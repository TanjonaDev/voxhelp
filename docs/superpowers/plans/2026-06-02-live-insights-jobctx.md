# Live Insights + Job Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le transcript brut + explications IA texte libre par un feed de cartes d'analyse structurées (4 champs), avec contexte de poste optionnel injecté dans le prompt Claude.

**Architecture:** `SessionConfig` accepte un `jobContext?` optionnel passé au `session:start`. Le backend stocke ce contexte et l'injecte dans `buildLiveAssistPrompt`. `processTranscript` fait un seul `callClaudeJSON<InsightCard>` au lieu des deux appels parallèles (tech-translate + streaming assist). Le frontend supprime la colonne transcript et affiche un feed de cartes structurées.

**Tech Stack:** TypeScript strict, React 19, Tailwind CSS 3.4, Fastify 5, Claude Sonnet via `callClaudeJSON`.

---

## Fichiers

| Action | Chemin |
|---|---|
| Modifier | `packages/shared/src/index.ts` |
| Modifier | `apps/backend/src/prompts/live-assist.ts` |
| Supprimer | `apps/backend/src/prompts/tech-translate.ts` |
| Modifier | `apps/backend/src/session.ts` |
| Modifier | `apps/web/src/hooks/useWebSocket.ts` |
| Réécrire | `apps/web/src/components/LiveView.tsx` |
| Supprimer | `apps/web/src/components/TechTranslationCard.tsx` |
| Modifier | `apps/web/src/App.tsx` |

---

### Task 1 : Mettre à jour les shared types

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Ajouter `JobContext`, `InsightCard`, mettre à jour `SessionConfig`, ajouter `assist:card`**

Remplacer le contenu complet de `packages/shared/src/index.ts` par :

```typescript
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

export interface InsightCard {
  meaning: string;
  signal: {
    label: string;
    type: "positive" | "weak" | "dig";
  };
  followUp: string;
  confidence: "confirmed" | "partial" | "vague";
}

export interface TechTranslation {
  term: string;
  definition: string;
  relatedTechs: string[];
  criticality: "HIGH" | "MEDIUM" | "LOW";
}

export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: number;
}

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:buffering" }
  | { type: "transcript:idle" }
  | { type: "transcript:final"; text: string }
  | { type: "tech:translation"; translation: TechTranslation }
  | { type: "assist:start" }
  | { type: "assist:chunk"; text: string }
  | { type: "assist:done"; fullText: string }
  | { type: "assist:card"; card: InsightCard }
  | { type: "assist:error"; error: string }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

Note : `TechTranslation` est gardé temporairement pour que le typecheck passe pendant la migration. Il sera supprimé en Task 5.

- [ ] **Step 2 : Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 3 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add JobContext, InsightCard, assist:card to shared types"
```

---

### Task 2 : Réécrire le prompt live-assist et mettre à jour session.ts

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`
- Delete: `apps/backend/src/prompts/tech-translate.ts`
- Modify: `apps/backend/src/session.ts`

- [ ] **Step 1 : Réécrire `live-assist.ts`**

Remplacer le contenu complet de `apps/backend/src/prompts/live-assist.ts` par :

```typescript
import type { JobContext } from "@voxhelp/shared";

