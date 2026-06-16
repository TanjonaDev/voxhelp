# VoxHelp Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer LiveView.tsx par un panneau de verre glass-panel haute fidélité (spec design handoff) branché sur le pipeline WebSocket existant, en mettant à jour le type partagé InsightCard → Insight et le prompt backend.

**Architecture:** Mise à jour full-stack en 3 couches : (1) type `Insight` dans `packages/shared`, (2) prompt `live-assist.ts` + injection `id`/`t` dans `session.ts`, (3) nouveaux composants React dans `apps/web/src/components/overlay/`. Le hook `useWebSocket` et `App.tsx` sont adaptés pour consommer le nouveau type.

**Tech Stack:** TypeScript strict · React 19 · Tailwind 3.4 · CSS custom properties (oklch, backdrop-filter) · CSS keyframes (pas de framer-motion) · SVG inline (pas de lucide-react)

---

## Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `packages/shared/src/index.ts` | Modifier — `InsightCard` → `Insight` |
| `apps/backend/src/prompts/live-assist.ts` | Modifier — prompt JSON → forme Insight |
| `apps/backend/src/prompts/final-analysis.ts` | Modifier — `InsightCard[]` → `Insight[]` |
| `apps/backend/src/session.ts` | Modifier — typage Insight, `sessionStartMs`, injection `id`/`t` |
| `apps/web/src/hooks/useWebSocket.ts` | Modifier — `InsightCard[]` → `Insight[]` |
| `apps/web/index.html` | Modifier — ajouter Google Font Onest |
| `apps/web/src/index.css` | Modifier — tokens CSS VH + keyframes |
| `apps/web/tailwind.config.js` | Modifier — Onest comme font-sans |
| `apps/web/src/App.tsx` | Modifier — import OverlayPanel |
| `apps/web/src/components/LiveView.tsx` | Supprimer |
| `apps/web/src/components/overlay/primitives/VIcon.tsx` | Créer |
| `apps/web/src/components/overlay/primitives/GhostBtn.tsx` | Créer |
| `apps/web/src/components/overlay/primitives/VHMark.tsx` | Créer |
| `apps/web/src/components/overlay/primitives/LiveWave.tsx` | Créer |
| `apps/web/src/components/overlay/primitives/Confidence.tsx` | Créer |
| `apps/web/src/components/overlay/primitives/CategoryTag.tsx` | Créer |
| `apps/web/src/components/overlay/PanelHeader.tsx` | Créer |
| `apps/web/src/components/overlay/LiveCaption.tsx` | Créer |
| `apps/web/src/components/overlay/InsightCardView.tsx` | Créer |
| `apps/web/src/components/overlay/CommandBar.tsx` | Créer |
| `apps/web/src/components/overlay/OverlayPanel.tsx` | Créer |

---

## Task 1 : Mettre à jour le type partagé InsightCard → Insight

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Remplacer le contenu de `packages/shared/src/index.ts`**

```ts
export type InterviewLanguage = "fr" | "en" | "es" | "pt" | "zh";

export interface JobContext {
  title: string;
  level: string;
  stack: string;
}

export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
}

export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "risk" | "level";
  confidence: "confirmed" | "partial" | "low";
  t: string;
  title: string;
  body: string;
  relance?: string;
  level?: number;
  levelLabel?: string;
}

export interface CandidateReport {
  overall: string;
  strengths: string[];
  gaps: string[];
  recommendation: "hire" | "maybe" | "pass";
  recommendationReason: string;
}

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "trigger:analyze" }
  | { type: "session:summarize" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:buffering" }
  | { type: "transcript:idle" }
  | { type: "transcript:final"; text: string }
  | { type: "assist:card"; card: Insight }
  | { type: "assist:error"; error: string }
  | { type: "analysis:final"; report: CandidateReport }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Vérifier que le package shared compile**

```bash
cd packages/shared && npx tsc --noEmit
```

Expected: aucune erreur.

- [ ] **Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): InsightCard → Insight with cat/title/body/relance/level"
```

---

## Task 2 : Mettre à jour le prompt live-assist

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`

- [ ] **Remplacer le contenu de `apps/backend/src/prompts/live-assist.ts`**

```ts
import type { JobContext, Insight } from "@voxhelp/shared";

