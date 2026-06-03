import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, SessionConfig, InsightCard, JobContext } from "@voxhelp/shared";
import { GroqSTT } from "./groq-stt.js";
import { callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";

export class Session {
  private ws: WebSocket;
  private stt: GroqSTT | null = null;
  private config: SessionConfig | null = null;
  private jobContext: JobContext | undefined = undefined;
  private transcriptBuffer: string[] = [];
  private conversationLog: string[] = [];
  private questionLog: string[] = [];
  private readonly MAX_LOG_ENTRIES = 5;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 3000;

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
    this.jobContext = config.jobContext;
    this.transcriptBuffer = [];
    this.conversationLog = [];

    this.stt?.close();
    this.stt = new GroqSTT(config.language, {
      onBuffering: () => this.send({ type: "transcript:buffering" }),
      onIdle: () => this.send({ type: "transcript:idle" }),
      onFinal: (text) => void this.handleFinalTranscript(text),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    this.stt.start();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}, jobContext=${config.jobContext ? config.jobContext.title : "none"}`);
  }

  private handleAudioChunk(base64Data: string): void {
    if (!this.stt) return;
    const buffer = Buffer.from(base64Data, "base64");
    this.stt.sendAudio(buffer);
  }

  private async handleFinalTranscript(rawText: string): Promise<void> {
    if (!rawText.trim()) return;

    const text = await correctTranscript(rawText);
    if (rawText !== text) console.log(`[Session] Corrected: "${rawText}" → "${text}"`);

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

    this.conversationLog.push(transcript);
    if (this.conversationLog.length > this.MAX_LOG_ENTRIES) this.conversationLog.shift();

    try {
      const card = await callClaudeJSON<InsightCard>(
        buildLiveAssistPrompt(this.jobContext, this.conversationLog.slice(0, -1), this.questionLog),
        `Ce qui vient d'être dit :\n"${transcript}"`
      );
      this.questionLog.push(card.followUp);
      if (this.questionLog.length > this.MAX_LOG_ENTRIES) this.questionLog.shift();
      this.send({ type: "assist:card", card });
    } catch (err) {
      this.send({
        type: "assist:error",
        error: err instanceof Error ? err.message : "Analysis error",
      });
    }

    this.isProcessing = false;

    if (this.pendingTranscript) {
      const pending = this.pendingTranscript;
      this.pendingTranscript = null;
      this.processTranscript(pending);
    }
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
    this.conversationLog = [];
    this.questionLog = [];
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    this.jobContext = undefined;
    console.log("[Session] Cleaned up");
  }
}