export function buildLiveAssistPrompt(jobContext?: JobContext): string {
  const contextSection = jobContext
    ? `\nContexte du poste : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\nCalibre ton signal et ton niveau de confiance en tenant compte de ces attentes.\n`
    : "";

  return `Tu es un assistant IA pour entretien technique. Tu reçois un extrait de transcript d'entretien.${contextSection}
Produis une analyse structurée en JSON strict (sans backticks, sans texte autour) :
{
  "meaning": "Ce que ça veut dire pour un recruteur non-tech (1-2 phrases)",
  "signal": {
    "label": "Signal observé (1 phrase courte)",
    "type": "positive|weak|dig"
  },
  "followUp": "Une question concrète de relance pour le recruteur",
  "confidence": "confirmed|partial|vague"
}
Règles :
- positive = maîtrise claire et articulée
- weak = réponse vague, superficielle ou incorrecte
- dig = sujet prometteur mais incomplet, mérite approfondissement
- confirmed = le candidat démontre une vraie expérience
- partial = connaissance théorique, expérience limitée
- vague = difficile à évaluer, réponse ambiguë`;
}
```

- [ ] **Step 2 : Supprimer `tech-translate.ts`**

```bash
git rm apps/backend/src/prompts/tech-translate.ts
```

- [ ] **Step 3 : Réécrire `session.ts`**

Remplacer le contenu complet de `apps/backend/src/session.ts` par :

```typescript
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
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 3500;

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

    try {
      const card = await callClaudeJSON<InsightCard>(
        buildLiveAssistPrompt(this.jobContext),
        `Ce qui vient d'être dit :\n"${transcript}"`
      );
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

- [ ] **Step 4 : Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts apps/backend/src/session.ts
git commit -m "feat(backend): structured InsightCard output, jobContext injection, remove tech-translate"
```

---

### Task 3 : Mettre à jour `useWebSocket.ts`

**Files:**
- Modify: `apps/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1 : Réécrire `useWebSocket.ts`**

Remplacer le contenu complet de `apps/web/src/hooks/useWebSocket.ts` par :

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, TranscriptEntry, InsightCard } from "@voxhelp/shared";
import { createId, WS_PING_INTERVAL_MS } from "@voxhelp/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  transcripts: TranscriptEntry[];
  currentPartial: string;
  isBuffering: boolean;
  isAnalyzing: boolean;
  insights: InsightCard[];
  startSession: (config: SessionConfig) => void;
  stopSession: () => void;
  sendAudio: (base64: string) => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [currentPartial, setCurrentPartial] = useState("");
  const [isBuffering, setIsBuffering] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [insights, setInsights] = useState<InsightCard[]>([]);

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
        setIsBuffering(false);
        setIsAnalyzing(false);
        console.error("[WS] Session error:", msg.error);
        break;
      case "transcript:partial":
        setCurrentPartial(msg.text);
        break;
      case "transcript:buffering":
        setIsBuffering(true);
        setIsAnalyzing(true);
        break;
      case "transcript:idle":
        setIsBuffering(false);
        setIsAnalyzing(false);
        break;
      case "transcript:final":
        setIsBuffering(false);
        setCurrentPartial("");
        setTranscripts((prev) => [
          ...prev,
          { id: createId(), text: msg.text, timestamp: Date.now() },
        ]);
        break;
      case "tech:translation":
        break;
      case "assist:start":
        break;
      case "assist:chunk":
        break;
      case "assist:done":
        break;
      case "assist:card":
        setIsAnalyzing(false);
        setInsights((prev) => [...prev, msg.card]);
        break;
      case "assist:error":
        setIsAnalyzing(false);
        console.error("[WS] Assist error:", msg.error);
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
      setIsBuffering(false);
      setIsAnalyzing(false);
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    ws.onerror = () => setStatus("error");
  }, [url, send, handleMessage]);

  const startSession = useCallback(
    (config: SessionConfig) => {
      setTranscripts([]);
      setCurrentPartial("");
      setIsBuffering(false);
      setIsAnalyzing(false);
      setInsights([]);

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

  useEffect(() => {
    connect();
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    status,
    transcripts,
    currentPartial,
    isBuffering,
    isAnalyzing,
    insights,
    startSession,
    stopSession,
    sendAudio,
  };
}
```

- [ ] **Step 2 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : erreur TypeScript sur `LiveView` — props obsolètes (`techTranslations`, `currentAssist`, `assists`, `isBuffering`). Attendu, corrigé en Task 4.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): replace assists/techTranslations with insights + isAnalyzing in useWebSocket"
```

---

### Task 4 : Réécrire `LiveView.tsx` et supprimer `TechTranslationCard.tsx`

**Files:**
- Modify: `apps/web/src/components/LiveView.tsx`
- Delete: `apps/web/src/components/TechTranslationCard.tsx`

- [ ] **Step 1 : Supprimer `TechTranslationCard.tsx`**

```bash
git rm apps/web/src/components/TechTranslationCard.tsx
```

- [ ] **Step 2 : Réécrire `LiveView.tsx`**

Remplacer le contenu complet de `apps/web/src/components/LiveView.tsx` par :

```typescript
import { useState, useEffect, useRef } from "react";
import type { InsightCard, JobContext } from "@voxhelp/shared";

interface LiveViewProps {
  insights: InsightCard[];
  isAnalyzing: boolean;
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: (jobContext?: JobContext) => Promise<void>;
  onStop: () => void;
}

const SIGNAL_STYLES = {
  positive: {
    border: "border-[#0FAA6C]/30",
    bg: "bg-[#0FAA6C]/5",
    dot: "bg-[#0FAA6C]",
    text: "text-[#0FAA6C]",
  },
  weak: {
    border: "border-[#FF6B35]/30",
    bg: "bg-[#FF6B35]/5",
    dot: "bg-[#FF6B35]",
    text: "text-[#FF6B35]",
  },
  dig: {
    border: "border-[#3D5AFE]/30",
    bg: "bg-[#3D5AFE]/5",
    dot: "bg-[#3D5AFE]",
    text: "text-[#3D5AFE]",
  },
};

const CONFIDENCE_LABELS = {
  confirmed: { label: "Confirmé", style: "text-[#0FAA6C] bg-[#0FAA6C]/10" },
  partial: { label: "Partiel", style: "text-[#FF6B35] bg-[#FF6B35]/10" },
  vague: { label: "Flou", style: "text-[#5A5F72] bg-[#5A5F72]/10" },
};

function InsightCardView({ card }: { card: InsightCard }) {
  const s = SIGNAL_STYLES[card.signal.type];
  const c = CONFIDENCE_LABELS[card.confidence];
  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-4 space-y-3`}>
      <div className={`flex items-center gap-2 ${s.text} font-medium text-sm`}>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
        {card.signal.label}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-1">
          Ce que ça veut dire
        </p>
        <p className="text-sm text-[#1A1D26] leading-relaxed">{card.meaning}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-1">
          Question de relance
        </p>
        <p className="text-sm text-[#1A1D26] italic leading-relaxed">{card.followUp}</p>
      </div>
      <div className="flex justify-end">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.style}`}>
          {c.label}
        </span>
      </div>
    </div>
  );
}

function useElapsedTime(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      setElapsed(0);
      startRef.current = null;
    }
  }, [active]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function LiveView({
  insights,
  isAnalyzing,
  wsStatus,
  isCapturing,
  isSpeaking,
  onStartAudio,
  onStop,
}: LiveViewProps) {
  const feedEndRef = useRef<HTMLDivElement>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobLevel, setJobLevel] = useState("");
  const [jobStack, setJobStack] = useState("");
  const elapsed = useElapsedTime(isCapturing);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [insights, isAnalyzing]);

  const handleStart = async () => {
    const jobContext =
      jobTitle || jobLevel || jobStack
        ? { title: jobTitle, level: jobLevel, stack: jobStack }
        : undefined;
    await onStartAudio(jobContext);
    setAudioStarted(true);
  };

  return (
    <div className="h-screen bg-[#F6F7FB] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#DFE1EA] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#3D5AFE] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VH</span>
          </div>
          <span className="font-semibold text-[#1A1D26] text-sm">VoxHelp</span>
        </div>
        <div
          className={`flex items-center gap-1.5 text-xs ${
            wsStatus === "connected" ? "text-[#0FAA6C]" : "text-[#5A5F72]"
          }`}
        >
          <div
            className={`w-2 h-2 rounded-full ${
              wsStatus === "connected" ? "bg-[#0FAA6C]" : "bg-gray-300"
            }`}
          />
          {wsStatus === "connected" ? "Connecté" : wsStatus}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 bg-white border-b border-[#DFE1EA] flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72]">
            Analyse temps réel
          </span>
          {!audioStarted ? (
            <button
              onClick={handleStart}
              className="text-xs bg-[#3D5AFE] text-white px-3 py-1 rounded-lg hover:bg-[#3451e0] transition-colors"
            >
              Démarrer l'écoute
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              <div
                className={`w-2 h-2 rounded-full ${
                  isSpeaking ? "bg-[#3D5AFE] animate-pulse" : "bg-[#0FAA6C]"
                }`}
              />
              <span className={isSpeaking ? "text-[#3D5AFE]" : "text-[#0FAA6C]"}>
                {isSpeaking ? "Parole détectée" : "En écoute"}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Pre-session form */}
          {!audioStarted && (
            <div className="bg-white border border-[#DFE1EA] rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72]">
                Contexte du poste (optionnel)
              </p>
              <input
                type="text"
                placeholder="Titre du poste — ex: Senior Frontend Developer"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full text-sm border border-[#DFE1EA] rounded-lg px-3 py-2 focus:outline-none focus:border-[#3D5AFE] bg-[#F6F7FB] text-[#1A1D26] placeholder-[#5A5F72]"
              />
              <select
                value={jobLevel}
                onChange={(e) => setJobLevel(e.target.value)}
                className="w-full text-sm border border-[#DFE1EA] rounded-lg px-3 py-2 focus:outline-none focus:border-[#3D5AFE] bg-[#F6F7FB] text-[#1A1D26]"
              >
                <option value="">Niveau — non précisé</option>
                <option value="Junior">Junior</option>
                <option value="Intermédiaire">Intermédiaire</option>
                <option value="Senior">Senior</option>
                <option value="Lead">Lead</option>
              </select>
              <input
                type="text"
                placeholder="Stack principale — ex: React, TypeScript, Node.js"
                value={jobStack}
                onChange={(e) => setJobStack(e.target.value)}
                className="w-full text-sm border border-[#DFE1EA] rounded-lg px-3 py-2 focus:outline-none focus:border-[#3D5AFE] bg-[#F6F7FB] text-[#1A1D26] placeholder-[#5A5F72]"
              />
            </div>
          )}

          {/* Empty state */}
          {audioStarted && insights.length === 0 && !isAnalyzing && (
            <div className="flex items-center justify-center h-full text-center text-[#5A5F72]">
              <div>
                <div className="text-4xl mb-3">🎧</div>
                <p className="text-sm">En écoute... Les analyses apparaîtront ici.</p>
              </div>
            </div>
          )}

          {/* Insight cards */}
          {insights.map((card, i) => (
            <InsightCardView key={i} card={card} />
          ))}

          {/* Skeleton card while analyzing */}
          {isAnalyzing && (
            <div className="rounded-xl border border-[#DFE1EA] bg-white p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-[#DFE1EA] rounded w-2/3" />
              <div className="space-y-1.5">
                <div className="h-3 bg-[#DFE1EA] rounded w-1/3" />
                <div className="h-3 bg-[#DFE1EA] rounded w-full" />
                <div className="h-3 bg-[#DFE1EA] rounded w-4/5" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 bg-[#DFE1EA] rounded w-1/3" />
                <div className="h-3 bg-[#DFE1EA] rounded w-3/4" />
              </div>
            </div>
          )}

          <div ref={feedEndRef} />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-white border-t border-[#DFE1EA] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          {isCapturing && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-[#1A1D26] font-medium">
            {isCapturing ? `En cours · ${elapsed}` : "En attente"}
          </span>
        </div>
        <button
          onClick={onStop}
          className="bg-red-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors"
        >
          ⏹ Arrêter
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : erreur TypeScript sur `App.tsx` — props `transcripts`, `isBuffering`, `techTranslations`, `currentAssist`, `assists` passées mais plus attendues par `LiveView`. Corrigé en Task 5.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/components/LiveView.tsx
git commit -m "feat(web): rewrite LiveView — insight cards feed, job context form, remove transcript column"
```