export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[]
): string {
  const contextSection = jobContext
    ? `\nContexte du poste : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\nCalibre la catégorie et le niveau de confiance en tenant compte de ces attentes.\n`
    : "";

  const historySection =
    history && history.length > 0
      ? `\nCe qui a été dit avant dans cette session :\n${history.map((t, i) => `[${i + 1}] "${t}"`).join("\n")}\n`
      : "";

  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions de relance déjà suggérées (NE PAS répéter ni reformuler) :\n${previousRelances.map((q, i) => `[${i + 1}] ${q}`).join("\n")}\n`
      : "";

  const recentCards = previousCards?.slice(-5);
  const cardsSection =
    recentCards && recentCards.length > 0
      ? `\nAnalyses déjà effectuées dans cette session (construis sur ces observations) :\n${recentCards.map((c, i) => `[${i + 1}] ${c.confidence.toUpperCase()} [${c.cat}] — "${c.title}" — ${c.body}`).join("\n")}\n`
      : "";

  return `Tu assistes un recruteur RH (non-technique) pendant un entretien avec un candidat développeur.${contextSection}${historySection}${cardsSection}${relancesSection}
Ton rôle : aider le recruteur à vérifier si le candidat a une vraie expérience pratique, pas juste des connaissances théoriques.

Produis une analyse en JSON strict (sans backticks, sans texte autour) :
{
  "cat": "translation|jargon|strength|risk|level",
  "confidence": "confirmed|partial|low",
  "title": "Titre court de l'insight, max 80 caractères",
  "body": "Explication en langage clair pour un recruteur non-technique, 1-3 phrases.",
  "relance": "Une question courte que le recruteur peut poser mot pour mot, ou null si non pertinent",
  "level": 0.0,
  "levelLabel": "Junior|Intermédiaire|Senior|Lead"
}

Règles catégories :
- translation = le candidat résume son profil ou son contexte → traduis en clair pour le recruteur
- jargon = terme technique utilisé → explique ce que ça veut dire concrètement
- strength = point fort démontré par une action ou un résultat concret
- risk = réponse vague, incohérente, ou lacune à creuser
- level = évaluation du niveau technique global observable sur cet extrait

Règles level et levelLabel : uniquement si cat = "level". level = 0.0 à 1.0 (0=Junior, 0.5=Intermédiaire, 0.75=Senior, 1.0=Lead). Omets ces champs si cat ≠ "level".

Règles confidence :
- confirmed = expérience terrain évidente et cohérente
- partial = a utilisé la techno mais de façon limitée ou ancienne
- low = impossible de juger (réponse trop courte, coupée, ou trop générale)

Règles relance :
- Viser à confirmer l'expérience réelle (durée, projet, rôle, résultat, architecture)
- Rester au niveau architecture ou organisation du code — pas descendre dans les détails d'implémentation
- Être courte et naturelle, posable mot pour mot
- null si cat = "translation" ou si une relance similaire a déjà été posée`;
}
```

- [ ] **Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts
git commit -m "feat(prompt): live-assist → Insight shape (cat/title/body/relance/level)"
```

---

## Task 3 : Mettre à jour le prompt final-analysis

**Files:**
- Modify: `apps/backend/src/prompts/final-analysis.ts`

- [ ] **Remplacer le contenu de `apps/backend/src/prompts/final-analysis.ts`**

```ts
import type { JobContext, Insight } from "@voxhelp/shared";

export function buildFinalAnalysisPrompt(jobContext?: JobContext, cards?: Insight[]): string {
  const contextSection = jobContext
    ? `\nPoste visé : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\n`
    : "";

  const cardsSection =
    cards && cards.length > 0
      ? `\nAnalyses réalisées pendant l'entretien :\n${cards.map((c, i) => `[${i + 1}] ${c.confidence.toUpperCase()} [${c.cat}] — "${c.title}"\n     → ${c.body}`).join("\n")}\n`
      : "\nAucune analyse disponible.\n";

  return `Tu es un assistant de recrutement. Un recruteur RH vient de terminer un entretien technique avec un candidat développeur.${contextSection}${cardsSection}
Génère un bilan final du candidat en JSON strict (sans backticks, sans texte autour) :
{
  "overall": "Bilan global en 2-3 phrases : niveau général, cohérence des réponses, impression d'ensemble",
  "strengths": ["Point fort 1 observé", "Point fort 2", "..."],
  "gaps": ["Lacune ou doute 1", "..."],
  "recommendation": "hire|maybe|pass",
  "recommendationReason": "1 phrase courte expliquant la recommandation"
}

Règles :
- Basé uniquement sur les signaux observés, pas sur des suppositions
- hire = expérience terrain clairement démontrée, cohérent avec le niveau attendu
- maybe = profil intéressant mais incomplet ou niveau incertain
- pass = trop vague, trop théorique, ou clairement sous le niveau attendu
- Si peu d'analyses disponibles, indique-le dans overall et mets recommendation: "maybe"
- strengths : 2-3 éléments max, concrets
- gaps : 1-3 éléments, honnêtes mais bienveillants`;
}
```

- [ ] **Commit**

```bash
git add apps/backend/src/prompts/final-analysis.ts
git commit -m "feat(prompt): final-analysis → Insight type (title/body/cat)"
```

---

## Task 4 : Mettre à jour session.ts

**Files:**
- Modify: `apps/backend/src/session.ts`

- [ ] **Remplacer le contenu de `apps/backend/src/session.ts`**

```ts
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
```

- [ ] **Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: aucune erreur.

- [ ] **Commit**

```bash
git add apps/backend/src/session.ts
git commit -m "feat(session): Insight type, sessionStartMs, inject id+t from backend"
```

---

## Task 5 : Mettre à jour useWebSocket.ts

**Files:**
- Modify: `apps/web/src/hooks/useWebSocket.ts`

- [ ] **Remplacer le contenu de `apps/web/src/hooks/useWebSocket.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, Insight, CandidateReport } from "@voxhelp/shared";
import { WS_PING_INTERVAL_MS } from "@voxhelp/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  insights: Insight[];
  finalReport: CandidateReport | null;
  startSession: (config: SessionConfig) => void;
  stopSession: () => void;
  sendAudio: (base64: string) => void;
  triggerAnalysis: () => void;
  summarize: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [finalReport, setFinalReport] = useState<CandidateReport | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "session:ready":
        break;
      case "session:error":
        setIsAnalyzing(false);
        setIsSummarizing(false);
        console.error("[WS] Session error:", msg.error);
        break;
      case "transcript:partial":
        setIsAnalyzing(true);
        break;
      case "transcript:buffering":
        setIsAnalyzing(true);
        break;
      case "transcript:idle":
        setIsAnalyzing(false);
        break;
      case "transcript:final":
        break;
      case "assist:card":
        setIsAnalyzing(false);
        setInsights((prev) => [...prev, msg.card]);
        break;
      case "assist:error":
        setIsAnalyzing(false);
        console.error("[WS] Assist error:", msg.error);
        break;
      case "analysis:final":
        setIsSummarizing(false);
        setFinalReport(msg.report);
        break;
      case "pong":
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      pingRef.current = setInterval(() => {
        send({ type: "ping" });
      }, WS_PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setIsAnalyzing(false);
      setIsSummarizing(false);
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    ws.onerror = () => setStatus("error");
  }, [url, send, handleMessage]);

  const startSession = useCallback(
    (config: SessionConfig) => {
      setIsAnalyzing(false);
      setIsSummarizing(false);
      setInsights([]);
      setFinalReport(null);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: "session:start", config });
        return;
      }

      connect();
      const check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          send({ type: "session:start", config });
        }
      }, 100);
    },
    [connect, send]
  );

  const stopSession = useCallback(() => {
    send({ type: "session:stop" });
  }, [send]);

  const sendAudio = useCallback(
    (base64: string) => {
      send({ type: "audio:chunk", data: base64 });
    },
    [send]
  );

  const triggerAnalysis = useCallback(() => {
    send({ type: "trigger:analyze" });
  }, [send]);

  const summarize = useCallback(() => {
    setIsSummarizing(true);
    send({ type: "session:summarize" });
  }, [send]);

  useEffect(() => {
    connect();
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    status,
    isAnalyzing,
    isSummarizing,
    insights,
    finalReport,
    startSession,
    stopSession,
    sendAudio,
    triggerAnalysis,
    summarize,
  };
}
```

- [ ] **Commit**

```bash
git add apps/web/src/hooks/useWebSocket.ts
git commit -m "feat(ws): useWebSocket → Insight[] type"
```

---

## Task 6 : CSS tokens, keyframes, fonts

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/tailwind.config.js`

