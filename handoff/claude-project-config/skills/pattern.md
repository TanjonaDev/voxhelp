---
name: pattern
description: Identifier ou appliquer un patron de conception sur un fichier du projet voxhelp
---

$ARGUMENTS peut être :
- Un nom de patron : `strategy`, `factory`, `interface`, `facade`, `observer`
- Un fichier : analyse et identifie les patrons applicables
- Les deux : `strategy apps/backend/src/session.ts`

---

## Si c'est un fichier sans patron précisé

Lis le fichier. Identifie :
1. Les patrons **déjà présents**
2. Les patrons **applicables** pour améliorer la lisibilité ou l'extensibilité
3. Pour chaque patron applicable : montre un exemple concret avec le code du fichier

---

## Patrons pertinents pour ce projet TypeScript/Node.js/React

### Interface / Contrat STT
**Quand :** plusieurs classes font la même chose (`DeepgramSTT`, `GroqWhisperSTT`, `GeminiAudioTranslator`).
**Problème actuel :** `session.ts` dépend des classes concrètes, pas d'une interface.
```typescript
// À extraire dans packages/shared/src/index.ts ou backend/src/stt.ts
interface STTProvider {
  connect(): void;
  sendAudio(chunk: Buffer): void;
  close(): void;
}
// session.ts ne voit plus que STTProvider — zéro couplage aux implémentations
```

### Factory (STT)
**Quand :** création d'un objet selon la configuration/l'environnement.
**Applicable :** la logique `if (mode === translator && lang === mg)` dans `session.ts`.
```typescript
// stt-factory.ts
export function createSTTProvider(config: SessionConfig, callbacks: STTCallbacks): STTProvider {
  if (config.mode === 'translator' && config.sourceLanguage === 'mg') {
    return new GeminiAudioTranslator(...)
  }
  if (config.sourceLanguage === 'mg') {
    return new GroqWhisperSTT(...)
  }
  return new DeepgramSTT(...)
}
// session.ts devient : this.stt = createSTTProvider(config, callbacks)
```

### Strategy (routing LLM)
**Quand :** plusieurs comportements selon un `mode` ou un `type`.
**Applicable :** `handleFinalTranscript` qui fait des choses différentes selon `skipLLM`.
```typescript
// Au lieu de if/else inline
const postTranscriptStrategies = {
  gemini: () => { /* skip LLM, traduction déjà faite */ },
  default: (text: string) => this.processWithLLM(text),
}
postTranscriptStrategies[this.mode](text)
```

### Facade (pipeline audio)
**Quand :** simplifier un sous-système derrière une interface unique.
**Déjà présent :** `useAudioCapture` est une facade sur `AudioContext` + `ScriptProcessorNode`.
**À consolider :** `setupAudioPipeline` pourrait être extrait dans un fichier `audio-pipeline.ts`.

### Observer (WebSocket messages)
**Déjà présent :** `useWebSocket` observe les `ServerMessage` et met à jour le state.
**À vérifier :** chaque `case` dans le switch devrait déléguer à une fonction nommée, pas inline.

---

Si l'utilisateur demande l'implémentation d'un patron sur un fichier précis :
1. Montre le code avant/après
2. Lance le typecheck avant et après
3. Demande validation avant de modifier le fichier
