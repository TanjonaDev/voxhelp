# Fusion des cards redondantes sur un même tour de parole

## Contexte

Retours de tests réels (`bilan-retours-voxhelp-tests.md`, point 1) : sur un monologue candidat continu, le debounce de pause (`DEBOUNCE_MS = 1500`) se redéclenche à chaque micro-pause naturelle (respiration, réflexion), produisant jusqu'à 4 cards distinctes en quelques secondes d'écart sur le même sous-thème (ex : "Stack technique maîtrisée" et "Portefeuille de projets data concrets" qui disent la même chose). Le seul garde-fou actuel est une liste des 5 derniers titres de cards passée au prompt avec l'instruction "diversifie les thèmes" (`live-assist.ts` — `buildPreviousCards`), qui n'empêche pas la redite quand le sujet réel n'a pas changé.

Le trigger `MAX_BUFFER_MS` (3 min, ajouté dans `docs/superpowers/specs/2026-07-09-max-buffer-flush-design.md`) n'est pas la cause de l'exemple concret du bilan (écarts de quelques secondes entre cards, pas 3 minutes), mais la fusion décrite ici s'applique uniformément à tout flush, quel que soit son déclencheur.

## Décision

1. Augmenter `DEBOUNCE_MS` de `1500` à `2500` dans `Session` — réduit mécaniquement la fréquence des flushes sur les micro-pauses.
2. Ajouter une logique de fusion pilotée par le LLM : avant de générer une nouvelle card, le backend propose au prompt le contenu complet de la dernière card émise si elle date de moins de 90s (`MERGE_WINDOW_MS`). Si le LLM juge que le nouveau segment ne fait que prolonger le même sous-thème, il répond avec un marqueur `[merge]` ; le backend remplace alors la card existante au lieu d'en créer une nouvelle.
3. Aucun nouveau type de message WebSocket — la fusion réutilise `assist:start` / `assist:chunk` / `assist:cancel` / `assist:done` avec l'id de la card cible.

## Comportement

### Déclenchement
- `DEBOUNCE_MS = 2500` (au lieu de 1500).
- `MAX_BUFFER_MS` inchangé (3 min).
- Les deux triggers passent par `flushBuffer()` → `processTranscript()` ; la fusion s'applique aux deux sans distinction.

### État de session (`session.ts`)
- Nouveau champ `lastCardEmittedAtMs: number = 0`, mis à jour à `Date.now()` uniquement quand une vraie card (normale ou fusionnée) est émise — jamais sur `[skip]`.
- Nouvelle constante `MERGE_WINDOW_MS = 90 * 1000`.
- `cleanup()` réinitialise `lastCardEmittedAtMs` à `0`.

### Calcul du candidat de fusion
Avant l'appel LLM dans `processTranscript` :
```ts
const mergeCandidate =
  this.cardLog.length > 0 && (Date.now() - this.lastCardEmittedAtMs) <= this.MERGE_WINDOW_MS
    ? this.cardLog[this.cardLog.length - 1]
    : undefined;
```
Passé à `buildLiveAssistPrompt(jobContext, conversationLog, relanceLog, cardLog, mergeCandidate)`.

### Prompt (`live-assist.ts`)
Nouvelle section, incluse uniquement si `mergeCandidate` est défini :
```
Dernière card émise à l'instant (il y a Xs) — [cat] Titre : Corps complet.
Si ce qui vient d'être dit ne fait que continuer/préciser le MÊME sous-thème que cette card
(pas juste un thème proche), NE CRÉE PAS de nouvelle card. Réponds avec :
[merge]
[catégorie] [evidence]
# Titre (peut être mis à jour)
Corps fusionné qui remplace entièrement le précédent
>> Relance (optionnelle)
```
Si `mergeCandidate` est absent, cette section est omise — le LLM ne voit pas l'option de fusion.

La règle "détection recruteur → `[skip]`" reste prioritaire et inchangée : un flush qui capte une question du recruteur répond `[skip]` même si un `mergeCandidate` existe.

