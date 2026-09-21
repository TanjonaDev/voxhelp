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
  lastProviderId: undefined as string | undefined,
  throwWith: null as string | null,
}));

vi.mock("../stt/index.js", () => ({
  createLiveStt: (_options: unknown, callbacks: STTCallbacks, providerId?: string) => {
    if (stt.throwWith) throw new Error(stt.throwWith);
    stt.lastProviderId = providerId;
    return {
      async start() { callbacks.onListening(); },
      sendAudio() {},
      close() {},
    };
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: vi.fn(),
  callClaudeJSON: vi.fn(),
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

interface FirstReply {
  ws: WebSocket;
  reply: ServerMessage;
  received: ServerMessage[];
}

function startSession(port: number, sttProvider?: string): Promise<FirstReply> {
  return new Promise((resolve) => {
    const received: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr", sttProvider } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      received.push(msg);
      if (msg.type === "session:ready" || msg.type === "session:error") resolve({ ws, reply: msg, received });
    });
  });
}

describe("Session STT provider selection", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    stt.lastProviderId = undefined;
    stt.throwWith = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("passes SessionConfig.sttProvider to createLiveStt", async () => {
    server = await createTestServer();

    const started = await startSession(server.port, "inworld");
    ws = started.ws;

    expect(started.reply.type).toBe("session:ready");
    expect(stt.lastProviderId).toBe("inworld");
  });

  it("passes undefined when the client does not choose a provider", async () => {
    server = await createTestServer();

    const started = await startSession(server.port);
    ws = started.ws;

    expect(started.reply.type).toBe("session:ready");
    expect(stt.lastProviderId).toBeUndefined();
  });

  it("answers session:error and never session:ready when the STT provider is rejected", async () => {
    stt.throwWith = 'Modèle STT inconnu : "whisper"';
    server = await createTestServer();

    const started = await startSession(server.port, "whisper");
    ws = started.ws;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(started.reply).toEqual({ type: "session:error", error: 'Modèle STT inconnu : "whisper"' });
    expect(started.received.some((m) => m.type === "session:ready")).toBe(false);
  });
});
