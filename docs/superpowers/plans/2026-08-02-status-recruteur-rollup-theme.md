# Statut recruteur + rollup par thème Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le champ `Insight.evidence` (high/medium/low) par `Insight.status` (acquis/à-creuser/pas-acquis) — un vocabulaire directement actionnable pour un recruteur non-tech — raccourcir/simplifier les cards live, et faire remonter un rollup par thème (calculé en code, pas par le LLM) dans le bilan final pour comparer des candidats entre eux.

**Architecture:** Renommage de bout en bout d'un champ existant (`evidence` → `status`, nouvelles valeurs), ajout d'un champ `theme` déjà calculé en interne mais jusqu'ici jeté après usage, et une fonction pure `buildThemeRollup` qui regroupe le `cardLog` déjà accumulé par `session.ts` — aucune nouvelle route, aucun nouveau message WebSocket.

**Tech Stack:** TypeScript (ESM, strict), Vitest (backend uniquement — `apps/web` n'a pas d'infra de tests), Fastify + ws, React 19.

## Global Constraints

- TypeScript strict, pas de `any`, ESM avec imports `.js` dans le backend.
- `packages/shared` n'a pas de suite de tests — vérifié uniquement via `tsc --noEmit`.
- `apps/web` n'a pas d'infra de tests (pas de vitest configuré) — les tâches frontend sont vérifiées par `tsc --noEmit` + vérification manuelle dans le navigateur (`pnpm dev`), pas de TDD automatisé pour ces tâches.
- Pas de nouveau panneau live permanent par thème — uniquement dans le bilan final.
- Le rollup par thème est calculé en code à partir des statuts déjà assignés en live, jamais redemandé au LLM.
- Les cards `cat=jargon` sont exclues du rollup par thème.
- Spec : `docs/superpowers/specs/2026-08-02-status-recruteur-rollup-theme-design.md`.

---

### Task 1: `packages/shared` — types `status`/`theme`/`ThemeStatus`

**Files:**
- Modify: `packages/shared/src/index.ts:14-30`

**Interfaces:**
- Produces: `Insight.status: "acquis" | "a-creuser" | "pas-acquis"` (remplace `evidence`), `Insight.theme: string | null`, `ThemeStatus { theme: string; status: Insight["status"]; label: string }`, `CandidateReport.themes: ThemeStatus[]`. Toutes les tâches suivantes consomment ces types.

**Note :** après cette tâche, `apps/backend` et `apps/web` ne typechecke plus (ils référencent encore `evidence`). C'est attendu — les tâches suivantes corrigent chaque consommateur. Ne pas toucher aux autres fichiers dans cette tâche.

- [ ] **Step 1: Remplacer `Insight` et `CandidateReport`**

Dans `packages/shared/src/index.ts`, remplacer les lignes 14–30 :
```ts
export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "attention";
  evidence: "high" | "medium" | "low";
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
}
```
par :
```ts
export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "attention";
  status: "acquis" | "a-creuser" | "pas-acquis";
  theme: string | null;
  t: string;
  title: string;
  body: string;
  relance?: string;
}

export interface ThemeStatus {
  theme: string;
  status: Insight["status"];
  label: string;
}

export interface CandidateReport {
  overall: string;
  strengths: string[];
  gaps: string[];
  recommendation: "hire" | "maybe" | "pass";
  recommendationReason: string;
  themes: ThemeStatus[];
}
```

- [ ] **Step 2: Typecheck le package shared**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: pas d'erreur (le package ne consomme pas ses propres types ailleurs).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): rename Insight.evidence to status, add theme + ThemeStatus rollup"
```

---

### Task 2: Prompts — tests (vocabulaire statut + règles de concision)

**Files:**
- Modify: `apps/backend/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: `Insight`/`ThemeStatus` de Task 1.
- Produces: suite de tests en échec que Task 3 doit satisfaire.

- [ ] **Step 1: Mettre à jour les fixtures `confirmedCard`/`vagueCard`**

Remplacer les lignes 6–24 :
```ts
const confirmedCard: Insight = {
  id: "test-1",
  t: "01:00",
  cat: "strength",
  evidence: "high",
  title: "Expérience terrain solide en React",
  body: "Le candidat a démontré une utilisation concrète de React en production.",
  relance: "Dans quel contexte avez-vous utilisé React ?",
};

const vagueCard: Insight = {
  id: "test-2",
  t: "02:00",
  cat: "attention",
  evidence: "low",
  title: "Manque de concret",
  body: "Réponse trop générale, sans exemple précis.",
  relance: "Pouvez-vous donner un exemple précis ?",
};
```
par :
```ts
const confirmedCard: Insight = {
  id: "test-1",
  t: "01:00",
  cat: "strength",
  status: "acquis",
  theme: "react-production",
  title: "Expérience terrain solide en React",
  body: "Le candidat a démontré une utilisation concrète de React en production.",
  relance: "Dans quel contexte avez-vous utilisé React ?",
};

const vagueCard: Insight = {
  id: "test-2",
  t: "02:00",
  cat: "attention",
  status: "pas-acquis",
  theme: "react-production",
  title: "Manque de concret",
  body: "Réponse trop générale, sans exemple précis.",
  relance: "Pouvez-vous donner un exemple précis ?",
};
```

