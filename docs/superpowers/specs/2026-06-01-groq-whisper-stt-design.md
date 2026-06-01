# Design : Migration STT Deepgram Nova-3 → Groq Whisper

**Date :** 2026-06-01  
**Statut :** Approuvé

## Contexte

VoxHelp utilise Deepgram Nova-3 en streaming WebSocket pour la transcription en temps réel. L'architecture actuelle produit des transcripts partiels mot par mot mais présente des problèmes de stabilité et de précision sur le vocabulaire technique.

**Trade-off accepté :** on abandonne les partials en temps réel. Le transcript apparaît toutes les 5-10s mais il est complet et précis. Acceptable pour un entretien technique.

## Approche retenue

**Approche B — Nouveau type de message `transcript:buffering`**

Le backend accumule l'audio, détecte les silences ≥ 2s, envoie le chunk à Groq Whisper (HTTP), retourne un transcript complet. Un nouveau message `transcript:buffering` est ajouté au protocole WS pour signaler que l'audio est en cours d'accumulation.

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `packages/shared/src/index.ts` | Ajouter `{ type: "transcript:buffering" }` dans `ServerMessage` |
| `apps/backend/src/groq-stt.ts` | Nouveau fichier — remplace `deepgram.ts` |
| `apps/backend/src/session.ts` | Swapper `DeepgramSTT` → `GroqSTT`, émettre `transcript:buffering` |
| `apps/web/src/hooks/useWebSocket.ts` | Gérer `transcript:buffering` → setter `isBuffering` |
| `apps/web/src/components/LiveView.tsx` | Afficher "Transcription en cours..." quand `isBuffering` |

`apps/backend/src/deepgram.ts` est supprimé.

## Architecture détaillée

### `GroqSTT` (`groq-stt.ts`)

Trois responsabilités :

**1. Accumulation**
- `sendAudio(buffer: Buffer)` ajoute chaque chunk PCM16 au buffer interne
- Calcule le RMS du chunk
- Si RMS > `0.005` : marque `lastSoundAt = Date.now()`, émet `onBuffering()` une seule fois (flag `isBuffering` pour éviter les doublons)

**2. Détection de silence**
- Timer interne tick toutes les 200ms
- Si `Date.now() - lastSoundAt >= 2000ms` ET buffer non vide → flush
- Si buffer ≥ 20s d'audio (640 000 bytes PCM16 à 16kHz mono) → flush forcé

**3. Flush → Groq**
- Construit un fichier WAV en mémoire : header 44 bytes standard + données PCM16
- Skip si buffer < 0.5s (< 16 000 bytes) — évite d'envoyer du bruit
- `POST https://api.groq.com/openai/v1/audio/transcriptions` via `multipart/form-data`
  - `model: "whisper-large-v3-turbo"`
  - `language` : passé depuis `SessionConfig.language`
  - `response_format: "text"`
- Réponse vide (`""`) → ignorée silencieusement
- Erreur réseau/API → `onError(message)` + vide le buffer

**Interface callbacks :**
```ts
interface GroqSTTCallbacks {
  onBuffering: () => void;   // audio détecté, buffering actif
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}
```

### `session.ts`

Changements minimes :
- Import `GroqSTT` au lieu de `DeepgramSTT`
- `onBuffering` → émet `{ type: "transcript:buffering" }`
- Supprime `onPartial` (plus utilisé)
- Reste inchangé : `handleFinalTranscript`, debounce Claude, `processTranscript`

### Protocole WebSocket (shared types)

```ts
// Ajout dans ServerMessage
| { type: "transcript:buffering" }
```

`transcript:partial` reste dans les types (pas de breaking change) mais n'est plus émis.

### Frontend

**`useWebSocket.ts` :**
- Nouveau state `isBuffering: boolean`
- `transcript:buffering` → `setIsBuffering(true)`
- `transcript:final` → `setIsBuffering(false)` + ajoute au transcript (comportement actuel)
- Expose `isBuffering` dans le retour du hook

**`LiveView.tsx` :**
- Reçoit `isBuffering` en prop
- Quand `isBuffering` : affiche `"Transcription en cours..."` animé (opacity pulse) à la place du `currentPartial`
- `isSpeaking` (RMS client-side) continue de driver le point bleu/vert — inchangé

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Groq API error / réseau | `onError(msg)` → `session:error` côté client, buffer vidé |
| Réponse Groq vide (`""`) | Ignoré silencieusement, pas d'erreur |
| Buffer < 0.5s | Skip flush, pas d'appel Groq |
| Buffer ≥ 20s sans silence | Flush forcé |
| `close()` pendant flush en cours | Buffer vidé, timer stoppé, réponse Groq ignorée |

## Variables d'environnement

`GROQ_API_KEY` déjà présent dans `apps/backend/.env`.

Pas de nouveau package npm — appel Groq via `fetch` natif (Node 20+) + `FormData`.

## Ce qui ne change pas

- Capture audio côté client (`useAudioCapture.ts`) — inchangé
- Format PCM16 16kHz mono — inchangé
- Logique Claude assist + tech-translate dans `session.ts` — inchangée
- `correctTranscript` (post-correction Haiku) — inchangée, s'applique toujours sur le transcript final Groq
- Route REST (`/api/analyze-job`, `/api/generate-report`) — inchangées
