import { DeepgramClient } from "@deepgram/sdk";

interface FluxSTTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

interface FluxConnection {
  on(event: "message", cb: (msg: { type?: string; event?: string; transcript?: string }) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "open", cb: () => void): void;
  connect(): unknown;
  waitForOpen(): Promise<unknown>;
  sendMedia(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
}

export class FluxSTT {
  private connection: FluxConnection | null = null;
  private callbacks: FluxSTTCallbacks;
  private language: string;
  private keywords: string[] | undefined;
  private closed = false;

  constructor(language: string, keywords: string[] | undefined, callbacks: FluxSTTCallbacks) {
    this.callbacks = callbacks;
    this.language = language;
    this.keywords = keywords;
  }

  async start(): Promise<void> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      this.callbacks.onError("DEEPGRAM_API_KEY not set");
      return;
    }

    const hints: string[] = [this.language];
    if (this.language !== "en") hints.push("en");

    try {
      const client = new DeepgramClient();

      const hasKeyterms = Boolean(this.keywords && this.keywords.length > 0);
      console.log(
        `[FluxSTT] Connecting to Deepgram: language_hint=[${hints.join(", ")}] keyterm=${hasKeyterms ? `[${this.keywords!.join(", ")}]` : "none"}`
      );

      const connection = await client.listen.v2.connect({
        model: "flux-general-multi",
        encoding: "linear16",
        sample_rate: 16000,
        language_hint: hints,
        ...(hasKeyterms ? { keyterm: this.keywords } : {}),
        Authorization: `Token ${apiKey}`,
      }) as unknown as FluxConnection;

      this.connection = connection;

      connection.on("message", (message) => {
        if (this.closed) return;
        if (message.type === "TurnInfo" && message.event === "EndOfTurn" && message.transcript?.trim()) {
          this.callbacks.onTranscript(message.transcript.trim());
        }
      });

      connection.on("error", (err) => {
        if (!this.closed) {
          this.callbacks.onError(err.message || "Deepgram connection error");
        }
      });

      connection.connect();
      await connection.waitForOpen();

      if (!this.closed) {
        this.callbacks.onListening();
      }
    } catch (err) {
      if (!this.closed) {
        this.callbacks.onError(
          err instanceof Error ? err.message : "Failed to connect to Deepgram"
        );
      }
    }
  }

  sendAudio(buf: Buffer): void {
    if (this.closed || !this.connection) return;
    try {
      this.connection.sendMedia(buf);
    } catch {
      // connection may have closed between check and send
    }
  }

  close(): void {
    this.closed = true;
    if (this.connection) {
      try {
        this.connection.close();
      } catch {
        // ignore cleanup errors
      }
      this.connection = null;
    }
  }
}
