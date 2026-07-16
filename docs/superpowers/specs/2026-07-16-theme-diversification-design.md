# Diversification forcée après 3 cards consécutives sur le même thème

## Contexte

Test réel (capture d'écran, entretien solo sur un poste backend Node.js/AWS serverless) : 5 cards sur ~5 minutes, dont 4 consécutives (`Fullstack serverless`, `ETL et data pipeline`, `Gestion d'une dizaine de microservices`, `SQS vs SNS`) toutes centrées sur le même macro-sujet AWS/serverless. Chaque card apporte une information réellement différente (pas de redondance de contenu comme dans `bilan-retours-voxhelp-tests.md` point 1) — le problème est différent : **la relance suggérée reste, elle aussi, dans le même macro-sujet**, approfondissant un détail technique différent à chaque fois (volumes → choix DynamoDB → temps réel/batch → SQS/SNS) sans jamais proposer de sortir du sujet.

La règle existante dans `live-assist.ts` (« DIVERSIFICATION OBLIGATOIRE : si les 2 derniers sujets analysés portent sur le même thème... ta relance DOIT aborder un autre aspect ») est respectée à la lettre par le LLM mais pas dans l'esprit voulu : « un autre aspect » est interprété comme un autre détail technique du même macro-sujet, pas comme un vrai changement de sujet. Si le recruteur suit les relances suggérées à la lettre, l'entretien peut rester sur un seul macro-sujet pendant toute sa durée.

Note : ce problème est distinct de celui traité (puis annulé) dans `docs/superpowers/specs/2026-07-16-card-merge-dedup-design.md` — il ne s'agit pas de fusionner des cards redondantes, mais de forcer la *relance* à changer de macro-sujet une fois qu'il a été suffisamment couvert. Aucune card n'est jamais supprimée ni fusionnée par ce mécanisme.

## Décision

Le LLM tague chaque card générée (hors `[skip]`) avec un court slug de macro-thème. Le backend compte les cards consécutives partageant le même slug. Une fois 3 cards consécutives atteintes sur le même thème, le prompt de l'appel suivant reçoit une instruction renforcée : la relance suggérée DOIT changer complètement de macro-sujet, pas seulement d'angle technique.

Le tag de thème est encodé comme un 3ème bracket sur la ligne d'en-tête existante (`[catégorie] [evidence] [theme-slug]`), jamais affiché à l'écran (cette ligne ne sert qu'au parsing, ni le backend ni le frontend ne l'affichent telle quelle). Aucun changement de `packages/shared`, aucun changement frontend, aucun nouveau message WebSocket — le mécanisme est entièrement contenu dans `apps/backend/src/session.ts` et `apps/backend/src/prompts/live-assist.ts`.

## Comportement

### Format de réponse LLM

La ligne d'en-tête des cards normales (jamais `[skip]`) devient :
```
[catégorie] [evidence] [theme-slug]
```
`theme-slug` : kebab-case, 1 à 4 mots (ex : `aws-serverless`, `presentation`, `methodologie-travail`).

`parseAssistText` (backend) et `parseAssistCard`/`parsePartialAssist` (frontend) ne sont **pas modifiés** : leur regex d'extraction de `[catégorie] [evidence]` n'est pas ancrée (pas de `^`/`$`), donc un 3ème bracket à la suite est silencieusement ignoré par le parsing existant sans risque de régression. Le titre (`lines[1]`) et le corps (`lines[2..]`) ne sont pas affectés puisqu'ils sont indexés par position de ligne, pas par le contenu de la ligne d'en-tête.

### État de session (`session.ts`)

Nouveaux champs :
- `private lastTheme: string | null = null;`
- `private themeStreakCount = 0;`
- `private readonly THEME_STREAK_THRESHOLD = 3;`

Réinitialisés (avec le reste de l'état de session) dans `startSession()` et `cleanup()`.

Nouvelle fonction d'extraction (indépendante de `parseAssistText`, ne le modifie pas) :
```ts
function extractTheme(text: string): string | null {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[(?:jargon|strength|attention|translation)\]\s*\[(?:high|medium|low)\]\s*\[([a-z0-9-]+)\]/i
  );
  return match?.[1]?.toLowerCase() ?? null;
}
```

Après chaque card normale émise (pas `[skip]`, pas d'erreur), dans `processTranscript`, juste après la mise à jour de `cardLog` :
```ts
const theme = extractTheme(cardText);
if (theme && theme === this.lastTheme) {
  this.themeStreakCount += 1;
} else {
  this.lastTheme = theme;
  this.themeStreakCount = theme ? 1 : 0;
}
```
Si `extractTheme` renvoie `null` (LLM n'a pas suivi le format), le streak est réinitialisé (`lastTheme = null`, `themeStreakCount = 0`) — comportement volontairement conservateur : en cas de doute, on sous-escalade plutôt que de forcer un pivot à tort sur la base d'une classification absente.

### Prompt (`live-assist.ts`)

Nouvelle section, incluse dès que `lastTheme` n'est pas `null` (indépendamment du compteur), renforcée si le seuil est atteint :
```
Thème de la dernière card : « {lastTheme} ». Si le nouveau segment reste sur ce même
sujet, réutilise EXACTEMENT ce slug pour le theme-tag ; sinon choisis un nouveau slug
court (kebab-case).

