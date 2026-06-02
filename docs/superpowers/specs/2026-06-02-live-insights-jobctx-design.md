# Design : Live Insights + Job Context Injection

**Date :** 2026-06-02  
**Statut :** Approuvé

## Contexte

VoxHelp affiche actuellement le transcript brut du candidat + des explications IA en texte libre dans deux colonnes séparées. L'objectif est de supprimer le transcript brut et de le remplacer par des cartes d'analyse structurées calibrées sur le poste. C'est l'étape "sans base vectorielle" d'une architecture RAG à venir (Qdrant + embeddings).

## Périmètre de cette itération

Blocs 1, 2, 3, 5, 6 du schéma cible — sans Qdrant (bloc 4).

- **Bloc 3 (enrichissement)** : contexte de poste optionnel (titre, niveau, stack) saisi par le recruteur avant la session
- **Bloc 5 (Claude)** : sortie JSON structurée avec 4 champs par chunk de transcript
- **Bloc 6 (UI)** : feed de cartes recruteur, transcript brut supprimé

## Approche retenue

**Approche A — Prompt restructuré + JSON batch**

`live-assist` passe de `generateFromPrompt` (streaming texte libre) à `callClaudeJSON` (batch JSON). Un seul appel Claude par chunk, sortie garantie structurée. Les `TechTranslationCard` sont supprimées — "Ce que ça veut dire" les remplace.

## Structures de données

### Nouveaux types (`packages/shared/src/index.ts`)

```typescript
export interface JobContext {
  title: string;   // ex: "Senior Frontend Developer"
  level: string;   // ex: "Senior"
  stack: string;   // ex: "React, TypeScript, Node.js"
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
```

### `SessionConfig` mis à jour

```typescript
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;   // optionnel
}
```

### Nouveau message serveur

```typescript
| { type: "assist:card"; card: InsightCard }
```

`assist:start`, `assist:chunk`, `assist:done` restent dans les types pour compatibilité ascendante mais ne sont plus émis par le backend.

### Types supprimés

`TechTranslation` et son interface associée sont supprimés de `shared/src/index.ts`.

## Backend

### `prompts/live-assist.ts`

`buildLiveAssistPrompt(jobContext?: JobContext): string`

Sans contexte — prompt générique :
```
Tu es un assistant IA pour entretien technique.
Tu reçois un extrait de transcript d'entretien.
Produis une analyse structurée en JSON strict (sans backticks) :
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
- vague = difficile à évaluer, réponse ambiguë
```

Avec `jobContext` — le prompt ajoute :
```
Contexte du poste : ${title} — niveau ${level} — stack attendue : ${stack}
Calibre ton signal et ton niveau de confiance en tenant compte de ces attentes.
```

### `prompts/tech-translate.ts`

Supprimé.

### `session.ts`

**Changements :**
- Stocke `this.jobContext = config.jobContext` à la réception de `session:start`
- `processTranscript(transcript)` : un seul appel `callClaudeJSON<InsightCard>` avec `buildLiveAssistPrompt(this.jobContext)` → émet `{ type: "assist:card", card }`
- Supprime `runTechTranslation` et `runAssist`
- Ajoute `private jobContext: JobContext | undefined = undefined`
- Gestion d'erreur : si `callClaudeJSON` échoue → émet `{ type: "assist:error", error }`
- Debounce 3500ms et buffer inchangés

## Frontend

### Formulaire pré-session (`LiveView.tsx`)

Affiché avant que l'audio soit démarré. 3 champs optionnels :
- **Titre du poste** : input text, placeholder "ex: Senior Frontend Developer"
- **Niveau** : select — Junior / Intermédiaire / Senior / Lead (+ option vide "Non précisé")
- **Stack principale** : input text, placeholder "ex: React, TypeScript, Node.js"

Boutons : "Démarrer l'écoute" (avec contexte si rempli) — pas de bouton "sans contexte" séparé, les champs étant optionnels.

Le formulaire est transmis à `App.tsx` via un callback `onStartAudio(jobContext?: JobContext)`.

### `App.tsx`

`handleStartAudio` reçoit le `jobContext?` depuis LiveView et le passe à `ws.startSession({ language: "fr", jobContext })`.

### `useWebSocket.ts`

- Supprime `currentAssist: { text: string; isStreaming: boolean } | null`
- Supprime `assists: AssistMessage[]`
- Ajoute `insights: InsightCard[]`
- Gère `assist:card` → `setInsights(prev => [...prev, msg.card])`
- Reset `insights` dans `startSession`
- Interface `UseWebSocketReturn` mise à jour en conséquence

### `LiveView.tsx`

**Supprimé :**
- Colonne transcript (transcripts, isBuffering display → transcript panel entier)
- Import et usage de `TechTranslationCard`
- Props : `transcripts`, `isBuffering`, `techTranslations`, `currentAssist`, `assists`

**Ajouté :**
- Props : `insights: InsightCard[]`, `isAnalyzing: boolean` (true entre `transcript:buffering` et `assist:card`)
- Formulaire pré-session (3 champs optionnels, voir ci-dessus)
- Feed pleine largeur de cartes `InsightCard`

**`InsightCard` dans le feed :**
```
┌─────────────────────────────────┐
│ 🟢 Maîtrise confirmée de React  │  ← signal.label (couleur selon type)
├─────────────────────────────────┤
│ Ce que ça veut dire             │
│ [meaning]                       │
├─────────────────────────────────┤
│ 💬 Question de relance          │
│ [followUp]                      │
├─────────────────────────────────┤
│ Badge : Confirmé / Partiel / Flou │
└─────────────────────────────────┘
```

Couleurs signal : `positive` → vert `#0FAA6C`, `weak` → orange `#FF6B35`, `dig` → bleu `#3D5AFE`.

Pendant `isAnalyzing` : skeleton card pulsante (`animate-pulse`).

### `TechTranslationCard.tsx`

Supprimé.

## Ce qui ne change pas

- Capture audio (`useAudioCapture.ts`) — inchangée
- GroqSTT, buffer, silence detection — inchangés
- `correctTranscript` (post-correction Haiku) — inchangée
- Debounce 3500ms — inchangé
- `isBuffering` / `transcript:buffering` / `transcript:idle` — inchangés côté WS (mais `isBuffering` ne drive plus une UI visible ; `isAnalyzing` est un état dérivé plus large)

## État `isAnalyzing`

`isAnalyzing = true` dès `transcript:buffering`, `false` à la réception de `assist:card` ou `assist:error`. Remplace `isBuffering` comme signal principal d'activité pour l'UI des cartes.