- [ ] **Step 2: Mettre à jour les assertions qui référencent le format d'en-tête**

Remplacer :
```ts
  it("documents the 4th angle bracket in the format instructions and drops the old generic diversification line", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("[catégorie] [evidence] [theme-slug] [angle]");
    expect(prompt).toContain("angle : contexte | ownership | impact | none");
    expect(prompt).not.toContain("DIVERSIFICATION OBLIGATOIRE");
  });

  it("insists every header field must be bracketed, with a fully-bracketed example", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("les 4 champs de la ligne d'en-tête doivent CHACUN être entourés de crochets");
    expect(prompt).toContain("[jargon] [high] [aws-lambda-scheduling] [ownership]");
  });
```
par :
```ts
  it("documents the 4th angle bracket in the format instructions and drops the old generic diversification line", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("[catégorie] [statut] [theme-slug] [angle]");
    expect(prompt).toContain("angle : contexte | ownership | impact | none");
    expect(prompt).not.toContain("DIVERSIFICATION OBLIGATOIRE");
  });

  it("insists every header field must be bracketed, with a fully-bracketed example", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("les 4 champs de la ligne d'en-tête doivent CHACUN être entourés de crochets");
    expect(prompt).toContain("[jargon] [acquis] [aws-lambda-scheduling] [ownership]");
  });

  it("defines the acquis/a-creuser/pas-acquis vocabulary instead of evidence levels", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("Statut : acquis (exemple concret fourni, réponse complète)");
    expect(prompt).toContain("a-creuser (mention sans détail, incomplet)");
    expect(prompt).toContain("pas-acquis (vague, aucune preuve concrète)");
    expect(prompt).not.toContain("Evidence : high");
  });

  it("instructs a 1-sentence body in plain, non-technical language", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("1 phrase MAX");
    expect(prompt).toContain("comme si tu l'expliquais à quelqu'un qui n'a jamais fait de dev");
  });

  it("forbids technical asides/parentheses in the relance", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("jamais de parenthèse ou d'aside technique d'implémentation");
    expect(prompt).toContain("lisible à voix haute par un recruteur non-tech");
  });
```

- [ ] **Step 3: Mettre à jour le test `buildFinalAnalysisPrompt` sur les niveaux d'evidence**

Remplacer :
```ts
  it("includes all card titles and evidence levels", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [confirmedCard, vagueCard]);
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("Manque de concret");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("LOW");
  });
```
par :
```ts
  it("includes all card titles and statuses", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [confirmedCard, vagueCard]);
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("Manque de concret");
    expect(prompt).toContain("ACQUIS");
    expect(prompt).toContain("PAS-ACQUIS");
  });
```

- [ ] **Step 4: Run et vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — `live-assist.ts` et `final-analysis.ts` utilisent encore `evidence`/high/medium/low, donc les nouvelles assertions ne matchent rien, et les fixtures `confirmedCard`/`vagueCard` (avec `status`/`theme`) ne compilent même pas encore contre l'ancien `Insight`... en réalité elles compilent (Task 1 a déjà changé `Insight`), donc l'échec vient uniquement du contenu du prompt.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/__tests__/prompts.test.ts
git commit -m "test(prompts): add failing tests for acquis/a-creuser/pas-acquis vocabulary"
```

---

### Task 3: Prompts — implémentation (vocabulaire statut + règles de concision)

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts:71-104`
- Modify: `apps/backend/src/prompts/final-analysis.ts:10`

**Interfaces:**
- Consumes: `apps/backend/src/__tests__/prompts.test.ts` (Task 2) comme test d'acceptation.
- Produces: `buildLiveAssistPrompt(...)` — signature inchangée, contenu textuel mis à jour. `buildFinalAnalysisPrompt(...)` — signature inchangée.

- [ ] **Step 1: Remplacer le corps du prompt live-assist**

Dans `apps/backend/src/prompts/live-assist.ts`, remplacer le `return` de `buildLiveAssistPrompt` (lignes 71–104) :
```ts
  return `Tu es VoxHelp, un copilote bienveillant qui aide un recruteur non-technique pendant un entretien développeur.${jobCtx}${convHistory}${prevCards}${relancesSection}${themeSection}
Rôle : traduire le jargon, repérer les points forts, aider à poser les bonnes questions.

PRIORITÉ ABSOLUE — DÉTECTION RECRUTEUR :
Si le texte transcrit est une question ou une invitation à parler typique d'un recruteur (ex : "Parlez-moi de...", "Comment gérez-vous...", "Pouvez-vous décrire...", "Tell me about...", "What is your experience with..."), réponds UNIQUEMENT avec :
[skip]
Ne génère rien d'autre. Un recruteur pose des questions courtes et n'explique pas de techno.
Un candidat répond : il raconte, explique, donne des exemples, cite des technos ou des chiffres.

Transcription possiblement incomplète. Ne le mentionne jamais. Analyse ce qui EST dit.
Réponds dans la même langue que le candidat.

