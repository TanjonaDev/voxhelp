import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { CandidateReport, ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({
  streamAssist: vi.fn(),
  callClaudeJSON: vi.fn(),
}));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: mockLlm.streamAssist,
  callClaudeJSON: mockLlm.callClaudeJSON,
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for message type "${type}"`));
    }, timeout);

    function handler(data: Buffer) {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}

function connectAndStart(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

const sampleAssistText = [
  "[strength] [high]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
  ">> Dans quel type de projet avez-vous utilisé React ?",
].join("\n");

const sampleReport: CandidateReport = {
  overall: "Candidat solide avec une expérience React clairement démontrée.",
  strengths: ["Expérience terrain claire", "Exemples concrets et précis"],
  gaps: ["TypeScript avancé non confirmé"],
  recommendation: "hire",
  recommendationReason: "Profil directement applicable au poste visé.",
};

function mockStreamAssist(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session WebSocket integration", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(async () => {
    mockLlm.streamAssist.mockReset();
    mockLlm.callClaudeJSON.mockReset();
    stt.callbacks = null;
    server = await createTestServer();
    ws = await connectAndStart(server.port);
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("sends assist:done when a transcript arrives", async () => {
    mockStreamAssist(sampleAssistText);

    stt.callbacks!.onTranscript("J'utilise React depuis 3 ans en production");

    const msg = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    expect(msg.fullText).toContain("Expérience terrain confirmée en React");
    expect(msg.id).toBeTruthy();
  });

  it("includes previous card context in the prompt for the second analysis", async () => {
    mockStreamAssist(sampleAssistText);
    mockStreamAssist(sampleAssistText);

    stt.callbacks!.onTranscript("Premier transcript");
    await waitForMessage(ws, "assist:done");

    stt.callbacks!.onTranscript("Deuxième transcript");
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).toContain("Expérience terrain confirmée en React");
    expect(secondPrompt).toContain("Sujets déjà analysés");
  });

  it("does not repeat follow-up questions in subsequent analyses", async () => {
    mockStreamAssist(sampleAssistText);
    mockStreamAssist(sampleAssistText);

    stt.callbacks!.onTranscript("Premier transcript");
    await waitForMessage(ws, "assist:done");

    stt.callbacks!.onTranscript("Deuxième transcript");
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).toContain("Dans quel type de projet avez-vous utilisé React ?");
    expect(secondPrompt).toContain("ne pas répéter");
  });

  it("sends analysis:final in response to session:summarize", async () => {
    mockStreamAssist(sampleAssistText);
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onTranscript("Le candidat présente son expérience");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:summarize" }));

    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.recommendation).toBe("hire");
    expect(msg.report.strengths).toHaveLength(2);
    expect(msg.report.gaps).toHaveLength(1);
    expect(msg.report.overall).toContain("Candidat solide");
  });

  it("includes accumulated cards in the final analysis prompt", async () => {
    mockStreamAssist(sampleAssistText);
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onTranscript("Premier transcript");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:summarize" }));
    await waitForMessage(ws, "analysis:final");

    const finalPrompt = mockLlm.callClaudeJSON.mock.calls[0][0] as string;
    expect(finalPrompt).toContain("Expérience terrain confirmée en React");
    expect(finalPrompt).toContain("bilan final");
  });
});
