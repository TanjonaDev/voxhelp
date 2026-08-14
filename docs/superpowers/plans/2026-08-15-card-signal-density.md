# Cards live-assist : suppression Jargon, signal factuel, fusion déterministe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire le bruit des cards live-assist : supprimer la catégorie "Jargon décodé" comme card autonome, recadrer le corps des cards vers un signal factuel (pas une explication technique) avec relance quasi systématique, et fusionner déterministiquement (côté code, jamais jugé par le LLM) les cards consécutives sur le même sujet précis quand rien n'est resté en suspens.

**Architecture:** `Insight.cat` passe de 4 à 3 valeurs. Le prompt live-assist (`live-assist.ts`) perd sa catégorie jargon et son garde-fou de dédup associé, et sa philosophie de corps de card change de "vulgariser la techno" à "signal factuel + relance par défaut". `session.ts` décide désormais, après génération, si la nouvelle card doit remplacer la précédente en place (même thème, précédente sans relance) via un nouveau message WS `assist:update`, plutôt que de systématiquement empiler une nouvelle card. Le frontend applique le même retrait de catégorie et gère la mise à jour en place.

**Tech Stack:** TypeScript strict, ESM, Fastify + `ws`, React 19, Vitest.

## Global Constraints

- TypeScript strict, pas de `any`.
- Backend ESM : imports internes avec extension `.js`.
- Aucune nouvelle dépendance npm.
- La logique de fusion est déterministe côté code (comparaison de theme-slug + absence de relance sur la card précédente) — jamais un jugement demandé au LLM. C'est la leçon retenue de la tentative de fusion du 16 juillet 2026 (mémoire `project-live-assist-card-merge`), à ne pas re-violer.
- La brièveté du corps n'est pas mesurée par un plafond de mots dans cette itération (cf. Hors Scope de la spec) — uniquement un changement de philosophie de contenu (signal factuel, pas d'explication tech).
- Aucune infra de test automatisé n'existe dans `apps/web` — vérification frontend par `tsc --noEmit` + smoke test manuel.

---

## Task 1: Types partagés — retrait de `jargon`, nouveau message `assist:update`

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `Insight.cat: "translation" | "strength" | "attention"` (3 valeurs, `jargon` retiré) ; nouveau variant `ServerMessage` : `{ type: "assist:update"; id: string; fullText: string }`.
- Consommé par toutes les tâches suivantes.

- [ ] **Step 1: Retirer `jargon` de `Insight.cat` et ajouter `assist:update`**

Dans `packages/shared/src/index.ts`, remplacer :

```ts
export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "attention";
  status: "acquis" | "a-creuser" | "pas-acquis";
```

par :

```ts
export interface Insight {
  id: string;
  cat: "translation" | "strength" | "attention";
  status: "acquis" | "a-creuser" | "pas-acquis";
```

Et remplacer dans `ServerMessage` :

```ts
  | { type: "assist:done"; id: string; fullText: string }
  | { type: "assist:cancel"; id: string }
```

par :

```ts
  | { type: "assist:done"; id: string; fullText: string }
  | { type: "assist:update"; id: string; fullText: string }
  | { type: "assist:cancel"; id: string }
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: PASS (le reste du monorepo ne typechecke pas encore end-to-end — les tâches suivantes adaptent chaque consommateur).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): drop jargon category, add assist:update message"
```

---