Format de réponse OBLIGATOIRE — commence DIRECTEMENT par le marqueur, rien avant :
[catégorie] [evidence] [theme-slug] [angle]
# Titre court
Explication simple 1-2 phrases
>> Question de relance (optionnelle)

IMPORTANT — les 4 champs de la ligne d'en-tête doivent CHACUN être entourés de crochets, sans exception : jamais de valeur nue sans crochets, même pour evidence/theme-slug/angle. Exemple exact et complet : [jargon] [high] [aws-lambda-scheduling] [ownership]

Catégories :
- jargon : terme technique → explique simplement au recruteur
- strength : expérience concrète ou résultat mesurable → valorise
- attention : contradiction ou point critique à creuser
- translation : contexte, rôle ou parcours → reformule en clair

Evidence : high (exemple concret fourni) | medium (mention sans détail) | low (vague)

theme-slug : court identifiant kebab-case (1 à 4 mots) du macro-sujet abordé (ex : aws-serverless, presentation, methodologie-travail).

angle : contexte | ownership | impact | none — l'angle de TA relance suggérée. none si pas de relance (cat = translation) ou si la relance ne correspond à aucun des 3 angles.

Relance : naturelle et bienveillante, jamais accusatrice.
Pas de relance si cat = translation ou si le sujet est épuisé.`;
```
par :
```ts
  return `Tu es VoxHelp, un copilote bienveillant qui aide un recruteur non-technique pendant un entretien développeur.${jobCtx}${convHistory}${prevCards}${relancesSection}${themeSection}
Rôle : traduire le jargon, repérer les points forts, aider à poser les bonnes questions.

PRIORITÉ ABSOLUE — DÉTECTION RECRUTEUR :
Si le texte transcrit est une question ou une invitation à parler typique d'un recruteur (ex : "Parlez-moi de...", "Comment gérez-vous...", "Pouvez-vous décrire...", "Tell me about...", "What is your experience with..."), réponds UNIQUEMENT avec :
[skip]
Ne génère rien d'autre. Un recruteur pose des questions courtes et n'explique pas de techno.
Un candidat répond : il raconte, explique, donne des exemples, cite des technos ou des chiffres.

Transcription possiblement incomplète. Ne le mentionne jamais. Analyse ce qui EST dit.
Réponds dans la même langue que le candidat.

Format de réponse OBLIGATOIRE — commence DIRECTEMENT par le marqueur, rien avant :
[catégorie] [statut] [theme-slug] [angle]
# Titre court
Explication en 1 phrase MAX, comme si tu l'expliquais à quelqu'un qui n'a jamais fait de dev : simple, concret, aucun terme technique non expliqué dans la phrase elle-même.
>> Question de relance (optionnelle)

IMPORTANT — les 4 champs de la ligne d'en-tête doivent CHACUN être entourés de crochets, sans exception : jamais de valeur nue sans crochets, même pour statut/theme-slug/angle. Exemple exact et complet : [jargon] [acquis] [aws-lambda-scheduling] [ownership]

Catégories :
- jargon : terme technique → explique simplement au recruteur
- strength : expérience concrète ou résultat mesurable → valorise
- attention : contradiction ou point critique à creuser
- translation : contexte, rôle ou parcours → reformule en clair

Statut : acquis (exemple concret fourni, réponse complète) | a-creuser (mention sans détail, incomplet) | pas-acquis (vague, aucune preuve concrète)

theme-slug : court identifiant kebab-case (1 à 4 mots) du macro-sujet abordé (ex : aws-serverless, presentation, methodologie-travail).

angle : contexte | ownership | impact | none — l'angle de TA relance suggérée. none si pas de relance (cat = translation) ou si la relance ne correspond à aucun des 3 angles.

Relance : naturelle et bienveillante, jamais accusatrice, jamais de parenthèse ou d'aside technique d'implémentation (ex interdit : "(rétrocompatibilité, déploiement coordonné des Lambdas)"). Doit rester lisible à voix haute par un recruteur non-tech sans qu'il ait besoin de comprendre un détail entre parenthèses.
Pas de relance si cat = translation ou si le sujet est épuisé.`;
```

- [ ] **Step 2: Renommer `evidence` en `status` dans le bilan final**

Dans `apps/backend/src/prompts/final-analysis.ts`, remplacer la ligne 10 :
```ts
      ? `\nAnalyses réalisées pendant l'entretien :\n${cards.map((c, i) => `[${i + 1}] ${c.evidence.toUpperCase()} [${c.cat}] — "${c.title}"\n     → ${c.body}`).join("\n")}\n`
```
par :
```ts
      ? `\nAnalyses réalisées pendant l'entretien :\n${cards.map((c, i) => `[${i + 1}] ${c.status.toUpperCase()} [${c.cat}] — "${c.title}"\n     → ${c.body}`).join("\n")}\n`
```

- [ ] **Step 3: Run et vérifier le succès**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS (tous les tests du fichier, y compris ceux déjà présents avant Task 2).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts apps/backend/src/prompts/final-analysis.ts
git commit -m "feat(prompts): switch to acquis/a-creuser/pas-acquis, shorten cards, ban jargon in relances"
```

