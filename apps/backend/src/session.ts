import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  SessionConfig,
} from "@voxhelp/shared";
import { DeepgramSTT } from "./deepgram.js";
import { generateResponse, generateFromPrompt } from "./llm.js";
import { buildSystemPrompt } from "./prompts.js";

export class Session {
  private ws: WebSocket;
  private stt: DeepgramSTT | null = null;
  private config: SessionConfig | null = null;
  private conversationHistory: string[] = [];
  private isProcessingLLM = false;
  private pendingTranscript: string | null = null;
  private transcriptBuffer: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 1800;
  private lastProcessedQuestion: string = "";

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
      case "user:expand":
        this.handleExpand();
        break;
      case "ping":
        this.send({ type: "pong" });
        break;
    }
  }

  private startSession(config: SessionConfig): void {
    this.config = config;
    this.conversationHistory = [];

    this.stt = new DeepgramSTT(config.language, {
      onPartial: (text) => this.send({ type: "transcript:partial", text }),
      onFinal: (text) => this.handleFinalTranscript(text),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    this.stt.connect();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}, stt=deepgram`);
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
    this.transcriptBuffer.push(text);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      const fullQuestion = this.transcriptBuffer.join(" ");
      this.transcriptBuffer = [];

      if (fullQuestion.trim().length < 10) return;

      if (this.isProcessingLLM) {
        this.pendingTranscript = fullQuestion;
        return;
      }

      this.processWithLLM(fullQuestion);
    }, this.DEBOUNCE_MS);
  }

  private async processWithLLM(transcript: string): Promise<void> {
    if (!this.config) return;

    this.lastProcessedQuestion = transcript;
    this.isProcessingLLM = true;

    await generateResponse(
      transcript,
      this.config,
      this.conversationHistory,
      {
        onStart: () => this.send({ type: "suggestion:start", source: "assist" }),
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

  private async handleExpand(): Promise<void> {
    if (!this.config || !this.lastProcessedQuestion) return;

    const systemPrompt = buildSystemPrompt(this.config, true);
    const history = this.conversationHistory.slice(-10).map((t) => `- ${t}`);
    const contextSection = history.length > 0
      ? `\n\nHISTORIQUE :\n${history.join("\n")}`
      : "";
    const userMessage = `${contextSection}\n\nQUESTION :\n"${this.lastProcessedQuestion}"`;

    await generateFromPrompt(systemPrompt, userMessage, {
      onStart: () => this.send({ type: "suggestion:start", source: "expand" }),
      onChunk: (text) => this.send({ type: "suggestion:chunk", text }),
      onDone: (fullText) => this.send({ type: "suggestion:done", fullText }),
      onError: (error) => this.send({ type: "suggestion:error", error }),
    });
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
    this.conversationHistory = [];
    this.lastProcessedQuestion = "";
    console.log("[Session] Cleaned up");
  }
}
