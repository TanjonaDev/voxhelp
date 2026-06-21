import type { WebSocket } from "ws";
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { FluxSTT } from "./deepgram-flux.js";
import { callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";

type InsightPayload = Omit<Insight, "id" | "t">;

export class Session {
  private ws: WebSocket;
  private stt: FluxSTT | null = null;
  private config: SessionConfig | null = null;
  private jobContext: JobContext | undefined = undefined;
  private transcriptBuffer: string[] = [];
  private conversationLog: string[] = [];
  private relanceLog: string[] = [];
  private cardLog: Insight[] = [];
  private sessionStartMs = 0;
  private readonly MAX_LOG_ENTRIES = 15;
  private readonly MAX_CARD_LOG = 30;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 1500;

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
      case "ask:question":
        void this.handleAskQuestion(message.text);
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
    this.stt = new FluxSTT(config.language, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    void this.stt.start();

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
    }
  }

  private async handleFinalTranscript(rawText: string): Promise<void> {
    if (!rawText.trim()) return;

    const sttContext = this.jobContext
      ? `${this.jobContext.title || ""} ${this.jobContext.stack || ""}`.trim()
      : undefined;
    const text = await correctTranscript(rawText, sttContext);

    this.send({ type: "transcript:final", text });
    this.transcriptBuffer.push(text);

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
    this.send({ type: "transcript:buffering" });

    this.conversationLog.push(transcript);
    if (this.conversationLog.length > this.MAX_LOG_ENTRIES) this.conversationLog.shift();

    try {
      const payload = await callClaudeJSON<InsightPayload>(
        buildLiveAssistPrompt(this.jobContext, this.conversationLog, this.relanceLog, this.cardLog),
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
    this.send({ type: "transcript:idle" });

    if (this.pendingTranscript) {
      const pending = this.pendingTranscript;
      this.pendingTranscript = null;
      this.processTranscript(pending);
    }
  }

  private buildAskPrompt(): string {
    const parts: string[] = [
      `Tu es VoxHelp, un copilote d'entretien technique pour recruteurs.
Le recruteur te pose une question. Réponds de manière concise et utile.
Retourne UNIQUEMENT un objet JSON (pas de markdown, pas de backticks) avec les champs :
{ "cat", "confidence", "title", "body", "relance?" }
- cat: "translation" | "jargon" | "strength" | "risk" | "level" — choisis la plus pertinente
- confidence: "confirmed" | "partial" | "low"
- title: titre court (max 10 mots)
- body: explication (2-4 phrases)
- relance: suggestion de question de suivi (optionnel)`,
    ];

    if (this.jobContext) {
      parts.push(
        `Poste : ${this.jobContext.title || "non précisé"}, Niveau : ${this.jobContext.level || "non précisé"}, Stack : ${this.jobContext.stack || "non précisée"}`
      );
    }

    if (this.conversationLog.length > 0) {
      parts.push(`Transcription récente :\n${this.conversationLog.map((t) => `"${t}"`).join("\n")}`);
    }

    if (this.cardLog.length > 0) {
      parts.push(
        `Analyses précédentes :\n${this.cardLog
          .slice(-5)
          .map((c) => `[${c.cat}] ${c.title}: ${c.body}`)
          .join("\n")}`
      );
    }

    return parts.join("\n\n");
  }

  private async handleAskQuestion(question: string): Promise<void> {
    this.send({ type: "transcript:buffering" });
    try {
      const payload = await callClaudeJSON<InsightPayload>(
        this.buildAskPrompt(),
        question
      );

      const card: Insight = {
        ...payload,
        id: createId(),
        t: this.sessionStartMs ? this.elapsedTime() : "00:00",
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
        error: err instanceof Error ? err.message : "Ask error",
      });
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