- [ ] **Mettre à jour `apps/web/index.html`** — ajouter Onest

```html
<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VoxHelp Recruit</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Mettre à jour `apps/web/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Onest", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Remplacer le contenu de `apps/web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Glass surfaces */
  --panel: hsl(222 28% 9% / 0.52);
  --card: hsl(0 0% 100% / 0.045);
  --card-hi: hsl(0 0% 100% / 0.075);
  --card-lift: hsl(0 0% 100% / 0.10);
  --stroke: hsl(0 0% 100% / 0.10);
  --stroke-2: hsl(0 0% 100% / 0.16);

  /* Text */
  --text: hsl(0 0% 100% / 0.95);
  --text-2: hsl(0 0% 100% / 0.62);
  --text-3: hsl(0 0% 100% / 0.40);

  /* Accent colors (oklch) */
  --indigo: oklch(0.70 0.14 268);
  --violet: oklch(0.70 0.16 300);
  --cyan:   oklch(0.75 0.12 212);
  --good:   oklch(0.76 0.15 158);
  --warn:   oklch(0.81 0.13 80);
  --risk:   oklch(0.72 0.16 25);
  --accent: var(--indigo);

  /* Soft variants (16% alpha) */
  --indigo-soft: oklch(0.70 0.14 268 / 0.16);
  --violet-soft: oklch(0.70 0.16 300 / 0.16);
  --cyan-soft:   oklch(0.75 0.12 212 / 0.16);
  --good-soft:   oklch(0.76 0.15 158 / 0.16);
  --warn-soft:   oklch(0.81 0.13 80  / 0.16);
  --risk-soft:   oklch(0.72 0.16 25  / 0.16);
  --accent-soft: var(--indigo-soft);

  /* Shadows */
  --shadow-panel:
    0 0 0 1px hsl(0 0% 100% / .10) inset,
    0 1px 0 hsl(0 0% 100% / .08) inset,
    0 24px 70px -12px hsl(230 40% 4% / .7),
    0 8px 28px -8px hsl(230 40% 4% / .55);
  --shadow-card:
    0 1px 0 hsl(0 0% 100% / .06) inset,
    0 8px 24px -10px hsl(230 40% 4% / .5);

  /* Geometry */
  --radius-panel: 26px;
  --radius-card: 18px;

  /* Typography */
  --font: 'Onest', system-ui, sans-serif;
  --mono: 'JetBrains Mono', monospace;
}

@layer base {
  body {
    font-family: var(--font);
    background: #0d0f18;
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: hsl(0 0% 100% / 0.12) transparent;
  }
}

/* ── VoxHelp keyframes ── */

@keyframes vh-thought-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes vh-glow-fade {
  0%   { opacity: 0.5; }
  100% { opacity: 0; }
}

@keyframes vh-bar {
  0%, 100% { transform: scaleY(0.35); }
  50%       { transform: scaleY(1); }
}

@keyframes vh-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes vh-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.45; transform: scale(0.82); }
}

@keyframes vh-float {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-3px); }
}

@keyframes vh-caption-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Commit**

```bash
git add apps/web/index.html apps/web/src/index.css apps/web/tailwind.config.js
git commit -m "feat(css): VH design tokens, keyframes, Onest font"
```

---

## Task 7 : Primitives — VIcon et GhostBtn

**Files:**
- Create: `apps/web/src/components/overlay/primitives/VIcon.tsx`
- Create: `apps/web/src/components/overlay/primitives/GhostBtn.tsx`

- [ ] **Créer `apps/web/src/components/overlay/primitives/VIcon.tsx`**

```tsx
export const VH_ICONS = {
  translate: 'M4 5h7M7.5 5v-2M9 5s-.5 5-4 7M5 9c0 2 2.5 3.5 4.5 4M13 19l3.5-8 3.5 8M14 16h5',
  sparkle:   'M12 3l1.6 5L18 9.6 13.6 11 12 16l-1.6-5L6 9.6 10.4 8zM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z',
  strength:  'M13 2 4.5 13H11l-1 9 8.5-11H12z',
  risk:      'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  level:     'M5 20V10M12 20V4M19 20v-7',
  chat:      'M21 12a8 8 0 0 1-8 8H7l-4 3v-4.5A8 8 0 1 1 21 12z',
  mic:       'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10a7 7 0 0 1-14 0M12 17v4',
  copy:      'M9 9h10v10H9zM5 15H4V4h11v1',
  pin:       'M9 3h6l-1 6 3 3v2h-5v5l-1 2-1-2v-5H4v-2l3-3z',
  x:         'M6 6l12 12M18 6 6 18',
  stop:      'M6 6h12v12H6z',
  eye:       'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  send:      'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  refresh:   'M21 12a9 9 0 1 1-3-6.7M21 4v4h-4',
  check:     'M20 6 9 17l-5-5',
  dot:       'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
} as const;

export type IconName = keyof typeof VH_ICONS;

interface VIconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  fill?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function VIcon({ name, size = 16, strokeWidth = 1.7, fill = false, style, className }: VIconProps) {
  const d = VH_ICONS[name] ?? VH_ICONS.dot;
  const segments = d.split('M').filter(Boolean).map((seg, i) => (
    <path key={i} d={'M' + seg} />
  ));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {segments}
    </svg>
  );
}
```

- [ ] **Créer `apps/web/src/components/overlay/primitives/GhostBtn.tsx`**

```tsx
import { useState } from 'react';
import { VIcon, type IconName } from './VIcon';

interface GhostBtnProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  size?: number;
  iconSize?: number;
  style?: React.CSSProperties;
}

export function GhostBtn({ icon, label, onClick, active, size = 30, iconSize = 15, style }: GhostBtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: 'unset' as const,
        cursor: 'pointer',
        width: size,
        height: size,
        borderRadius: 9,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        color: active || hover ? 'var(--text)' : 'var(--text-3)',
        background: hover || active ? 'var(--card-hi)' : 'transparent',
        boxShadow: active ? '0 0 0 1px var(--stroke-2) inset' : 'none',
        transition: 'all 0.15s',
        ...style,
      }}
    >
      <VIcon name={icon} size={iconSize} />
    </button>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/primitives/
git commit -m "feat(overlay): VIcon + GhostBtn primitives"
```

