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

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

const baseReport: Omit<CandidateReport, "themes"> = {
  overall: "Candidat correct dans l'ensemble.",
  strengths: ["Bonne communication"],
  gaps: ["Manque de profondeur technique"],
  recommendation: "maybe",
  recommendationReason: "Profil à confirmer.",
};

describe("Session theme rollup", () => {
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

  it("rolls up the last known status per theme, excluding jargon cards", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(
      [
        "[strength] [pas-acquis] [aws-lambda-scheduling] [contexte]",
        "# Premier passage sur AWS Lambda",
        "Réponse vague sur l'architecture.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[jargon] [acquis] [aws-lambda-scheduling] [none]",
        "# Définition : EventBridge",
        "EventBridge programme des tâches.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On utilise EventBridge pour ça.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[strength] [acquis] [aws-lambda-scheduling] [ownership]",
        "# Rôle clarifié sur AWS Lambda",
        "Le candidat a conçu le scheduling lui-même.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("C'est moi qui ai mis ça en place.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes).toEqual([
      { theme: "aws-lambda-scheduling", status: "acquis", label: "Rôle clarifié sur AWS Lambda" },
    ]);
  });

  it("lists distinct themes in order of first appearance", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(
      [
        "[translation] [a-creuser] [parcours-candidat] [none]",
        "# Parcours du candidat",
        "Le candidat décrit son parcours.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("J'ai commencé chez une startup.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[strength] [acquis] [aws-lambda-scheduling] [impact]",
        "# Impact du scheduling AWS",
        "Le candidat chiffre le gain de performance.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("Ça a réduit la latence de 40%.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes.map((t) => t.theme)).toEqual(["parcours-candidat", "aws-lambda-scheduling"]);
  });

  it("normalizes capitalized and accented/spaced status variants instead of falling back to a-creuser", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    // Capitalized status ("Acquis") — must still resolve to "acquis", not the
    // "a-creuser" default that a failed case-sensitive match would produce.
    mockStreamAssistOnce(
      [
        "[strength] [Acquis] [aws-lambda-scheduling] [contexte]",
        "# Maîtrise du scheduling AWS Lambda",
        "Réponse claire sur l'architecture.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    // Accented/spaced status ("pas acquis") — must still resolve to the
    // canonical "pas-acquis", not fail the whole header match.
    mockStreamAssistOnce(
      [
        "[attention] [pas acquis] [gcp-basics] [contexte]",
        "# Lacune sur les bases GCP",
        "Le candidat ne connaît pas les concepts de base de GCP.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("Je n'ai jamais utilisé GCP.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes).toEqual([
      { theme: "aws-lambda-scheduling", status: "acquis", label: "Maîtrise du scheduling AWS Lambda" },
      { theme: "gcp-basics", status: "pas-acquis", label: "Lacune sur les bases GCP" },
    ]);
  });

  it("omits themes with no evaluative card (jargon-only)", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(
      [
        "[jargon] [acquis] [definition-only] [none]",
        "# Définition : idempotence",
        "Une opération idempotente peut être répétée sans effet de bord.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On garde nos endpoints idempotents.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes).toEqual([]);
  });
});
