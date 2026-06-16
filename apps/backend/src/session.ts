import type { WebSocket } from "ws";
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { GroqSTT } from "./groq-stt.js";
import { callClaudeJSON } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";

type InsightPayload = Omit<Insight, "id" | "t">;

export class Session {
  private ws: WebSocket;
  private stt: GroqSTT | null = null;
  private config: SessionConfig | null = null;
  private jobContext: JobContext | undefined = undefined;
  private transcriptBuffer: string[] = [];
  private conversationLog: string[] = [];
  private relanceLog: string[] = [];
  private cardLog: Insight[] = [];
  private sessionStartMs = 0;
  private readonly MAX_LOG_ENTRIES = 5;
  private readonly MAX_CARD_LOG = 20;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private immediateAnalysis = false;
  private readonly DEBOUNCE_MS = 300;

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
      case "trigger:analyze":
        this.triggerAnalysis();
        break;
      case "session:summarize":
        void this.generateFinalReport();
        break;
    }
  }

  private startSession(config: SessionConfig): void {
    this.config = config;
    this.jobContext = config.jobContext;
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = Date.now();

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

  private triggerAnalysis(): void {
    if (this.immediateAnalysis) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const existing = this.transcriptBuffer.join(" ").trim();
    if (existing) {
      this.transcriptBuffer = [];
      if (this.isProcessing) {
        this.pendingTranscript = existing;
      } else {
        this.processTranscript(existing);
      }
      void this.stt?.flush();
      return;
    }
    this.immediateAnalysis = true;
    void this.stt?.flush();
  }

  private handleFinalTranscript(rawText: string): void {
    if (!rawText.trim()) return;

    this.send({ type: "transcript:final", text: rawText });
    this.transcriptBuffer.push(rawText);

    if (this.immediateAnalysis) {
      this.immediateAnalysis = false;
      if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
      const fullText = this.transcriptBuffer.join(" ");
      this.transcriptBuffer = [];
      if (fullText.trim()) {
        if (this.isProcessing) { this.pendingTranscript = fullText; }
        else { this.processTranscript(fullText); }
      }
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      const fullText = this.transcriptBuffer.join(" ");
      this.transcriptBuffer = [];

      if (!fullText.trim()) return;

      if (this.isProcessing) {
        this.pendingTranscript = fullText;
        return;
      }

      this.processTranscript(fullText);
    }, this.DEBOUNCE_MS);
  }

  private elapsedTime(): string {
    const elapsedSec = Math.floor((Date.now() - this.sessionStartMs) / 1000);
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const ss = String(elapsedSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  private async processTranscript(transcript: string): Promise<void> {
    this.isProcessing = true;

    this.conversationLog.push(transcript);
    if (this.conversationLog.length > this.MAX_LOG_ENTRIES) this.conversationLog.shift();

    try {
      const payload = await callClaudeJSON<InsightPayload>(
        buildLiveAssistPrompt(this.jobContext, this.conversationLog.slice(0, -1), this.relanceLog, this.cardLog),
        `Ce qui vient d'être dit :\n"${transcript}"`
      );

      const card: Insight = {
        ...payload,
        id: createId(),
        t: this.elapsedTime(),
      };

      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

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

  private async generateFinalReport(): Promise<void> {
    try {
      const report = await callClaudeJSON<CandidateReport>(
        buildFinalAnalysisPrompt(this.jobContext, this.cardLog),
        "Génère le bilan final du candidat."
      );
      this.send({ type: "analysis:final", report });
    } catch (err) {
      this.send({
        type: "session:error",
        error: err instanceof Error ? err.message : "Final analysis error",
      });
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
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = 0;
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    this.jobContext = undefined;
    console.log("[Session] Cleaned up");
  }
}
