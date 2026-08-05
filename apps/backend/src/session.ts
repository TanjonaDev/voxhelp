import type { WebSocket } from "ws";
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext, TranscriptEntry,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { FluxSTT } from "./deepgram-flux.js";
import { streamAssist, callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";
import { supabaseAdmin } from "./supabase.js";

interface ProfileUsage {
  session_count: number;
  session_limit: number;
}

function extractThemeAndAngle(text: string): { theme: string | null; angle: string | null } {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?(?:\s*\[?(contexte|ownership|impact|none)\]?)?/i
  );
  return {
    theme: match?.[1]?.toLowerCase() ?? null,
    angle: match?.[2]?.toLowerCase() ?? null,
  };
}

function normalizeStatus(raw: string | undefined): Insight["status"] {
  const normalized = raw?.toLowerCase().trim() ?? "";
  if (normalized === "acquis") return "acquis";
  if (/^pas[\s-]?acquis$/.test(normalized)) return "pas-acquis";
  if (/^[aà][\s-]?creuser$/.test(normalized)) return "a-creuser";
  return "a-creuser";
}

export class Session {
  private ws: WebSocket;
  private userId: string | null;
  private stt: FluxSTT | null = null;
  private config: SessionConfig | null = null;
  private jobContext: JobContext | undefined = undefined;
  private candidateName: string | undefined = undefined;
  private transcriptBuffer: string[] = [];
  private conversationLog: string[] = [];
  private relanceLog: string[] = [];
  private cardLog: Insight[] = [];
  private fullTranscriptLog: TranscriptEntry[] = [];
  private readonly MAX_TRANSCRIPT_LOG = 600;
  private sessionStartMs = 0;
  private readonly MAX_LOG_ENTRIES = 15;
  private readonly MAX_CARD_LOG = 30;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBufferMs: number;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 2500;
  private lastTheme: string | null = null;
  private coveredAngles: Set<string> = new Set();
  private themeCardCount = 0;
  private jargonDecodedThemes: Set<string> = new Set();

  constructor(ws: WebSocket, userId: string | null = null, maxBufferMs: number = 3 * 60 * 1000) {
    this.ws = ws;
    this.userId = userId;
    this.maxBufferMs = maxBufferMs;
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
        void this.startSession(message.config);
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

  private async startSession(config: SessionConfig): Promise<void> {
    if (this.userId && supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .select("session_count, session_limit")
          .eq("id", this.userId)
          .single();

        const usage = data as ProfileUsage | null;

        if (!error && usage && usage.session_count >= usage.session_limit) {
          console.log(`[Session] Blocked: user ${this.userId} reached session_limit=${usage.session_limit}`);
          this.send({
            type: "session:error",
            error: `Limite de ${usage.session_limit} entretiens atteinte pour ce compte. Contacte-nous pour continuer.`,
          });
          return;
        }
      } catch (err) {
        console.error("[Session] Quota check failed, allowing session:", err);
      }
    }

    this.config = config;
    this.jobContext = config.jobContext;
    this.candidateName = config.candidateName;
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.fullTranscriptLog = [];
    this.lastTheme = null;
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
    this.jargonDecodedThemes = new Set();
    this.sessionStartMs = Date.now();

    this.stt?.close();
    this.stt = new FluxSTT(config.language, config.keywords, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    void this.stt.start();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}, jobContext=${config.jobContext ? config.jobContext.title : "none"}`);
    console.log(
      `[Session] Keywords for Deepgram keyterm boosting: ${config.keywords && config.keywords.length > 0 ? `[${config.keywords.join(", ")}] (${config.keywords.length} termes)` : "aucun"}`
    );
  }

  private handleAudioChunk(base64Data: string): void {
    if (!this.stt) return;
    const buffer = Buffer.from(base64Data, "base64");
    this.stt.sendAudio(buffer);
  }

  private triggerAnalysis(): void {
    this.flushBuffer();
  }

  private flushBuffer(): void {
    if (this.maxBufferTimer) {
      clearTimeout(this.maxBufferTimer);
      this.maxBufferTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const fullText = this.transcriptBuffer.join(" ").trim();
    this.transcriptBuffer = [];

    if (!fullText) return;

    if (this.isProcessing) {
      this.pendingTranscript = fullText;
    } else {
      this.processTranscript(fullText);
    }
  }

  private async handleFinalTranscript(rawText: string): Promise<void> {
    if (!rawText.trim()) return;

    const sttContext = this.jobContext
      ? `${this.jobContext.title || ""} ${this.jobContext.stack || ""}`.trim()
      : undefined;
    const text = await correctTranscript(rawText, sttContext);

    this.send({ type: "transcript:final", text });

    const transcriptT = this.sessionStartMs ? this.elapsedTime() : "00:00";
    this.fullTranscriptLog.push({ t: transcriptT, text });
    if (this.fullTranscriptLog.length > this.MAX_TRANSCRIPT_LOG) this.fullTranscriptLog.shift();

    if (this.transcriptBuffer.length === 0 && !this.maxBufferTimer) {
      this.maxBufferTimer = setTimeout(() => this.flushBuffer(), this.maxBufferMs);
    }

    this.transcriptBuffer.push(text);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.flushBuffer();
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
      /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
    );
    const cat = (headerMatch?.[1]?.toLowerCase() as Insight["cat"]) ?? "translation";
    const status = normalizeStatus(headerMatch?.[2]);
    const { theme } = extractThemeAndAngle(text);

    const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

    const lastLine = lines[lines.length - 1];
    const hasRelance = lastLine?.startsWith(">>");
    const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : undefined;

    const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
    const body = lines.slice(2, bodyEnd).join(" ").trim();

    return { id, cat, status, theme, t, title, body, relance };
  }

  private async processTranscript(transcript: string): Promise<void> {
    this.isProcessing = true;
    this.send({ type: "transcript:buffering" });

    this.conversationLog.push(transcript);
    if (this.conversationLog.length > this.MAX_LOG_ENTRIES) this.conversationLog.shift();

    const cardId = createId();
    const cardT = this.elapsedTime();
    this.send({ type: "assist:start", id: cardId, t: cardT });

    let accumulated = "";
    let cancelled = false;

    try {
      const jargonAlreadyDecoded = this.lastTheme ? this.jargonDecodedThemes.has(this.lastTheme) : false;
      const fullText = await streamAssist(
        buildLiveAssistPrompt(
          this.jobContext,
          this.conversationLog,
          this.relanceLog,
          this.cardLog,
          this.lastTheme,
          Array.from(this.coveredAngles),
          this.themeCardCount,
          jargonAlreadyDecoded
        ),
        `Ce qui vient d'être dit :\n"${transcript}"`,
        (chunk) => {
          if (cancelled) return;
          accumulated += chunk;
          if (accumulated.trimStart().startsWith("[skip]")) {
            cancelled = true;
            console.log(`[Session] Card skippée (question recruteur ou rien de nouveau à signaler) — transcript: "${transcript}"`);
            this.send({ type: "assist:cancel", id: cardId });
            return;
          }
          this.send({ type: "assist:chunk", id: cardId, text: chunk });
        }
      );

