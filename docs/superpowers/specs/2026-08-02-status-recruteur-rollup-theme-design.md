# Statuts acquis/à-creuser/pas-acquis + rollup par thème dans le bilan final

## Contexte

`bilan-retours-voxhelp-tests.md` (point 6) note que les relances générées restent parfois trop techniques pour un recruteur non-tech (ex : parenthèses d'implémentation type « rétrocompatibilité, déploiement coordonné des Lambdas »), et suggérait d'accompagner ces relances d'un repère de type « à quoi ressemble une bonne réponse ».

En reprenant ce point, le besoin réel exprimé est différent et plus direct : pendant l'entretien, le recruteur n'a pas le temps de lire un pavé d'explication technique. Il veut juste savoir, d'un coup d'œil, si la réponse du candidat est complète ou non, et s'il faut relancer. Le signal qui compte vraiment pour comparer des candidats entre eux, c'est le **bilan final** — les cards live ne sont qu'un outil de suivi en direct.

Aujourd'hui, `Insight.evidence` (`high`/`medium`/`low`, « exemple concret / mention sans détail / vague ») est déjà quasiment ce verdict, mais nommé et présenté comme un jugement de qualité d'analyse plutôt que comme une décision recruteur. Ajouter un champ `status` séparé ferait doublon avec `evidence` — la bonne approche est de **repurposer ce champ existant** plutôt que d'en ajouter un nouveau.

Par ailleurs, `theme` (macro-sujet abordé, ex. `aws-lambda-scheduling`) est déjà extrait par `extractThemeAndAngle` (`session.ts:18`) pour piloter la diversification des relances, mais n'est jamais conservé sur la card ni exposé — il est recalculé et jeté à chaque tour. Pour que le bilan final liste les thèmes abordés avec leur statut, il faut le persister.

## Décision

1. Renommer `Insight.evidence` (`high`/`medium`/`low`) en `Insight.status` (`acquis`/`a-creuser`/`pas-acquis`), avec un mapping direct (exemple concret → `acquis`, mention sans détail → `a-creuser`, vague → `pas-acquis`). Le LLM live-assist tague directement avec ce vocabulaire — plus de traduction mentale côté recruteur.
2. Body de card ramené à 1 phrase, formulée « comme si on l'expliquait à un enfant » (simple, concret, sans jargon non défini). Relance interdite de parenthèses/asides techniques d'implémentation.
3. `Insight` gagne un champ `theme: string | null`, persisté (au lieu d'être jeté après usage interne). À la génération du bilan final, le code (pas le LLM) regroupe `cardLog` par thème, garde le **dernier statut connu par thème**, et produit `CandidateReport.themes`. Les cards `cat=jargon` sont exclues du rollup (pas évaluatives).
4. Le badge de statut devient l'élément visuel dominant de la card, sauf pour `cat=jargon` où il reste discret. Le bilan final affiche une nouvelle section thèmes, en plus de `overall`/`strengths`/`gaps`/`recommendation` inchangés.

Pas de nouveau panneau live permanent par thème (décision explicite pendant le brainstorming) — les cards ponctuelles suffisent, la vue d'ensemble par thème n'existe que dans le bilan final.

## Comportement

### 1. `packages/shared/src/index.ts`

```ts
export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "attention";
  status: "acquis" | "a-creuser" | "pas-acquis"; // remplace evidence
  theme: string | null; // nouveau
  t: string;
  title: string;
  body: string;
  relance?: string;
}

export interface CandidateReport {
  overall: string;
  strengths: string[];
  gaps: string[];
  recommendation: "hire" | "maybe" | "pass";
  recommendationReason: string;
  themes: ThemeStatus[]; // nouveau
}

export interface ThemeStatus {
  theme: string;
  status: "acquis" | "a-creuser" | "pas-acquis";
  label: string; // titre de la dernière card sur ce thème, repère lisible
}
```

### 2. Prompt live-assist (`apps/backend/src/prompts/live-assist.ts`)

Format d'en-tête inchangé dans sa structure (toujours 4 brackets), mais le 2ème bracket change de vocabulaire :

```
[catégorie] [statut] [theme-slug] [angle]
```

- `statut` ∈ `acquis` | `a-creuser` | `pas-acquis`. Remplace la définition actuelle d'`evidence` :
  - `acquis` : exemple concret fourni, réponse complète
  - `a-creuser` : mention sans détail, incomplet
  - `pas-acquis` : vague, aucune preuve concrète
- Nouvelle règle sur le corps : *« Explication en 1 phrase MAX, comme si tu l'expliquais à quelqu'un qui n'a jamais fait de dev — clair, concret, aucun terme technique non expliqué dans la phrase elle-même. »*
- Nouvelle règle sur la relance : *« Jamais de parenthèse ou d'aside technique d'implémentation dans la relance (ex : interdiction de type "(rétrocompatibilité, déploiement coordonné des Lambdas)"). La relance doit être lisible à voix haute par un recruteur non-tech sans qu'il ait besoin de comprendre un détail entre parenthèses. »*
- L'exemple complet donné dans le prompt (ligne 89 actuelle) est mis à jour avec le nouveau vocabulaire : `[jargon] [acquis] [aws-lambda-scheduling] [ownership]`.

`buildThemeAngleSection` n'est pas touché dans sa logique (thème/angle restent un mécanisme indépendant) — seul le texte qui référence `evidence` ailleurs dans le fichier est mis à jour si présent.

### 3. Backend — parsing et tracking (`apps/backend/src/session.ts`)

`parseAssistText` (ligne 215) capture désormais aussi le thème, en réutilisant `extractThemeAndAngle` au lieu de le laisser purement interne au tracking d'angle :

```ts
private parseAssistText(text: string, id: string, t: string): Insight {
  const lines = text.trim().split("\n").filter((l) => l.trim() !== "");

  const headerMatch = lines[0]?.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|a-creuser|pas-acquis)\]?/
  );
  const cat = (headerMatch?.[1] as Insight["cat"]) ?? "translation";
  const status = (headerMatch?.[2] as Insight["status"]) ?? "a-creuser";
  const { theme } = extractThemeAndAngle(text);

  // ... title/relance/body inchangés

  return { id, cat, status, theme, t, title, body, relance };
}
```

`extractThemeAndAngle` (ligne 18) : la regex qui matche `(high|medium|low)` sur le 2ème bracket passe à `(acquis|a-creuser|pas-acquis)`.

Le tracking `lastTheme`/`coveredAngles`/`themeCardCount` (lignes 295-303) n'est pas modifié dans sa logique. `parseAssistText` (ligne 287) et ce bloc de tracking (ligne 295) continuent chacun à appeler `extractThemeAndAngle` séparément — double parsing léger (une regex), déjà le cas aujourd'hui pour `cat`/`evidence` vs `theme`/`angle`, pas une régression.

`buildAskPrompt` (ligne 322, prompt séparé pour le flux « le recruteur pose une question directe ») utilise aussi le vocabulaire `evidence` dans son format d'en-tête (`[catégorie] [evidence]`, ligne 335) et instruit en dur `evidence = high` (ligne 340). Mis à jour avec le même vocabulaire : `[catégorie] [statut]` et `statut = acquis`. `parseAssistText` étant partagé entre `processTranscript` et `handleAskQuestion`, ce prompt doit rester cohérent avec la nouvelle regex de parsing.

### 4. Rollup par thème (`apps/backend/src/prompts/final-analysis.ts` ou nouvelle fonction utilitaire dans `session.ts`)

Nouvelle fonction pure, appelée juste avant `generateFinalReport` (ligne 397) :

```ts
function buildThemeRollup(cards: Insight[]): ThemeStatus[] {
  const byTheme = new Map<string, Insight>();
  for (const card of cards) {
    if (!card.theme || card.cat === "jargon") continue;
    byTheme.set(card.theme, card); // la dernière card du thème écrase les précédentes
  }
  return Array.from(byTheme.entries()).map(([theme, card]) => ({
    theme,
    status: card.status,
    label: card.title,
  }));
}
```

`generateFinalReport` calcule `themes` en code et l'injecte directement dans le `CandidateReport` renvoyé — **pas** de passage par le LLM pour cette partie (cohérence garantie avec ce que le recruteur a vu en direct, pas d'appel supplémentaire). `buildFinalAnalysisPrompt` continue de générer `overall`/`strengths`/`gaps`/`recommendation`/`recommendationReason` comme aujourd'hui ; `themes` est fusionné après coup :

```ts
const report = await callClaudeJSON<Omit<CandidateReport, "themes">>(...);
this.send({ type: "analysis:final", report: { ...report, themes: buildThemeRollup(this.cardLog) } });
```

### 5. Frontend

- `apps/web/src/lib/parseAssistCard.ts` et `parseAssistStream.ts` : même changement de regex (`high|medium|low` → `acquis|a-creuser|pas-acquis`), champ renommé `evidence` → `status`, et capture de `theme` (actuellement absent des deux fichiers, à ajouter en réutilisant la même logique d'extraction que `extractThemeAndAngle`, dupliquée côté frontend car ces fichiers n'importent pas le code backend).
- `apps/web/src/components/ui.tsx` :
  - `EVIDENCE_META`/`Confidence` renommés en `STATUS_META`/`StatusBadge`, avec les 3 nouvelles valeurs (labels : `acquis` → "Acquis", `a-creuser` → "À creuser", `pas-acquis` → "Pas acquis"). Rendu plus visuellement dominant sur la card (actuellement un indicateur discret à 3 points).
  - Pour `cat === "jargon"`, le badge de statut n'est pas rendu (ou rendu très discret) — pas pertinent sur une card purement définitionnelle.
  - `CATEGORY_META.attention.label` renommé de `"À creuser"` à `"Point critique"` : ce libellé entrait en collision avec la nouvelle valeur de statut `a-creuser` — une card `cat=attention` + `status=a-creuser` afficherait sinon deux badges au texte identique côte à côte.
- `apps/web/src/components/OverlayPanel.tsx` (`FinalReportView`, ligne 603) : nouvelle section « Thèmes abordés » entre `overall` et `strengths`, listant `report.themes` avec une puce/icône par statut (✓ acquis / ? à creuser / ✕ pas acquis), même style visuel que les sections `strengths`/`gaps` existantes.

## Hors scope

- Pas de panneau live permanent listant l'état de tous les thèmes en cours d'entretien — uniquement dans le bilan final.
- Pas de rollup par thème recalculé par le LLM — uniquement calculé en code à partir des statuts déjà assignés en live.
- Le mécanisme de progression d'angle (`contexte`/`ownership`/`impact`, `docs/superpowers/specs/2026-07-28-theme-angle-progression-design.md`) n'est pas modifié.
- Pas de nouvelle route REST ni de nouveau message WebSocket — `ThemeStatus[]` voyage uniquement dans le `analysis:final` existant.
- Pas de gestion de la migration de données existantes (démo sans persistance long terme, tout est en mémoire par session).

## Tests

- `prompts.test.ts` : le prompt `buildLiveAssistPrompt` contient bien les nouvelles règles (1 phrase, vocabulaire acquis/a-creuser/pas-acquis, interdiction de parenthèses techniques dans la relance) et l'exemple mis à jour.
- `session.test.ts` / nouveau `session-theme-rollup.test.ts` :
  - `parseAssistText` extrait correctement `status` et `theme` avec et sans crochets sur le 2ème bracket (cohérent avec le fix existant sur le parsing tolérant).
  - `buildThemeRollup` : plusieurs cards sur le même thème → seul le dernier statut est gardé (la valeur `Map` est écrasée, mais la clé garde sa position d'insertion en JS) ; cards `cat=jargon` exclues même si elles ont un thème ; cards sans thème (`null`) ignorées ; les thèmes distincts apparaissent dans `themes[]` dans leur ordre de première apparition dans `cardLog`, pour rester lisible chronologiquement côté recruteur.
- Frontend : `apps/web` n'a pas d'infra de tests (pas de vitest configuré, `package.json` n'expose que `dev`/`build`/`preview`) — cohérent avec le reste du projet, pas de suite à ajouter pour ce changement. Vérification manuelle : lancer `pnpm dev`, dérouler un entretien de test, vérifier que les badges de statut s'affichent avec les nouvelles valeurs et que le bilan final liste les thèmes.
