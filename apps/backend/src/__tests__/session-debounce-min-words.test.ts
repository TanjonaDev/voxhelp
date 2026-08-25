import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
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

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const sampleAssistText = [
  "[strength] [acquis] [typescript-strict-mode] [none]",
  "# Discipline TypeScript",
  "Le candidat type tout le code avec rigueur.",
].join("\n");

describe("Session debounce minimum word gate", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockLlm.streamAssist.mockImplementation(
      async (_sys: string, _user: string, onChunk: (t: string) => void) => {
        onChunk(sampleAssistText);
        return sampleAssistText;
      }
    );
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("does not analyze a fragment shorter than the minimum word count when the debounce fires", async () => {
    server = await createTestServer(null, 3 * 60 * 1000, 50);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    stt.callbacks!.onTranscript("TypeScript");
    await wait(150);

    expect(mockLlm.streamAssist).not.toHaveBeenCalled();
  });

  it("keeps buffering a too-short fragment and analyzes the combined text once enough words accumulate", async () => {
    server = await createTestServer(null, 3 * 60 * 1000, 50);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    stt.callbacks!.onTranscript("TypeScript");
    await wait(150);
    expect(mockLlm.streamAssist).not.toHaveBeenCalled();

    stt.callbacks!.onTranscript("on type tout le code avec rigueur.");
    await waitForMessage(ws, "assist:done");

    expect(mockLlm.streamAssist).toHaveBeenCalledTimes(1);
    const userText = mockLlm.streamAssist.mock.calls[0][1] as string;
    expect(userText).toContain("TypeScript on type tout le code avec rigueur.");
  });

  it("still flushes a short fragment once maxBufferMs elapses, even below the minimum word count", async () => {
    server = await createTestServer(null, 120, 50);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    stt.callbacks!.onTranscript("TypeScript");
    await waitForMessage(ws, "assist:done");

    expect(mockLlm.streamAssist).toHaveBeenCalledTimes(1);
    const userText = mockLlm.streamAssist.mock.calls[0][1] as string;
    expect(userText).toContain("TypeScript");
  });
});