---

### Task 4: `session.ts` — tests (parsing statut/thème)

**Files:**
- Modify: `apps/backend/src/__tests__/session.test.ts`
- Modify: `apps/backend/src/__tests__/session-theme-angle.test.ts`

**Interfaces:**
- Consumes: types de Task 1, prompts de Task 3.
- Produces: suite de tests en échec que Task 5 doit satisfaire.

- [ ] **Step 1: Mettre à jour `sampleAssistText` et `sampleReport` dans `session.test.ts`**

Remplacer :
```ts
const sampleAssistText = [
  "[strength] [high]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
  ">> Dans quel type de projet avez-vous utilisé React ?",
].join("\n");

const sampleReport: CandidateReport = {
  overall: "Candidat solide avec une expérience React clairement démontrée.",
  strengths: ["Expérience terrain claire", "Exemples concrets et précis"],
  gaps: ["TypeScript avancé non confirmé"],
  recommendation: "hire",
  recommendationReason: "Profil directement applicable au poste visé.",
};
```
par :
```ts
const sampleAssistText = [
  "[strength] [acquis]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
  ">> Dans quel type de projet avez-vous utilisé React ?",
].join("\n");

const sampleReport: CandidateReport = {
  overall: "Candidat solide avec une expérience React clairement démontrée.",
  strengths: ["Expérience terrain claire", "Exemples concrets et précis"],
  gaps: ["TypeScript avancé non confirmé"],
  recommendation: "hire",
  recommendationReason: "Profil directement applicable au poste visé.",
  themes: [],
};
```
Note : `sampleReport.themes` est ignoré à l'exécution réelle (Task 7 le recalcule côté serveur et écrase ce que le mock renvoie) — ce `themes: []` sert uniquement à satisfaire le type `CandidateReport`.

- [ ] **Step 2: Mettre à jour le vocabulaire dans `session-theme-angle.test.ts`**

Remplacer la fonction `awsCard` :
```ts
function awsCard(title: string, angle: "contexte" | "ownership" | "impact" | "none" = "none"): string {
  return [
    `[strength] [high] [aws-serverless] [${angle}]`,
    `# ${title}`,
    "Détail technique sur ce sujet.",
  ].join("\n");
}
```
par :
```ts
function awsCard(title: string, angle: "contexte" | "ownership" | "impact" | "none" = "none"): string {
  return [
    `[strength] [acquis] [aws-serverless] [${angle}]`,
    `# ${title}`,
    "Détail technique sur ce sujet.",
  ].join("\n");
}
```

Remplacer chacun de ces 4 littéraux (mêmes lignes, ailleurs dans le fichier) :
- `"[translation] [medium] [methodologie-travail] [none]",` → `"[translation] [a-creuser] [methodologie-travail] [none]",`
- `"[translation] high parcours-rbc-data-projects none",` → `"[translation] acquis parcours-rbc-data-projects none",`
- `"[jargon] high parcours-rbc-data-projects [ownership]",` → `"[jargon] acquis parcours-rbc-data-projects [ownership]",`
- `"[strength] high [parcours-rbc-data-projects] impact",` → `"[strength] acquis [parcours-rbc-data-projects] impact",`

- [ ] **Step 3: Run et vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/session.test.ts src/__tests__/session-theme-angle.test.ts`
Expected: FAIL à la compilation — `session.ts` (`parseAssistText`) référence encore `evidence`/`high|medium|low`, donc `Insight["status"]` n'existe pas côté implémentation ; TypeScript refuse de compiler tant que Task 5 n'a pas renommé le champ dans `session.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/__tests__/session.test.ts apps/backend/src/__tests__/session-theme-angle.test.ts
git commit -m "test(session): update fixtures to acquis/a-creuser/pas-acquis vocabulary"
```

---

### Task 5: `session.ts` — implémentation (parsing statut/thème)

**Files:**
- Modify: `apps/backend/src/session.ts:18-27,215-234,335,340`

**Interfaces:**
- Consumes: `Insight`/`ThemeStatus` de Task 1.
- Produces: `Insight` construit par `parseAssistText` porte désormais `status`/`theme`. Consommé par Task 7 (`buildThemeRollup`).

- [ ] **Step 1: Renommer le vocabulaire dans `extractThemeAndAngle`**

Remplacer les lignes 18–27 :
```ts
function extractThemeAndAngle(text: string): { theme: string | null; angle: string | null } {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:high|medium|low)\]?\s*\[?([a-z0-9-]+)\]?(?:\s*\[?(contexte|ownership|impact|none)\]?)?/i
  );
  return {
    theme: match?.[1]?.toLowerCase() ?? null,
    angle: match?.[2]?.toLowerCase() ?? null,
  };
}
```
par :
```ts
function extractThemeAndAngle(text: string): { theme: string | null; angle: string | null } {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|a-creuser|pas-acquis)\]?\s*\[?([a-z0-9-]+)\]?(?:\s*\[?(contexte|ownership|impact|none)\]?)?/i
  );
  return {
    theme: match?.[1]?.toLowerCase() ?? null,
    angle: match?.[2]?.toLowerCase() ?? null,
  };
}
```

