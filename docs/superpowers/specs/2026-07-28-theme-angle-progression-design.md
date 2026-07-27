# Progression d'angle par thème (contexte → ownership → impact)

## Contexte

`docs/superpowers/specs/2026-07-16-theme-diversification-design.md` a introduit le tracking de macro-thème (`lastTheme`/`themeStreakCount`) et un pivot forcé après 3 cards consécutives sur le même thème. Ce mécanisme évite qu'un sujet s'éternise, mais ne guide pas *ce qu'il faut demander* pendant qu'on est encore dessus : l'instruction reste générique (« aborde un autre aspect »), ce qui laisse le LLM enchaîner plusieurs relances techniques sur le même outil (ex : nombre de topics Kafka → throughput → consumer lag) plutôt que de varier l'angle vers la personne.

Objectif produit : sur un même thème, la progression des relances doit suivre 3 angles centrés sur le candidat plutôt que sur la techno :
1. **contexte** — architecture / projet global ("Décrivez-moi le projet, l'architecture globale")
2. **ownership** — rôle personnel ("Quel était votre rôle dans ce choix ?")
3. **impact** — résultat concret ("Quel problème ça résolvait ? Quel résultat ?")

Contrainte explicite : jamais deux relances techniques de suite sur le même outil. Le but n'est pas de comprendre Kafka en détail, c'est de comprendre la personne.

## Décision

On étend le mécanisme de tag existant (3ème bracket `theme-slug`) avec un **4ème bracket `angle`**, tagué par le LLM sur chaque card qui inclut une relance. Le backend accumule les angles déjà couverts pour le thème courant dans un `Set` (au lieu du simple compteur `themeStreakCount`), et le prompt suivant liste les angles restants avec leur définition, pour guider — sans l'imposer rigidement — le choix du prochain angle.

Le pivot forcé (actuellement déclenché à 3 cards consécutives) se déclenche désormais quand **les 3 angles sont couverts**, avec un garde-fou de secours à 5 cards consécutives sur le même thème si le LLM n'a jamais correctement tagué les angles (ex : reste bloqué en `none`).

La ligne `DIVERSIFICATION OBLIGATOIRE` existante (générique, ligne 82 de `live-assist.ts`) est supprimée : elle devient redondante et peut contredire la nouvelle instruction précise par angle.

Aucun changement de `packages/shared`, aucun changement frontend, aucun nouveau message WebSocket — comme pour le mécanisme de thème, tout reste contenu dans `session.ts` et `live-assist.ts`. Le 4ème bracket n'est jamais affiché à l'écran, comme le 3ème.

## Comportement

### Format de réponse LLM

Header étendu :
```
[catégorie] [evidence] [theme-slug] [angle]
```
`angle` ∈ `contexte` | `ownership` | `impact` | `none`.

- `none` quand la card n'a pas de relance (cat = `translation`), ou que la relance ne rentre dans aucun des 3 angles (ex : relance de pure clarification).
- Le bracket est présent sur toutes les cards non-`[skip]`, y compris `translation`/`none` — pour garder une position de bracket stable et un parsing simple.

`parseAssistText` (backend) et les parsers frontend ne sont **pas modifiés**, pour la même raison qu'avec le theme-slug : leur regex n'est pas ancrée en fin de ligne, un bracket supplémentaire est silencieusement ignoré.

### État de session (`session.ts`)

Remplace `themeStreakCount: number` par :
```ts
private lastTheme: string | null = null;
private coveredAngles: Set<string> = new Set();
private themeCardCount = 0;
private readonly THEME_STREAK_FALLBACK = 5;
```
Réinitialisés aux mêmes points que `themeStreakCount` aujourd'hui (`startSession()`, `cleanup()`).

Nouvelle extraction (remplace `extractTheme`) :
```ts
function extractThemeAndAngle(text: string): { theme: string | null; angle: string | null } {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[(?:jargon|strength|attention|translation)\]\s*\[(?:high|medium|low)\]\s*\[([a-z0-9-]+)\](?:\s*\[(contexte|ownership|impact|none)\])?/i
  );
  return {
    theme: match?.[1]?.toLowerCase() ?? null,
    angle: match?.[2]?.toLowerCase() ?? null,
  };
}
```
Le 4ème groupe est optionnel dans la regex (si le LLM omet le tag, on ne casse pas le parsing du thème), mais requis par les instructions du prompt.

