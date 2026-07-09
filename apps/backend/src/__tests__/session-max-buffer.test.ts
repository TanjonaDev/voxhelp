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
  "[strength] [high]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
].join("\n");

describe("Session max buffer flush", () => {
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

  it("flushes the buffered transcript after maxBufferMs even if new turns keep arriving faster than the debounce", async () => {
    server = await createTestServer(null, 150);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    const start = Date.now();
    stt.callbacks!.onTranscript("Premier segment du monologue.");
    await wait(60);
    stt.callbacks!.onTranscript("Deuxième segment du monologue.");
    await wait(60);
    stt.callbacks!.onTranscript("Troisième segment du monologue.");

    await waitForMessage(ws, "assist:done");
    const elapsed = Date.now() - start;

    // With only the 1500ms debounce (pre-implementation), this flush wouldn't
    // happen until ~1500ms after the last piece (~1620ms total). The 150ms
    // maxBufferMs must force it far sooner than that.
    expect(elapsed).toBeLessThan(800);
    expect(mockLlm.streamAssist).toHaveBeenCalledTimes(1);
    const userText = mockLlm.streamAssist.mock.calls[0][1] as string;
    expect(userText).toContain("Premier segment du monologue.");
    expect(userText).toContain("Deuxième segment du monologue.");
    expect(userText).toContain("Troisième segment du monologue.");
  });

  it("does not double-flush once the stale debounce timer's original deadline passes", async () => {
    server = await createTestServer(null, 100);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    const start = Date.now();
    stt.callbacks!.onTranscript("Un seul segment.");
    await waitForMessage(ws, "assist:done");
    const elapsed = Date.now() - start;

    // Confirms this particular flush was driven by maxBufferMs (100ms), not
    // the 1500ms debounce — otherwise the check below would be meaningless.
    expect(elapsed).toBeLessThan(500);

    // Wait past the original (1500ms) debounce deadline that was pending
    // when the buffer was flushed early. If flushBuffer() didn't clear it,
    // it would fire again here with an empty buffer.
    await wait(1700);

    expect(mockLlm.streamAssist).toHaveBeenCalledTimes(1);
  });
});