- [ ] **Step 2: Mettre à jour `parseAssistText` pour produire `status`/`theme`**

Remplacer les lignes 215–234 :
```ts
  private parseAssistText(text: string, id: string, t: string): Insight {
    const lines = text.trim().split("\n").filter((l) => l.trim() !== "");

    const headerMatch = lines[0]?.match(
      /\[?(jargon|strength|attention|translation)\]?\s*\[?(high|medium|low)\]?/
    );
    const cat = (headerMatch?.[1] as Insight["cat"]) ?? "translation";
    const evidence = (headerMatch?.[2] as Insight["evidence"]) ?? "medium";

    const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

    const lastLine = lines[lines.length - 1];
    const hasRelance = lastLine?.startsWith(">>");
    const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : undefined;

    const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
    const body = lines.slice(2, bodyEnd).join(" ").trim();

    return { id, cat, evidence, t, title, body, relance };
  }
```
par :
```ts
  private parseAssistText(text: string, id: string, t: string): Insight {
    const lines = text.trim().split("\n").filter((l) => l.trim() !== "");

    const headerMatch = lines[0]?.match(
      /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|a-creuser|pas-acquis)\]?/
    );
    const cat = (headerMatch?.[1] as Insight["cat"]) ?? "translation";
    const status = (headerMatch?.[2] as Insight["status"]) ?? "a-creuser";
    const { theme } = extractThemeAndAngle(text);

    const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

    const lastLine = lines[lines.length - 1];
    const hasRelance = lastLine?.startsWith(">>");
    const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : undefined;

    const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
    const body = lines.slice(2, bodyEnd).join(" ").trim();

    return { id, cat, status, theme, t, title, body, relance };
  }
```

- [ ] **Step 3: Mettre à jour le format d'en-tête et l'instruction fixe dans `buildAskPrompt`**

Remplacer la ligne 335 :
```
[catégorie] [evidence]
```
par :
```
[catégorie] [statut]
```

Remplacer la ligne 340 :
```ts
Utilise TOUJOURS catégorie = translation et evidence = high pour tes réponses.`,
```
par :
```ts
Utilise TOUJOURS catégorie = translation et statut = acquis pour tes réponses.`,
```

- [ ] **Step 4: Run la suite complète et vérifier le succès**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — tous les fichiers, y compris `session.test.ts` et `session-theme-angle.test.ts` (Task 4).

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/session.ts
git commit -m "feat(session): parse acquis/a-creuser/pas-acquis status and persist theme on cards"
```

---

### Task 6: Rollup par thème — tests

**Files:**
- Create: `apps/backend/src/__tests__/session-theme-rollup.test.ts`

**Interfaces:**
- Consumes: `Session` via WebSocket (comme les autres tests d'intégration), `Insight.theme`/`status` de Task 5.
- Produces: suite de tests en échec que Task 7 doit satisfaire (`CandidateReport.themes`).

- [ ] **Step 1: Écrire le fichier de test**

Créer `apps/backend/src/__tests__/session-theme-rollup.test.ts` :
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { CandidateReport, ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";
import { waitForMessage } from "./helpers/ws.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({
  streamAssist: vi.fn(),
  callClaudeJSON: vi.fn(),
}));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: mockLlm.streamAssist,
  callClaudeJSON: mockLlm.callClaudeJSON,
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

function connectAndStart(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

const baseReport: Omit<CandidateReport, "themes"> = {
  overall: "Candidat correct dans l'ensemble.",
  strengths: ["Bonne communication"],
  gaps: ["Manque de profondeur technique"],
  recommendation: "maybe",
  recommendationReason: "Profil à confirmer.",
};

describe("Session theme rollup", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockLlm.callClaudeJSON.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("rolls up the last known status per theme, excluding jargon cards", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(
      [
        "[strength] [pas-acquis] [aws-lambda-scheduling] [contexte]",
        "# Premier passage sur AWS Lambda",
        "Réponse vague sur l'architecture.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[jargon] [acquis] [aws-lambda-scheduling] [none]",
        "# Définition : EventBridge",
        "EventBridge programme des tâches.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On utilise EventBridge pour ça.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[strength] [acquis] [aws-lambda-scheduling] [ownership]",
        "# Rôle clarifié sur AWS Lambda",
        "Le candidat a conçu le scheduling lui-même.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("C'est moi qui ai mis ça en place.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes).toEqual([
      { theme: "aws-lambda-scheduling", status: "acquis", label: "Rôle clarifié sur AWS Lambda" },
    ]);
  });

  it("lists distinct themes in order of first appearance", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(
      [
        "[translation] [a-creuser] [parcours-candidat] [none]",
        "# Parcours du candidat",
        "Le candidat décrit son parcours.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("J'ai commencé chez une startup.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[strength] [acquis] [aws-lambda-scheduling] [impact]",
        "# Impact du scheduling AWS",
        "Le candidat chiffre le gain de performance.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("Ça a réduit la latence de 40%.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes.map((t) => t.theme)).toEqual(["parcours-candidat", "aws-lambda-scheduling"]);
  });

  it("omits themes with no evaluative card (jargon-only)", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(
      [
        "[jargon] [acquis] [definition-only] [none]",
        "# Définition : idempotence",
        "Une opération idempotente peut être répétée sans effet de bord.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On garde nos endpoints idempotents.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(baseReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.themes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run et vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/session-theme-rollup.test.ts`