## Task 2: Backend — prompt live-assist (retrait jargon + corps signal + relance par défaut)

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`
- Modify: `apps/backend/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: rien de nouveau (le fichier n'importe que `JobContext`/`Insight` de `@voxhelp/shared`, déjà compatibles avec Task 1).
- Produces: `buildLiveAssistPrompt` perd son 8ème paramètre (`jargonAlreadyDecoded`) — nouvelle signature à 7 paramètres. Consommé par Task 3 (`session.ts`).

- [ ] **Step 1: Écrire les tests (mise à jour + nouveaux)**

Dans `apps/backend/src/__tests__/prompts.test.ts`, remplacer la ligne 132 :

```ts
    expect(prompt).toContain("[jargon] [acquis] [aws-lambda-scheduling] [ownership]");
```

par :

```ts
    expect(prompt).toContain("[strength] [acquis] [aws-lambda-scheduling] [ownership]");
```

Remplacer le bloc (lignes 143-154, les deux tests sur le corps de card) :

```ts
  it("instructs a 1-sentence body in plain, non-technical language", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("1 phrase MAX");
    expect(prompt).toContain("comme si tu l'expliquais à quelqu'un qui n'a jamais fait de dev");
  });

  it("caps the body at 15-20 words and forbids the trailing justification/analogy dash", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("15-20 mots");
    expect(prompt).toContain("Donne uniquement le fait");
    expect(prompt).toContain("n'ajoute JAMAIS de justification ou d'analogie après un tiret");
  });
```

par :

```ts
  it("instructs a factual signal body, not a tech explanation", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("ce qui a été dit, factuellement");
    expect(prompt).toContain("pas une explication de la techno elle-même");
    expect(prompt).not.toContain("comme si tu l'expliquais à quelqu'un qui n'a jamais fait de dev");
  });

  it("forbids compound sentences joined by a dash, colon, or linking et", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("jamais deux reliées par un tiret, un deux-points ou un « et » de liaison");
  });
```

Remplacer entièrement le bloc des 4 tests jargon-guard (lignes 162-181) :

```ts
  it("adds the jargon-guard instruction when the theme's jargon was already decoded", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1, true);
    expect(prompt).toContain("Le jargon technique du thème « aws-serverless » a déjà été décodé");
    expect(prompt).toContain("NE génère PAS de nouvelle card [jargon]");
  });

  it("omits the jargon-guard instruction when jargonAlreadyDecoded is false", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1, false);
    expect(prompt).not.toContain("a déjà été décodé");
  });

  it("omits the jargon-guard instruction when jargonAlreadyDecoded is omitted (defaults to false)", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1);
    expect(prompt).not.toContain("a déjà été décodé");
  });

  it("omits the jargon-guard instruction when lastTheme is null even if jargonAlreadyDecoded is true", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], null, [], 0, true);
    expect(prompt).not.toContain("a déjà été décodé");
  });
});
```

par :

```ts
  it("lists exactly 3 categories and never mentions jargon anywhere in the prompt", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("strength : expérience concrète ou résultat mesurable");
    expect(prompt).toContain("attention : contradiction, point vague ou signal à creuser");
    expect(prompt).toContain("translation : contexte, rôle ou parcours");
    expect(prompt).not.toContain("jargon");
  });

  it("makes the relance the default, not the exception, and drops the translation-only exclusion", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("Inclus une relance, sauf exception");
    expect(prompt).not.toContain("Pas de relance si cat = translation");
  });

  it("reframes the assistant's role around signal, not jargon translation", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("donner un signal clair au recruteur");
    expect(prompt).not.toContain("traduire le jargon");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run prompts.test.ts`
Expected: FAIL — `live-assist.ts` still has the old category list, the old body/relance wording, and the jargon-guard mechanism.

- [ ] **Step 3: Implement the prompt changes**

Dans `apps/backend/src/prompts/live-assist.ts` :

3a. Supprimer entièrement `buildJargonGuardSection` (la fonction complète, lignes 53-56) :

```ts
function buildJargonGuardSection(lastTheme: string | null | undefined, jargonAlreadyDecoded: boolean): string {
  if (!lastTheme || !jargonAlreadyDecoded) return "";
  return `\nLe jargon technique du thème « ${lastTheme} » a déjà été décodé dans une card précédente. Si le nouveau segment reste sur ce même thème sans introduire de terme technique réellement nouveau (jamais encore expliqué dans cet entretien), NE génère PAS de nouvelle card [jargon] pour ce thème — utilise [strength], [attention] ou [translation] si le contenu apporte une info nouvelle (rôle, décision, résultat concret), ou [skip] si rien de nouveau n'est apporté.\n`;
}
```

3b. Retirer le paramètre `jargonAlreadyDecoded` et la variable `jargonGuardSection` de `buildLiveAssistPrompt` :

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
  const jobCtx = buildJobContext(jobContext);
  const convHistory = buildConversationHistory(history ?? []);
  const prevCards = buildPreviousCards(previousCards ?? []);
  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions déjà posées (ne pas répéter) :\n${previousRelances.map((q) => `- ${q}`).join("\n")}\n`
      : "";
  const themeSection = buildThemeAngleSection(lastTheme, coveredAngles ?? [], themeCardCount ?? 0);
  const jargonGuardSection = buildJargonGuardSection(lastTheme, jargonAlreadyDecoded ?? false);

  return `Tu es VoxHelp, un copilote bienveillant qui aide un recruteur non-technique pendant un entretien développeur.${jobCtx}${convHistory}${prevCards}${relancesSection}${themeSection}${jargonGuardSection}
Rôle : traduire le jargon, repérer les points forts, aider à poser les bonnes questions.
```