Après chaque card normale émise, dans `processTranscript`, à la place de la mise à jour actuelle de `themeStreakCount` :
```ts
const { theme, angle } = extractThemeAndAngle(cardText);
if (theme && theme === this.lastTheme) {
  this.themeCardCount += 1;
  if (angle && angle !== "none") this.coveredAngles.add(angle);
} else {
  this.lastTheme = theme;
  this.themeCardCount = theme ? 1 : 0;
  this.coveredAngles = new Set(angle && angle !== "none" ? [angle] : []);
}
```
Comme pour le mécanisme existant : si `theme` est `null` (LLM n'a pas suivi le format), tout est réinitialisé — comportement conservateur, on sous-escalade plutôt que de forcer un pivot à tort.

### Prompt (`live-assist.ts`)

`buildThemeStreakSection` est remplacée par `buildThemeAngleSection(lastTheme, coveredAngles, themeCardCount)` :

- `lastTheme` est `null` → rien (identique à aujourd'hui).
- `lastTheme` présent, angles restants non vides, et `themeCardCount < THEME_STREAK_FALLBACK` :
  ```
  Thème de la dernière card : « {lastTheme} ». Si le nouveau segment reste sur ce thème,
  réutilise EXACTEMENT ce slug pour le theme-tag.

  Angles déjà couverts sur ce thème : {covered.join(", ") || "aucun"}.
  Angles restants : {remaining.join(", ")} — privilégie un de ces angles pour ta
  prochaine relance :
  - contexte : architecture ou projet global ("Décrivez-moi l'architecture globale")
  - ownership : rôle personnel du candidat dans ce choix/projet ("Quel était votre rôle ?")
  - impact : problème résolu ou résultat concret ("Quel problème ça résolvait ?")

  Ne pose JAMAIS deux relances techniques de suite sur le même outil (ex : nombre de
  topics Kafka, puis throughput, puis consumer lag). Le but n'est pas de comprendre
  l'outil en détail, c'est de comprendre la personne — ses décisions, son rôle, son
  impact. Tague ta relance avec le 4ème bracket [contexte|ownership|impact|none].
  ```
- `lastTheme` présent et (angles restants vides **ou** `themeCardCount >= THEME_STREAK_FALLBACK`) → pivot forcé, message inchangé par rapport à l'actuel (« ce thème a déjà été couvert... ta relance DOIT changer complètement de sujet »).

La ligne `DIVERSIFICATION OBLIGATOIRE` (actuelle ligne 82) est supprimée du corps fixe du prompt — son intention est maintenant portée par la section ci-dessus, de façon plus précise.

## Hors scope

- `handleAskQuestion` : non touché, comme pour le mécanisme de thème existant.
- Aucun changement sur la génération/fusion des cards elles-mêmes — uniquement le texte de la relance suggérée et son tag.
- Pas d'affichage du thème ni de l'angle côté frontend — purement interne au backend.
- `THEME_STREAK_FALLBACK` reste une constante en dur (5), cohérent avec les autres constantes de session (`DEBOUNCE_MS`, `MAX_BUFFER_MS`, `MAX_LOG_ENTRIES`, `MAX_CARD_LOG`).
- Pas de persistance de l'angle sur `Insight` (type partagé inchangé) — l'angle ne sert qu'au tracking interne de session, pas à l'affichage de la card.

## Tests

- `prompts.test.ts` : tests sur `buildThemeAngleSection` — angles partiels affichent la liste restante et les définitions ; tous les angles couverts déclenchent le message de pivot ; `themeCardCount >= 5` déclenche le pivot même avec des angles restants ; `lastTheme = null` n'affiche rien.
- Tests d'intégration `session.ts` (style existant) : séquence de flushes mockés avec tags d'angle différents (`contexte` puis `ownership`) → le 3ème appel `streamAssist` reçoit l'instruction avec `impact` comme seul angle restant ; séquence où les 3 angles sont couverts en 3 cards → pivot forcé dès le 4ème appel ; séquence où le LLM ne tague jamais l'angle (`none` répété) → pivot forcé au 6ème appel (garde-fou à 5).