Expected: FAIL — `msg.report.themes` est `undefined` (le serveur ne calcule et n'injecte pas encore le rollup).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/__tests__/session-theme-rollup.test.ts
git commit -m "test(session): add failing tests for per-theme status rollup"
```

---

### Task 7: Rollup par thème — implémentation

**Files:**
- Modify: `apps/backend/src/session.ts:1-11,397-411`

**Interfaces:**
- Consumes: `ThemeStatus` de Task 1, `Insight.theme`/`status` de Task 5.
- Produces: `analysis:final` message avec `report.themes: ThemeStatus[]` peuplé.

- [ ] **Step 1: Importer `ThemeStatus` et ajouter `buildThemeRollup`**

Remplacer la ligne 4 (import type) :
```ts
  Insight, CandidateReport, JobContext,
```
par :
```ts
  Insight, CandidateReport, JobContext, ThemeStatus,
```

Ajouter, juste après `extractThemeAndAngle` (après la ligne 27 d'origine, désormais après le bloc de Task 5) :
```ts
function buildThemeRollup(cards: Insight[]): ThemeStatus[] {
  const byTheme = new Map<string, Insight>();
  for (const card of cards) {
    if (!card.theme || card.cat === "jargon") continue;
    byTheme.set(card.theme, card);
  }
  return Array.from(byTheme.entries()).map(([theme, card]) => ({
    theme,
    status: card.status,
    label: card.title,
  }));
}
```

- [ ] **Step 2: Injecter le rollup dans `generateFinalReport`**

Remplacer (lignes 397–411) :
```ts
  private async generateFinalReport(): Promise<void> {
    try {
      const report = await callClaudeJSON<CandidateReport>(
        buildFinalAnalysisPrompt(this.jobContext, this.cardLog),
        "Génère le bilan final du candidat.",
        "claude-sonnet-4-6"
      );
      this.send({ type: "analysis:final", report });
    } catch (err) {
      this.send({
        type: "session:error",
        error: err instanceof Error ? err.message : "Final analysis error",
      });
    }
  }
```
par :
```ts
  private async generateFinalReport(): Promise<void> {
    try {
      const report = await callClaudeJSON<Omit<CandidateReport, "themes">>(
        buildFinalAnalysisPrompt(this.jobContext, this.cardLog),
        "Génère le bilan final du candidat.",
        "claude-sonnet-4-6"
      );
      this.send({
        type: "analysis:final",
        report: { ...report, themes: buildThemeRollup(this.cardLog) },
      });
    } catch (err) {
      this.send({
        type: "session:error",
        error: err instanceof Error ? err.message : "Final analysis error",
      });
    }
  }
```

- [ ] **Step 3: Run la suite complète et vérifier le succès**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — tous les fichiers, y compris `session-theme-rollup.test.ts` (Task 6).

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/session.ts
git commit -m "feat(session): roll up per-theme status into the final report, computed in code"
```

---

### Task 8: Frontend — parsers (`parseAssistCard.ts`, `parseAssistStream.ts`)

**Files:**
- Modify: `apps/web/src/lib/parseAssistCard.ts`
- Modify: `apps/web/src/lib/parseAssistStream.ts`
- Modify: `apps/web/src/hooks/useWebSocket.ts:74`

**Interfaces:**
- Produces: `AssistCard.status`/`AssistCard.theme` (remplace `AssistCard.evidence`), `PartialCard.status`/`PartialCard.theme` (remplace `PartialCard.evidence`). Consommé par Task 9/10.

**Note :** `apps/web` n'a pas d'infra de tests — cette tâche n'a pas d'étape TDD, vérifiée par `tsc --noEmit` puis manuellement à la Task 11.

- [ ] **Step 1: Réécrire `parseAssistCard.ts`**

Remplacer le contenu complet de `apps/web/src/lib/parseAssistCard.ts` :
```ts
export interface AssistCard {
  cat: "jargon" | "strength" | "attention" | "translation";
  status: "acquis" | "a-creuser" | "pas-acquis";
  theme: string | null;
  title: string;
  body: string;
  relance: string | null;
}

export function parseAssistCard(raw: string): AssistCard {
  const lines = raw.trim().split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0] ?? "";

  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|a-creuser|pas-acquis)\]?/
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|a-creuser|pas-acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );

  const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(2, bodyEnd).join(" ").trim();

  return {
    cat: (headerMatch?.[1] as AssistCard["cat"]) ?? "translation",
    status: (headerMatch?.[2] as AssistCard["status"]) ?? "a-creuser",
    theme: themeMatch?.[1]?.toLowerCase() ?? null,
    title,
    body,
    relance,
  };
}
```

- [ ] **Step 2: Réécrire `parseAssistStream.ts`**

Remplacer le contenu complet de `apps/web/src/lib/parseAssistStream.ts` :
```ts
import type { AssistCard } from "./parseAssistCard.js";

export interface PartialCard {
  id: string;
  t: string;
  cat: AssistCard["cat"] | null;
  status: AssistCard["status"] | null;
  theme: string | null;
  title: string | null;
  body: string;
  relance: string | null;
}

export function parsePartialAssist(textSoFar: string, id: string, t: string): PartialCard {
  const lines = textSoFar.split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0] ?? "";

  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|a-creuser|pas-acquis)\]?/
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|a-creuser|pas-acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
  const cat = (headerMatch?.[1] as AssistCard["cat"]) ?? null;
  const status = (headerMatch?.[2] as AssistCard["status"]) ?? null;
  const theme = themeMatch?.[1]?.toLowerCase() ?? null;

  const titleLine = lines[1];
  const title = titleLine?.startsWith("#") ? titleLine.replace(/^#\s*/, "").trim() : null;

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyStart = title !== null ? 2 : cat !== null ? 1 : 0;
  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(bodyStart, bodyEnd).join(" ").trim();

  return { id, t, cat, status, theme, title, body, relance };
}
```

- [ ] **Step 3: Corriger le site de construction de `PartialCard` dans `useWebSocket.ts`**

`apps/web/src/hooks/useWebSocket.ts:74` construit un `PartialCard` initial vide au démarrage du streaming (`assist:start`) — raté par un premier grep, il référence encore `evidence`. Remplacer :
```ts
        setStreamingCard({ id: msg.id, t: msg.t, cat: null, evidence: null, title: null, body: "", relance: null });
```
par :
```ts
        setStreamingCard({ id: msg.id, t: msg.t, cat: null, status: null, theme: null, title: null, body: "", relance: null });
```

Note : `apps/web/src/hooks/useInterviews.ts:21` a aussi un champ `evidence: string` (type `AssistCardRow`, persistance Supabase) — vérifié via `grep -rn "useInterviews\|saveAssistCards\|AssistCardRow" apps/web/src`, ce hook n'est importé/utilisé nulle part dans le code actuel (scaffolding mort, découplé du flux Live en mémoire décrit dans `CLAUDE.md`). Hors scope : ne pas y toucher.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/parseAssistCard.ts apps/web/src/lib/parseAssistStream.ts apps/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): parse acquis/a-creuser/pas-acquis status and theme in assist cards"
```

---

### Task 9: Frontend — `ui.tsx` (badge de statut + libellé catégorie)

**Files:**
- Modify: `apps/web/src/components/ui.tsx:150-206`

**Interfaces:**
- Consumes: `Insight.status` de Task 1.
- Produces: `StatusBadge` (remplace `Confidence`), exporté avec la même API `{ level, showLabel? }`. Consommé par Task 10.

- [ ] **Step 1: Remplacer `EVIDENCE_META`/`Confidence` par `STATUS_META`/`StatusBadge`**

Remplacer les lignes 147–193 :
```ts
// ---------------------------------------------------------------------------
// Evidence — 3 dots indicator
// ---------------------------------------------------------------------------
const EVIDENCE_META: Record<Insight["evidence"], { dots: number; color: string; label: string }> = {
  high: { dots: 3, color: "var(--good)", label: "Concret" },
  medium: { dots: 2, color: "var(--warn)", label: "Partiel" },
  low: { dots: 1, color: "var(--risk)", label: "Vague" },
};

interface EvidenceProps {
  level: Insight["evidence"];
  showLabel?: boolean;
}

export function Confidence({ level, showLabel = true }: EvidenceProps) {
  const c = EVIDENCE_META[level];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: i < c.dots ? c.color : "hsl(0 0% 100% / 0.16)",
              boxShadow: i < c.dots ? `0 0 6px -1px ${c.color}` : "none",
            }}
          />
        ))}
      </span>
      {showLabel && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: c.color,
            letterSpacing: "0.01em",
          }}
        >
          {c.label}
        </span>
      )}
    </span>
  );
}
```
par :
```ts
// ---------------------------------------------------------------------------
// StatusBadge — acquis / à-creuser / pas-acquis
// ---------------------------------------------------------------------------
const STATUS_META: Record<Insight["status"], { dots: number; color: string; label: string }> = {
  "acquis": { dots: 3, color: "var(--good)", label: "Acquis" },
  "a-creuser": { dots: 2, color: "var(--warn)", label: "À creuser" },
  "pas-acquis": { dots: 1, color: "var(--risk)", label: "Pas acquis" },
};

