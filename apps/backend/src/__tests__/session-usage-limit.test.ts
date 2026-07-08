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
const mockSupabase = vi.hoisted(() => ({
  profileResult: { data: null as { session_count: number; session_limit: number } | null, error: null as { message: string } | null },
  rpc: vi.fn(() => Promise.resolve({ error: null as { message: string } | null })),
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

vi.mock("../supabase.js", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve(mockSupabase.profileResult),
        }),
      }),
    }),
    rpc: mockSupabase.rpc,
  },
}));

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
  });
}

const sampleAssistText = [
  "[strength] [high]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
].join("\n");

describe("Session usage limit", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockSupabase.rpc.mockClear();
    mockSupabase.rpc.mockResolvedValue({ error: null });
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("blocks session:start and does not create an STT connection when quota is exhausted", async () => {
    mockSupabase.profileResult = { data: { session_count: 5, session_limit: 5 }, error: null };
    server = await createTestServer("user-at-limit");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = (await waitForMessage(ws, "session:error")) as Extract<ServerMessage, { type: "session:error" }>;
    expect(msg.error).toContain("Limite de 5 entretiens atteinte");
    expect(stt.callbacks).toBeNull();
  });

  it("allows session:start when the user is under quota", async () => {
    mockSupabase.profileResult = { data: { session_count: 2, session_limit: 5 }, error: null };
    server = await createTestServer("user-under-limit");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = await waitForMessage(ws, "session:ready");
    expect(msg.type).toBe("session:ready");
  });

  it("allows session:start when Supabase profile read errors (fail open)", async () => {
    mockSupabase.profileResult = { data: null, error: { message: "boom" } };
    server = await createTestServer("user-error");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = await waitForMessage(ws, "session:ready");
    expect(msg.type).toBe("session:ready");
  });

  it("allows session:start when userId is null (auth disabled)", async () => {
    mockSupabase.profileResult = { data: { session_count: 5, session_limit: 5 }, error: null };
    server = await createTestServer(null);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = await waitForMessage(ws, "session:ready");
    expect(msg.type).toBe("session:ready");
  });

  it("increments session_count after a session with at least one transcript", async () => {
    mockSupabase.profileResult = { data: { session_count: 0, session_limit: 5 }, error: null };
    mockLlm.streamAssist.mockImplementationOnce(
      async (_sys: string, _user: string, onChunk: (t: string) => void) => {
        onChunk(sampleAssistText);
        return sampleAssistText;
      }
    );
    server = await createTestServer("user-with-content");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    stt.callbacks!.onTranscript("J'utilise React depuis 3 ans en production");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:stop" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSupabase.rpc).toHaveBeenCalledWith("increment_session_count", { uid: "user-with-content" });
  });

  it("does not increment session_count when the session had no transcript", async () => {
    mockSupabase.profileResult = { data: { session_count: 0, session_limit: 5 }, error: null };
    server = await createTestServer("user-empty-session");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    ws.send(JSON.stringify({ type: "session:stop" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
