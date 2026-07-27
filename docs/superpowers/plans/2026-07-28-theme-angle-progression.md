# Theme Angle Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guide live-assist relances through 3 angles (contexte → ownership → impact) per macro-thème instead of a generic "diversify" instruction, replacing the theme-streak-count pivot trigger with an angle-coverage trigger.

**Architecture:** Extend the existing theme-slug tag (3rd header bracket) with a 4th `angle` bracket the LLM tags on each card. `session.ts` accumulates covered angles per theme in a `Set` instead of a plain streak counter, and `live-assist.ts` turns that into a targeted prompt section listing remaining angles with their definitions. Forced pivot triggers when all 3 angles are covered, with a 5-consecutive-card fallback if the LLM never tags angles correctly.

**Tech Stack:** TypeScript (ESM, strict), Vitest, Fastify + ws (backend only — no frontend/shared changes).

## Global Constraints

- No changes to `packages/shared` (Insight type unchanged — angle is session-internal, not persisted on the card).
- No changes to frontend parsing/display — 4th bracket is silently ignored by existing non-anchored regexes, same as the 3rd bracket.
- `THEME_STREAK_FALLBACK` stays a hardcoded constant (5), consistent with `DEBOUNCE_MS`/`MAX_BUFFER_MS`/`MAX_LOG_ENTRIES`/`MAX_CARD_LOG`.
- TypeScript strict, no `any`, ESM imports with `.js` extensions in the backend.
- Spec: `docs/superpowers/specs/2026-07-28-theme-angle-progression-design.md`.

---

### Task 1: `buildLiveAssistPrompt` — angle-progression prompt section (tests)

