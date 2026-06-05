# Continuous Listening + Manual Analysis Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer le flush forcé sur durée (écoute continue), ajouter un bouton "Analyser ↵" pour déclencher manuellement l'analyse à tout moment.

**Architecture:** `MAX_BUFFER_BYTES` et son bloc de flush forcé sont supprimés de `GroqSTT` — le seul flush automatique reste silence ≥ 5s. Un nouveau message `trigger:analyze` dans le protocole WS permet au frontend de demander une analyse immédiate du buffer accumulé. Le filtre "20 mots minimum" est supprimé côté session.

**Tech Stack:** TypeScript strict, ESM, Fastify/WebSocket backend, React 19 frontend, Tailwind CSS.

---

## Fichiers

| Action | Chemin |
|---|---|
| Modifier | `packages/shared/src/index.ts` |
| Modifier | `apps/backend/src/groq-stt.ts` |
| Modifier | `apps/backend/src/session.ts` |
| Modifier | `apps/web/src/hooks/useWebSocket.ts` |
| Modifier | `apps/web/src/components/LiveView.tsx` |
| Modifier | `apps/web/src/App.tsx` |

---

### Task 1 : Ajouter `trigger:analyze` aux shared types

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1 : Ajouter `trigger:analyze` à `ClientMessage`**

Dans `packages/shared/src/index.ts`, remplacer `ClientMessage` par :

```typescript
export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "trigger:analyze" }
  | { type: "ping" };
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
git commit -m "feat(shared): add trigger:analyze to ClientMessage"
```

---

### Task 2 : Backend — supprimer le flush forcé + `triggerAnalysis()`

**Files:**
- Modify: `apps/backend/src/groq-stt.ts`
- Modify: `apps/backend/src/session.ts`

- [ ] **Step 1 : Modifier `groq-stt.ts` — supprimer le flush forcé**

Dans `apps/backend/src/groq-stt.ts` :

**Supprimer la ligne 12** (constante `MAX_BUFFER_BYTES`) :
```typescript
const MAX_BUFFER_BYTES = AUDIO_SAMPLE_RATE * 2 * 30; // 30s PCM16 mono = 960 000 bytes
```

**Supprimer le bloc lignes 80-82** dans `sendAudio()` :
```typescript
    if (this.totalBytes >= MAX_BUFFER_BYTES) {
      void this.flush();
    }
```

Résultat — `sendAudio()` doit ressembler à :
```typescript
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
  }
```

- [ ] **Step 2 : Modifier `session.ts` — supprimer le filtre 20 mots et ajouter `triggerAnalysis()`**

Dans `apps/backend/src/session.ts` :

**A) Remplacer le filtre 20 mots** dans le callback du `debounceTimer` (ligne 104) :

Remplacer :
```typescript
      if (fullText.trim().split(/\s+/).length < 20) return;
```
Par :
```typescript
      if (!fullText.trim()) return;
```

**B) Ajouter le case `trigger:analyze`** dans `handleMessage()`, après le case `ping` :

```typescript
      case "trigger:analyze":
        this.triggerAnalysis();
        break;
```

**C) Ajouter la méthode `triggerAnalysis()`** après `handleAudioChunk()` :

```typescript
  private triggerAnalysis(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const fullText = this.transcriptBuffer.join(" ");
    this.transcriptBuffer = [];
    if (!fullText.trim()) return;
    if (this.isProcessing) {
      this.pendingTranscript = fullText;
      return;
    }
    this.processTranscript(fullText);
  }
```

- [ ] **Step 3 : Typecheck backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add apps/backend/src/groq-stt.ts apps/backend/src/session.ts
git commit -m "feat(backend): remove forced flush, add triggerAnalysis() for manual trigger"
```

---

### Task 3 : Frontend — `triggerAnalysis()` dans le hook + bouton dans LiveView

**Files:**
- Modify: `apps/web/src/hooks/useWebSocket.ts`
- Modify: `apps/web/src/components/LiveView.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1 : Ajouter `triggerAnalysis` à `useWebSocket.ts`**

Dans `apps/web/src/hooks/useWebSocket.ts` :

**A) Ajouter à `UseWebSocketReturn`** :
```typescript
interface UseWebSocketReturn {
  status: ConnectionStatus;
  isAnalyzing: boolean;
  insights: InsightCard[];
  startSession: (config: SessionConfig) => void;
  stopSession: () => void;
  sendAudio: (base64: string) => void;
  triggerAnalysis: () => void;
}
```

**B) Ajouter le callback** après `sendAudio` :
```typescript
  const triggerAnalysis = useCallback(() => {
    send({ type: "trigger:analyze" });
  }, [send]);
```

**C) Ajouter dans le `return`** :
```typescript
  return {
    status,
    isAnalyzing,
    insights,
    startSession,
    stopSession,
    sendAudio,
    triggerAnalysis,
  };
```

- [ ] **Step 2 : Ajouter `onTriggerAnalysis` prop et le bouton dans `LiveView.tsx`**

Dans `apps/web/src/components/LiveView.tsx` :

**A) Ajouter à `LiveViewProps`** :
```typescript
interface LiveViewProps {
  insights: InsightCard[];
  isAnalyzing: boolean;
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: (jobContext?: JobContext) => Promise<void>;
  onStop: () => void;
  onTriggerAnalysis: () => void;
}
```

**B) Ajouter à la destructuration de la fonction** :
```typescript
export function LiveView({
  insights,
  isAnalyzing,
  wsStatus,
  isCapturing,
  isSpeaking,
  onStartAudio,
  onStop,
  onTriggerAnalysis,
}: LiveViewProps) {
```

**C) Remplacer le bloc sub-header** (actuellement lignes 107-120 environ) — remplacer la `<div>` de status audio par :

```tsx
        <div className="px-3 py-1.5 bg-white border-b border-[#DFE1EA] flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72]">Analyse</span>
          {!audioStarted ? (
            <button onClick={handleStart} className="text-[10px] bg-[#3D5AFE] text-white px-2.5 py-1 rounded-md hover:bg-[#3451e0] transition-colors font-medium">
              Démarrer l'écoute
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[10px]">
                <div className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? "bg-[#3D5AFE] animate-pulse" : "bg-[#0FAA6C]"}`} />
                <span className={isSpeaking ? "text-[#3D5AFE]" : "text-[#0FAA6C]"}>{isSpeaking ? "Parole détectée" : "En écoute"}</span>
              </div>
              <button
                onClick={onTriggerAnalysis}
                className="text-[10px] bg-[#3D5AFE] text-white px-2.5 py-1 rounded-md hover:bg-[#3451e0] transition-colors font-medium"
              >
                Analyser ↵
              </button>
            </div>
          )}
        </div>
```

- [ ] **Step 3 : Passer `onTriggerAnalysis` depuis `App.tsx`**

Dans `apps/web/src/App.tsx`, ajouter le prop à `<LiveView>` :

```typescript
  return (
    <LiveView
      insights={ws.insights}
      isAnalyzing={ws.isAnalyzing}
      wsStatus={ws.status}
      isCapturing={audio.isCapturing}
      isSpeaking={audio.isSpeaking}
      onStartAudio={handleStartAudio}
      onStop={handleStop}
      onTriggerAnalysis={ws.triggerAnalysis}
    />
  );
```

- [ ] **Step 4 : Typecheck frontend**

```bash
cd apps/web && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/hooks/useWebSocket.ts apps/web/src/components/LiveView.tsx apps/web/src/App.tsx
git commit -m "feat(web): add triggerAnalysis hook + Analyser button in LiveView"
```
