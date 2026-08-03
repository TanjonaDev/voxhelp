# Anti-répétition du décodage jargon sur un même thème

## Contexte

Pendant un test réel (candidat décrivant l'architecture d'un pipeline data serverless AWS), deux cards `[jargon]` consécutives sont apparues à 3 secondes d'intervalle, décrivant le même pipeline Lambda → transformation → DynamoDB sous deux formulations différentes :
- 01:45 — « Stack full serverless AWS avec Lambda + DynamoDB pour les pipelines data »
- 01:48 — « Pipeline data serverless : récupérer → transformer → stocker »

C'est le point 1 du bilan de tests initial (`bilan-retours-voxhelp-tests.md`), resté ouvert : le mécanisme de progression contexte/ownership/impact (`docs/superpowers/specs/2026-07-28-theme-angle-progression-design.md`) diversifie l'angle des **relances**, mais rien n'empêche la catégorie `[jargon]` de se redéclencher sur un thème déjà décodé.

Cause probable : `buildPreviousCards` (`live-assist.ts:27-31`) ne transmet au LLM que le **titre** des 5 dernières cards, pas leur contenu — le modèle voit le titre précédent mais n'a pas d'instruction explicite lui interdisant de re-décoder le même concept sous un angle différent. Une piste de fusion sémantique post-génération avait déjà été tentée et abandonnée (`docs/superpowers/specs/2026-07-16-card-merge-dedup-design.md`, mémoire `project-live-assist-card-merge`) car le LLM fusionnait à tort des cards séparées par une relance du recruteur — la leçon retenue est de préférer un signal déterministe (thème/tag) à un jugement de similarité du LLM.

## Décision

Étendre le mécanisme de tracking par thème déjà existant (`lastTheme`/`coveredAngles`/`themeCardCount`) avec un nouveau state **cumulatif sur toute la session** : `jargonDecodedThemes: Set<string>`. Contrairement à `coveredAngles` (réinitialisé à chaque changement de thème), celui-ci n'est jamais réinitialisé en cours de session — si le thème revient plus tard dans l'entretien, on ne veut toujours pas re-décoder le même jargon.

Quand `lastTheme` a déjà une entrée dans `jargonDecodedThemes`, le prompt reçoit une instruction explicite : ne pas générer de nouvelle card `[jargon]` sur ce thème sauf si un terme technique réellement nouveau apparaît ; basculer vers `[strength]`/`[attention]`/`[translation]` si le segment apporte une info nouvelle (rôle, décision, résultat), ou `[skip]` sinon.

Périmètre volontairement restreint à `jargon` + continuité de thème — les cards `strength`/`attention`/`translation` continuent de suivre la progression d'angle existante sans changement, car elles portent une info potentiellement nouvelle (qui a fait quoi, quel résultat) même en restant sur le même sujet.

## Comportement

### 1. `session.ts` — nouveau state

```ts
private jargonDecodedThemes: Set<string> = new Set();
```
Déclaré à côté de `lastTheme`/`coveredAngles`/`themeCardCount` (ligne ~71). Réinitialisé aux deux mêmes points que ces derniers : `startSession()` (ligne ~157) et `cleanup()` (ligne ~482).

### 2. `session.ts` — calcul du flag avant l'appel LLM

Dans `processTranscript`, avant l'appel à `buildLiveAssistPrompt` (ligne ~277), calculer :
```ts
const jargonAlreadyDecoded = this.lastTheme ? this.jargonDecodedThemes.has(this.lastTheme) : false;
```
et le passer comme 8ème argument positionnel à `buildLiveAssistPrompt(...)`.

### 3. `session.ts` — mise à jour après émission de la card

Juste après le bloc qui met à jour `lastTheme`/`coveredAngles`/`themeCardCount` (ligne ~326-333), ajouter :
```ts
if (card.cat === "jargon" && card.theme) {
  this.jargonDecodedThemes.add(card.theme);
}
```

### 4. `live-assist.ts` — nouvelle section de prompt

```ts
function buildJargonGuardSection(lastTheme: string | null | undefined, jargonAlreadyDecoded: boolean): string {
  if (!lastTheme || !jargonAlreadyDecoded) return "";
  return `\nLe jargon technique du thème « ${lastTheme} » a déjà été décodé dans une card précédente. Si le nouveau segment reste sur ce même thème sans introduire de terme technique réellement nouveau (jamais encore expliqué dans cet entretien), NE génère PAS de nouvelle card [jargon] pour ce thème — utilise [strength], [attention] ou [translation] si le contenu apporte une info nouvelle (rôle, décision, résultat concret), ou [skip] si rien de nouveau n'est apporté.\n`;
}
```

`buildLiveAssistPrompt` gagne un 8ème paramètre optionnel `jargonAlreadyDecoded?: boolean`, et la section est insérée dans le template juste après `themeSection` :
```ts
export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[],
  lastTheme?: string | null,
  coveredAngles?: string[],
  themeCardCount?: number,
  jargonAlreadyDecoded?: boolean
): string {
  // ...
  const themeSection = buildThemeAngleSection(lastTheme, coveredAngles ?? [], themeCardCount ?? 0);
  const jargonGuardSection = buildJargonGuardSection(lastTheme, jargonAlreadyDecoded ?? false);

  return `...${themeSection}${jargonGuardSection}
Rôle : traduire le jargon...`;
}
```

## Hors scope

- Pas de correspondance floue entre theme-slugs proches (ex : `aws-lambda-pipeline` vs `pipeline-serverless-data` sur le même sujet mais slugs différents) — le mécanisme dépend, comme l'angle-progression existante, de la réutilisation exacte du slug par le LLM d'un tour à l'autre. Limite connue et acceptée, cohérente avec le mécanisme déjà en place.
- Pas de déduplication pour les catégories `strength`/`attention`/`translation` — seul `jargon` est concerné par ce garde-fou.
- Pas de fusion de cards déjà émises (déjà tenté et abandonné) — uniquement une prévention en amont de la génération.
- `buildAskPrompt` (flux « le recruteur pose une question directe ») non concerné — pas de theme-slug dans ce format à 2 crochets.

## Tests

- `prompts.test.ts` : `buildJargonGuardSection`/`buildLiveAssistPrompt` — l'instruction de garde-fou apparaît quand `lastTheme` est set ET déjà dans les thèmes décodés ; absente quand `jargonAlreadyDecoded` est `false` ou `lastTheme` est `null`/`undefined`.
- Tests d'intégration `session.ts` (style `session-theme-angle.test.ts`) : séquence de cards mockées où une 1ère card `[jargon]` sur un thème est suivie d'une 2ème card sur le même thème → le prompt de la 2ème card contient l'instruction de garde-fou ; une card `[strength]` sur le même thème après le jargon ne déclenche pas le garde-fou pour autant qu'elle ne soit pas elle-même jargon (le garde-fou influence le choix de catégorie du LLM, il ne bloque rien côté code) ; le thème revient plus tard dans la session (après un changement de thème intermédiaire) → le garde-fou est toujours actif (state cumulatif, pas réinitialisé au changement de thème).
