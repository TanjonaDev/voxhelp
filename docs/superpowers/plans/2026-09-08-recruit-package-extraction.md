# Recruit Package Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Recruit's infra-free domain logic (CV parsing, prompt builders) out of `apps/backend` into a new `@voxhelp/recruit` package, symmetric to `@voxhelp/lecture`, with zero behavior change.

**Architecture:** Pure mechanical file move + import-path updates. No business logic is rewritten. `apps/backend` keeps `session.ts`, `deepgram-flux.ts`, `groq-stt.ts`, `llm.ts`, `supabase.ts` as host/infra; it becomes a thin consumer of `@voxhelp/recruit` for CV parsing and prompt building, same as it already consumes `@voxhelp/lecture`.

**Tech Stack:** TypeScript strict/ESM, Vitest (existing suite is the safety net — no new tests written).

**Spec:** `docs/superpowers/specs/2026-09-07-vertical-package-boundaries-design.md`

## Global Constraints

- Zero behavior change: no prompt text, CV-parsing logic, or route response shape changes.
- The full backend test suite (95 tests before this plan) must stay green with the same test count after every task — only file locations and import paths change.
- `session.ts` is explicitly out of scope beyond its two prompt-import lines — no other line in it changes.
- ESM imports use `.js` extensions; package.json `main`/`types` point at `./src/index.ts`, mirroring `packages/lecture` and `packages/shared`.

---

## Task 1: Scaffold `@voxhelp/recruit`

**Files:**
- Create: `packages/recruit/package.json`
- Create: `packages/recruit/tsconfig.json`
- Create: `packages/recruit/vitest.config.ts`
- Create: `packages/recruit/src/index.ts`
- Modify: root `package.json` (build scripts)

- [ ] **Step 1: Package manifest**

`packages/recruit/package.json`:
```json
{
  "name": "@voxhelp/recruit",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@voxhelp/shared": "workspace:*",
    "mammoth": "^1.12.0",
    "unpdf": "^1.8.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: tsconfig (mirrors `packages/lecture/tsconfig.json`)**

`packages/recruit/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: vitest config (mirrors `packages/lecture/vitest.config.ts`)**

`packages/recruit/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: Placeholder entry point**

`packages/recruit/src/index.ts`:
```ts
export const RECRUIT_PACKAGE_READY = true;
```

- [ ] **Step 5: Wire into root build pipeline**

In root `package.json`, change:
```json
"build": "pnpm --filter @voxhelp/shared build && pnpm --filter @voxhelp/lecture build && pnpm run --parallel build:web build:backend",
```
to:
```json
"build": "pnpm --filter @voxhelp/shared build && pnpm --filter @voxhelp/lecture build && pnpm --filter @voxhelp/recruit build && pnpm run --parallel build:web build:backend",
```
and add a `build:recruit` script next to `build:lecture`:
```json
"build:recruit": "pnpm --filter @voxhelp/recruit build"
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Run: `cd packages/recruit && npx vitest run`
Expected: "No test files found" (not an error).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml packages/recruit
git commit -m "chore(recruit): scaffold @voxhelp/recruit package"
```

---

## Task 2: Move CV parsing and prompts into the package

**Files:**
- Create: `packages/recruit/src/cv-parser.ts` (moved from `apps/backend/src/cv-parser.ts`)
- Create: `packages/recruit/src/prompts/cv-keyword-extraction.ts` (moved)
- Create: `packages/recruit/src/prompts/final-analysis.ts` (moved)
- Create: `packages/recruit/src/prompts/live-assist.ts` (moved)
- Create: `packages/recruit/src/__tests__/cv-keyword-extraction.test.ts` (moved)
- Create: `packages/recruit/src/__tests__/prompts.test.ts` (moved)
- Modify: `packages/recruit/src/index.ts`

**Interfaces:**
- Produces: `extractTextFromCv(buffer: Buffer, format: CvFormat): Promise<string>`, `type CvFormat`, `buildCvKeywordExtractionPrompt(cvText: string): string`, `buildFinalAnalysisPrompt(jobContext, cards, transcriptLog): string`, `buildLiveAssistPrompt(...)` — same signatures as today, just re-exported from `@voxhelp/recruit` instead of relative backend paths.

- [ ] **Step 1: Move `cv-parser.ts` verbatim**

`packages/recruit/src/cv-parser.ts` (identical content, only its location changes):
```ts
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const MAX_CHARS = 20000;