[uniquement si themeStreakCount >= THEME_STREAK_THRESHOLD] :
ATTENTION — ce thème a déjà été couvert par {themeStreakCount} cards consécutives.
Si le nouveau segment reste sur ce même sujet, ta relance DOIT changer complètement
de sujet — pas un autre détail technique de « {lastTheme} », mais un sujet vraiment
différent : méthodologie de travail, parcours professionnel, soft skills, un autre
projet, gestion d'équipe, préférences technologiques hors de ce sujet, etc.
```
La première partie (rappel du slug précédent) sert à la cohérence de nommage du LLM d'un appel à l'autre — sans elle, le LLM pourrait inventer un slug légèrement différent pour le même sujet réel (ex : `aws-serverless` puis `serverless-architecture`), ce qui fausserait le compteur.

Cette section vient s'ajouter à `buildLiveAssistPrompt` sans remplacer la règle « DIVERSIFICATION OBLIGATOIRE » existante (qui reste utile pour la diversification légère avant que le seuil de 3 soit atteint).

## Hors scope

- `handleAskQuestion` (flux "poser une question à l'assistant") : pas de notion de thème ni de relance-diversification dans ce flux aujourd'hui, non touché par ce mécanisme.
- Aucune suppression ni fusion de card liée au streak — contrairement à la tentative précédente (annulée), ce mécanisme n'influence jamais la génération de la card elle-même, seulement le texte de la relance suggérée.
- Pas d'affichage du thème côté frontend — c'est une donnée purement interne au backend pour le comptage du streak, jamais exposée ni utilisée par l'UI.
- Seuil configurable via variable d'environnement — `THEME_STREAK_THRESHOLD` reste une constante en dur (3), cohérent avec `DEBOUNCE_MS`/`MAX_BUFFER_MS`/`MAX_LOG_ENTRIES` existants.

## Tests

- `prompts.test.ts` : nouveaux tests sur `buildLiveAssistPrompt` avec les nouveaux paramètres `lastTheme`/`themeStreakCount` — la section de continuité de slug apparaît dès que `lastTheme` est fourni (même sous le seuil) ; la section d'alerte n'apparaît que si `themeStreakCount >= 3` ; aucune des deux sections n'apparaît si `lastTheme` est `null`.
- Nouveau test d'intégration `session.ts` (dans le style de `session-merge.test.ts`, déjà supprimé par le revert mais réutilisable comme référence de style) : 3 flushes mockés renvoyant le même tag de thème dans la réponse LLM, puis un 4ème flush → le prompt envoyé au 4ème appel `streamAssist` contient l'instruction de pivot forcé et le nom du thème. Test complémentaire : un thème différent dès le 2ème flush → le streak repart à 1, aucune section d'alerte au 3ème appel.
