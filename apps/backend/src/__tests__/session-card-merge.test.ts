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

function card(theme: string, title: string, relance?: string): string {
  const lines = [
    `[strength] [acquis] [${theme}] [none]`,
    `# ${title}`,
    "Détail factuel sur ce sujet.",
  ];
  if (relance) lines.push(`>> ${relance}`);
  return lines.join("\n");
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session card merge", () => {
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

  it("merges into the previous card when the theme matches and the previous card had no relance", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("aws-serverless", "Premier passage"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const first = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(card("aws-serverless", "Complément sur le même sujet"));
    stt.callbacks!.onTranscript("Et on a aussi EventBridge.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const second = (await waitForMessage(ws, "assist:update")) as Extract<ServerMessage, { type: "assist:update" }>;

    expect(second.id).toBe(first.id);
    expect(second.fullText).toContain("Complément sur le même sujet");
  });

  it("does not merge when the previous card had a relance", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("aws-serverless", "Premier passage", "Qui a pris cette décision ?"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const first = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(card("aws-serverless", "Suite sur le même sujet"));
    stt.callbacks!.onTranscript("C'est moi qui ai décidé.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const second = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    expect(second.id).not.toBe(first.id);
  });

  it("does not merge when the theme differs", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("aws-serverless", "Premier sujet"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const first = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(card("methodologie-travail", "Sujet différent"));
    stt.callbacks!.onTranscript("On travaille en méthode agile.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const second = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    expect(second.id).not.toBe(first.id);
  });
});