### Détection et traitement du marqueur `[merge]` (`processTranscript`)
Même mécanisme que la détection `[skip]` existante, dans le callback de streaming :
- Dès que `accumulated.trimStart().startsWith("[merge]")` : annuler la card spéculative en cours (`assist:cancel` sur l'id spéculatif, comme pour `[skip]`), puis émettre un nouveau `assist:start` avec l'id de `mergeCandidate`. Les chunks suivants (contenu après le marqueur) sont relayés sous cet id.
- `parseAssistText` gère un préfixe `[merge]` optionnel en première ligne : s'il est présent, il est retiré avant de parser le reste normalement (header/titre/corps/relance) ; l'`Insight` retourné garde l'`id` de la card cible.
- `cardLog` : l'entrée correspondant à `mergeCandidate.id` est **remplacée** par la nouvelle card parsée (même id, contenu mis à jour) au lieu d'un `push`.
- `lastCardEmittedAtMs` est mis à jour sur toute émission de card (normale ou fusionnée).

### Frontend (`useWebSocket.ts`)
Seul changement, dans le handler `assist:done` : remplacer l'insight existante si `msg.id` correspond déjà à une entrée de `insights`, au lieu de toujours l'ajouter en fin de liste. Le `t` (timestamp) d'origine de la card fusionnée est conservé (pas celui du flush qui a déclenché la fusion) — le recruteur voit toujours le moment d'apparition initial du sujet.

```ts
case "assist:done": {
  const parsed = parseAssistCard(msg.fullText);
  setStreamingCard(null);
  setIsAnalyzing(false);
  setInsights((prev) => {
    const idx = prev.findIndex((c) => c.id === msg.id);
    const updated = { id: msg.id, t: streamingTRef.current, ...parsed, relance: parsed.relance ?? undefined };
    if (idx === -1) return [...prev, updated];
    const next = [...prev];
    next[idx] = { ...next[idx], ...updated, t: next[idx].t };
    return next;
  });
  break;
}
```

## Limite UX acceptée (v1)

Pendant le streaming d'une fusion, `OverlayPanel` affiche brièvement la card existante (ancien contenu, en place dans `insights`) ET le `StreamingCardView` juste en dessous (nouveau contenu qui s'écrit), avant que `assist:done` ne remplace la première et fasse disparaître la seconde. Chevauchement visuel de quelques centaines de ms, pas un doublon fonctionnel. Pas de traitement spécial ajouté pour l'instant — à revisiter seulement si ça s'avère gênant à l'usage réel.

## Hors scope

- Redéfinition de la frontière Traduction / Jargon décodé (point 2 du bilan) — traité séparément.
- Contrôle de cohérence factuelle entre cards non consécutives (point 4 du bilan) — la fusion réduit mécaniquement ce risque pour le cas consécutif, mais aucune vérification factuelle croisée n'est ajoutée entre cards non adjacentes ou hors fenêtre 90s.
- Suppression des cards "Amorce de réponse" sans valeur (point 5 du bilan) — traité séparément.
- Fenêtre de fusion configurable via variable d'environnement — constante en dur (`MERGE_WINDOW_MS`), cohérent avec `DEBOUNCE_MS` / `MAX_BUFFER_MS` / `MAX_LOG_ENTRIES` existants.
- Nettoyage de `relanceLog` lors d'une fusion (l'éventuelle relance de l'ancienne card reste dans la liste "questions déjà posées" même après fusion) — impact jugé négligeable, non traité.

## Tests

- Vérifier que `session-max-buffer.test.ts` existant n'est pas cassé par le passage de `DEBOUNCE_MS` à 2500.
- Nouveau test unitaire `parseAssistText` : préfixe `[merge]` retiré correctement, reste parsé comme une card normale.
- Nouveaux tests `Session` :
  - deux flushes rapprochés (< 90s), second flush mocké pour répondre `[merge]...` → un seul élément net dans `cardLog`, id de la première card conservé, contenu de la seconde.
  - deux flushes espacés (> 90s) → le prompt généré ne contient pas la section "Dernière card émise" (pas de `mergeCandidate` proposé).
- Pas de test frontend automatisé prévu (pas de suite de tests JS component existante identifiée) — validation manuelle après implémentation.
