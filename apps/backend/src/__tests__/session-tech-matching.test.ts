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
      ws.send(JSON.stringify({
        type: "session:start",
        config: { language: "fr", jobContext: { title: "Lead Backend", level: "Senior", stack: "Node.js, PostgreSQL" } },
      }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

const generatedReport: Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel"> = {
  summary: "Candidat expérimenté sur la stack backend attendue.",
  techMatching: [
    {
      skill: "Node.js",
      status: "demontre",
      evidence: "Exemple concret d'API Node.js en production avec résultat chiffré.",
      citation: { quote: "J'ai construit l'API de paiement en Node.js, ça a réduit la latence de 30%.", t: "05:42" },
    },
    {
      skill: "PostgreSQL",
      status: "mentionne",
      evidence: "PostgreSQL cité sans exemple précis.",
      citation: { quote: "On utilisait PostgreSQL côté base de données.", t: "07:15" },
    },
    {
      skill: "Kubernetes",
      status: "non-aborde",
      evidence: "Jamais mentionné pendant l'entretien.",
    },
  ],
  strengths: [
    {
      text: "Impact chiffré sur la latence de l'API de paiement",
      citation: { quote: "J'ai construit l'API de paiement en Node.js, ça a réduit la latence de 30%.", t: "05:42" },
    },
  ],
  attentionPoints: [
    { text: "Le candidat utilise souvent « on » plutôt que « j'ai » — à clarifier son rôle exact dans l'équipe." },
  ],
  keyProjects: [
    {
      company: "Acme Corp",
      period: "2021-2023",
      stack: "Node.js, PostgreSQL",
      role: "Lead Backend",
      impact: "Réduction de 30% de la latence de l'API de paiement.",
    },
  ],
  verdict: "presenter",
  verdictReason: "Compétences backend clairement démontrées avec impact chiffré.",
  verdictChecklist: [],
  nextSteps: ["Approfondir l'expérience Kubernetes en entretien technique."],
  suggestedQuestions: ["Avez-vous déjà déployé sur Kubernetes ?"],
};

describe("Session final report — tech matching pass-through", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockLlm.callClaudeJSON.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("passes through each skill's status and citation exactly as returned by the LLM", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockLlm.callClaudeJSON.mockResolvedValueOnce(generatedReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.techMatching).toEqual(generatedReport.techMatching);
  });

  it("omits citation for a non-aborde skill instead of fabricating one", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockLlm.callClaudeJSON.mockResolvedValueOnce(generatedReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    const kubernetes = msg.report.techMatching.find((m) => m.skill === "Kubernetes");
    expect(kubernetes?.status).toBe("non-aborde");
    expect(kubernetes?.citation).toBeUndefined();
  });

  it("merges the server-computed header fields with the LLM-generated content", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockLlm.callClaudeJSON.mockResolvedValueOnce(generatedReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.jobTitle).toBe("Lead Backend");
    expect(msg.report.candidateName).toBe("Candidat");
    expect(msg.report.verdict).toBe("presenter");
    expect(msg.report.keyProjects).toEqual(generatedReport.keyProjects);
  });
});
