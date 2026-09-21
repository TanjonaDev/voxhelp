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
  createCalls: 0,
  lastKeyterms: undefined as string[] | undefined,
}));

vi.mock("../stt/index.js", () => {
  class MockSttProviderError extends Error {}
  return {
    SttProviderError: MockSttProviderError,
    createLiveStt: (options: { keyterms?: string[] }, callbacks: STTCallbacks) => {
      stt.createCalls += 1;
      stt.lastKeyterms = options.keyterms;
      return {
        async start() {
          callbacks.onListening();
        },
        sendAudio() {},
        close() {},
      };
    },
  };
});

vi.mock("../llm.js", () => ({
  streamAssist: vi.fn(),
  callClaudeJSON: vi.fn(),
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

interface Connection {
  ws: WebSocket;
  received: ServerMessage[];
}

function connect(port: number): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const received: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("message", (data) => {
      received.push(JSON.parse(data.toString()) as ServerMessage);
    });
    ws.once("open", () => resolve({ ws, received }));
    ws.once("error", reject);
  });
}

function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForType(received: ServerMessage[], type: ServerMessage["type"], timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (received.some((m) => m.type === type)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${type}`));
      }
    }, 10);
  });
}

describe("Session session:start config validation", () => {
  let server: TestServer;
  let ws: WebSocket;
  let received: ServerMessage[];

  beforeEach(async () => {
    stt.createCalls = 0;
    stt.lastKeyterms = undefined;
    server = await createTestServer();
    ({ ws, received } = await connect(server.port));
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  const invalidConfigs: Array<[string, unknown]> = [
    ["null", null],
    ["a string", "x"],
    ["an unknown language", { language: "xx" }],
    ["keywords sent as a string", { language: "fr", keywords: "abc" }],
    ["jobContext sent as a string", { language: "fr", jobContext: "x" }],
    ["a numeric sttProvider", { language: "fr", sttProvider: 5 }],
  ];

  it.each(invalidConfigs)("rejects a session:start whose config is %s and keeps serving", async (_label, config) => {
    ws.send(JSON.stringify({ type: "session:start", config }));
    await settle();

    expect(received).toEqual([{ type: "session:error", error: "Configuration de session invalide" }]);
    expect(received.some((m) => m.type === "session:ready")).toBe(false);
    expect(stt.createCalls).toBe(0);

    // Le process n'a pas planté : la connexion répond toujours.
    ws.send(JSON.stringify({ type: "ping" }));
    await waitForType(received, "pong");
    expect(received.at(-1)).toEqual({ type: "pong" });
  });

  it("filters junk keywords and starts the session with the valid ones", async () => {
    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr", keywords: [1, null, "Kubernetes"] } }));
    await waitForType(received, "session:ready");

    expect(received.some((m) => m.type === "session:error")).toBe(false);
    expect(stt.createCalls).toBe(1);
    expect(stt.lastKeyterms).toEqual(["Kubernetes"]);
  });
});