par :

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
Rôle : donner un signal clair au recruteur — ce qui a été dit, faut-il creuser, avec quelle question.
```

3c. Remplacer l'instruction de corps (la ligne "Explication en 1 phrase MAX...") :

```ts
Explication en 1 phrase MAX (15-20 mots), comme si tu l'expliquais à quelqu'un qui n'a jamais fait de dev : simple, concret, aucun terme technique non expliqué dans la phrase elle-même. Donne uniquement le fait — n'ajoute JAMAIS de justification ou d'analogie après un tiret (interdit : « — c'est la marque de... », « — comme un chef d'orchestre... »).
```

par :

```ts
Explication en 1 phrase courte : ce qui a été dit, factuellement — pas une explication de la techno elle-même. Si un terme technique est indispensable à la compréhension de la phrase, glose-le en 2-3 mots maximum entre parenthèses, jamais plus. Une seule idée, jamais deux reliées par un tiret, un deux-points ou un « et » de liaison.
```

3d. Remplacer l'exemple d'en-tête :

```ts
IMPORTANT — les 4 champs de la ligne d'en-tête doivent CHACUN être entourés de crochets, sans exception : jamais de valeur nue sans crochets, même pour statut/theme-slug/angle. Exemple exact et complet : [jargon] [acquis] [aws-lambda-scheduling] [ownership]
```

par :

```ts
IMPORTANT — les 4 champs de la ligne d'en-tête doivent CHACUN être entourés de crochets, sans exception : jamais de valeur nue sans crochets, même pour statut/theme-slug/angle. Exemple exact et complet : [strength] [acquis] [aws-lambda-scheduling] [ownership]
```

3e. Remplacer la liste des catégories :

```ts
Catégories :
- jargon : terme technique → explique simplement au recruteur
- strength : expérience concrète ou résultat mesurable → valorise
- attention : contradiction ou point critique à creuser
- translation : contexte, rôle ou parcours → reformule en clair
```

par :

```ts
Catégories :
- strength : expérience concrète ou résultat mesurable → valorise
- attention : contradiction, point vague ou signal à creuser
- translation : contexte, rôle ou parcours → signal factuel
```

3f. Remplacer la ligne `angle` :

```ts
angle : contexte | ownership | impact | none — l'angle de TA relance suggérée. none si pas de relance (cat = translation) ou si la relance ne correspond à aucun des 3 angles.
```

par :

```ts
angle : contexte | ownership | impact | none — l'angle de TA relance suggérée. none si pas de relance (cas exceptionnel où le point est déjà clos) ou si la relance ne correspond à aucun des 3 angles.
```

3g. Remplacer la dernière ligne du prompt (règle de relance) :

```ts
Pas de relance si cat = translation ou si le sujet est épuisé.`;
```

par :

