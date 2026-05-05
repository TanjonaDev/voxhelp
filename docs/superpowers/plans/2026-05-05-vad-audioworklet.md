# VAD + AudioWorklet Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deprecated `ScriptProcessorNode` with `@ricky0123/vad-web` (Silero ML VAD + AudioWorklet) so that only speech frames are sent to Deepgram.

**Architecture:** `MicVAD.new({ stream })` accepts the existing `MediaStream` (tab or mic), runs Silero VAD in an internal AudioWorklet, and calls `onFrameProcessed` for every 512-sample frame with a speech probability score. Frames with `isSpeech > 0.5` are converted Float32→Int16→base64 and forwarded via the existing `sendAudio()` callback. Nothing in the backend changes.

**Tech Stack:** `@ricky0123/vad-web`, `onnxruntime-web` (WASM, via CDN), Vite 6, React 19, TypeScript strict.

---

## File map

| File | Action |
|---|---|
| `apps/web/src/hooks/useAudioCapture.ts` | Full rewrite |
| `apps/web/vite.config.ts` | Add `optimizeDeps.exclude` |
| `apps/web/public/vad.worklet.bundle.min.js` | Copy from node_modules |
| `apps/web/public/silero_vad.onnx` | Copy from node_modules |
| `apps/web/src/App.tsx` | Add `isSpeaking` visual indicator (lines ~203-211) |

---

## Task 1: Install `@ricky0123/vad-web` and copy static assets

**Files:**
- Modify: `apps/web/package.json` (via pnpm)
- Create: `apps/web/public/vad.worklet.bundle.min.js`
- Create: `apps/web/public/silero_vad.onnx`

- [ ] **Step 1: Install the package**

```bash
pnpm --filter @voxhelp/web add @ricky0123/vad-web
```

Expected: package added to `apps/web/package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Copy static assets to public/**

```bash
cp node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js apps/web/public/
cp node_modules/@ricky0123/vad-web/dist/silero_vad.onnx apps/web/public/
```

- [ ] **Step 3: Verify files exist**

```bash
ls -lh apps/web/public/
```

Expected output includes `vad.worklet.bundle.min.js` and `silero_vad.onnx`.

- [ ] **Step 4: Get the installed onnxruntime-web version (needed for CDN URL in Task 3)**

```bash
node -e "console.log(require('./node_modules/onnxruntime-web/package.json').version)"
```

Note this version — you'll use it in Task 3 step 2.

---

## Task 2: Configure Vite

**Files:**
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Update vite.config.ts**

Replace the entire contents of `apps/web/vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@ricky0123/vad-web", "onnxruntime-web"],
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/package.json apps/web/public/vad.worklet.bundle.min.js apps/web/public/silero_vad.onnx apps/web/vite.config.ts pnpm-lock.yaml
git commit -m "chore: install @ricky0123/vad-web and configure Vite for WASM"
```

---

## Task 3: Rewrite `useAudioCapture.ts`

**Files:**
- Modify: `apps/web/src/hooks/useAudioCapture.ts`

This is a complete rewrite. The public interface gains one new field (`isSpeaking: boolean`) and is otherwise identical to the current hook.

- [ ] **Step 1: Replace the entire file**

```typescript
import { useCallback, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";

type AudioSource = "microphone" | "tab";

interface UseAudioCaptureReturn {
  isCapturing: boolean;
  isSpeaking: boolean;
  audioSource: AudioSource | null;
  startMicrophone: () => Promise<void>;
  startTabCapture: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

function float32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const uint8 = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function useAudioCapture(
  onAudioChunk: (base64: string) => void
): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<Awaited<ReturnType<typeof MicVAD.new>> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const ORT_VERSION = "REPLACE_WITH_VERSION_FROM_TASK_1_STEP_4";

  const startVAD = useCallback(
    async (stream: MediaStream, source: AudioSource) => {
      try {
        const vad = await MicVAD.new({
          stream,
          workletURL: "/vad.worklet.bundle.min.js",
          modelURL: "/silero_vad.onnx",
          ortConfig: (ort) => {
            ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
          },
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          preSpeechPadFrames: 4,
          redemptionFrames: 8,
          onFrameProcessed: (probs, frame) => {
            if (probs.isSpeech > 0.5) {
              onAudioChunk(float32ToBase64(frame));
            }
          },
          onSpeechStart: () => setIsSpeaking(true),
          onSpeechEnd: () => setIsSpeaking(false),
          onVADMisfire: () => setIsSpeaking(false),
        });

        vad.start();
        vadRef.current = vad;
        streamRef.current = stream;
        setAudioSource(source);
        setIsCapturing(true);
        setError(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "VAD initialization failed";
        setError(msg);
        stream.getTracks().forEach((t) => t.stop());
      }
    },
    [onAudioChunk]
  );

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      await startVAD(stream, "microphone");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Microphone access denied"
      );
    }
  }, [startVAD]);

  const startTabCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      stream.getVideoTracks().forEach((t) => t.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setError(
          "Aucun audio capturé. Assure-toi de cocher 'Partager l'audio' et de sélectionner l'onglet de ton appel."
        );
        return;
      }

      await startVAD(new MediaStream(audioTracks), "tab");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Tab audio capture denied"
      );
    }
  }, [startVAD]);

  const stop = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
    setIsSpeaking(false);
    setAudioSource(null);
  }, []);

  return {
    isCapturing,
    isSpeaking,
    audioSource,
    startMicrophone,
    startTabCapture,
    stop,
    error,
  };
}
```

- [ ] **Step 2: Substitute the real ORT version**

Replace `REPLACE_WITH_VERSION_FROM_TASK_1_STEP_4` in the file with the version string you noted in Task 1 Step 4 (e.g. `"1.17.3"`).

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. If you see `Module '"@ricky0123/vad-web"' has no exported member 'MicVAD'`, check the package exports with `ls node_modules/@ricky0123/vad-web/dist/` and adjust the import path.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useAudioCapture.ts
git commit -m "feat: replace ScriptProcessorNode with @ricky0123/vad-web (Silero VAD + AudioWorklet)"
```

