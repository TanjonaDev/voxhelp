# Groq Whisper STT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer Deepgram Nova-3 streaming par Groq Whisper (batch) : buffer audio backend, détection silence ≥2s, flush vers Groq, transcript complet toutes les 5-10s.

**Architecture:** `GroqSTT` accumule les chunks PCM16 reçus via WS, calcule le RMS pour détecter la parole, flush un fichier WAV vers l'API REST Groq après 2s de silence (ou 20s max). Un nouveau message `transcript:buffering` signale au frontend que l'audio est en cours d'accumulation.

**Tech Stack:** Node.js 20+ `fetch` natif, `FormData`, WAV header manuel (44 bytes), Groq API `whisper-large-v3-turbo`.

---

## Fichiers

| Action | Chemin |
|---|---|
| Modifier | `packages/shared/src/index.ts` |
| Créer | `apps/backend/src/groq-stt.ts` |
| Modifier | `apps/backend/src/session.ts` |
| Supprimer | `apps/backend/src/deepgram.ts` |
| Modifier | `apps/web/src/hooks/useWebSocket.ts` |
| Modifier | `apps/web/src/components/LiveView.tsx` |
| Modifier | `apps/web/src/App.tsx` |

---

### Task 1 : Ajouter `transcript:buffering` aux shared types

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Ajouter le type dans `ServerMessage`**

Dans `packages/shared/src/index.ts`, remplacer le bloc `ServerMessage` par :

```typescript
export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:buffering" }
  | { type: "transcript:final"; text: string }
  | { type: "tech:translation"; translation: TechTranslation }
  | { type: "assist:start" }
  | { type: "assist:chunk"; text: string }
  | { type: "assist:done"; fullText: string }
  | { type: "assist:error"; error: string }
  | { type: "pong" };
```

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
git commit -m "feat(shared): add transcript:buffering server message type"
```

---

### Task 2 : Créer `groq-stt.ts`

**Files:**
- Create: `apps/backend/src/groq-stt.ts`

- [ ] **Step 1 : Créer le fichier**

Créer `apps/backend/src/groq-stt.ts` avec le contenu suivant :

```typescript
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";

