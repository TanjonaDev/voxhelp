# Jargon/Theme Dedup Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the live-assist LLM from generating a second `[jargon]` card that re-explains a concept already jargon-decoded earlier in the same theme, while leaving `strength`/`attention`/`translation` cards on that theme unaffected.

**Architecture:** Extend the existing per-theme session state (`lastTheme`/`coveredAngles`/`themeCardCount`) with a new, session-wide (never reset on theme change) `jargonDecodedThemes: Set<string>`. When the current theme is already in that set, `live-assist.ts` adds an explicit instruction telling the LLM not to re-emit `[jargon]` for it unless a genuinely new technical term appears.

**Tech Stack:** TypeScript (ESM, strict), Vitest, backend-only (no shared/frontend changes).

## Global Constraints

- Scoped strictly to `jargon` category + theme continuity — `strength`/`attention`/`translation` cards are untouched by this change.
- `jargonDecodedThemes` is cumulative for the whole session (unlike `coveredAngles`, which resets per theme-streak) — a theme resurfacing later must still trigger the guard.
- No fuzzy/semantic theme matching — relies on exact theme-slug reuse by the LLM, same assumption the existing angle-progression mechanism already makes.
- TypeScript strict, no `any`, ESM imports with `.js` extensions in the backend.
- Spec: `docs/superpowers/specs/2026-08-04-jargon-theme-dedup-design.md`.

---

### Task 1: `buildLiveAssistPrompt` — jargon-guard prompt section (tests)

**Files:**
- Modify: `apps/backend/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: nothing new — writes tests against the target signature `buildLiveAssistPrompt(jobContext?, history?, previousRelances?, previousCards?, lastTheme?, coveredAngles?, themeCardCount?, jargonAlreadyDecoded?)`.
- Produces: a failing test suite that Task 2 must satisfy.

- [ ] **Step 1: Add 4 new tests to the `buildLiveAssistPrompt` describe block**

In `apps/backend/src/__tests__/prompts.test.ts`, add these tests right after the existing `"forbids technical asides/parentheses in the relance"` test (before the closing `});` of the `describe("buildLiveAssistPrompt", ...)` block, currently at line 141):

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
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — `buildLiveAssistPrompt` doesn't yet accept an 8th argument, and the prompt never contains "a déjà été décodé", so the first test's assertions don't match. (TypeScript won't flag the extra call argument since vitest doesn't type-check via esbuild — the failures show up as assertion mismatches, not compile errors.)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/__tests__/prompts.test.ts
git commit -m "test(live-assist): add failing tests for jargon/theme dedup guard"
```

---

### Task 2: `buildLiveAssistPrompt` — jargon-guard prompt implementation

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`

**Interfaces:**
- Consumes: `apps/backend/src/__tests__/prompts.test.ts` (Task 1) as the acceptance test.
- Produces: `buildLiveAssistPrompt(jobContext?: JobContext, history?: string[], previousRelances?: string[], previousCards?: Insight[], lastTheme?: string | null, coveredAngles?: string[], themeCardCount?: number, jargonAlreadyDecoded?: boolean): string` — new 8th parameter, consumed by `session.ts` in Task 4.

**Note:** After this task, `session.ts` still calls the old 7-argument form — that's fine, JavaScript doesn't error on a missing trailing argument (it's `undefined`, and `jargonAlreadyDecoded ?? false` inside the function handles that). Task 4 adds the 8th argument at the call site: not strictly required for compilation, but required for the new behavior to actually activate.

- [ ] **Step 1: Add `buildJargonGuardSection`**

In `apps/backend/src/prompts/live-assist.ts`, add this function right after `buildThemeAngleSection` (after its closing brace, currently ending at line 51, before `export function buildLiveAssistPrompt`):

```ts
function buildJargonGuardSection(lastTheme: string | null | undefined, jargonAlreadyDecoded: boolean): string {
  if (!lastTheme || !jargonAlreadyDecoded) return "";
  return `\nLe jargon technique du thème « ${lastTheme} » a déjà été décodé dans une card précédente. Si le nouveau segment reste sur ce même thème sans introduire de terme technique réellement nouveau (jamais encore expliqué dans cet entretien), NE génère PAS de nouvelle card [jargon] pour ce thème — utilise [strength], [attention] ou [translation] si le contenu apporte une info nouvelle (rôle, décision, résultat concret), ou [skip] si rien de nouveau n'est apporté.\n`;
}
```

- [ ] **Step 2: Wire it into `buildLiveAssistPrompt`**

Replace the function signature and body (currently lines 53-71):
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
```
with:
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