---

## Task 8 : Primitives visuelles — VHMark, LiveWave, Confidence, CategoryTag

**Files:**
- Create: `apps/web/src/components/overlay/primitives/VHMark.tsx`
- Create: `apps/web/src/components/overlay/primitives/LiveWave.tsx`
- Create: `apps/web/src/components/overlay/primitives/Confidence.tsx`
- Create: `apps/web/src/components/overlay/primitives/CategoryTag.tsx`

- [ ] **Créer `apps/web/src/components/overlay/primitives/VHMark.tsx`**

```tsx
interface VHMarkProps {
  size?: number;
  glow?: boolean;
}

export function VHMark({ size = 30, glow = false }: VHMarkProps) {
  const barHeights = [0.36, 0.62, 1, 0.5];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        flexShrink: 0,
        background: 'linear-gradient(150deg, var(--indigo), var(--violet))',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        boxShadow: glow
          ? '0 0 0 1px hsl(0 0% 100% / 0.18) inset, 0 6px 18px -4px var(--accent)'
          : '0 0 0 1px hsl(0 0% 100% / 0.18) inset',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.066 }}>
        {barHeights.map((h, i) => (
          <span
            key={i}
            style={{
              width: size * 0.082,
              height: size * 0.52 * h,
              borderRadius: 99,
              background: 'white',
              transformOrigin: 'center',
              animation: glow
                ? `vh-bar ${0.8 + i * 0.14}s ease-in-out ${i * 0.1}s infinite`
                : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Créer `apps/web/src/components/overlay/primitives/LiveWave.tsx`**

```tsx
import { useRef } from 'react';

interface LiveWaveProps {
  active?: boolean;
  bars?: number;
  h?: number;
  color?: string;
  w?: number;
}

export function LiveWave({ active = true, bars = 22, h = 16, color = 'currentColor', w = 2 }: LiveWaveProps) {
  const seeds = useRef(
    Array.from({ length: bars }, (_, i) => 0.25 + (Math.sin(i * 2.3) * 0.5 + 0.5) * 0.75)
  ).current;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: h }}>
      {seeds.map((s, i) => (
        <span
          key={i}
          style={{
            width: w,
            height: Math.max(3, s * h),
            borderRadius: 99,
            background: color,
            flexShrink: 0,
            transformOrigin: 'center',
            animation: active
              ? `vh-bar ${0.6 + (i % 4) * 0.13}s ease-in-out ${i * 0.045}s infinite`
              : 'none',
            opacity: active ? 0.95 : 0.35,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Créer `apps/web/src/components/overlay/primitives/Confidence.tsx`**

```tsx
import type { Insight } from '@voxhelp/shared';

const CONFIDENCE_META: Record<Insight['confidence'], { dots: number; color: string; label: string }> = {
  confirmed: { dots: 3, color: 'var(--good)', label: 'Confirmé' },
  partial:   { dots: 2, color: 'var(--warn)', label: 'Partiel' },
  low:       { dots: 1, color: 'var(--risk)', label: 'À vérifier' },
};

interface ConfidenceProps {
  level: Insight['confidence'];
  showLabel?: boolean;
}

export function Confidence({ level, showLabel = true }: ConfidenceProps) {
  const meta = CONFIDENCE_META[level];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: i < meta.dots ? meta.color : 'hsl(0 0% 100% / 0.16)',
              boxShadow: i < meta.dots ? `0 0 6px -1px ${meta.color}` : 'none',
            }}
          />
        ))}
      </span>
      {showLabel && (
        <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, letterSpacing: '0.01em' }}>
          {meta.label}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Créer `apps/web/src/components/overlay/primitives/CategoryTag.tsx`**

```tsx
import type { Insight } from '@voxhelp/shared';
import { VIcon, type IconName } from './VIcon';

const CATEGORY_META: Record<Insight['cat'], { color: string; softColor: string; icon: IconName; label: string }> = {
  translation: { color: 'var(--indigo)', softColor: 'var(--indigo-soft)', icon: 'translate', label: 'Traduction' },
  jargon:      { color: 'var(--violet)', softColor: 'var(--violet-soft)', icon: 'sparkle',   label: 'Jargon décodé' },
  strength:    { color: 'var(--good)',   softColor: 'var(--good-soft)',   icon: 'strength',  label: 'Point fort' },
  risk:        { color: 'var(--risk)',   softColor: 'var(--risk-soft)',   icon: 'risk',      label: 'À creuser' },
  level:       { color: 'var(--cyan)',   softColor: 'var(--cyan-soft)',   icon: 'level',     label: 'Niveau tech' },
};

interface CategoryTagProps {
  cat: Insight['cat'];
}

export function CategoryTag({ cat }: CategoryTagProps) {
  const meta = CATEGORY_META[cat];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{
        width: 22,
        height: 22,
        borderRadius: 7,
        display: 'grid',
        placeItems: 'center',
        background: meta.softColor,
        color: meta.color,
        boxShadow: `0 0 0 1px ${meta.softColor}`,
      }}>
        <VIcon name={meta.icon} size={13} strokeWidth={2} />
      </span>
      <span style={{
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: meta.color,
      }}>
        {meta.label}
      </span>
    </span>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/primitives/
git commit -m "feat(overlay): VHMark, LiveWave, Confidence, CategoryTag primitives"
```

---

## Task 9 : PanelHeader

**Files:**
- Create: `apps/web/src/components/overlay/PanelHeader.tsx`

- [ ] **Créer `apps/web/src/components/overlay/PanelHeader.tsx`**

```tsx
import { VHMark } from './primitives/VHMark';
import { LiveWave } from './primitives/LiveWave';
import { GhostBtn } from './primitives/GhostBtn';

export type Status = 'idle' | 'listening' | 'speaking' | 'analyzing';

interface PanelHeaderProps {
  status: Status;
  wsStatus: string;
  onStop: () => void;
}

export function PanelHeader({ status, wsStatus, onStop }: PanelHeaderProps) {
  const isLive = status === 'speaking';
  const isThink = status === 'analyzing';

  const statusLabel =
    status === 'idle'      ? (wsStatus === 'connected' ? 'Connecté' : 'Déconnecté') :
    status === 'listening' ? 'En écoute' :
    status === 'speaking'  ? 'Candidat parle' :
                             'Analyse…';

  return (
    <div style={{ padding: '13px 15px 11px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <VHMark size={30} glow={isThink || isLive} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text)' }}>
            VoxHelp
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 500 }}>
            Copilote recruteur IA
          </span>
        </div>

        {/* Status pill */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 11px 5px 9px',
          borderRadius: 99,
          background: 'var(--card)',
          boxShadow: '0 0 0 1px var(--stroke) inset',
          flexShrink: 0,
        }}>
          {isLive ? (
            <span style={{ color: 'var(--good)' }}>
              <LiveWave active bars={9} h={13} w={2} color="currentColor" />
            </span>
          ) : isThink ? (
            <span style={{ width: 13, height: 13, display: 'grid', placeItems: 'center' }}>
              <span style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'conic-gradient(from 0deg, transparent, var(--accent))',
                WebkitMask: 'radial-gradient(circle 3.5px at center, transparent 96%, #000)',
                mask: 'radial-gradient(circle 3.5px at center, transparent 96%, #000)',
                animation: 'vh-spin 0.9s linear infinite',
              }} />
            </span>
          ) : (
            <span style={{
              width: 7,
              height: 7,
              borderRadius: 99,
              background: wsStatus === 'connected' ? 'var(--good)' : 'var(--text-3)',
              animation: wsStatus === 'connected' ? 'vh-pulse 1.8s infinite' : 'none',
            }} />
          )}
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: isThink ? 'var(--accent)' : 'var(--text-2)',
            whiteSpace: 'nowrap',
          }}>
            {statusLabel}
          </span>
        </div>

        <GhostBtn icon="stop" label="Arrêter la session" onClick={onStop} iconSize={13} />
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/PanelHeader.tsx
git commit -m "feat(overlay): PanelHeader with status pill and VHMark"
```

---

## Task 10 : LiveCaption

**Files:**
- Create: `apps/web/src/components/overlay/LiveCaption.tsx`

- [ ] **Créer `apps/web/src/components/overlay/LiveCaption.tsx`**

```tsx
import { VIcon } from './primitives/VIcon';
import { LiveWave } from './primitives/LiveWave';
import type { Status } from './PanelHeader';

