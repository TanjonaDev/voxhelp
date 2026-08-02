import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({
  callbacks: null as STTCallbacks | null,
  lastKeywords: undefined as string[] | undefined,
}));
const mockLlm = vi.hoisted(() => ({ streamAssist: vi.fn(), callClaudeJSON: vi.fn() }));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, keywords: string[] | undefined, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
      stt.lastKeywords = keywords;
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

function connectAndStart(port: number, keywords?: string[]): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr", keywords } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

describe("Session keyword passthrough", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    stt.callbacks = null;
    stt.lastKeywords = undefined;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("passes SessionConfig.keywords to the FluxSTT constructor", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port, ["Cléo", "RMC BFM", "Kubernetes"]);

    expect(stt.lastKeywords).toEqual(["Cléo", "RMC BFM", "Kubernetes"]);
  });

  it("passes undefined when no keywords are provided", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    expect(stt.lastKeywords).toBeUndefined();
  });
});
