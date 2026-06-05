# Design : Écoute continue + déclenchement manuel d'analyse

**Date :** 2026-06-05  
**Statut :** Approuvé

## Contexte

Le flush forcé à 30s dans `GroqSTT` déclenche des analyses en plein milieu d'une explication longue, produisant des cartes répétitives et incomplètes. Le recruteur n'a aucun moyen de forcer une analyse quand il le décide.

## Objectif

1. **Écoute continue** : supprimer le flush forcé sur `MAX_BUFFER_BYTES` — le buffer audio grandit sans limite, seul le silence ≥ 5s déclenche un flush Groq.
2. **Déclenchement manuel** : un bouton "Analyser ↵" permet au recruteur de forcer l'analyse à tout moment avec les transcripts déjà reçus.

## Approche retenue

**Approche A** — suppression du flush forcé + bouton manuel.

Le recruteur garde le contrôle : l'analyse automatique ne part que sur vraie pause (≥ 5s silence → flush Groq → debounce 3s → Claude). Pour les longues réponses sans pause, il appuie sur "Analyser ↵".

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `apps/backend/src/groq-stt.ts` | Supprimer le bloc de flush forcé sur `MAX_BUFFER_BYTES` |
| `packages/shared/src/index.ts` | Ajouter `{ type: "trigger:analyze" }` à `ClientMessage` |
| `apps/backend/src/session.ts` | Gérer `trigger:analyze` → méthode `triggerAnalysis()` |
| `apps/web/src/hooks/useWebSocket.ts` | Exposer `triggerAnalysis: () => void` |
| `apps/web/src/components/LiveView.tsx` | Ajouter bouton "Analyser ↵" + prop `onTriggerAnalysis` |
| `apps/web/src/App.tsx` | Passer `ws.triggerAnalysis` à LiveView |

## Détail des changements

### `groq-stt.ts`

Supprimer dans `sendAudio()` :
```typescript
if (this.totalBytes >= MAX_BUFFER_BYTES) {
  void this.flush();
}
```
Supprimer la constante `MAX_BUFFER_BYTES`. Le buffer PCM est désormais illimité. Le seul flush automatique reste le timer (tick 200ms, silence ≥ 5s).

### `packages/shared/src/index.ts`

```typescript
export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "trigger:analyze" }
  | { type: "ping" };
```

### `session.ts`

Nouveau case dans `handleMessage` :
```typescript
case "trigger:analyze":
  this.triggerAnalysis();
  break;
```

Nouvelle méthode privée :
```typescript
private triggerAnalysis(): void {
  if (this.debounceTimer) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }
  const fullText = this.transcriptBuffer.join(" ");
  this.transcriptBuffer = [];
  if (fullText.trim().split(/\s+/).length < 20) return;
  if (this.isProcessing) {
    this.pendingTranscript = fullText;
    return;
  }
  this.processTranscript(fullText);
}
```

Comportement :
- Annule le debounce en cours
- Prend tout ce qui est dans `transcriptBuffer` et le vide
- Si < 20 mots : ignoré silencieusement
- Si `isProcessing` : mis en `pendingTranscript` (traité après l'analyse en cours)
- Sinon : `processTranscript` immédiatement

### `useWebSocket.ts`

Ajouter dans `UseWebSocketReturn` :
```typescript
triggerAnalysis: () => void;
```

Ajouter dans le hook :
```typescript
const triggerAnalysis = useCallback(() => {
  send({ type: "trigger:analyze" });
}, [send]);
```

Exposé dans le return.

### `LiveView.tsx`

Ajout dans `LiveViewProps` :
```typescript
onTriggerAnalysis: () => void;
```

Dans la sub-header, après le status "En écoute / Parole détectée" :
```tsx
{audioStarted && (
  <button
    onClick={onTriggerAnalysis}
    className="text-[10px] bg-[#3D5AFE] text-white px-2.5 py-1 rounded-md hover:bg-[#3451e0] transition-colors font-medium"
  >
    Analyser ↵
  </button>
)}
```

Le bouton est visible dès que l'audio a démarré, même pendant `isAnalyzing` (le recruteur peut toujours forcer une nouvelle analyse — elle sera mise en `pendingTranscript` si une est déjà en cours).

### `App.tsx`

```tsx
<LiveView
  ...
  onTriggerAnalysis={ws.triggerAnalysis}
/>
```

## Ce qui ne change pas

- Silence threshold : 5s
- Debounce : 3s
- Filtre 20 mots minimum
- `conversationLog` / `questionLog` — inchangés
- `MIN_BUFFER_BYTES` (0.5s) — conservé pour éviter les flush de bruit