const CAPTIONS = [
  '…donc tout le pipeline tourne en serverless sur AWS, sans serveurs à gérer.',
  'On utilise DynamoDB pour le temps réel et RDS pour l\'historique.',
  'Pour les pics de trafic, il y a un runbook CDK qui se déclenche automatiquement.',
];

interface LiveCaptionProps {
  status: Status;
  capIdx: number;
}

export function LiveCaption({ status, capIdx }: LiveCaptionProps) {
  if (status === 'idle' || status === 'listening') return null;

  const speaking = status === 'speaking';
  const caption = CAPTIONS[capIdx % CAPTIONS.length];

  return (
    <div style={{ padding: '0 15px 10px', flexShrink: 0 }}>
      <div style={{
        borderRadius: 14,
        padding: '9px 12px',
        background: 'var(--card)',
        boxShadow: '0 0 0 1px var(--stroke) inset',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}>
        <span style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--card-hi)',
          color: speaking ? 'var(--good)' : 'var(--text-3)',
        }}>
          <VIcon name="mic" size={14} />
        </span>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-3)',
            }}>
              Transcription en direct
            </span>
            {speaking && (
              <span style={{ color: 'var(--good)' }}>
                <LiveWave active bars={5} h={9} w={1.5} color="currentColor" />
              </span>
            )}
          </div>
          <p
            key={caption}
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: 'var(--text-2)',
              fontStyle: 'italic',
              animation: 'vh-caption-in 0.4s both',
            }}
          >
            "{caption}"
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/LiveCaption.tsx
git commit -m "feat(overlay): LiveCaption strip with animated transcript"
```

---

## Task 11 : InsightCardView

**Files:**
- Create: `apps/web/src/components/overlay/InsightCardView.tsx`

- [ ] **Créer `apps/web/src/components/overlay/InsightCardView.tsx`**

```tsx
import { useState } from 'react';
import type { Insight } from '@voxhelp/shared';
import { CategoryTag } from './primitives/CategoryTag';
import { Confidence } from './primitives/Confidence';
import { GhostBtn } from './primitives/GhostBtn';
import { VIcon } from './primitives/VIcon';

const CATEGORY_COLOR: Record<Insight['cat'], string> = {
  translation: 'var(--indigo)',
  jargon:      'var(--violet)',
  strength:    'var(--good)',
  risk:        'var(--risk)',
  level:       'var(--cyan)',
};

interface InsightCardViewProps {
  insight: Insight;
  isNew?: boolean;
}

