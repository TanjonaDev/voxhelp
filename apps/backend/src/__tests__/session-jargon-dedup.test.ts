import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";
import { waitForMessage } from "./helpers/ws.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({ streamAssist: vi.fn() }));

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
  callClaudeJSON: vi.fn(),
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

function card(cat: string, theme: string, title: string): string {
  return [
    `[${cat}] [acquis] [${theme}] [none]`,
    `# ${title}`,
    "Détail sur ce sujet.",
  ].join("\n");
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session jargon/theme dedup", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("adds the jargon-guard instruction on the next card of the same theme after a [jargon] card", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("jargon", "aws-serverless", "Pipeline Lambda expliqué"));
    stt.callbacks!.onTranscript("On utilise des Lambdas pour le pipeline.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("jargon", "aws-serverless", "Encore le même pipeline"));
    stt.callbacks!.onTranscript("Toujours le même pipeline serverless.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).toContain("Le jargon technique du thème « aws-serverless » a déjà été décodé");
  });

  it("does not add the jargon-guard instruction if no [jargon] card was emitted on the theme yet", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("strength", "aws-serverless", "Bonne maîtrise du serverless"));
    stt.callbacks!.onTranscript("J'ai conçu ce pipeline serverless.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("strength", "aws-serverless", "Suite sur le même thème"));
    stt.callbacks!.onTranscript("On continue sur ce sujet.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).not.toContain("a déjà été décodé");
  });

  it("keeps the jargon-guard active when the theme resurfaces after switching away", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("jargon", "aws-serverless", "Pipeline Lambda expliqué"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("translation", "methodologie-travail", "Méthode de travail"));
    stt.callbacks!.onTranscript("On travaille en méthode agile.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("strength", "aws-serverless", "Retour sur le pipeline"));
    stt.callbacks!.onTranscript("Pour revenir sur le pipeline serverless.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("strength", "aws-serverless", "Encore sur le pipeline"));
    stt.callbacks!.onTranscript("Toujours ce même pipeline.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const fourthPrompt = mockLlm.streamAssist.mock.calls[3][0] as string;
    expect(fourthPrompt).toContain("Le jargon technique du thème « aws-serverless » a déjà été décodé");
  });
});