(Only the function signature and the `return` template's opening line change — everything after `Rôle : traduire...` stays exactly as-is, not reproduced here.)

- [ ] **Step 3: Run and confirm it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS (all tests in the file, including the 4 new ones from Task 1).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts
git commit -m "feat(live-assist): add jargon/theme dedup guard to the prompt"
```

---

### Task 3: `session.ts` — jargon/theme dedup tracking (tests)

**Files:**
- Create: `apps/backend/src/__tests__/session-jargon-dedup.test.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt`'s new 8th parameter from Task 2 (already implemented — the mocked `streamAssist` calls capture the prompt string built with it).
- Produces: a failing integration test suite that Task 4 must satisfy.

- [ ] **Step 1: Write the test file**

Create `apps/backend/src/__tests__/session-jargon-dedup.test.ts`:
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

function card(cat: string, theme: string, title: string): string {
  return [
    `[${cat}] [acquis] [${theme}] [none]`,
    `# ${title}`,
    "Détail sur ce sujet.",
  ].join("\n");
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session jargon/theme dedup", () => {
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

  it("adds the jargon-guard instruction on the next card of the same theme after a [jargon] card", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("jargon", "aws-serverless", "Pipeline Lambda expliqué"));
    stt.callbacks!.onTranscript("On utilise des Lambdas pour le pipeline.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("jargon", "aws-serverless", "Encore le même pipeline"));
    stt.callbacks!.onTranscript("Toujours le même pipeline serverless.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).toContain("Le jargon technique du thème « aws-serverless » a déjà été décodé");
  });

  it("does not add the jargon-guard instruction if no [jargon] card was emitted on the theme yet", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("strength", "aws-serverless", "Bonne maîtrise du serverless"));
    stt.callbacks!.onTranscript("J'ai conçu ce pipeline serverless.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("strength", "aws-serverless", "Suite sur le même thème"));
    stt.callbacks!.onTranscript("On continue sur ce sujet.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).not.toContain("a déjà été décodé");
  });

  it("keeps the jargon-guard active when the theme resurfaces after switching away", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(card("jargon", "aws-serverless", "Pipeline Lambda expliqué"));
    stt.callbacks!.onTranscript("On utilise des Lambdas.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("translation", "methodologie-travail", "Méthode de travail"));
    stt.callbacks!.onTranscript("On travaille en méthode agile.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("strength", "aws-serverless", "Retour sur le pipeline"));
    stt.callbacks!.onTranscript("Pour revenir sur le pipeline serverless.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(card("strength", "aws-serverless", "Encore sur le pipeline"));
    stt.callbacks!.onTranscript("Toujours ce même pipeline.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const fourthPrompt = mockLlm.streamAssist.mock.calls[3][0] as string;
    expect(fourthPrompt).toContain("Le jargon technique du thème « aws-serverless » a déjà été décodé");
  });
});
```

Note on the 3rd test: the guard depends on `lastTheme` *at prompt-build time*, which is the theme as of the end of the *previous* card — not the theme the upcoming mocked response will declare. That's why it takes 4 calls (not 3) to prove the theme "resurfaces": call 3 returns to `aws-serverless` in its own response (updating `lastTheme` afterward), and only call 4's prompt — built after that update — can be expected to see `lastTheme === "aws-serverless"` again and find it in `jargonDecodedThemes`.

- [ ] **Step 2: Run and confirm it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/session-jargon-dedup.test.ts`
Expected: FAIL — `session.ts` never computes or passes a `jargonAlreadyDecoded` value, so `buildLiveAssistPrompt` always receives `undefined` for the 8th argument and the guard text never appears.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/__tests__/session-jargon-dedup.test.ts
git commit -m "test(session): add failing tests for jargon/theme dedup tracking"
```

---

### Task 4: `session.ts` — jargon/theme dedup tracking implementation

**Files:**
- Modify: `apps/backend/src/session.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt(..., jargonAlreadyDecoded?)` from Task 2.
- Produces: internal-only state (`jargonDecodedThemes: Set<string>`) — no other file depends on this.

- [ ] **Step 1: Add the new field**

In `apps/backend/src/session.ts`, replace (around line 69-71):
```ts
  private lastTheme: string | null = null;
  private coveredAngles: Set<string> = new Set();
  private themeCardCount = 0;
```
with:
```ts
  private lastTheme: string | null = null;
  private coveredAngles: Set<string> = new Set();
  private themeCardCount = 0;
  private jargonDecodedThemes: Set<string> = new Set();
```

- [ ] **Step 2: Reset it in `startSession()` and `cleanup()`**

In `startSession()`, replace (around line 155-157):
```ts
    this.lastTheme = null;
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
```
with:
```ts
    this.lastTheme = null;
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
    this.jargonDecodedThemes = new Set();
```

In `cleanup()`, replace (around line 480-482):
```ts
    this.lastTheme = null;
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
```
with:
```ts
    this.lastTheme = null;
    this.coveredAngles = new Set();
    this.themeCardCount = 0;
    this.jargonDecodedThemes = new Set();
```

(These are two separate occurrences of the same 3 lines, in two different methods — both need the same addition.)

- [ ] **Step 3: Compute the flag and pass it to `buildLiveAssistPrompt`**

In `processTranscript`, replace the `streamAssist`/`buildLiveAssistPrompt` call (currently lines 276-285):
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
with:
```ts
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

- [ ] **Step 4: Track jargon-decoded themes after a card is emitted**

After the card-logging `console.log` line and before the `lastTheme`/`coveredAngles` update block (i.e. right after the block that currently reads, around lines 318-323):
```ts
      console.log(
        `[Session] Card [${card.cat}] [${card.status}] theme=${card.theme ?? "null"} "${card.title}"${card.relance ? ` | relance: "${card.relance}"` : ""}`
      );
```
add immediately after it:
```ts
      if (card.cat === "jargon" && card.theme) {
        this.jargonDecodedThemes.add(card.theme);
      }
```

- [ ] **Step 5: Run the full test suite and confirm everything passes**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — all test files, including `session-jargon-dedup.test.ts` (Task 3) and `prompts.test.ts` (Task 1/2).

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/session.ts
git commit -m "feat(session): track jargon-decoded themes, feed the dedup guard to the prompt"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite one more time from a clean state**

Run: `cd apps/backend && npx vitest run`
Expected: PASS, no skipped/todo tests.

- [ ] **Step 2: Typecheck all 3 packages**

Run: `cd packages/shared && npx tsc --noEmit && cd ../../apps/backend && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: no errors (this change doesn't touch `packages/shared` or `apps/web`, but confirming the whole monorepo stays green is cheap and catches anything unexpected).

- [ ] **Step 3: Grep to confirm the new argument reached the call site**

Run: `grep -n "jargonAlreadyDecoded" apps/backend/src/session.ts`
Expected: 2 matches — the `const jargonAlreadyDecoded = ...` computation and its use as the 8th argument to `buildLiveAssistPrompt(...)`. If only 1 match (or 0), the wiring from Task 4 Step 3 is incomplete.

- [ ] **Step 4: Manual smoke check with the `[Session] Card`/`[Session] Theme tracking` logs already in place**

Run: `pnpm dev` (from repo root), start a session, and have someone describe the same technical concept twice in a row with a short pause in between (mimicking the original bug report — e.g. explain a Lambda/DynamoDB pipeline, pause, then rephrase the same pipeline differently). Watch the backend terminal:
- After the first `[jargon]` card on a theme, confirm `[Session] Card [jargon] ...` logs the theme slug.
- On the next analysis for the same theme, the LLM should no longer emit `[jargon]` for the same concept — check the resulting `[Session] Card [...]` log shows a different category (or that no card was emitted, i.e. a `[Session] Card skippée` log) instead of a second `[jargon]`.
- This is a real LLM call, not a guarantee — the prompt instructs the model, it doesn't hard-block `[jargon]` in code, so occasional non-compliance is possible and not itself a bug in this implementation.
