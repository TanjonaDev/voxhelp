import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, SessionConfig, TechTranslation } from "@voxhelp/shared";
import { DeepgramSTT } from "./deepgram.js";
import { generateFromPrompt, callClaudeJSON } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildTechTranslatePrompt } from "./prompts/tech-translate.js";

export class Session {
  private ws: WebSocket;
  private stt: DeepgramSTT | null = null;
  private config: SessionConfig | null = null;
  private transcriptBuffer: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 1800;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.ws.on("message", (data) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch {
        if (Buffer.isBuffer(data) && this.stt) {
          this.stt.sendAudio(data);
        }
      }
    });

    this.ws.on("close", () => this.cleanup());
    this.ws.on("error", (err) => {
      console.error("[Session] WS error:", err.message);
      this.cleanup();
    });
  }

  private handleMessage(message: ClientMessage): void {
    switch (message.type) {
      case "session:start":
        this.startSession(message.config);
        break;
      case "session:stop":
        this.cleanup();
        break;
      case "audio:chunk":
        this.handleAudioChunk(message.data);
        break;
      case "ping":
        this.send({ type: "pong" });
        break;
    }
  }

  private startSession(config: SessionConfig): void {
    this.config = config;
    this.transcriptBuffer = [];

    this.stt = new DeepgramSTT(config.language, {
      onPartial: (text) => this.send({ type: "transcript:partial", text }),
      onFinal: (text) => this.handleFinalTranscript(text),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    this.stt.connect();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}`);
  }

  private handleAudioChunk(base64Data: string): void {
    if (!this.stt) return;
    const buffer = Buffer.from(base64Data, "base64");
    this.stt.sendAudio(buffer);
  }

  private handleFinalTranscript(text: string): void {
    if (!text.trim()) return;

    this.send({ type: "transcript:final", text });
    this.transcriptBuffer.push(text);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      const fullText = this.transcriptBuffer.join(" ");
      this.transcriptBuffer = [];

      if (fullText.trim().length < 10) return;

      if (this.isProcessing) {
        this.pendingTranscript = fullText;
        return;
      }

      this.processTranscript(fullText);
    }, this.DEBOUNCE_MS);
  }

  private async processTranscript(transcript: string): Promise<void> {
    this.isProcessing = true;

    await Promise.all([
      this.runTechTranslation(transcript),
      this.runAssist(transcript),
    ]);

    this.isProcessing = false;

    if (this.pendingTranscript) {
      const pending = this.pendingTranscript;
      this.pendingTranscript = null;
      this.processTranscript(pending);
    }
  }

  private async runTechTranslation(transcript: string): Promise<void> {
    try {
      const result = await callClaudeJSON<{ translations: TechTranslation[] }>(
        buildTechTranslatePrompt(),
        `TRANSCRIPTION:\n"${transcript}"`
      );
      for (const translation of result.translations) {
        this.send({ type: "tech:translation", translation });
      }
    } catch (err) {
      console.error("[Session] Tech translation error:", err instanceof Error ? err.message : err);
    }
  }

  private async runAssist(transcript: string): Promise<void> {
    await generateFromPrompt(
      buildLiveAssistPrompt(),
      `Ce qui vient d'être dit :\n"${transcript}"`,
      {
        onStart: () => this.send({ type: "assist:start" }),
        onChunk: (text) => this.send({ type: "assist:chunk", text }),
        onDone: (fullText) => this.send({ type: "assist:done", fullText }),
        onError: (error) => this.send({ type: "assist:error", error }),
      }
    );
  }

  private send(message: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private cleanup(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.transcriptBuffer = [];
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    console.log("[Session] Cleaned up");
  }
}