export function InsightCardView({ insight, isNew }: InsightCardViewProps) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);

  const accentColor = CATEGORY_COLOR[insight.cat];

  function copy() {
    const txt = [insight.title, insight.body, insight.relance ? `→ ${insight.relance}` : '']
      .filter(Boolean)
      .join('\n');
    navigator.clipboard.writeText(txt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-card)',
        padding: '13px 14px',
        flexShrink: 0,
        background: hover ? 'var(--card-hi)' : 'var(--card)',
        boxShadow: hover
          ? `0 0 0 1px var(--stroke-2) inset, 0 10px 30px -12px hsl(230 40% 4% / 0.6)`
          : `0 0 0 1px var(--stroke) inset, var(--shadow-card)`,
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'background .18s, box-shadow .18s, transform .18s',
        animation: isNew ? 'vh-thought-in 0.55s cubic-bezier(.2,.8,.2,1) both' : 'none',
        overflow: 'hidden',
      }}
    >
      {/* Accent rail */}
      <span style={{
        position: 'absolute',
        left: 0,
        top: 12,
        bottom: 12,
        width: 3,
        borderRadius: 99,
        background: accentColor,
        opacity: 0.85,
      }} />

      {/* New-card glow ring */}
      {isNew && (
        <span style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          boxShadow: `0 0 0 1px ${accentColor} inset`,
          opacity: 0.5,
          animation: 'vh-glow-fade 2.4s ease forwards',
          pointerEvents: 'none',
        }} />
      )}

      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <CategoryTag cat={insight.cat} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-3)' }}>
          {insight.t}
        </span>
        <Confidence level={insight.confidence} showLabel={false} />
      </div>

      {/* Title */}
      <h3 style={{
        margin: '0 0 7px',
        fontSize: 14.5,
        fontWeight: 600,
        lineHeight: 1.32,
        letterSpacing: '-0.005em',
        color: 'var(--text)',
      }}>
        {insight.title}
      </h3>

      {/* Level meter — only for cat: 'level' */}
      {typeof insight.level === 'number' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 9px' }}>
          <div style={{
            flex: 1,
            height: 5,
            borderRadius: 99,
            background: 'hsl(0 0% 100% / 0.10)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${insight.level * 100}%`,
              height: '100%',
              borderRadius: 99,
              background: 'linear-gradient(90deg, var(--cyan), var(--indigo))',
            }} />
          </div>
          {insight.levelLabel && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)' }}>
              {insight.levelLabel}
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ marginBottom: insight.relance ? 11 : 2 }}>
        <div style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          marginBottom: 4,
        }}>
          Ce que ça veut dire
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
          {insight.body}
        </p>
      </div>

      {/* Follow-up question */}
      {insight.relance && (
        <div style={{
          borderRadius: 12,
          padding: '9px 11px',
          background: 'var(--accent-soft)',
          boxShadow: '0 0 0 1px var(--indigo-soft) inset',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <VIcon name="chat" size={12} style={{ color: 'var(--indigo)' }} />
            <span style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: 'var(--indigo)',
            }}>
              Question de relance
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--text)', fontWeight: 500 }}>
            {insight.relance}
          </p>
        </div>
      )}

      {/* Hover actions */}
      <div style={{
        position: 'absolute',
        top: 11,
        right: 12,
        display: 'flex',
        gap: 4,
        opacity: hover ? 1 : 0,
        transform: hover ? 'none' : 'translateY(-3px)',
        transition: 'opacity .15s, transform .15s',
        pointerEvents: hover ? 'auto' : 'none',
      }}>
        <GhostBtn
          icon={copied ? 'check' : 'copy'}
          label="Copier"
          onClick={copy}
          size={26}
          iconSize={13}
          style={{ background: 'var(--panel)' }}
        />
        <GhostBtn
          icon="pin"
          label="Épingler"
          onClick={() => setPinned((p) => !p)}
          active={pinned}
          size={26}
          iconSize={13}
          style={{ background: 'var(--panel)' }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/InsightCardView.tsx
git commit -m "feat(overlay): InsightCardView — accent rail, level meter, relance, hover actions"
```

---

## Task 12 : CommandBar

**Files:**
- Create: `apps/web/src/components/overlay/CommandBar.tsx`

- [ ] **Créer `apps/web/src/components/overlay/CommandBar.tsx`**

```tsx
import { useState } from 'react';
import { VIcon } from './primitives/VIcon';

interface CommandBarProps {
  elapsed: number;
  isCapturing: boolean;
  onStop: () => void;
  onAction: (id: 'assist' | 'followups' | 'recap') => void;
}

export function CommandBar({ elapsed, isCapturing, onStop, onAction }: CommandBarProps) {
  const [val, setVal] = useState('');
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const pills: Array<{ id: 'assist' | 'followups' | 'recap'; icon: 'sparkle' | 'chat' | 'refresh'; label: string }> = [
    { id: 'assist',   icon: 'sparkle', label: 'Assister' },
    { id: 'followups', icon: 'chat',    label: 'Relances' },
    { id: 'recap',    icon: 'refresh', label: 'Récap' },
  ];

  return (
    <div style={{
      flexShrink: 0,
      padding: '10px 14px 12px',
      borderTop: '1px solid var(--stroke)',
    }}>
      {/* Action pills */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 9 }}>
        {pills.map((p) => (
          <PillBtn key={p.id} icon={p.icon} label={p.label} onClick={() => onAction(p.id)} />
        ))}
      </div>

      {/* Ask input */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px 6px 13px',
        borderRadius: 13,
        background: 'var(--card)',
        boxShadow: '0 0 0 1px var(--stroke) inset',
        marginBottom: 10,
      }}>
        <VIcon name="sparkle" size={15} fill style={{ color: 'var(--accent)' }} />
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Demandez à VoxHelp…"
          style={{
            all: 'unset' as const,
            flex: 1,
            fontFamily: 'var(--font)',
            fontSize: 13,
            color: 'var(--text)',
            minWidth: 0,
          }}
        />
        <button
          onClick={() => setVal('')}
          style={{
            all: 'unset' as const,
            cursor: 'pointer',
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            background: val.trim() ? 'var(--accent)' : 'var(--card-hi)',
            color: 'white',
            transition: 'background .15s',
            flexShrink: 0,
          }}
        >
          <VIcon name="send" size={14} />
        </button>
      </div>

      {/* Recording footer */}
      {isCapturing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12,
            color: 'var(--text-2)',
            fontWeight: 500,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: 'var(--risk)',
              animation: 'vh-pulse 1.6s infinite',
              boxShadow: '0 0 8px -1px var(--risk)',
            }} />
            En cours
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>
              · {mm}:{ss}
            </span>
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onStop}
            style={{
              all: 'unset' as const,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9,
              background: 'var(--risk-soft)',
              color: 'var(--risk)',
              fontSize: 12.5,
              fontWeight: 600,
              boxShadow: '0 0 0 1px var(--risk-soft) inset',
            }}
          >
            <VIcon name="stop" size={11} fill />
            Arrêter
          </button>
        </div>
      )}
    </div>
  );
}

function PillBtn({
  icon,
  label,
  onClick,
}: {
  icon: 'sparkle' | 'chat' | 'refresh';
  label: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: 'unset' as const,
        cursor: 'pointer',
        flex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '8px 6px',
        borderRadius: 11,
        background: hover ? 'var(--card-hi)' : 'var(--card)',
        boxShadow: '0 0 0 1px var(--stroke) inset',
        fontSize: 12,
        fontWeight: 600,
        color: hover ? 'var(--text)' : 'var(--text-2)',
        transition: 'all .15s',
      }}
    >
      <VIcon name={icon} size={14} />
      {label}
    </button>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/CommandBar.tsx