---

### Task 5 : Mettre à jour `App.tsx` + nettoyage final shared types

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Réécrire `App.tsx`**

Remplacer le contenu complet de `apps/web/src/App.tsx` par :

```typescript
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { LiveView } from "./components/LiveView";
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
    <LiveView
      insights={ws.insights}
      isAnalyzing={ws.isAnalyzing}
      wsStatus={ws.status}
      isCapturing={audio.isCapturing}
      isSpeaking={audio.isSpeaking}
      onStartAudio={handleStartAudio}
      onStop={handleStop}
    />
  );
}
```

- [ ] **Step 2 : Supprimer `TechTranslation` et types obsolètes de `shared/src/index.ts`**

Remplacer le contenu complet de `packages/shared/src/index.ts` par la version finale sans `TechTranslation` ni `TranscriptEntry` :

```typescript
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

export interface InsightCard {
  meaning: string;
  signal: {
    label: string;
    type: "positive" | "weak" | "dig";
  };
  followUp: string;
  confidence: "confirmed" | "partial" | "vague";
}

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:buffering" }
  | { type: "transcript:idle" }
  | { type: "transcript:final"; text: string }
  | { type: "assist:card"; card: InsightCard }
  | { type: "assist:error"; error: string }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

Note : `assist:start`, `assist:chunk`, `assist:done`, `tech:translation` sont retirés du protocole — plus émis ni consommés.

- [ ] **Step 3 : Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/App.tsx packages/shared/src/index.ts
git commit -m "feat(web): update App.tsx + clean up shared types (remove TechTranslation, TranscriptEntry)"
```
