import type { WebSocket } from "ws";
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { FluxSTT } from "./deepgram-flux.js";
import { streamAssist, callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";

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

  private parseAssistText(text: string, id: string, t: string): Insight {
    const lines = text.trim().split("\n").filter((l) => l.trim() !== "");

    const headerMatch = lines[0]?.match(
      /\[(jargon|strength|attention|translation)\]\s*\[(high|medium|low)\]/
    );
    const cat = (headerMatch?.[1] as Insight["cat"]) ?? "translation";
    const evidence = (headerMatch?.[2] as Insight["evidence"]) ?? "medium";

    const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

    const lastLine = lines[lines.length - 1];
    const hasRelance = lastLine?.startsWith(">>");
    const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : undefined;

    const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
    const body = lines.slice(2, bodyEnd).join(" ").trim();

    return { id, cat, evidence, t, title, body, relance };
  }

  private async processTranscript(transcript: string): Promise<void> {
    this.isProcessing = true;
    this.send({ type: "transcript:buffering" });

    this.conversationLog.push(transcript);
    if (this.conversationLog.length > this.MAX_LOG_ENTRIES) this.conversationLog.shift();

    const cardId = createId();
    const cardT = this.elapsedTime();
    this.send({ type: "assist:start", id: cardId, t: cardT });

    try {
      const fullText = await streamAssist(
        buildLiveAssistPrompt(this.jobContext, this.conversationLog, this.relanceLog, this.cardLog),
        `Ce qui vient d'être dit :\n"${transcript}"`,
        (chunk) => this.send({ type: "assist:chunk", id: cardId, text: chunk })
      );

      this.send({ type: "assist:done", id: cardId, fullText });

      const card = this.parseAssistText(fullText, cardId, cardT);
      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

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
      `Tu es VoxHelp, un copilote d'entretien technique qui assiste un recruteur RH non-technique en temps réel.

Le recruteur te pose une question directe. Réponds-lui comme un collègue expert bienveillant.

Exemples de questions que le recruteur peut poser :
- "Donne-moi une question sur React" → propose UNE question d'entretien pertinente
- "C'est quoi un webhook ?" → explique simplement
- "Le candidat est bon ?" → donne ton avis basé sur ce que tu as observé
- "Que demander maintenant ?" → suggère la meilleure question de suivi

Format de réponse OBLIGATOIRE — commence DIRECTEMENT par le marqueur, rien avant :
[catégorie] [evidence]
# Titre court (max 10 mots)
Ta réponse complète au recruteur. 2-5 phrases, langage simple et direct. Si le recruteur demande une question d'entretien, donne la question ET explique ce qu'une bonne réponse devrait contenir.
>> Question de suivi optionnelle (ou rien)

Utilise TOUJOURS catégorie = translation et evidence = high pour tes réponses.`,
    ];

    if (this.jobContext) {
      parts.push(
        `Poste : ${this.jobContext.title || "non précisé"}, Niveau : ${this.jobContext.level || "non précisé"}, Stack : ${this.jobContext.stack || "non précisée"}`
      );
    }

    if (this.conversationLog.length > 0) {
      parts.push(`Contexte — ce qui a été dit pendant l'entretien :\n${this.conversationLog.map((t) => `"${t}"`).join("\n")}`);
    }

    if (this.cardLog.length > 0) {
      parts.push(
        `Analyses déjà faites :\n${this.cardLog
          .slice(-5)
          .map((c) => `[${c.cat}] ${c.title}: ${c.body}`)
          .join("\n")}`
      );
    }

    return parts.join("\n\n");
  }

  private async handleAskQuestion(question: string): Promise<void> {
    this.send({ type: "transcript:buffering" });

    const cardId = createId();
    const cardT = this.sessionStartMs ? this.elapsedTime() : "00:00";
    this.send({ type: "assist:start", id: cardId, t: cardT });

    try {
      const fullText = await streamAssist(
        this.buildAskPrompt(),
        question,
        (chunk) => this.send({ type: "assist:chunk", id: cardId, text: chunk })
      );

      this.send({ type: "assist:done", id: cardId, fullText });

      const card = this.parseAssistText(fullText, cardId, cardT);
      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

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
        "Génère le bilan final du candidat.",
        "claude-sonnet-4-6"
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