interface StatusBadgeProps {
  level: Insight["status"];
  showLabel?: boolean;
}

export function StatusBadge({ level, showLabel = true }: StatusBadgeProps) {
  const c = STATUS_META[level];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: i < c.dots ? c.color : "hsl(0 0% 100% / 0.16)",
              boxShadow: i < c.dots ? `0 0 6px -1px ${c.color}` : "none",
            }}
          />
        ))}
      </span>
      {showLabel && (
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: c.color,
            letterSpacing: "0.01em",
          }}
        >
          {c.label}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Renommer le libellé de la catégorie `attention`**

Dans `CATEGORY_META` (désormais quelques lignes plus bas), remplacer :
```ts
  attention: { color: "risk", icon: "risk", label: "À creuser" },
```
par :
```ts
  attention: { color: "risk", icon: "risk", label: "Point critique" },
```
Raison : évite la collision visuelle avec le nouveau `status = "a-creuser"` ("À creuser") sur la même card.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: des erreurs subsistent sur `OverlayPanel.tsx` (import `Confidence` inexistant, `insight.evidence` inexistant) — normal, corrigé en Task 10.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui.tsx
git commit -m "feat(web): rename Confidence to StatusBadge, relabel attention category"
```

---

### Task 10: Frontend — `OverlayPanel.tsx` (badge dominant + section thèmes)

**Files:**
- Modify: `apps/web/src/components/OverlayPanel.tsx:2-3,490,603-705`

**Interfaces:**
- Consumes: `StatusBadge` de Task 9, `ThemeStatus`/`CandidateReport.themes` de Task 1.

- [ ] **Step 1: Mettre à jour les imports**

Remplacer la ligne 2 :
```ts
import type { Insight, CandidateReport, JobContext } from "@voxhelp/shared";
```
par :
```ts
import type { Insight, CandidateReport, JobContext, ThemeStatus } from "@voxhelp/shared";
```

Remplacer la ligne 3 :
```ts
import { VIcon, VHMark, LiveWave, Confidence, CategoryTag, GhostBtn } from "./ui.js";
```
par :
```ts
import { VIcon, VHMark, LiveWave, StatusBadge, CategoryTag, GhostBtn } from "./ui.js";
```

- [ ] **Step 2: Rendre le badge dominant, masqué pour `cat=jargon`**

Remplacer la ligne 490 :
```tsx
        <Confidence level={insight.evidence} showLabel={false} />