```ts
Inclus une relance, sauf exception : ne l'omets que si le point est déjà totalement clos et qu'aucune question n'apporterait de signal supplémentaire — c'est l'exception, pas la règle.`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts apps/backend/src/__tests__/prompts.test.ts
git commit -m "feat(backend): drop jargon category and reframe live-assist cards around factual signal"
```

---

## Task 3: Backend — session.ts (retrait état jargon + fusion déterministe)

**Files:**
- Modify: `apps/backend/src/session.ts`
- Modify: `apps/backend/src/__tests__/session-theme-angle.test.ts`
- Delete: `apps/backend/src/__tests__/session-jargon-dedup.test.ts`
- Create: `apps/backend/src/__tests__/session-card-merge.test.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt` à 7 paramètres (Task 2), `Insight.cat` à 3 valeurs et `ServerMessage`'s `assist:update` (Task 1).
- Produces: `Session` envoie `{ type: "assist:update", id, fullText }` au lieu de `assist:done` quand une card fusionne dans la précédente (même `id` que la card d'origine). Consommé par Task 5 (`useWebSocket.ts`).

- [ ] **Step 1: Écrire les tests (mise à jour + nouveaux)**

D'abord, supprimer entièrement `apps/backend/src/__tests__/session-jargon-dedup.test.ts` (son sujet — `jargonDecodedThemes`/le garde-fou jargon — n'existe plus) :

```bash
git rm apps/backend/src/__tests__/session-jargon-dedup.test.ts
```

Ensuite, dans `apps/backend/src/__tests__/session-theme-angle.test.ts`, 4 des 5 tests enchaînent des cards sur le même theme-slug sans jamais poser de relance (`awsCard()` ne génère jamais de ligne `>>`) — chaque card après la première sur un même thème va désormais fusionner dans la précédente, donc son message terminal devient `assist:update` au lieu de `assist:done`. Le test "resets covered angles and does not warn when the theme changes" n'est pas affecté (ses 3 cards changent de thème à chaque fois, aucune fusion possible) — ne pas le toucher.

Remplacer le test "lists remaining angles and does not force a pivot while angles are still uncovered" (3 cards, même thème) :

```ts
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
```

par (seuls les 2ème et 3ème `waitForMessage` changent) :

```ts
    mockStreamAssistOnce(awsCard("Fullstack serverless", "contexte"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Rôle sur le projet", "ownership"));
    stt.callbacks!.onTranscript("J'ai porté cette décision.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a un pipeline ETL derrière.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");

    const thirdPrompt = mockLlm.streamAssist.mock.calls[2][0] as string;
    expect(thirdPrompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(thirdPrompt).toContain("Angles déjà couverts sur ce thème : contexte, ownership");
    expect(thirdPrompt).toContain("Angles restants : impact");
    expect(thirdPrompt).not.toContain("DOIT changer complètement de sujet");
  });
```

Remplacer le test "adds the forced-pivot instruction once all 3 angles are covered on the same theme" (4 cards, même thème) :

```ts
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
```

par (le 1er wait reste `assist:done`, les 3 suivants deviennent `assist:update`) :

```ts
    mockStreamAssistOnce(awsCard("Fullstack serverless", "contexte"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Rôle sur le projet", "ownership"));
    stt.callbacks!.onTranscript("J'ai porté cette décision.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");

    mockStreamAssistOnce(awsCard("Résultat obtenu", "impact"));
    stt.callbacks!.onTranscript("Ça a réduit la latence de 40%.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");

    mockStreamAssistOnce(awsCard("SQS vs SNS"));
    stt.callbacks!.onTranscript("On utilise SQS plutôt que SNS.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");

    const fourthPrompt = mockLlm.streamAssist.mock.calls[3][0] as string;
```

Remplacer le test "forces a pivot at the 5-card fallback even if the LLM never tags an angle" :

```ts
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
```

par :

```ts
    for (let i = 0; i < 5; i++) {
      mockStreamAssistOnce(awsCard(`Détail technique ${i}`));
      stt.callbacks!.onTranscript(`Encore un détail sur ce sujet ${i}.`);
      ws.send(JSON.stringify({ type: "trigger:analyze" }));
      await waitForMessage(ws, i === 0 ? "assist:done" : "assist:update");
    }

    const sixthCallIndex = 5;
    mockStreamAssistOnce(awsCard("Encore un détail"));
    stt.callbacks!.onTranscript("Toujours le même sujet.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");
```

Remplacer le test "still tracks theme/angle when the LLM omits brackets on some header fields" — la 2ème card fusionne dans la 1ère (même thème, 1ère card sans relance), et son fixture utilise `[jargon]`, catégorie qui n'existe plus :

```ts
    mockStreamAssistOnce(
      [
        "[jargon] acquis parcours-rbc-data-projects [ownership]",
        "# Rôle du candidat sur le projet",
        "Le candidat explique son rôle.",
        ">> Quel était votre rôle exact ?",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("J'étais responsable de l'architecture.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");
```

par :

```ts
    mockStreamAssistOnce(
      [
        "[strength] acquis parcours-rbc-data-projects [ownership]",
        "# Rôle du candidat sur le projet",
        "Le candidat explique son rôle.",
        ">> Quel était votre rôle exact ?",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("J'étais responsable de l'architecture.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:update");
```

(La 3ème card de ce test, plus bas, reste `assist:done` sans changement : la 2ème card portait une relance, donc la 3ème ne fusionne pas — ne pas toucher `await waitForMessage(ws, "assist:done")` après le mock `"[strength] acquis [parcours-rbc-data-projects] impact"`.)

Enfin, créer `apps/backend/src/__tests__/session-card-merge.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";
import { waitForMessage } from "./helpers/ws.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({ streamAssist: vi.fn() }));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, _keywords: string[] | undefined, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: mockLlm.streamAssist,
  callClaudeJSON: vi.fn(),
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

function card(theme: string, title: string, relance?: string): string {
  const lines = [
    `[strength] [acquis] [${theme}] [none]`,
    `# ${title}`,
    "Détail factuel sur ce sujet.",
  ];
  if (relance) lines.push(`>> ${relance}`);
  return lines.join("\n");
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session card merge", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("merges into the previous card when the theme matches and the previous card had no relance", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("aws-serverless", "Premier passage"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const first = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(card("aws-serverless", "Complément sur le même sujet"));
    stt.callbacks!.onTranscript("Et on a aussi EventBridge.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const second = (await waitForMessage(ws, "assist:update")) as Extract<ServerMessage, { type: "assist:update" }>;

    expect(second.id).toBe(first.id);
    expect(second.fullText).toContain("Complément sur le même sujet");
  });

  it("does not merge when the previous card had a relance", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("aws-serverless", "Premier passage", "Qui a pris cette décision ?"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const first = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(card("aws-serverless", "Suite sur le même sujet"));
    stt.callbacks!.onTranscript("C'est moi qui ai décidé.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const second = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    expect(second.id).not.toBe(first.id);
  });

  it("does not merge when the theme differs", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("aws-serverless", "Premier sujet"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const first = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(card("methodologie-travail", "Sujet différent"));
    stt.callbacks!.onTranscript("On travaille en méthode agile.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const second = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    expect(second.id).not.toBe(first.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run session-theme-angle.test.ts session-card-merge.test.ts`
Expected: FAIL — `session.ts` still sends `assist:done` for every card (no merge logic yet), still calls `buildLiveAssistPrompt` with an 8th argument that no longer exists in Task 2's signature (TypeScript error), and `session-card-merge.test.ts`'s `assist:update` waits time out.

- [ ] **Step 3: Implement the session.ts changes**

Dans `apps/backend/src/session.ts` :

3a. `extractThemeAndAngle`, retirer `jargon` de l'alternation :

```ts
  const match = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?(?:\s*\[?(contexte|ownership|impact|none)\]?)?/i
  );
```

par :

```ts
  const match = headerLine.match(
    /\[?(?:strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?(?:\s*\[?(contexte|ownership|impact|none)\]?)?/i
  );
```

3b. Retirer le champ `jargonDecodedThemes` (déclaré juste après `themeCardCount = 0;`) :

```ts
  private themeCardCount = 0;
  private jargonDecodedThemes: Set<string> = new Set();
```

par :

```ts
  private themeCardCount = 0;
```

3c. Dans `startSession`, retirer la ligne de reset :

```ts
    this.themeCardCount = 0;
    this.jargonDecodedThemes = new Set();
    this.sessionStartMs = Date.now();
```

par :

```ts
    this.themeCardCount = 0;
    this.sessionStartMs = Date.now();
```

3d. Dans `parseAssistText`, retirer `jargon` de l'alternation :

```ts
    const headerMatch = lines[0]?.match(
      /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
    );
```

par :

```ts
    const headerMatch = lines[0]?.match(
      /\[?(strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
    );
```

3e. Dans `processTranscript`, retirer le calcul `jargonAlreadyDecoded` et le 8ème argument :

```ts
    try {
      const jargonAlreadyDecoded = this.lastTheme ? this.jargonDecodedThemes.has(this.lastTheme) : false;
      const fullText = await streamAssist(
        buildLiveAssistPrompt(
          this.jobContext,
          this.conversationLog,
          this.relanceLog,
          this.cardLog,
          this.lastTheme,
          Array.from(this.coveredAngles),
          this.themeCardCount,
          jargonAlreadyDecoded
        ),
```

par :

```ts
    try {
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

3f. Toujours dans `processTranscript`, remplacer le bloc de finalisation de card (envoi du message + gestion de `cardLog` + retrait du garde-fou jargon) :

```ts
      this.send({ type: "assist:done", id: cardId, fullText });

      const card = this.parseAssistText(fullText, cardId, cardT);
      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

      console.log(
        `[Session] Card [${card.cat}] [${card.status}] theme=${card.theme ?? "null"} "${card.title}"${card.relance ? ` | relance: "${card.relance}"` : ""}`
      );

      if (card.cat === "jargon" && card.theme) {
        this.jargonDecodedThemes.add(card.theme);
      }

      const { theme, angle } = extractThemeAndAngle(fullText);
```

par :

```ts
      const card = this.parseAssistText(fullText, cardId, cardT);
      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }

      const lastCard = this.cardLog[this.cardLog.length - 1];
      const canMerge = !!lastCard && !!card.theme && card.theme === lastCard.theme && !lastCard.relance;

      if (canMerge) {
        const mergedCard: Insight = { ...card, id: lastCard.id, t: lastCard.t };
        this.cardLog[this.cardLog.length - 1] = mergedCard;
        this.send({ type: "assist:update", id: lastCard.id, fullText });
        console.log(
          `[Session] Card fusionnée dans ${lastCard.id} [${card.cat}] [${card.status}] theme=${card.theme} "${card.title}"`
        );
      } else {
        this.cardLog.push(card);
        this.send({ type: "assist:done", id: cardId, fullText });
        console.log(
          `[Session] Card [${card.cat}] [${card.status}] theme=${card.theme ?? "null"} "${card.title}"${card.relance ? ` | relance: "${card.relance}"` : ""}`
        );
      }
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

      const { theme, angle } = extractThemeAndAngle(fullText);
```

3g. Dans `cleanup`, retirer la ligne de reset :

```ts
    this.themeCardCount = 0;
    this.jargonDecodedThemes = new Set();
    this.sessionStartMs = 0;
```

par :

```ts
    this.themeCardCount = 0;
    this.sessionStartMs = 0;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — l'ensemble de la suite backend, y compris `session-theme-angle.test.ts`, `session-card-merge.test.ts`, `prompts.test.ts` (Task 2), et tous les autres fichiers non touchés (`session.test.ts`, `session-keywords.test.ts`, `session-max-buffer.test.ts`, `session-usage-limit.test.ts`, `session-tech-matching.test.ts`, tests CV).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/session-theme-angle.test.ts apps/backend/src/__tests__/session-card-merge.test.ts
git commit -m "feat(backend): drop jargon dedup state, merge same-theme cards deterministically"
```

---

## Task 4: Frontend — retrait de `jargon` dans les libs de parsing

**Files:**
- Modify: `apps/web/src/lib/parseAssistCard.ts`
- Modify: `apps/web/src/lib/parseAssistStream.ts`

**Interfaces:**
- Produces: `AssistCard.cat: "strength" | "attention" | "translation"` (3 valeurs). Consommé par Task 5/6.

- [ ] **Step 1: `parseAssistCard.ts`**

Remplacer :

```ts
export interface AssistCard {
  cat: "jargon" | "strength" | "attention" | "translation";
  status: "acquis" | "a-creuser" | "pas-acquis";
```

par :

```ts
export interface AssistCard {
  cat: "strength" | "attention" | "translation";
  status: "acquis" | "a-creuser" | "pas-acquis";
```

Remplacer les deux regex :

```ts
  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
```

par :

```ts
  const headerMatch = headerLine.match(
    /\[?(strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const themeMatch = headerLine.match(
    /\[?(?:strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
```

- [ ] **Step 2: `parseAssistStream.ts`**

Remplacer les deux mêmes regex (identiques dans ce fichier) :

```ts
  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
```

par :

```ts
  const headerMatch = headerLine.match(
    /\[?(strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const themeMatch = headerLine.match(
    /\[?(?:strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: FAIL à ce stade — `OverlayPanel.tsx` et `ui.tsx` référencent encore `jargon` dans des `Record<Insight["cat"], ...>` (Tasks 5/6, pas encore faites). Confirmer que les seules erreurs restantes sont dans ces deux fichiers, pas dans les fichiers touchés par cette tâche.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/parseAssistCard.ts apps/web/src/lib/parseAssistStream.ts
git commit -m "feat(web): drop jargon from card parsing libs"
```

---

## Task 5: Frontend — `useWebSocket.ts` (gestion de `assist:update`)

**Files:**
- Modify: `apps/web/src/hooks/useWebSocket.ts`

**Interfaces:**
- Consumes: `ServerMessage`'s `assist:update` variant (Task 1), `parseAssistCard` à 3 catégories (Task 4).
- Produces: `UseWebSocketReturn.touchedId: string | null` — dernier `id` de card ajouté ou mis à jour. Consommé par Task 6.

- [ ] **Step 1: Ajouter le state `touchedId` et le cas `assist:update`**

Remplacer la déclaration de l'interface de retour (ajout d'un champ) :

```ts
interface UseWebSocketReturn {
  status: ConnectionStatus;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  insights: Insight[];
  streamingCard: PartialCard | null;
  finalReport: CandidateReport | null;
  lastTranscript: string;
  lastError: string | null;
```

par :

```ts
interface UseWebSocketReturn {
  status: ConnectionStatus;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  insights: Insight[];
  streamingCard: PartialCard | null;
  finalReport: CandidateReport | null;
  touchedId: string | null;
  lastTranscript: string;
  lastError: string | null;
```

Ajouter le state, juste après la déclaration de `finalReport` :

```ts
  const [finalReport, setFinalReport] = useState<CandidateReport | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
```

par :

```ts
  const [finalReport, setFinalReport] = useState<CandidateReport | null>(null);
  const [touchedId, setTouchedId] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
```

Remplacer le cas `assist:done` (ajout de `setTouchedId`) et ajouter le nouveau cas `assist:update` juste après :

```ts
      case "assist:done": {
        const parsed = parseAssistCard(msg.fullText);
        setStreamingCard(null);
        setIsAnalyzing(false);
        setInsights((prev) => [
          ...prev,
          {
            id: msg.id,
            t: streamingTRef.current,
            ...parsed,
            relance: parsed.relance ?? undefined,
          },
        ]);
        break;
      }
      case "assist:cancel":
```

par :

```ts
      case "assist:done": {
        const parsed = parseAssistCard(msg.fullText);
        setStreamingCard(null);
        setIsAnalyzing(false);
        setInsights((prev) => [
          ...prev,
          {
            id: msg.id,
            t: streamingTRef.current,
            ...parsed,
            relance: parsed.relance ?? undefined,
          },
        ]);
        setTouchedId(msg.id);
        break;
      }
      case "assist:update": {
        const parsed = parseAssistCard(msg.fullText);
        setStreamingCard(null);
        setIsAnalyzing(false);
        setInsights((prev) =>
          prev.map((insight) =>
            insight.id === msg.id
              ? { ...insight, ...parsed, id: msg.id, t: insight.t, relance: parsed.relance ?? undefined }
              : insight
          )
        );
        setTouchedId(msg.id);
        break;
      }
      case "assist:cancel":
```

Ajouter `touchedId` au retour du hook :

```ts
  return {
    status,
    isAnalyzing,
    isSummarizing,
    insights,
    streamingCard,
    finalReport,
    lastTranscript,
```

par :

```ts
  return {
    status,
    isAnalyzing,
    isSummarizing,
    insights,
    streamingCard,
    finalReport,
    touchedId,
    lastTranscript,
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: FAIL toujours à ce stade sur `OverlayPanel.tsx`/`ui.tsx` uniquement (Task 6 pas encore faite) — confirmer qu'aucune nouvelle erreur n'apparaît dans `useWebSocket.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): handle assist:update by replacing the matching card in place"
```

---

## Task 6: Frontend — retrait UI du Jargon + highlight piloté par `touchedId`

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Modify: `apps/web/src/components/OverlayPanel.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `Insight.cat` à 3 valeurs (Task 1/4), `touchedId` exposé par `useWebSocket` (Task 5).
- Produces: rien consommé par une tâche suivante — dernière tâche de contenu.

- [ ] **Step 1: `ui.tsx` — retirer `jargon` de `CATEGORY_META`**

Remplacer :

```ts
const CATEGORY_META: Record<
  Insight["cat"],
  { color: string; icon: string; label: string }
> = {
  translation: { color: "indigo", icon: "translate", label: "Traduction" },
  jargon: { color: "violet", icon: "sparkle", label: "Jargon décodé" },
  strength: { color: "good", icon: "strength", label: "Point fort" },
  attention: { color: "risk", icon: "risk", label: "Point critique" },
};
```

par :

```ts
const CATEGORY_META: Record<
  Insight["cat"],
  { color: string; icon: string; label: string }
> = {
  translation: { color: "indigo", icon: "translate", label: "Traduction" },
  strength: { color: "good", icon: "strength", label: "Point fort" },
  attention: { color: "risk", icon: "risk", label: "Point critique" },
};
```

- [ ] **Step 2: `OverlayPanel.tsx` — retirer `jargon` des `catColorMap`, badge de statut inconditionnel, libellé renommé**

Dans `StreamingCardView`, remplacer :

```ts
  const catColorMap: Record<string, string> = {
    translation: "var(--indigo)",
    jargon: "var(--violet)",
    strength: "var(--good)",
    attention: "var(--risk)",
  };
```

par :

```ts
  const catColorMap: Record<string, string> = {
    translation: "var(--indigo)",
    strength: "var(--good)",
    attention: "var(--risk)",
  };
```

Dans `InsightCardView`, remplacer :

```ts
  const catColorMap: Record<Insight["cat"], string> = {
    translation: "var(--indigo)",
    jargon: "var(--violet)",
    strength: "var(--good)",
    attention: "var(--risk)",
  };
```

par :

```ts
  const catColorMap: Record<Insight["cat"], string> = {
    translation: "var(--indigo)",
    strength: "var(--good)",
    attention: "var(--risk)",
  };
```

Toujours dans `InsightCardView`, rendre le badge de statut inconditionnel — remplacer :

```ts
        {insight.cat !== "jargon" && <StatusBadge level={insight.status} />}
```

par :

```ts
        <StatusBadge level={insight.status} />
```

Renommer le libellé de section dans `StreamingCardView` ET `InsightCardView` (2 occurrences identiques) — remplacer chaque :

```ts
          Ce que ça veut dire
```

par :

```ts
          Ce qui a été dit
```

- [ ] **Step 3: `OverlayPanel.tsx` — highlight piloté par `touchedId`**

Ajouter `touchedId` aux props du composant. Remplacer :

```ts
export interface OverlayPanelProps {
  token: string;
  insights: Insight[];
  streamingCard: PartialCard | null;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  finalReport: CandidateReport | null;
```

par :

```ts
export interface OverlayPanelProps {
  token: string;
  insights: Insight[];
  streamingCard: PartialCard | null;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  finalReport: CandidateReport | null;
  touchedId: string | null;
```

Remplacer la déstructuration des props :

```ts
export function OverlayPanel({
  token,
  insights,
  streamingCard,
  isAnalyzing,
  isSummarizing,
  finalReport,
```

par :

```ts
export function OverlayPanel({
  token,
  insights,
  streamingCard,
  isAnalyzing,
  isSummarizing,
  finalReport,
  touchedId,
```

Remplacer l'effet basé sur la longueur (qui ne se déclenche jamais sur une mise à jour en place) :

```ts
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (insights.length > prevCountRef.current) {
      const newest = insights[insights.length - 1];
      setNewId(newest.id);
      prevCountRef.current = insights.length;
    }
  }, [insights]);
```

par :

```ts
  useEffect(() => {
    if (touchedId) setNewId(touchedId);
  }, [touchedId]);
```

(`prevCountRef` devient inutilisé ailleurs dans le fichier — vérifier avec `grep -n "prevCountRef" apps/web/src/components/OverlayPanel.tsx` qu'il n'y a plus d'autre référence après ce remplacement ; sinon le retirer aussi.)

- [ ] **Step 4: `App.tsx` — transmettre `touchedId`**

Remplacer :

```tsx
      insights={ws.insights}
      streamingCard={ws.streamingCard}
      isAnalyzing={ws.isAnalyzing}
      isSummarizing={ws.isSummarizing}
      finalReport={ws.finalReport}
```

par :

```tsx
      insights={ws.insights}
      streamingCard={ws.streamingCard}
      isAnalyzing={ws.isAnalyzing}
      isSummarizing={ws.isSummarizing}
      finalReport={ws.finalReport}
      touchedId={ws.touchedId}
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS, zéro erreur. Vérifier via `grep -rn "jargon" apps/web/src/` qu'il ne reste plus aucune référence.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/OverlayPanel.tsx apps/web/src/App.tsx
git commit -m "feat(web): drop jargon UI, always show status badge, highlight on touchedId"
```

---

## Task 7: Vérification finale + smoke test manuel

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: Typecheck complet**

Run:
```bash
cd apps/backend && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```
Expected: PASS pour les deux.

- [ ] **Step 2: Suite backend complète**

Run: `pnpm --filter @voxhelp/backend test`
Expected: PASS — tous les fichiers de `apps/backend/src/__tests__/`.

- [ ] **Step 3: Build web**

Run: `cd apps/web && pnpm build`
Expected: PASS.

- [ ] **Step 4: Grep de cohérence**

Run: `grep -rn "jargon" apps/ packages/ --include="*.ts" --include="*.tsx"`
Expected: aucune sortie hors `apps/backend/src/llm.ts:29` (mention isolée de "jargon dev" dans le prompt de correction de transcript, sans rapport avec le système de catégories — à laisser telle quelle).

- [ ] **Step 5: Smoke test manuel**

Run: `pnpm dev` depuis la racine, puis en conditions réelles :
1. Démarrer une session, laisser le candidat parler suffisamment longtemps sur un même sujet précis (ex : détailler une techno) sans qu'une relance ne soit posée entre-temps par le recruteur.
2. Vérifier qu'une seule card apparaît pour ce sujet et se met à jour en place (highlight visuel) plutôt que de s'empiler en plusieurs cards quasi identiques.
3. Vérifier qu'aucune card "Jargon décodé" n'apparaît — les termes techniques sont glosés brièvement à l'intérieur des cards `strength`/`attention`/`translation`.
4. Vérifier que le badge de statut (Acquis/À creuser/Pas acquis) s'affiche sur toutes les cards, y compris celles qui auraient été "jargon" auparavant.
5. Vérifier qu'une relance est présente sur la majorité des cards, pas seulement occasionnellement.

Ce test est manuel car `apps/web` n'a aucune infra de test automatisé — cohérent avec le reste du composant.