interface GroqSTTCallbacks {
  onBuffering: () => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

const RMS_THRESHOLD = 0.005;
const SILENCE_THRESHOLD_MS = 2000;
const MAX_BUFFER_BYTES = AUDIO_SAMPLE_RATE * 2 * 20; // 20s PCM16 mono = 640 000 bytes
const MIN_BUFFER_BYTES = AUDIO_SAMPLE_RATE * 2 * 0.5; // 0.5s = 16 000 bytes
const TICK_INTERVAL_MS = 200;

function buildWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function calcRms(buf: Buffer): number {
  const samples = buf.length / 2;
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    const s = buf.readInt16LE(i) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

export class GroqSTT {
  private callbacks: GroqSTTCallbacks;
  private language: string;
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private lastSoundAt = 0;
  private isBufferingActive = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(language: string, callbacks: GroqSTTCallbacks) {
    this.language = language;
    this.callbacks = callbacks;
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  sendAudio(buf: Buffer): void {
    if (this.closed) return;

    const rms = calcRms(buf);
    if (rms > RMS_THRESHOLD) {
      this.lastSoundAt = Date.now();
      if (!this.isBufferingActive) {
        this.isBufferingActive = true;
        this.callbacks.onBuffering();
      }
    }

    this.chunks.push(buf);
    this.totalBytes += buf.length;

    if (this.totalBytes >= MAX_BUFFER_BYTES) {
      void this.flush();
    }
  }

  private tick(): void {
    if (this.closed || this.totalBytes === 0 || this.lastSoundAt === 0) return;
    if (Date.now() - this.lastSoundAt >= SILENCE_THRESHOLD_MS) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.totalBytes < MIN_BUFFER_BYTES) {
      this.reset();
      return;
    }

    const pcm = Buffer.concat(this.chunks);
    this.reset();

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      this.callbacks.onError("GROQ_API_KEY not set");
      return;
    }

    try {
      const wav = buildWav(pcm);
      const form = new FormData();
      form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
      form.append("model", "whisper-large-v3-turbo");
      form.append("language", this.language);
      form.append("response_format", "text");

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        throw new Error(`Groq ${res.status}: ${await res.text()}`);
      }

      const text = (await res.text()).trim();
      if (text && !this.closed) {
        this.callbacks.onFinal(text);
      }
    } catch (err) {
      if (!this.closed) {
        this.callbacks.onError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  private reset(): void {
    this.chunks = [];
    this.totalBytes = 0;
    this.isBufferingActive = false;
    this.lastSoundAt = 0;
  }

  close(): void {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.reset();
  }
}
```

- [ ] **Step 2 : Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur (le fichier n'est pas encore importé donc il peut y avoir une alerte "unused" selon la config, mais pas d'erreur de type).

- [ ] **Step 3 : Commit**

```bash
git add apps/backend/src/groq-stt.ts
git commit -m "feat(backend): add GroqSTT — buffer PCM, silence detection, Whisper flush"
```

---

### Task 3 : Mettre à jour `session.ts` et supprimer `deepgram.ts`

**Files:**
- Modify: `apps/backend/src/session.ts`
- Delete: `apps/backend/src/deepgram.ts`

- [ ] **Step 1 : Modifier `session.ts`**

Remplacer le contenu complet de `apps/backend/src/session.ts` par :

```typescript
import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, SessionConfig, TechTranslation } from "@voxhelp/shared";
import { GroqSTT } from "./groq-stt.js";
import { generateFromPrompt, callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildTechTranslatePrompt } from "./prompts/tech-translate.js";

export class Session {
  private ws: WebSocket;
  private stt: GroqSTT | null = null;
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

    this.stt = new GroqSTT(config.language, {
      onBuffering: () => this.send({ type: "transcript:buffering" }),
      onFinal: (text) => void this.handleFinalTranscript(text),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    this.stt.start();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}`);
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
```

- [ ] **Step 2 : Supprimer `deepgram.ts`**

```bash
git rm apps/backend/src/deepgram.ts
```

- [ ] **Step 3 : Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/session.ts
git commit -m "feat(backend): swap DeepgramSTT → GroqSTT, remove deepgram.ts"
```

---

### Task 4 : Mettre à jour `useWebSocket.ts`

**Files:**
- Modify: `apps/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1 : Ajouter `isBuffering` et gérer `transcript:buffering`**

Remplacer le contenu complet de `apps/web/src/hooks/useWebSocket.ts` par :

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, TranscriptEntry, TechTranslation } from "@voxhelp/shared";
import { createId, WS_PING_INTERVAL_MS } from "@voxhelp/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface AssistMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface UseWebSocketReturn {
  status: ConnectionStatus;
  transcripts: TranscriptEntry[];
  currentPartial: string;
  isBuffering: boolean;
  techTranslations: TechTranslation[];
  currentAssist: { text: string; isStreaming: boolean } | null;
  assists: AssistMessage[];
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
  const [techTranslations, setTechTranslations] = useState<TechTranslation[]>([]);
  const [currentAssist, setCurrentAssist] = useState<{ text: string; isStreaming: boolean } | null>(null);
  const [assists, setAssists] = useState<AssistMessage[]>([]);

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
        console.error("[WS] Session error:", msg.error);
        break;
      case "transcript:partial":
        setCurrentPartial(msg.text);
        break;
      case "transcript:buffering":
        setIsBuffering(true);
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
        setTechTranslations((prev) => [msg.translation, ...prev].slice(0, 5));
        break;
      case "assist:start":
        setCurrentAssist({ text: "", isStreaming: true });
        break;
      case "assist:chunk":
        setCurrentAssist((prev) =>
          prev ? { ...prev, text: prev.text + msg.text } : null
        );
        break;
      case "assist:done":
        setCurrentAssist(null);
        setAssists((prev) => [
          ...prev,
          { id: createId(), text: msg.fullText, timestamp: Date.now() },
        ]);
        break;
      case "assist:error":
        setCurrentAssist(null);
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
      setTechTranslations([]);
      setCurrentAssist(null);
      setAssists([]);

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

  return { status, transcripts, currentPartial, isBuffering, techTranslations, currentAssist, assists, startSession, stopSession, sendAudio };
}
```

- [ ] **Step 2 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : erreur TypeScript sur `LiveView` — `isBuffering` manquant dans les props. C'est attendu, on le corrige dans la tâche suivante.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add isBuffering state, handle transcript:buffering message"
```

---

### Task 5 : Mettre à jour `LiveView.tsx` et `App.tsx`

**Files:**
- Modify: `apps/web/src/components/LiveView.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1 : Modifier `LiveViewProps` et le rendu dans `LiveView.tsx`**

Dans `apps/web/src/components/LiveView.tsx` :

**Remplacer l'interface `LiveViewProps`** (lignes 11-22) :

```typescript
interface LiveViewProps {
  transcripts: TranscriptEntry[];
  isBuffering: boolean;
  techTranslations: TechTranslation[];
  currentAssist: { text: string; isStreaming: boolean } | null;
  assists: AssistMessage[];
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: () => Promise<void>;
  onStop: () => void;
}
```

**Remplacer la destructuration** dans la signature de la fonction (lignes 46-57) :

```typescript
export function LiveView({
  transcripts,
  isBuffering,
  techTranslations,
  currentAssist,
  assists,
  wsStatus,
  isCapturing,
  isSpeaking,
  onStartAudio,
  onStop,
}: LiveViewProps) {
```

**Remplacer le `useEffect` scroll** (ligne 63-65) — `currentPartial` n'est plus nécessaire :

```typescript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, isBuffering]);
```

**Remplacer le bloc condition vide** (lignes 115-124) :

```typescript
            {transcripts.length === 0 && !isBuffering && (
              <div className="flex items-center justify-center h-full text-center text-[#5A5F72]">
                <div>
                  <div className="text-4xl mb-3">🎤</div>
                  <p className="text-sm">
                    {audioStarted ? "En écoute..." : "Démarrez l'écoute pour commencer"}
                  </p>
                </div>
              </div>
            )}
```

**Remplacer le bloc `currentPartial`** (lignes 135-144) :

```typescript
            {isBuffering && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[#F6F7FB] border border-[#DFE1EA] flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                  🎤
                </div>
                <div className="bg-white border border-[#DFE1EA] rounded-xl px-4 py-2.5 text-sm text-[#5A5F72] italic opacity-70 shadow-sm max-w-[85%] animate-pulse">
                  Transcription en cours...
                </div>
              </div>
            )}
```

- [ ] **Step 2 : Mettre à jour `App.tsx`**

Dans `apps/web/src/App.tsx`, remplacer `currentPartial={ws.currentPartial}` par `isBuffering={ws.isBuffering}` dans les props passées à `<LiveView>`.

Lire le fichier pour trouver le bloc exact, puis faire l'Edit ciblé.

- [ ] **Step 3 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/components/LiveView.tsx apps/web/src/App.tsx
git commit -m "feat(web): replace partial transcript with isBuffering indicator in LiveView"
```

---

### Task 6 : Vérification end-to-end

**Files:** aucun fichier modifié — vérification uniquement.

- [ ] **Step 1 : Lancer le projet**

```bash
pnpm dev
```

Ouvrir `http://localhost:5173`.

- [ ] **Step 2 : Vérifier le flux audio**

1. Aller sur l'étape **Live**
2. Cliquer **Démarrer l'écoute** (microphone)
3. Parler pendant 3-4 secondes, puis se taire
4. Vérifier dans l'UI :
   - Pendant la parole : le bandeau "Transcription en cours..." apparaît en italique pulsant
   - Après ~2s de silence : le transcript final apparaît en bulle blanche
   - Les explications IA (tech-translate + assist) se déclenchent après le transcript

- [ ] **Step 3 : Vérifier les logs backend**

Dans le terminal backend, les logs attendus :
```
[Session] Started: language=fr
[Session] Corrected: "..." → "..."   (si correction Haiku active)
```

Aucun log `[Deepgram]`.

- [ ] **Step 4 : Vérifier la variable d'env**

Si le transcript ne revient pas, vérifier que `GROQ_API_KEY` est bien dans `apps/backend/.env`. La clé est déjà présente : `gsk_h83...`.