```
par :
```tsx
        {insight.cat !== "jargon" && <StatusBadge level={insight.status} />}
```

- [ ] **Step 3: Ajouter `THEME_STATUS_META` et la section « Thèmes abordés »**

Juste après `RECOMMENDATION_META` (avant `function FinalReportView`), ajouter :
```tsx
const THEME_STATUS_META: Record<ThemeStatus["status"], { icon: string; color: string }> = {
  "acquis": { icon: "✓", color: "var(--good)" },
  "a-creuser": { icon: "?", color: "var(--warn)" },
  "pas-acquis": { icon: "✕", color: "var(--risk)" },
};
```

Dans `FinalReportView`, insérer entre le paragraphe `report.overall` et le bloc `report.strengths.length > 0 && (...)` :
```tsx
      {report.themes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              margin: "0 0 5px",
            }}
          >
            Thèmes abordés
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
            {report.themes.map((theme) => {
              const meta = THEME_STATUS_META[theme.status];
              return (
                <li key={theme.theme} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                  <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
                  {theme.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/OverlayPanel.tsx
git commit -m "feat(web): show dominant status badge and per-theme rollup in the final report"
```

---

### Task 11: Vérification de bout en bout

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: Typecheck complet**

Run: `cd packages/shared && npx tsc --noEmit && cd ../../apps/backend && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: pas d'erreur sur les 3 packages.

- [ ] **Step 2: Suite de tests backend complète**

Run: `cd apps/backend && npx vitest run`
Expected: PASS, tous les fichiers.

- [ ] **Step 3: Grep pour du vocabulaire résiduel**

Run: `grep -rn "\bevidence\b\|EVIDENCE_META\|Confidence\b" apps/backend/src apps/web/src packages/shared/src`
Expected: aucune occurrence (tout renommé en `status`/`STATUS_META`/`StatusBadge` dans les Tasks 1–10). Note : ce grep peut remonter des faux positifs dans `apps/backend/src/__tests__/` si un commentaire ou un nom de variable non lié contient "evidence" — vérifier au cas par cas.

- [ ] **Step 4: Vérification manuelle dans le navigateur**

Run: `pnpm dev` (depuis la racine du repo)
- Ouvrir le frontend, démarrer une session Prep → Live avec un job context simple.
- Parler quelques phrases variées (un point technique concret, un point vague) pour déclencher plusieurs cards.
- Vérifier que chaque card affiche un badge de statut (Acquis/À creuser/Pas acquis) visible, masqué sur les cards `jargon`.
- Vérifier que le corps de la card tient en 1 phrase simple, et que la relance (si présente) ne contient pas de jargon entre parenthèses.
- Déclencher le bilan final (`session:summarize`) et vérifier que la section « Thèmes abordés » liste les thèmes rencontrés avec une icône de statut cohérente.

- [ ] **Step 5: Commit final si des ajustements manuels ont été faits**

```bash
git status
```
Si des fichiers ont été modifiés pendant la vérification manuelle (ex : ajustement visuel mineur), les committer séparément avec un message décrivant l'ajustement.