git commit -m "feat(overlay): CommandBar with pills, ask input, recording footer"
```

---

## Task 13 : OverlayPanel (composant racine)

**Files:**
- Create: `apps/web/src/components/overlay/OverlayPanel.tsx`

- [ ] **Créer `apps/web/src/components/overlay/OverlayPanel.tsx`**

```tsx
import { useState, useEffect, useRef } from 'react';
import type { Insight, JobContext, CandidateReport } from '@voxhelp/shared';
import { PanelHeader, type Status } from './PanelHeader';
import { LiveCaption } from './LiveCaption';
import { InsightCardView } from './InsightCardView';
import { CommandBar } from './CommandBar';

interface OverlayPanelProps {
  insights: Insight[];
  isAnalyzing: boolean;
  isSummarizing: boolean;
  finalReport: CandidateReport | null;
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: (jobContext?: JobContext) => Promise<void>;
  onStop: () => void;
  onSummarize: () => void;
}

const RECOMMENDATION_LABEL: Record<CandidateReport['recommendation'], { label: string; color: string }> = {
  hire:  { label: 'Recommandé',  color: 'var(--good)' },
  maybe: { label: 'À revoir',    color: 'var(--warn)' },
  pass:  { label: 'Non retenu',  color: 'var(--risk)' },
};