export type CvFormat = "pdf" | "docx";

export async function extractTextFromCv(buffer: Buffer, format: CvFormat): Promise<string> {
  let text: string;

  if (format === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  }

  return text.slice(0, MAX_CHARS);
}
```

Delete `apps/backend/src/cv-parser.ts`.

- [ ] **Step 2: Move the three prompt files verbatim**

Copy `apps/backend/src/prompts/cv-keyword-extraction.ts`,
`apps/backend/src/prompts/final-analysis.ts`, and
`apps/backend/src/prompts/live-assist.ts` byte-for-byte to
`packages/recruit/src/prompts/` (same filenames, same content — their only
external import, `@voxhelp/shared`, already resolves the same way from the
new location since it's a workspace package). Delete the three originals and
the now-empty `apps/backend/src/prompts/` directory.

- [ ] **Step 3: Move the two pure unit test files**

Copy `apps/backend/src/__tests__/cv-keyword-extraction.test.ts` to
`packages/recruit/src/__tests__/cv-keyword-extraction.test.ts`, changing only
its import line from `"../prompts/cv-keyword-extraction.js"` to
`"../prompts/cv-keyword-extraction.js"` (same relative depth: both are one
level under `src/`, so the import path text is unchanged — verify this after
the copy). Delete the original from `apps/backend/src/__tests__/`.

Copy `apps/backend/src/__tests__/prompts.test.ts` to
`packages/recruit/src/__tests__/prompts.test.ts` unchanged (its imports
`"../prompts/live-assist.js"` and `"../prompts/final-analysis.js"` and
`"@voxhelp/shared"` all resolve identically from the new location). Delete
the original from `apps/backend/src/__tests__/`.

- [ ] **Step 4: Re-export from the package entry point**

Replace `packages/recruit/src/index.ts`:
```ts
export * from "./cv-parser.js";
export * from "./prompts/cv-keyword-extraction.js";
export * from "./prompts/final-analysis.js";
export * from "./prompts/live-assist.js";
```

- [ ] **Step 5: Run the package's own suite and typecheck**

Run: `cd packages/recruit && npx vitest run`
Expected: 2 test files, same test counts as the originals had in `apps/backend` (`cv-keyword-extraction.test.ts`: 5 tests; `prompts.test.ts`: 30 tests — verify exact count against the pre-move `apps/backend` run in Task 3 Step 1 below).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/recruit/src apps/backend/src/cv-parser.ts apps/backend/src/prompts apps/backend/src/__tests__/cv-keyword-extraction.test.ts apps/backend/src/__tests__/prompts.test.ts
git commit -m "feat(recruit): move cv-parser and prompt builders into @voxhelp/recruit"
```

---

