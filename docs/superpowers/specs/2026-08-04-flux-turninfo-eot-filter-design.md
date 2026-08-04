# Filtrer les messages Deepgram Flux sur `event=EndOfTurn`

## Contexte

Un test réel a produit des transcriptions massivement corrompues — le même passage répété des dizaines de fois, s'allongeant progressivement à chaque répétition (ex : "On a une API partenaire qui nous fournit la donnée. Le projet est en Node.js..." répété ~80 fois dans un seul segment envoyé au LLM). Ce n'est pas un problème de pause candidat ni de `DEBOUNCE_MS` : c'est la cause racine de plusieurs symptômes observés pendant le test (cards signalant une "transcription coupée"/"très fragmentée", le bilan final lui-même notant que "les transcriptions incomplètes empêchent de valider pleinement" la compréhension du candidat).

Vérifié dans la doc officielle Deepgram (`docs/flux/state`, `reference/speech-to-text/listen-flux`) : un message `TurnInfo` a un champ `event` qui vaut `"Update"` (envoyé **toutes les ~0.25s** pendant que le candidat parle), `"StartOfTurn"`, `"EagerEndOfTurn"`, `"TurnResumed"`, ou `"EndOfTurn"`. **Chaque message contient la transcription cumulée depuis le début du tour de parole**, pas un delta.

`apps/backend/src/deepgram-flux.ts:61-66` ne filtre actuellement que sur `message.type === "TurnInfo"`, sans regarder `message.event` :
```ts
connection.on("message", (message) => {
  if (this.closed) return;
  if (message.type === "TurnInfo" && message.transcript?.trim()) {
    this.callbacks.onTranscript(message.transcript.trim());
  }
});
```
Pour un tour de parole de 10 secondes, Deepgram envoie ~40 événements `Update`, chacun avec le texte cumulé un peu plus long que le précédent. Notre code appelle `onTranscript` pour CHACUN, et `session.ts:handleFinalTranscript` fait `this.transcriptBuffer.push(text)` à chaque appel — donc le buffer accumule ~40 versions se chevauchant du même texte, qui sont ensuite toutes concaténées (`transcriptBuffer.join(" ")`) au moment du flush. D'où la répétition en escalier observée.

## Décision

Ne déclencher `onTranscript` que sur `message.event === "EndOfTurn"` — le seul événement représentant la transcription finale et complète d'un tour de parole. Ignorer `Update`, `StartOfTurn`, `EagerEndOfTurn`, `TurnResumed`.

Alternative envisagée et écartée : utiliser `EagerEndOfTurn` pour réduire la latence perçue, avec gestion de `TurnResumed` pour invalider/remplacer la transcription si le candidat continue de parler après une fin de tour prématurée. Écartée car : (1) le serveur a déjà un debounce de 2.5s (`DEBOUNCE_MS`) qui absorbe une bonne partie de la latence perçue, (2) la complexité de gestion de `TurnResumed` (remplacer plutôt qu'accumuler un état déjà bufferisé) introduit une nouvelle surface de bug pour un gain marginal dans une architecture qui n'est de toute façon pas un agent vocal temps-réel à la Deepgram (pas de réponse vocale immédiate à préparer).

Aucun changement côté `session.ts` — une fois le filtre appliqué, `handleFinalTranscript` reçoit à nouveau un texte propre, une fois par tour, exactement comme le reste du pipeline (debounce, buffer, correction Haiku) a été conçu pour le recevoir.

## Comportement

### `apps/backend/src/deepgram-flux.ts`

Le type inline du message (actuellement `{ type?: string; transcript?: string }` dans la signature de `FluxConnection.on("message", ...)`) gagne un champ `event?: string`.

Le handler devient :
```ts
connection.on("message", (message) => {
  if (this.closed) return;
  if (message.type === "TurnInfo" && message.event === "EndOfTurn" && message.transcript?.trim()) {
    this.callbacks.onTranscript(message.transcript.trim());
  }
});
```

## Hors scope

- Pas d'utilisation de `EagerEndOfTurn`/gestion de `TurnResumed` — décision explicite ci-dessus.
- Pas de changement dans `session.ts` — le bug est entièrement contenu dans la couche de traduction des messages Deepgram vers `onTranscript`.
- Ne couvre pas les 4 autres points remontés pendant le test (contradiction Acquis/Pas acquis sur SQL/PostgreSQL, relance TypeScript dupliquée, formulation des relances, bilan figé sur DynamoDB) — traités séparément, potentiellement en partie résolus comme effet de bord une fois la transcription propre, à réévaluer après ce fix.

## Tests

Aucun test automatisé possible sans mocker le SDK `@deepgram/sdk` au niveau du message WebSocket brut, ce qui n'existe pas dans ce projet actuellement (cf. décision similaire pour `deepgram-flux.ts` dans `docs/superpowers/plans/2026-08-02-status-recruteur-rollup-theme.md`, Task 6 — le projet ne teste pas cette couche directement, seulement via les mocks `FluxSTT` au niveau `session.ts`). Vérification manuelle recommandée : refaire un test avec une explication technique continue de 10+ secondes et confirmer dans les logs `[Session] Card` que le texte analysé n'est plus répété.