**Files:**
- Modify: `apps/backend/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: nothing new — this task only writes tests against the target signature `buildLiveAssistPrompt(jobContext?, history?, previousRelances?, previousCards?, lastTheme?, coveredAngles?, themeCardCount?)`.
- Produces: a failing test suite that Task 2 must satisfy.

- [ ] **Step 1: Replace the 4 existing theme-streak tests with theme-angle tests**

In `apps/backend/src/__tests__/prompts.test.ts`, replace these 4 tests (currently lines 61–83):
```ts
  it("includes the theme-continuity instruction when lastTheme is provided", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", 1);
    expect(prompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(prompt).toContain("réutilise EXACTEMENT ce slug");
  });

  it("does not include the forced-pivot warning below the streak threshold", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", 2);
    expect(prompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("includes the forced-pivot warning once the streak threshold is reached", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", 3);
    expect(prompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(prompt).toContain("DOIT changer complètement de sujet");
  });

  it("omits the theme section entirely when lastTheme is null or undefined", () => {
    const promptNull = buildLiveAssistPrompt(undefined, [], [], [], null, 5);
    expect(promptNull).not.toContain("Thème de la dernière card");
    const promptUndefined = buildLiveAssistPrompt(undefined, [], [], []);
    expect(promptUndefined).not.toContain("Thème de la dernière card");
  });
```

with:
```ts
  it("includes the theme-continuity instruction when lastTheme is provided", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1);
    expect(prompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(prompt).toContain("réutilise EXACTEMENT ce slug");
  });

  it("lists all 3 remaining angles with definitions when no angle is covered yet", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1);
    expect(prompt).toContain("Angles déjà couverts sur ce thème : aucun");
    expect(prompt).toContain("Angles restants : contexte, ownership, impact");
    expect(prompt).toContain("contexte : architecture ou projet global");
    expect(prompt).toContain("ownership : rôle personnel du candidat");
    expect(prompt).toContain("impact : problème résolu ou résultat concret");
    expect(prompt).toContain("Ne pose JAMAIS deux relances techniques de suite sur le même outil");
    expect(prompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("lists only the remaining angles once some are already covered", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", ["contexte"], 2);
    expect(prompt).toContain("Angles déjà couverts sur ce thème : contexte");
    expect(prompt).toContain("Angles restants : ownership, impact");
    expect(prompt).not.toContain("contexte : architecture ou projet global");
    expect(prompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("includes the forced-pivot warning once all 3 angles are covered", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", ["contexte", "ownership", "impact"], 3);
    expect(prompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(prompt).toContain("DOIT changer complètement de sujet");
    expect(prompt).not.toContain("Angles restants");
  });

  it("includes the forced-pivot warning at the 5-card fallback even if angles are missing", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 5);
    expect(prompt).toContain("ATTENTION — ce thème a déjà été couvert par 5 cards consécutives");
    expect(prompt).toContain("DOIT changer complètement de sujet");
  });

  it("omits the theme section entirely when lastTheme is null or undefined", () => {
    const promptNull = buildLiveAssistPrompt(undefined, [], [], [], null, [], 5);
    expect(promptNull).not.toContain("Thème de la dernière card");
    const promptUndefined = buildLiveAssistPrompt(undefined, [], [], []);
    expect(promptUndefined).not.toContain("Thème de la dernière card");
  });
```

- [ ] **Step 2: Add a test for the new 4-bracket format instruction and removal of the old generic diversification line**

Add to the `describe("buildLiveAssistPrompt", ...)` block:
```ts
  it("documents the 4th angle bracket in the format instructions and drops the old generic diversification line", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("[catégorie] [evidence] [theme-slug] [angle]");
    expect(prompt).toContain("angle : contexte | ownership | impact | none");
    expect(prompt).not.toContain("DIVERSIFICATION OBLIGATOIRE");
  });
```

- [ ] **Step 3: Run the test file and confirm it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — `buildLiveAssistPrompt` still has the old `(lastTheme, themeStreakCount)` signature and old prompt text, so the new assertions (angle definitions, "Angles restants", 4-bracket format line) don't match.

- [ ] **Step 4: Commit the failing tests**

```bash
git add apps/backend/src/__tests__/prompts.test.ts
git commit -m "test(live-assist): add failing tests for theme-angle progression"
```

---

### Task 2: `buildLiveAssistPrompt` — angle-progression prompt implementation

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`

**Interfaces:**
- Consumes: `apps/backend/src/__tests__/prompts.test.ts` (Task 1) as the acceptance test.
- Produces: `buildLiveAssistPrompt(jobContext?: JobContext, history?: string[], previousRelances?: string[], previousCards?: Insight[], lastTheme?: string | null, coveredAngles?: string[], themeCardCount?: number): string` — new signature, replaces the old `(..., lastTheme, themeStreakCount)`. `themeCardCount` (formerly `themeStreakCount`) is consumed by `session.ts` in Task 3.

**Note:** After this task, `apps/backend` will **not** typecheck — `session.ts` still calls the old signature. That's expected; Task 3 fixes the call site. Do not touch `session.ts` in this task.

- [ ] **Step 1: Replace `buildThemeStreakSection` with `buildThemeAngleSection`**

In `apps/backend/src/prompts/live-assist.ts`, replace lines 1–34 (imports through `buildThemeStreakSection`) with:
```ts
import type { JobContext, Insight } from "@voxhelp/shared";

const ALL_ANGLES = ["contexte", "ownership", "impact"] as const;
const ANGLE_DEFINITIONS: Record<(typeof ALL_ANGLES)[number], string> = {
  contexte: "architecture ou projet global (\"Décrivez-moi l'architecture globale\")",
  ownership: "rôle personnel du candidat dans ce choix/projet (\"Quel était votre rôle ?\")",
  impact: "problème résolu ou résultat concret (\"Quel problème ça résolvait ?\")",
};
const THEME_CARD_COUNT_FALLBACK = 5;

function buildJobContext(ctx?: JobContext): string {
  if (!ctx) return "";
  const parts = [
    ctx.title,
    ctx.level ? `niveau ${ctx.level}` : "",
    ctx.stack ? `stack : ${ctx.stack}` : "",
  ].filter(Boolean);
  return `\nPoste : ${parts.join(" — ")}\n`;
}

function buildConversationHistory(transcripts: string[]): string {
  const recent = transcripts.slice(-10);
  if (recent.length === 0) return "";
  return `\nConversation récente :\n${recent.map((t) => `- ${t}`).join("\n")}\n`;
}

function buildPreviousCards(cards: Insight[]): string {
  const recent = cards.slice(-5);
  if (recent.length === 0) return "";
  return `\nSujets déjà analysés (diversifie les thèmes) :\n${recent.map((c) => `- [${c.cat}] ${c.title}`).join("\n")}\n`;
}

function buildThemeAngleSection(
  lastTheme: string | null | undefined,
  coveredAngles: string[],
  themeCardCount: number
): string {
  if (!lastTheme) return "";

  const remaining = ALL_ANGLES.filter((a) => !coveredAngles.includes(a));
  const forcePivot = remaining.length === 0 || themeCardCount >= THEME_CARD_COUNT_FALLBACK;

  let section = `\nThème de la dernière card : « ${lastTheme} ». Si le nouveau segment reste sur ce thème, réutilise EXACTEMENT ce slug pour le theme-tag.\n`;

  if (forcePivot) {
    section += `\nATTENTION — ce thème a déjà été couvert par ${themeCardCount} cards consécutives. Si le nouveau segment reste sur ce même sujet, ta relance DOIT changer complètement de sujet — pas un autre détail technique de « ${lastTheme} », mais un sujet vraiment différent : méthodologie de travail, parcours professionnel, soft skills, un autre projet, gestion d'équipe, préférences technologiques hors de ce sujet, etc.\n`;
  } else {
    section += `\nAngles déjà couverts sur ce thème : ${coveredAngles.length > 0 ? coveredAngles.join(", ") : "aucun"}.\nAngles restants : ${remaining.join(", ")} — privilégie un de ces angles pour ta prochaine relance :\n${remaining.map((a) => `- ${a} : ${ANGLE_DEFINITIONS[a]}`).join("\n")}\n\nNe pose JAMAIS deux relances techniques de suite sur le même outil (ex : nombre de topics Kafka, puis throughput, puis consumer lag). Le but n'est pas de comprendre l'outil en détail, c'est de comprendre la personne — ses décisions, son rôle, son impact.\n`;
  }
  return section;
}
```

- [ ] **Step 2: Update `buildLiveAssistPrompt`'s signature and body**

Replace the `export function buildLiveAssistPrompt(...)` block (old lines 36–84) with:
```ts
export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[],
  lastTheme?: string | null,
  coveredAngles?: string[],
  themeCardCount?: number
): string {
  const jobCtx = buildJobContext(jobContext);
  const convHistory = buildConversationHistory(history ?? []);
  const prevCards = buildPreviousCards(previousCards ?? []);
  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions déjà posées (ne pas répéter) :\n${previousRelances.map((q) => `- ${q}`).join("\n")}\n`
      : "";
  const themeSection = buildThemeAngleSection(lastTheme, coveredAngles ?? [], themeCardCount ?? 0);

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
}
```

- [ ] **Step 3: Run the test file and confirm it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones from before Task 1).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts
git commit -m "feat(live-assist): guide relances through contexte/ownership/impact angles per theme"
```

---

### Task 3: `session.ts` — angle tracking and forced-pivot trigger (tests)

**Files:**
- Modify: `apps/backend/src/__tests__/session-theme-streak.test.ts` → rename to `apps/backend/src/__tests__/session-theme-angle.test.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt` from Task 2 (already implemented — the mocked `streamAssist` calls capture the prompt string built with it).
- Produces: a failing integration test suite that Task 4 must satisfy.

- [ ] **Step 1: Rename the test file**

```bash
git mv apps/backend/src/__tests__/session-theme-streak.test.ts apps/backend/src/__tests__/session-theme-angle.test.ts
```

- [ ] **Step 2: Replace `awsCard` helper and the two existing tests**

In `apps/backend/src/__tests__/session-theme-angle.test.ts`, replace the `awsCard` helper (old lines 48–54):
```ts
function awsCard(title: string): string {
  return [
    "[strength] [high] [aws-serverless]",
    `# ${title}`,
    "Détail technique sur ce sujet.",
  ].join("\n");
}
```
with an angle-aware version:
```ts
function awsCard(title: string, angle: "contexte" | "ownership" | "impact" | "none" = "none"): string {
  return [
    `[strength] [high] [aws-serverless] [${angle}]`,
    `# ${title}`,
    "Détail technique sur ce sujet.",
  ].join("\n");
}
```

Replace the two existing `it(...)` blocks (old lines 79–137: `"adds the forced-pivot instruction once 3 consecutive cards share the same theme"` and `"resets the streak and does not warn when the theme changes"`) with:
```ts
  it("lists remaining angles and does not force a pivot while angles are still uncovered", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless", "contexte"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Rôle sur le projet", "ownership"));
    stt.callbacks!.onTranscript("J'ai porté cette décision.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a un pipeline ETL derrière.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const thirdPrompt = mockLlm.streamAssist.mock.calls[2][0] as string;
    expect(thirdPrompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(thirdPrompt).toContain("Angles déjà couverts sur ce thème : contexte, ownership");
    expect(thirdPrompt).toContain("Angles restants : impact");
    expect(thirdPrompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("adds the forced-pivot instruction once all 3 angles are covered on the same theme", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless", "contexte"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Rôle sur le projet", "ownership"));
    stt.callbacks!.onTranscript("J'ai porté cette décision.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Résultat obtenu", "impact"));
    stt.callbacks!.onTranscript("Ça a réduit la latence de 40%.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("SQS vs SNS"));
    stt.callbacks!.onTranscript("On utilise SQS plutôt que SNS.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const fourthPrompt = mockLlm.streamAssist.mock.calls[3][0] as string;
    expect(fourthPrompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(fourthPrompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(fourthPrompt).toContain("DOIT changer complètement de sujet");
  });

  it("forces a pivot at the 5-card fallback even if the LLM never tags an angle", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    for (let i = 0; i < 5; i++) {
      mockStreamAssistOnce(awsCard(`Détail technique ${i}`));
      stt.callbacks!.onTranscript(`Encore un détail sur ce sujet ${i}.`);
      ws.send(JSON.stringify({ type: "trigger:analyze" }));
      await waitForMessage(ws, "assist:done");
    }

    const sixthCallIndex = 5;
    mockStreamAssistOnce(awsCard("Encore un détail"));
    stt.callbacks!.onTranscript("Toujours le même sujet.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const sixthPrompt = mockLlm.streamAssist.mock.calls[sixthCallIndex][0] as string;
    expect(sixthPrompt).toContain("ATTENTION — ce thème a déjà été couvert par 5 cards consécutives");
    expect(sixthPrompt).toContain("DOIT changer complètement de sujet");
  });

  it("resets covered angles and does not warn when the theme changes", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless", "contexte"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[translation] [medium] [methodologie-travail] [none]",
        "# Méthode de travail en équipe",
        "Le candidat décrit sa méthode agile.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On travaille en méthode agile avec des sprints.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a aussi un pipeline ETL.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const thirdPrompt = mockLlm.streamAssist.mock.calls[2][0] as string;
    expect(thirdPrompt).toContain("Thème de la dernière card : « methodologie-travail »");
    expect(thirdPrompt).not.toContain("ATTENTION — ce thème a déjà été couvert");
  });
```

Update the outer `describe` title from `"Session theme streak"` to `"Session theme angle"`.

- [ ] **Step 3: Run the test file and confirm it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/session-theme-angle.test.ts`
Expected: FAIL — `session.ts` still uses `extractTheme`/`themeStreakCount` and calls `buildLiveAssistPrompt` with the old signature (a `number` where `coveredAngles: string[]` is now expected), so the new prompt content never appears.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/__tests__/session-theme-angle.test.ts
git commit -m "test(session): add failing tests for theme-angle tracking"
```

---

### Task 4: `session.ts` — angle tracking implementation

**Files:**
- Modify: `apps/backend/src/session.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt(jobContext?, history?, previousRelances?, previousCards?, lastTheme?, coveredAngles?, themeCardCount?)` from Task 2.
- Produces: internal-only state (`coveredAngles: Set<string>`, `themeCardCount: number`) — no other file depends on this.

- [ ] **Step 1: Replace `extractTheme` with `extractThemeAndAngle`**

In `apps/backend/src/session.ts`, replace lines 18–24:
```ts
function extractTheme(text: string): string | null {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[(?:jargon|strength|attention|translation)\]\s*\[(?:high|medium|low)\]\s*\[([a-z0-9-]+)\]/i
  );
  return match?.[1]?.toLowerCase() ?? null;
}
```
with:
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

- [ ] **Step 2: Replace the `themeStreakCount` field with `coveredAngles`/`themeCardCount`**

Replace line 46 (`private themeStreakCount = 0;`) with:
```ts
  private coveredAngles: Set<string> = new Set();
  private themeCardCount = 0;
```
`themeCardCount` is just a raw counter here — the fallback threshold (5) is only compared in `buildThemeAngleSection` (Task 2), so `session.ts` doesn't need its own copy of that constant.

- [ ] **Step 3: Update the two reset points**

In `startSession()` (line 131) replace:
```ts
    this.themeStreakCount = 0;
```
with:
```ts
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
```

In `cleanup()` (line 433) replace:
```ts
    this.themeStreakCount = 0;
```
with:
```ts
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
```

- [ ] **Step 4: Update the `buildLiveAssistPrompt` call site**

Replace lines 246–254:
```ts
      const fullText = await streamAssist(
        buildLiveAssistPrompt(
          this.jobContext,
          this.conversationLog,
          this.relanceLog,
          this.cardLog,
          this.lastTheme,
          this.themeStreakCount
        ),
```
with:
```ts
      const fullText = await streamAssist(
        buildLiveAssistPrompt(
          this.jobContext,
          this.conversationLog,
          this.relanceLog,
          this.cardLog,
          this.lastTheme,
          Array.from(this.coveredAngles),
          this.themeCardCount
        ),
```

- [ ] **Step 5: Update the theme/angle bookkeeping after a card is emitted**

Replace lines 289–295:
```ts
      const theme = extractTheme(fullText);
      if (theme && theme === this.lastTheme) {
        this.themeStreakCount += 1;
      } else {
        this.lastTheme = theme;
        this.themeStreakCount = theme ? 1 : 0;
      }
```
with:
```ts
      const { theme, angle } = extractThemeAndAngle(fullText);
      if (theme && theme === this.lastTheme) {
        this.themeCardCount += 1;
        if (angle && angle !== "none") this.coveredAngles.add(angle);
      } else {
        this.lastTheme = theme;
        this.themeCardCount = theme ? 1 : 0;
        this.coveredAngles = new Set(angle && angle !== "none" ? [angle] : []);
      }
```

- [ ] **Step 6: Run the full backend test suite and confirm everything passes**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — all test files, including `session-theme-angle.test.ts` (Task 3) and `prompts.test.ts` (Task 1/2).

- [ ] **Step 7: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/session.ts
git commit -m "feat(session): track covered angles per theme, pivot once all 3 are covered"
```

---

### Task 5: End-to-end sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite one more time from a clean state**

Run: `cd apps/backend && npx vitest run`
Expected: PASS, no skipped/todo tests left over from the rename in Task 3.

- [ ] **Step 2: Grep for leftover references to the old API**

Run: `grep -rn "themeStreakCount\|extractTheme\b\|buildThemeStreakSection\|THEME_STREAK_THRESHOLD\|DIVERSIFICATION OBLIGATOIRE" apps/backend/src`
Expected: no matches (all renamed/removed in Tasks 2 and 4).

- [ ] **Step 3: Manual smoke check of the generated prompt shape**

Run: `cd apps/backend && node -e "
import('./src/prompts/live-assist.js').then(({ buildLiveAssistPrompt }) => {
  console.log(buildLiveAssistPrompt(undefined, [], [], [], 'kafka-architecture', ['contexte'], 2));
});
" 2>&1 | head -20`
Note: this requires the backend to be built (`npx tsc`) or run via `tsx` — if the `.js` import fails because there's no build output, use `npx tsx -e "..."` with the same snippet importing from `./src/prompts/live-assist.ts` instead. Expected output includes the "Angles déjà couverts sur ce thème : contexte" / "Angles restants : ownership, impact" block, readable and correctly formatted in French.