      if (cancelled) {
        this.isProcessing = false;
        this.send({ type: "transcript:idle" });
        if (this.pendingTranscript) {
          const pending = this.pendingTranscript;
          this.pendingTranscript = null;
          this.processTranscript(pending);
        }
        return;
      }

      this.send({ type: "assist:done", id: cardId, fullText });

      const card = this.parseAssistText(fullText, cardId, cardT);
      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

      console.log(
        `[Session] Card [${card.cat}] [${card.status}] theme=${card.theme ?? "null"} "${card.title}"${card.relance ? ` | relance: "${card.relance}"` : ""}`
      );

      if (card.cat === "jargon" && card.theme) {
        this.jargonDecodedThemes.add(card.theme);
      }

      const { theme, angle } = extractThemeAndAngle(fullText);
      if (theme && theme === this.lastTheme) {
        this.themeCardCount += 1;
        if (angle && angle !== "none") this.coveredAngles.add(angle);
      } else {
        this.lastTheme = theme;
        this.themeCardCount = theme ? 1 : 0;
        this.coveredAngles = new Set(angle && angle !== "none" ? [angle] : []);
      }

      console.log(
        `[Session] Theme tracking: lastTheme=${this.lastTheme ?? "null"} coveredAngles=[${Array.from(this.coveredAngles).join(", ")}] themeCardCount=${this.themeCardCount}`
      );

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
[catégorie] [statut]
# Titre court (max 10 mots)
Ta réponse complète au recruteur. 2-5 phrases, langage simple et direct. Si le recruteur demande une question d'entretien, donne la question ET explique ce qu'une bonne réponse devrait contenir.
>> Question de suivi optionnelle (ou rien)

Utilise TOUJOURS catégorie = translation et statut = acquis pour tes réponses.`,
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
      type GeneratedReportFields = Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel">;
      const generated = await callClaudeJSON<GeneratedReportFields>(
        buildFinalAnalysisPrompt(this.jobContext, this.cardLog, this.fullTranscriptLog),
        "Génère la fiche de qualification du candidat.",
        "claude-sonnet-4-6"
      );
      const durationLabel = this.sessionStartMs
        ? `${Math.max(1, Math.round((Date.now() - this.sessionStartMs) / 60000))} min`
        : "0 min";
      const report: CandidateReport = {
        candidateName: this.candidateName?.trim() || "Candidat",
        jobTitle: this.jobContext?.title?.trim() || "Poste non précisé",
        interviewDate: new Date().toISOString(),
        durationLabel,
        ...generated,
      };
      console.log(`[Session] Verdict: ${report.verdict} — ${report.verdictReason}`);
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
    if (this.userId && supabaseAdmin && this.conversationLog.length > 0) {
      void supabaseAdmin
        .rpc("increment_session_count", { uid: this.userId })
        .then(({ error }) => {
          if (error) console.error("[Session] Failed to increment session_count:", error.message);
        });
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxBufferTimer) {
      clearTimeout(this.maxBufferTimer);
      this.maxBufferTimer = null;
    }
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.fullTranscriptLog = [];
    this.lastTheme = null;
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
    this.jargonDecodedThemes = new Set();
    this.sessionStartMs = 0;
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    this.jobContext = undefined;
    this.candidateName = undefined;
    console.log("[Session] Cleaned up");
  }
}
