import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  SessionConfig,
} from "@voxhelp/shared";
import { DeepgramSTT } from "./deepgram.js";
import { GroqWhisperSTT } from "./groq-whisper.js";
import { generateResponse } from "./llm.js";

export class Session {
  private ws: WebSocket;
  private stt: DeepgramSTT | GroqWhisperSTT | null = null;
  private config: SessionConfig | null = null;
  private conversationHistory: string[] = [];
  private isProcessingLLM = false;
  private pendingTranscript: string | null = null;

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
        // Might be binary audio data
        if (Buffer.isBuffer(data) && this.stt) {
          this.stt.sendAudio(data);
        }
      }
    });

    this.ws.on("close", () => {
      this.cleanup();
    });

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
    this.conversationHistory = [];

    // Choose STT based on source language
    const sourceLanguage = this.getSourceLanguage();
    const needsWhisper = sourceLanguage === "mg"; // Malagasy needs Whisper

    if (needsWhisper) {
      this.stt = new GroqWhisperSTT(sourceLanguage, {
        onFinal: (text) => this.handleFinalTranscript(text),
        onError: (err) => this.send({ type: "session:error", error: err }),
      });
    } else {
      this.stt = new DeepgramSTT(sourceLanguage, {
        onPartial: (text) =>
          this.send({ type: "transcript:partial", text }),
        onFinal: (text) => this.handleFinalTranscript(text),
        onError: (err) => this.send({ type: "session:error", error: err }),
      });
    }

    this.stt.connect();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(
      `[Session] Started: mode=${config.mode}, source=${sourceLanguage}, stt=${needsWhisper ? "groq-whisper" : "deepgram"}`
    );
  }

  private getSourceLanguage(): string {
    if (!this.config) return "fr";

    if (this.config.mode === "translator") {
      return this.config.sourceLanguage ?? "mg";
    }
    // Interview mode: detect from JD language or default to FR
    return "fr";
  }

  private handleAudioChunk(base64Data: string): void {
    if (!this.stt) return;
    const buffer = Buffer.from(base64Data, "base64");
    this.stt.sendAudio(buffer);
  }

  private handleFinalTranscript(text: string): void {
    if (!text.trim()) return;

    this.send({ type: "transcript:final", text });
    this.conversationHistory.push(text);

    // If LLM is busy, queue the latest transcript
    if (this.isProcessingLLM) {
      this.pendingTranscript = text;
      return;
    }

    this.processWithLLM(text);
  }

  private async processWithLLM(transcript: string): Promise<void> {
    if (!this.config) return;

    this.isProcessingLLM = true;

    await generateResponse(
      transcript,
      this.config,
      this.conversationHistory,
      {
        onStart: () => this.send({ type: "suggestion:start" }),
        onChunk: (text) => this.send({ type: "suggestion:chunk", text }),
        onDone: (fullText) => {
          this.send({ type: "suggestion:done", fullText });
          this.isProcessingLLM = false;

          // Process any queued transcript
          if (this.pendingTranscript) {
            const pending = this.pendingTranscript;
            this.pendingTranscript = null;
            this.processWithLLM(pending);
          }
        },
        onError: (error) => {
          this.send({ type: "suggestion:error", error });
          this.isProcessingLLM = false;
        },
      }
    );
  }

  private send(message: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private cleanup(): void {
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    this.conversationHistory = [];
    console.log("[Session] Cleaned up");
  }
}