---

## Task 4: Add `isSpeaking` indicator in `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx` (~line 203)

The capture indicator block currently reads:

```tsx
{audio.isCapturing && (
  <div className="flex items-center gap-2 text-xs text-success">
    <div className="relative">
      <div className="w-2 h-2 rounded-full bg-success" />
      <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-pulse-ring" />
    </div>
    {audio.audioSource === "tab" ? "Capture audio onglet" : "Capture micro"}
  </div>
)}
```

- [ ] **Step 1: Replace the capture indicator block**

Replace the block above with:

```tsx
{audio.isCapturing && (
  <div className="flex items-center gap-2 text-xs">
    <div className="relative">
      <div
        className={`w-2 h-2 rounded-full ${
          audio.isSpeaking ? "bg-accent" : "bg-success"
        }`}
      />
      {audio.isSpeaking && (
        <div className="absolute inset-0 w-2 h-2 rounded-full bg-accent animate-pulse-ring" />
      )}
    </div>
    <span className={audio.isSpeaking ? "text-accent" : "text-success"}>
      {audio.isSpeaking
        ? "Parole détectée"
        : audio.audioSource === "tab"
          ? "Capture audio onglet"
          : "Capture micro"}
    </span>
  </div>
)}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: add isSpeaking VAD indicator in capture status"
```

---

## Task 5: Manual browser test

No automated tests are possible for browser audio hardware. Test manually.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

Open `http://localhost:5173` in Chrome.

- [ ] **Step 2: Test microphone mode**

1. Select "Micro" source, click "Démarrer la session"
2. Grant microphone permission
3. Speak — the capture indicator should turn accent-colored and say "Parole détectée"
4. Stop speaking — indicator returns to green "Capture micro"
5. Check browser console: no errors, no WASM loading failures

- [ ] **Step 3: Test tab capture mode**

1. Open a video call tab (or any audio-playing tab)
2. Select "Onglet" source, click "Démarrer la session"
3. Share the audio tab with "Partager l'audio" checked
4. Confirm the VAD indicator fires when audio plays

- [ ] **Step 4: Verify Deepgram only receives speech**

In the backend terminal, Deepgram partial/final transcripts should only appear during actual speech, not during silence.

- [ ] **Step 5: Commit if any fixes were needed, then tag**

```bash
git add -p  # stage only intentional changes
git commit -m "fix: <describe any browser-test fixes>"
```
