import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { CandidateReport, ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";
import { waitForMessage } from "./helpers/ws.js";

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
    constructor(_lang: string, _keywords: string[] | undefined, callbacks: STTCallbacks) {
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
  "[strength] [acquis]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
  ">> Dans quel type de projet avez-vous utilisé React ?",
].join("\n");

const sampleReport: Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel"> = {
  summary: "Candidat solide avec une expérience React clairement démontrée.",
  techMatching: [
    {
      skill: "React",
      status: "demontre",
      evidence: "Expérience terrain confirmée avec exemple concret.",
      citation: { quote: "J'ai développé la plateforme e-commerce en React pendant deux ans.", t: "03:10" },
    },
  ],
  strengths: [
    {
      text: "Expérience terrain claire",
      citation: { quote: "J'ai développé la plateforme e-commerce en React pendant deux ans.", t: "03:10" },
    },
  ],
  attentionPoints: [{ text: "TypeScript avancé non confirmé" }],
  keyProjects: [],
  verdict: "presenter",
  verdictReason: "Profil directement applicable au poste visé.",
  verdictChecklist: [],
  nextSteps: ["Prévoir un entretien technique approfondi sur TypeScript."],
  suggestedQuestions: ["Pouvez-vous détailler votre usage des types avancés TypeScript ?"],
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

    expect(msg.report.verdict).toBe("presenter");
    expect(msg.report.strengths).toHaveLength(1);
    expect(msg.report.attentionPoints).toHaveLength(1);
    expect(msg.report.summary).toContain("Candidat solide");
  });

  it("fills candidateName and jobTitle with defaults when the session was started without them", async () => {
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.candidateName).toBe("Candidat");
    expect(msg.report.jobTitle).toBe("Poste non précisé");
    expect(msg.report.durationLabel).toMatch(/^\d+ min$/);
    expect(msg.report.interviewDate).toBeTruthy();
  });

  it("uses the configured candidate name and job title when provided", async () => {
    ws.send(JSON.stringify({
      type: "session:start",
      config: {
        language: "fr",
        candidateName: "Awa Diallo",
        jobContext: { title: "Lead Backend", level: "Senior", stack: "Node.js" },
      },
    }));
    await waitForMessage(ws, "session:ready");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.candidateName).toBe("Awa Diallo");
    expect(msg.report.jobTitle).toBe("Lead Backend");
  });

  it("keeps the server-computed header fields even if the LLM hallucinates its own", async () => {
    ws.send(JSON.stringify({
      type: "session:start",
      config: {
        language: "fr",
        candidateName: "Awa Diallo",
        jobContext: { title: "Lead Backend", level: "Senior", stack: "Node.js" },
      },
    }));
    await waitForMessage(ws, "session:ready");

    mockLlm.callClaudeJSON.mockResolvedValueOnce({
      ...sampleReport,
      candidateName: "HALLUCINÉ",
      jobTitle: "Poste inventé",
      interviewDate: "2000-01-01T00:00:00.000Z",
      durationLabel: "999 min",
    });
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.candidateName).toBe("Awa Diallo");
    expect(msg.report.jobTitle).toBe("Lead Backend");
    expect(msg.report.interviewDate).not.toBe("2000-01-01T00:00:00.000Z");
    expect(msg.report.durationLabel).not.toBe("999 min");
  });

  it("includes accumulated cards and the timestamped transcript in the final analysis prompt", async () => {
    mockStreamAssist(sampleAssistText);
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onTranscript("Premier transcript");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:summarize" }));
    await waitForMessage(ws, "analysis:final");

    const finalPrompt = mockLlm.callClaudeJSON.mock.calls[0][0] as string;
    expect(finalPrompt).toContain("Expérience terrain confirmée en React");
    expect(finalPrompt).toContain("FICHE DE QUALIFICATION");
    expect(finalPrompt).toContain('"Premier transcript"');
  });
});