## Task 3: Wire `apps/backend` to consume `@voxhelp/recruit`

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/session.ts`
- Modify: `apps/backend/src/__tests__/extract-cv-keywords.test.ts`
- Modify: `apps/backend/src/__tests__/extract-cv-keywords-auth.test.ts`

- [ ] **Step 1: Record the pre-move backend test count**

Run: `cd apps/backend && npx vitest run 2>&1 | tail -5`
Expected: note the "Test Files" / "Tests" counts (95 tests across 14 files, per the last full run) — this is the baseline Task 3 Step 8 must reproduce exactly.

- [ ] **Step 2: Swap backend dependencies**

In `apps/backend/package.json`, remove `"mammoth": "^1.12.0"` and
`"unpdf": "^1.8.0"` from `dependencies`, add
`"@voxhelp/recruit": "workspace:*"` (alongside the existing
`"@voxhelp/lecture": "workspace:*"`).

Run: `pnpm install`

- [ ] **Step 3: Update `routes.ts` imports**

Replace:
```ts
import { extractTextFromCv, type CvFormat } from "./cv-parser.js";
import { callClaudeJSON } from "./llm.js";
import { buildCvKeywordExtractionPrompt } from "./prompts/cv-keyword-extraction.js";
import { analyzePass1, type Pass1Input } from "@voxhelp/lecture";
```
with:
```ts
import { extractTextFromCv, buildCvKeywordExtractionPrompt, type CvFormat } from "@voxhelp/recruit";
import { callClaudeJSON } from "./llm.js";
import { analyzePass1, type Pass1Input } from "@voxhelp/lecture";
```

- [ ] **Step 4: Update `session.ts` imports**

Replace:
```ts
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";
```
with:
```ts
import { buildLiveAssistPrompt, buildFinalAnalysisPrompt } from "@voxhelp/recruit";
```
No other line in `session.ts` changes.

- [ ] **Step 5: Update `extract-cv-keywords.test.ts` mock target**

Replace:
```ts
vi.mock("../cv-parser.js", () => ({ extractTextFromCv: mockExtract }));
```
with:
```ts
vi.mock("@voxhelp/recruit", () => ({ extractTextFromCv: mockExtract }));
```

- [ ] **Step 6: Update `extract-cv-keywords-auth.test.ts` mock target**

Replace:
```ts
vi.mock("../cv-parser.js", () => ({ extractTextFromCv: mockExtract }));
```
with:
```ts
vi.mock("@voxhelp/recruit", () => ({ extractTextFromCv: mockExtract }));
```
(Check the exact mock factory shape in the file first — it may need
`buildCvKeywordExtractionPrompt` re-exported too if the route imports both
from `@voxhelp/recruit`; if so, extend the mock factory to also return the
real `buildCvKeywordExtractionPrompt` via
`await vi.importActual("@voxhelp/recruit")` spread, so the route's prompt
call doesn't break.)

- [ ] **Step 7: Confirm no leftover references**

Run: `grep -rn "\./cv-parser\|\./prompts/cv-keyword-extraction\|\./prompts/final-analysis\|\./prompts/live-assist" apps/backend/src`
Expected: no output.

- [ ] **Step 8: Run the full backend suite and typecheck**

Run: `cd apps/backend && npx vitest run`
Expected: same Test Files / Tests counts as Task 3 Step 1's baseline.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/package.json apps/backend/src/routes.ts apps/backend/src/session.ts apps/backend/src/__tests__/extract-cv-keywords.test.ts apps/backend/src/__tests__/extract-cv-keywords-auth.test.ts pnpm-lock.yaml
git commit -m "feat(backend): consume @voxhelp/recruit for cv-parsing and prompts"
```

---

## Task 4: Whole-repo verification

**Files:** none — verification only.

- [ ] **Step 1: Full test run across the touched packages**

Run: `pnpm --filter @voxhelp/recruit test && pnpm --filter @voxhelp/backend test`
Expected: all green, counts matching the pre-move baseline.

- [ ] **Step 2: Typecheck every workspace package**

Run: `cd packages/recruit && npx tsc --noEmit && cd ../lecture && npx tsc --noEmit && cd ../../apps/backend && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 3: Confirm `apps/backend/src/prompts/` and `apps/backend/src/cv-parser.ts` no longer exist**

Run: `ls apps/backend/src/prompts apps/backend/src/cv-parser.ts 2>&1`
Expected: "No such file or directory" for both.

---

## Self-Review Notes

- **Spec coverage:** every file listed in the design's "Extracted into
  `@voxhelp/recruit`" section has a task; every file in "Explicitly NOT
  touched" is untouched (Task 3 Step 4 confirms `session.ts` gets only its
  two import lines changed).
- **Type consistency:** `extractTextFromCv`, `CvFormat`,
  `buildCvKeywordExtractionPrompt`, `buildFinalAnalysisPrompt`,
  `buildLiveAssistPrompt` — names and signatures are unchanged from their
  current `apps/backend` versions, only their import path changes.
- **Risk flagged inline:** Task 3 Step 6 calls out that
  `extract-cv-keywords-auth.test.ts`'s mock may need to preserve the real
  `buildCvKeywordExtractionPrompt` via `vi.importActual` if the route ends up
  importing both symbols from the same module specifier — this is checked
  against the actual file content at execution time, not assumed.
