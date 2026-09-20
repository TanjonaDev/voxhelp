import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeSocket {
  url: string;
  options: { headers: Record<string, string> };
  readyState: number;
  sent: string[];
  closeCalled: boolean;
  emit(event: string, ...args: unknown[]): boolean;
}

const fake = vi.hoisted(() => ({ sockets: [] as FakeSocket[] }));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    closeCalled = false;
    constructor(
      public url: string,
      public options: { headers: Record<string, string> }
    ) {
      super();
      fake.sockets.push(this as unknown as FakeSocket);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.closeCalled = true;
      this.readyState = 3;
    }
  }
  return { default: FakeWebSocket };
});

const { InworldSTT } = await import("../stt/providers/inworld-live.js");

function makeCallbacks() {
  return { onTranscript: vi.fn(), onListening: vi.fn(), onError: vi.fn() };
}

function lastSocket(): FakeSocket {
  return fake.sockets[fake.sockets.length - 1];
}

function openSocket(socket: FakeSocket): void {
  socket.readyState = 1;
  socket.emit("open");
}

function serverSends(socket: FakeSocket, payload: unknown): void {
  socket.emit("message", Buffer.from(JSON.stringify(payload)));
}

async function startConnected(stt: InstanceType<typeof InworldSTT>): Promise<FakeSocket> {
  const started = stt.start();
  const socket = lastSocket();
  openSocket(socket);
  await started;
  return socket;
}

describe("InworldSTT", () => {
  beforeEach(() => {
    fake.sockets.length = 0;
    process.env.INWORLD_API_KEY = "test-key";
  });

  it("authenticates with Basic <key> against the streaming endpoint", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());

    const socket = await startConnected(stt);

    expect(socket.url).toBe("wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional");
    expect(socket.options.headers.Authorization).toBe("Basic test-key");
  });

  it("sends transcribeConfig first, with model, LINEAR16 16 kHz, language, prompts and turn detection", async () => {
    const stt = new InworldSTT("fr", ["Kubernetes", "Cléo"], makeCallbacks());

    const socket = await startConnected(stt);

    expect(JSON.parse(socket.sent[0])).toEqual({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        sampleRateHertz: 16000,
        language: "fr",
        prompts: ["Kubernetes", "Cléo"],
        endOfTurnConfidenceThreshold: 0.7,
        inworldSttV1Config: {
          minEndOfTurnSilenceWhenConfident: 300,
          maxTurnSilence: 1200,
        },
      },
    });
  });

  it("omits prompts when there are no keyterms", async () => {
    for (const keyterms of [undefined, []]) {
      fake.sockets.length = 0;
      const stt = new InworldSTT("en", keyterms, makeCallbacks());

      const socket = await startConnected(stt);

      expect(JSON.parse(socket.sent[0]).transcribeConfig).not.toHaveProperty("prompts");
    }
  });

  it("calls onListening only once the config has been sent", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);

    const started = stt.start();
    const socket = lastSocket();
    expect(callbacks.onListening).not.toHaveBeenCalled();

    openSocket(socket);
    await started;

    expect(callbacks.onListening).toHaveBeenCalledTimes(1);
  });

  it("ignores audio until the config has been sent", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());

    const started = stt.start();
    const socket = lastSocket();
    stt.sendAudio(Buffer.from([1, 2, 3]));
    expect(socket.sent).toHaveLength(0);

    openSocket(socket);
    await started;

    expect(socket.sent).toHaveLength(1); // uniquement la config
  });

  it("wraps audio in base64 audioChunk messages", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());
    const socket = await startConnected(stt);

    stt.sendAudio(Buffer.from([1, 2, 3]));

    expect(JSON.parse(socket.sent[1])).toEqual({ audioChunk: { content: "AQID" } });
  });

  it("emits onTranscript only for non-empty final results, trimmed", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    serverSends(socket, { result: { speechStarted: { startTimeMs: 0, confidence: 0 } } });
    serverSends(socket, { result: { transcription: { transcript: "Bon", isFinal: false } } });
    serverSends(socket, { result: { transcription: { transcript: "   ", isFinal: true } } });
    socket.emit("message", Buffer.from("not json"));
    expect(callbacks.onTranscript).not.toHaveBeenCalled();

    serverSends(socket, { result: { transcription: { transcript: "  Bonjour tout le monde.  ", isFinal: true } } });

    expect(callbacks.onTranscript).toHaveBeenCalledTimes(1);
    expect(callbacks.onTranscript).toHaveBeenCalledWith("Bonjour tout le monde.");
  });

  it("sends closeStream and closes the socket on close()", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());
    const socket = await startConnected(stt);

    stt.close();

    expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual({ closeStream: {} });
    expect(socket.closeCalled).toBe(true);
  });

  it("ignores server messages after close()", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    stt.close();
    serverSends(socket, { result: { transcription: { transcript: "Trop tard.", isFinal: true } } });

    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it("reports a missing API key without opening a socket", async () => {
    delete process.env.INWORLD_API_KEY;
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);

    await stt.start();

    expect(callbacks.onError).toHaveBeenCalledWith("INWORLD_API_KEY not set");
    expect(fake.sockets).toHaveLength(0);
  });

  it("reports an explicit error for unsupported languages without opening a socket", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("zh", undefined, callbacks);

    await stt.start();

    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("zh"));
    expect(fake.sockets).toHaveLength(0);
  });

  it("reports a socket error that happens before the connection opens, once", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);

    const started = stt.start();
    const socket = lastSocket();
    socket.emit("error", new Error("ECONNREFUSED"));
    socket.emit("close", 1006);
    await started;

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith("ECONNREFUSED");
    expect(callbacks.onListening).not.toHaveBeenCalled();
  });

  it("reports an unexpected close once connected", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    socket.emit("close", 1006);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("1006"));
  });

  it("reports a single onError when a connected socket emits error then close", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    socket.emit("error", new Error("ECONNRESET"));
    socket.emit("close", 1006);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith("ECONNRESET");
  });

  it("stays silent when the socket closes after close()", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    stt.close();
    socket.emit("close", 1000);

    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("forwards server error messages to onError", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    serverSends(socket, { error: { message: "quota exceeded" } });

    expect(callbacks.onError).toHaveBeenCalledWith("quota exceeded");
  });
});