export function OverlayPanel({
  insights, isAnalyzing, isSummarizing, finalReport,
  wsStatus, isCapturing, isSpeaking,
  onStartAudio, onStop, onSummarize,
}: OverlayPanelProps) {
  const [newId, setNewId] = useState<string | null>(null);
  const [capIdx, setCapIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [jobTitle, setJobTitle] = useState('');
  const [jobLevel, setJobLevel] = useState('');
  const [jobStack, setJobStack] = useState('');
  const feedEndRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number | null>(null);

  const status: Status = !isCapturing ? 'idle'
    : isAnalyzing   ? 'analyzing'
    : isSpeaking    ? 'speaking'
    : 'listening';

  // Auto-scroll on new content
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [insights.length, isAnalyzing]);

  // Track newest card for glow
  useEffect(() => {
    if (insights.length === 0) return;
    const last = insights[insights.length - 1];
    setNewId(last.id);
    const t = setTimeout(() => setNewId(null), 2400);
    return () => clearTimeout(t);
  }, [insights.length]);

  // Increment caption on each speaking burst
  useEffect(() => {
    if (isSpeaking) setCapIdx((i) => i + 1);
  }, [isSpeaking]);

  // Elapsed timer
  useEffect(() => {
    if (isCapturing) {
      startTimeRef.current = Date.now();
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      setElapsed(0);
      startTimeRef.current = null;
    }
  }, [isCapturing]);

  const handleStart = async () => {
    const jobContext: JobContext | undefined =
      jobTitle || jobLevel || jobStack
        ? { title: jobTitle, level: jobLevel, stack: jobStack }
        : undefined;
    await onStartAudio(jobContext);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d0f18', position: 'relative' }}>
      {/* Glass panel — fixed right */}
      <div style={{
        position: 'fixed',
        top: 18,
        bottom: 18,
        right: 18,
        width: 400,
        display: 'flex',
        flexDirection: 'column',
        background: 'hsl(222 28% 9% / 0.52)',
        backdropFilter: 'blur(34px) saturate(170%)',
        WebkitBackdropFilter: 'blur(34px) saturate(170%)',
        borderRadius: 'var(--radius-panel)',
        boxShadow: 'var(--shadow-panel)',
        color: 'var(--text)',
        fontFamily: 'var(--font)',
        overflow: 'hidden',
      }}>
        <PanelHeader status={status} wsStatus={wsStatus} onStop={onStop} />

        {!isCapturing ? (
          /* Pre-session form */
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              padding: '16px',
              background: 'var(--card)',
              borderRadius: 16,
              boxShadow: '0 0 0 1px var(--stroke) inset',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Contexte du poste (optionnel)
              </p>
              <input
                type="text"
                placeholder="Titre — ex : Senior Frontend Dev"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                style={inputStyle}
              />
              <select value={jobLevel} onChange={(e) => setJobLevel(e.target.value)} style={inputStyle}>
                <option value="">Niveau — non précisé</option>
                <option value="Junior">Junior</option>
                <option value="Intermédiaire">Intermédiaire</option>
                <option value="Senior">Senior</option>
                <option value="Lead">Lead</option>
              </select>
              <input
                type="text"
                placeholder="Stack — ex : React, TypeScript"
                value={jobStack}
                onChange={(e) => setJobStack(e.target.value)}
                style={inputStyle}
              />
              <button
                onClick={handleStart}
                style={{
                  all: 'unset' as const,
                  cursor: 'pointer',
                  display: 'block',
                  width: '100%',
                  padding: '10px',
                  borderRadius: 12,
                  background: 'var(--accent)',
                  color: 'white',
                  fontFamily: 'var(--font)',
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'center',
                  boxSizing: 'border-box',
                  transition: 'opacity .15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
              >
                Démarrer l'écoute
              </button>
            </div>
          </div>
        ) : (
          <>
            <LiveCaption status={status} capIdx={capIdx} />

            {/* Section label */}
            <div style={{
              padding: '6px 15px 8px',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                Analyse en direct
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--stroke)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>
                {insights.length}
              </span>
            </div>

            {/* Feed */}
            <div style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '0 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              {insights.length === 0 && !isAnalyzing && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}>
                  En écoute…
                </div>
              )}

              {insights.map((ins) => (
                <InsightCardView key={ins.id} insight={ins} isNew={ins.id === newId} />
              ))}

              {/* Skeleton card while analyzing */}
              {isAnalyzing && (
                <div style={{
                  flexShrink: 0,
                  borderRadius: 'var(--radius-card)',
                  padding: '13px 14px',
                  background: 'var(--card)',
                  boxShadow: '0 0 0 1px var(--stroke) inset',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={skeletonBar(80, 18)} />
                    <div style={{ flex: 1 }} />
                    <div style={skeletonBar(32, 10)} />
                  </div>
                  <div style={skeletonBar('65%', 14)} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={skeletonBar('40%', 9)} />
                    <div style={skeletonBar('100%', 11)} />
                    <div style={skeletonBar('85%', 11)} />
                  </div>
                </div>
              )}

              {/* Final report card */}
              {finalReport && <FinalReportCard report={finalReport} />}

              {/* Summarize trigger */}
              {!finalReport && insights.length > 0 && (
                <button
                  onClick={onSummarize}
                  disabled={isSummarizing}
                  style={{
                    all: 'unset' as const,
                    cursor: isSummarizing ? 'default' : 'pointer',
                    flexShrink: 0,
                    display: 'block',
                    padding: '9px',
                    borderRadius: 12,
                    background: 'var(--card)',
                    boxShadow: '0 0 0 1px var(--indigo-soft) inset',
                    color: 'var(--accent)',
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: 'center',
                    opacity: isSummarizing ? 0.6 : 1,
                    fontFamily: 'var(--font)',
                  }}
                >
                  {isSummarizing ? 'Génération du bilan…' : 'Générer le bilan candidat'}
                </button>
              )}

              <div ref={feedEndRef} style={{ height: 8 }} />
            </div>
          </>
        )}

        <CommandBar elapsed={elapsed} isCapturing={isCapturing} onStop={onStop} onAction={() => {}} />
      </div>
    </div>
  );
}

function skeletonBar(width: number | string, height: number): React.CSSProperties {
  return {
    width,
    height,
    borderRadius: 6,
    background: 'hsl(0 0% 100% / 0.07)',
    animation: 'vh-pulse 1.8s ease-in-out infinite',
  };
}

const inputStyle: React.CSSProperties = {
  all: 'unset' as const,
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  borderRadius: 10,
  background: 'var(--card-hi)',
  boxShadow: '0 0 0 1px var(--stroke) inset',
  fontSize: 12.5,
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  boxSizing: 'border-box',
};

function FinalReportCard({ report }: { report: CandidateReport }) {
  const rec = RECOMMENDATION_LABEL[report.recommendation];
  return (
    <div style={{
      flexShrink: 0,
      borderRadius: 'var(--radius-card)',
      padding: '13px 14px',
      background: 'var(--card)',
      boxShadow: '0 0 0 1px var(--stroke) inset, var(--shadow-card)',
      animation: 'vh-thought-in 0.55s cubic-bezier(.2,.8,.2,1) both',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
          Bilan candidat
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          padding: '3px 10px',
          borderRadius: 99,
          background: `color-mix(in srgb, ${rec.color} 15%, transparent)`,
          color: rec.color,
          boxShadow: `0 0 0 1px color-mix(in srgb, ${rec.color} 30%, transparent) inset`,
        }}>
          {rec.label}
        </span>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>{report.overall}</p>
      {report.strengths.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={{ margin: '0 0 4px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--good)' }}>
            Points forts
          </p>
          {report.strengths.map((s, i) => (
            <p key={i} style={{ margin: '0 0 2px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.4 }}>
              <span style={{ color: 'var(--good)', marginRight: 6 }}>+</span>{s}
            </p>
          ))}
        </div>
      )}
      {report.gaps.length > 0 && (
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--risk)' }}>
            Points à creuser
          </p>
          {report.gaps.map((g, i) => (
            <p key={i} style={{ margin: '0 0 2px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.4 }}>
              <span style={{ color: 'var(--risk)', marginRight: 6 }}>?</span>{g}
            </p>
          ))}
        </div>
      )}
      <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic', borderTop: '1px solid var(--stroke)', paddingTop: 8 }}>
        {report.recommendationReason}
      </p>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add apps/web/src/components/overlay/OverlayPanel.tsx
git commit -m "feat(overlay): OverlayPanel — glass panel root with pre-session form, feed, skeleton"
```

---

## Task 14 : Câbler App.tsx, supprimer LiveView.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/components/LiveView.tsx`

- [ ] **Remplacer le contenu de `apps/web/src/App.tsx`**

```tsx
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { OverlayPanel } from "./components/overlay/OverlayPanel";
import type { JobContext } from "@voxhelp/shared";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const ws = useWebSocket(WS_URL);
  const audio = useAudioCapture(ws.sendAudio);

  const handleStartAudio = async (jobContext?: JobContext) => {
    ws.startSession({ language: "fr", jobContext });
    try {
      await audio.startTabCapture();
    } catch {
      await audio.startMicrophone();
    }
  };

  const handleStop = () => {
    ws.stopSession();
    audio.stop();
  };

  return (
    <OverlayPanel
      insights={ws.insights}
      isAnalyzing={ws.isAnalyzing}
      isSummarizing={ws.isSummarizing}
      finalReport={ws.finalReport}
      wsStatus={ws.status}
      isCapturing={audio.isCapturing}
      isSpeaking={audio.isSpeaking}
      onStartAudio={handleStartAudio}
      onStop={handleStop}
      onSummarize={ws.summarize}
    />
  );
}
```

- [ ] **Supprimer `apps/web/src/components/LiveView.tsx`**

```bash
rm apps/web/src/components/LiveView.tsx
```

- [ ] **Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: aucune erreur.

- [ ] **Commit**

```bash
git add apps/web/src/App.tsx
git add -u apps/web/src/components/LiveView.tsx
git commit -m "feat(app): wire OverlayPanel, remove LiveView"
```

---

## Task 15 : Smoke test visuel

**Files:** aucun (run only)

- [ ] **Lancer le projet**

```bash
pnpm dev
```

Ouvrir `http://localhost:5173`.

- [ ] **Vérifier visuellement**

Checklist :
- [ ] Fond noir `#0d0f18` visible derrière le panneau
- [ ] Panneau de verre visible à droite (400px, rayon 26px, effet blur)
- [ ] Header : logo VHMark (carré dégradé indigo→violet + 4 barres), "VoxHelp", pill statut "Connecté" avec point vert pulsant
- [ ] Formulaire pre-session affiché dans le feed avec les 3 inputs et le bouton "Démarrer l'écoute"
- [ ] CommandBar visible en bas avec 3 pills + input "Demandez à VoxHelp…"
- [ ] Cliquer "Démarrer l'écoute" → statut change, footer recording apparaît avec timer rouge pulsant
- [ ] Quand une carte arrive → animation `vh-thought-in` + glow coloré 2.4s
- [ ] Hover carte → lift 1px, stroke éclairci, boutons Copier/Épingler en fade-in
- [ ] Copier → icône passe à ✓ 1.4s

- [ ] **Commit final si tout est OK**

```bash
git add -A
git commit -m "feat(overlay): glass panel UI — design handoff implementation complete"
```
