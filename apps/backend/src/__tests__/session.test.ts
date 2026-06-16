import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { CandidateReport, ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";

interface STTCallbacks {
  onBuffering: () => void;
  onIdle: () => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

// vi.hoisted allows these values to be captured inside vi.mock factories
const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({ callClaudeJSON: vi.fn() }));

vi.mock("../groq-stt.js", () => ({
  GroqSTT: class MockGroqSTT {
    constructor(_lang: string, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    start() {}
    sendAudio() {}
    async flush() {}
    close() {}
  },
}));

vi.mock("../llm.js", () => ({
  callClaudeJSON: mockLlm.callClaudeJSON,
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

// InsightPayload — what callClaudeJSON returns (no id, no t)
const samplePayload = {
  cat: "strength" as const,
  confidence: "confirmed" as const,
  title: "Expérience terrain confirmée en React",
  body: "Le candidat montre une vraie expérience React en production.",
  relance: "Dans quel type de projet avez-vous utilisé React ?",
};

const sampleReport: CandidateReport = {
  overall: "Candidat solide avec une expérience React clairement démontrée.",
  strengths: ["Expérience terrain claire", "Exemples concrets et précis"],
  gaps: ["TypeScript avancé non confirmé"],
  recommendation: "hire",
  recommendationReason: "Profil directement applicable au poste visé.",
};

describe("Session WebSocket integration", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(async () => {
    mockLlm.callClaudeJSON.mockReset();
    stt.callbacks = null;
    server = await createTestServer();
    ws = await connectAndStart(server.port);
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("sends assist:card when a transcript arrives", async () => {
    mockLlm.callClaudeJSON.mockResolvedValueOnce(samplePayload);

    stt.callbacks!.onFinal("J'utilise React depuis 3 ans en production");

    const msg = (await waitForMessage(ws, "assist:card")) as Extract<ServerMessage, { type: "assist:card" }>;

    expect(msg.card.title).toBe(samplePayload.title);
    expect(msg.card.confidence).toBe("confirmed");
    expect(msg.card.cat).toBe("strength");
    expect(msg.card.relance).toBeTruthy();
    // id and t are injected by session
    expect(msg.card.id).toBeTruthy();
    expect(msg.card.t).toMatch(/^\d{2}:\d{2}$/);
  });

  it("includes previous card context in the prompt for the second analysis", async () => {
    mockLlm.callClaudeJSON
      .mockResolvedValueOnce(samplePayload)
      .mockResolvedValueOnce({ ...samplePayload, title: "Deuxième analyse" });

    stt.callbacks!.onFinal("Premier transcript");
    await waitForMessage(ws, "assist:card");

    stt.callbacks!.onFinal("Deuxième transcript");
    await waitForMessage(ws, "assist:card");

    const secondPrompt = mockLlm.callClaudeJSON.mock.calls[1][0] as string;
    expect(secondPrompt).toContain("CONFIRMED");
    expect(secondPrompt).toContain("Expérience terrain confirmée en React");
    expect(secondPrompt).toContain("Analyses déjà effectuées");
  });

  it("does not repeat follow-up questions in subsequent analyses", async () => {
    mockLlm.callClaudeJSON
      .mockResolvedValueOnce(samplePayload)
      .mockResolvedValueOnce({ ...samplePayload, relance: "Autre question ?" });

    stt.callbacks!.onFinal("Premier transcript");
    await waitForMessage(ws, "assist:card");

    stt.callbacks!.onFinal("Deuxième transcript");
    await waitForMessage(ws, "assist:card");

    const secondPrompt = mockLlm.callClaudeJSON.mock.calls[1][0] as string;
    expect(secondPrompt).toContain("Dans quel type de projet avez-vous utilisé React ?");
    expect(secondPrompt).toContain("NE PAS répéter");
  });

  it("sends analysis:final in response to session:summarize", async () => {
    mockLlm.callClaudeJSON
      .mockResolvedValueOnce(samplePayload)
      .mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onFinal("Le candidat présente son expérience");
    await waitForMessage(ws, "assist:card");

    ws.send(JSON.stringify({ type: "session:summarize" }));

    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.recommendation).toBe("hire");
    expect(msg.report.strengths).toHaveLength(2);
    expect(msg.report.gaps).toHaveLength(1);
    expect(msg.report.overall).toContain("Candidat solide");
  });

  it("includes accumulated cards in the final analysis prompt", async () => {
    mockLlm.callClaudeJSON
      .mockResolvedValueOnce(samplePayload)
      .mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onFinal("Premier transcript");
    await waitForMessage(ws, "assist:card");

    ws.send(JSON.stringify({ type: "session:summarize" }));
    await waitForMessage(ws, "analysis:final");

    const finalPrompt = mockLlm.callClaudeJSON.mock.calls[1][0] as string;
    expect(finalPrompt).toContain("CONFIRMED");
    expect(finalPrompt).toContain("Expérience terrain confirmée en React");
    expect(finalPrompt).toContain("bilan final");
  });
});
