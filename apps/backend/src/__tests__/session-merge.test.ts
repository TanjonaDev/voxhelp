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
const mockLlm = vi.hoisted(() => ({
  streamAssist: vi.fn(),
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const firstCardText = [
  "[strength] [high]",
  "# Stack technique maîtrisée",
  "Le candidat maîtrise la stack backend Node.js.",
].join("\n");

const mergeCardText = [
  "[merge]",
  "[strength] [high]",
  "# Stack technique et portefeuille de projets",
  "Le candidat maîtrise la stack backend Node.js et a un portefeuille de projets data concrets.",
].join("\n");

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

  it("merges into the previous card's id when the LLM responds with [merge] inside the merge window", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(firstCardText);
    stt.callbacks!.onTranscript("Premier segment du monologue.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const firstDone = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(mergeCardText);
    stt.callbacks!.onTranscript("Deuxième segment, même sous-thème.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));

    // The mock streamAssist resolves the whole [merge] blob in a single onChunk call, so the
    // server flushes assist:cancel, assist:start (reused id) and assist:done in one synchronous
    // burst. Awaiting these sequentially would register the "assist:done" listener only after
    // that burst already landed, losing the message — so both listeners must be attached before
    // either message can arrive.
    const [cancelMsg, secondDone] = await Promise.all([
      waitForMessage(ws, "assist:cancel") as Promise<Extract<ServerMessage, { type: "assist:cancel" }>>,
      waitForMessage(ws, "assist:done") as Promise<Extract<ServerMessage, { type: "assist:done" }>>,
    ]);

    expect(cancelMsg.id).not.toBe(firstDone.id);
    expect(secondDone.id).toBe(firstDone.id);
    expect(secondDone.fullText).not.toContain("[merge]");
    expect(secondDone.fullText).toContain("portefeuille de projets data concrets");
  });

  it("does not offer a merge candidate once the merge window has elapsed", async () => {
    server = await createTestServer(null, 3 * 60 * 1000, 100);
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(firstCardText);
    stt.callbacks!.onTranscript("Premier segment du monologue.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    await wait(150);

    mockStreamAssistOnce(firstCardText);
    stt.callbacks!.onTranscript("Deuxième segment, sujet différent.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).not.toContain("Dernière card émise");
  });
});
