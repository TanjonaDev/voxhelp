# VAD + AudioWorklet Migration — Design Spec

**Date:** 2026-05-05  
**Status:** Approved  
**Scope:** `apps/web` only — backend untouched

---

## Objectif

Remplacer le `ScriptProcessorNode` déprécié par un pipeline AudioWorklet via `@ricky0123/vad-web`, et implémenter un VAD ML (Silero) pour ne transmettre à Deepgram que les frames contenant de la parole.

**Bénéfices :**
- Réduction des coûts STT (silence non envoyé)
- Suppression des faux transcripts (bruit de fond, clavier, notifications)
- Migration AudioWorklet sans écrire de worklet custom

---

## Périmètre

**Fichiers modifiés :**
- `apps/web/src/hooks/useAudioCapture.ts` — réécriture complète
- `apps/web/vite.config.ts` — exclusion `onnxruntime-web` de l'optimisation Vite
- `apps/web/package.json` — ajout `@ricky0123/vad-web`

**Fichiers non touchés :**
- `apps/backend/` — aucun changement
- `apps/web/src/hooks/useWebSocket.ts` — aucun changement
- `apps/web/src/App.tsx` — ajout mineur : indicateur `isSpeaking`
- `packages/shared/` — aucun changement

---

## Architecture

```
MediaStream (tab ou micro)
  └─► MicVAD.new() [@ricky0123/vad-web]
        │  AudioWorklet interne (Silero ONNX, ~2 MB WASM)
        │
        ├─ onFrameProcessed(probabilities, frame: Float32Array)
        │    └─ if isSpeech > 0.5 → Float32→Int16→base64 → sendAudio()
        │
        ├─ onSpeechStart() → setIsSpeaking(true)
        └─ onSpeechEnd()   → setIsSpeaking(false)
```

---

## Interface du hook

```typescript
interface UseAudioCaptureReturn {
  isCapturing: boolean;
  isSpeaking: boolean;          // nouveau — pulse visuel dans l'UI
  audioSource: AudioSource | null;
  startMicrophone: () => Promise<void>;
  startTabCapture: () => Promise<void>;
  stop: () => void;
  error: string | null;
}
```

`isSpeaking` est exposé pour permettre un indicateur visuel dans `App.tsx` (le point de statut audio pulse quand la parole est détectée).

---

## Paramètres VAD

| Paramètre | Valeur | Rôle |
|---|---|---|
| `positiveSpeechThreshold` | `0.5` | Seuil pour déclarer "parole" |
| `negativeSpeechThreshold` | `0.35` | Hystérésis — seuil pour déclarer "silence" |
| `preSpeechPadFrames` | `4` | Frames bufférisées avant détection — évite de couper le premier mot (~120ms) |
| `redemptionFrames` | `8` | Frames envoyées après détection silence — évite de couper la dernière syllabe (~240ms) |

---

## Setup Vite

`@ricky0123/vad-web` utilise `onnxruntime-web` (WASM). Configuration requise dans `vite.config.ts` :

```typescript
optimizeDeps: {
  exclude: ["@ricky0123/vad-web", "onnxruntime-web"],
}
```

Le fichier modèle `silero_vad.onnx` est copié dans `apps/web/public/`. L'ONNX runtime est pointé vers son CDN (`cdn.jsdelivr.net`) via `ortConfig` dans `MicVAD.new()`.

---

## Flux de données détaillé

### Avant (ScriptProcessorNode)
- `onaudioprocess` tire toutes les 250ms sans condition
- Float32 → Int16 → base64 → `sendAudio()` systématiquement
- Silence, bruit, tout part vers Deepgram

### Après (vad-web + AudioWorklet)
- `onFrameProcessed` tire toutes les ~30ms (512 samples @ 16kHz)
- Chaque frame a un score `isSpeech` entre 0 et 1
- Seules les frames avec `isSpeech > 0.5` sont converties et envoyées
- Deepgram ne reçoit que de la parole réelle

---

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| `MicVAD.new()` échec (WASM, stream) | `setError(msg)` → bandeau rouge existant dans `App.tsx` |
| Stream tab sans audio | Vérification `audioTracks.length === 0` avant `MicVAD.new()` |
| Parole continue sans silence | `redemptionFrames` + debounce 1800ms backend (second filet) |
| Stop session | `myvad.destroy()` libère stream tracks + AudioWorklet + modèle |

---

## Ce qui ne change pas

- Le debounce 1800ms dans `session.ts` reste le filet de sécurité LLM
- `sendAudio(base64: string)` dans `useWebSocket.ts` — interface identique
- Le backend `deepgram.ts` reçoit des frames PCM base64 comme avant (format inchangé, volume réduit)
- La logique de sélection tab/micro dans `App.tsx` — inchangée
