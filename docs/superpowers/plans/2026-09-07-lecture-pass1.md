# Lecture Pass 1 (Cours) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Passe 1" analysis engine for the new "Cours" vertical: given a raw batch transcript, produce a plan, a new-terms glossary, references, and uncertain zones — without rewriting or summarizing any content — and wire it into the backend behind a REST endpoint.

**Architecture:** A new pnpm workspace package `@voxhelp/lecture` holds the domain types, Zod validation schema, prompt builders, long-transcript windowing, and glossary post-processing as pure, dependency-injected functions (no direct Anthropic SDK dependency — the LLM call is injected as `(system, user) => Promise<unknown>`). `apps/backend` wires this package to the existing `callClaudeJSON` helper (extended with an optional `temperature` param) behind a new `POST /api/lecture/analyze-pass1` route, following the same auth/error-handling pattern as `/api/extract-cv-keywords`.

**Tech Stack:** TypeScript strict/ESM, Zod (new dependency) for runtime validation, Vitest for tests, Fastify route, `@anthropic-ai/sdk` via the existing `callClaudeJSON` wrapper.

**Spec:** `voxhelp-verticale-cours-passe1.md` (repo root at plan-writing time — content reproduced/implemented task-by-task below; the source file is deleted once this plan is filed, per the requester's instruction).

## Global Constraints

- Model: `claude-sonnet-4-6` (existing convention in `apps/backend/src/session.ts:487`), `temperature: 0`.
- Output must be JSON strict, validated by Zod; on validation failure, exactly one retry with the Zod error message appended, then explicit failure (no retry loop).
- Pass 1 never rewrites/summarizes/reformulates course content — only extracts plan/glossary/references/uncertain zones.
- Never invent: unidentified terms go to `uncertainZones`, not to the glossary with a guessed correction.
- Confidence is 0–1 per entry; entries below 0.6 confidence route to manual validation instead of being auto-applied; terms ≥0.8 confidence feed the Deepgram `keyterm` list.
- `oneLineSummary` on a `LectureSection` is capped at 120 characters.
- Segments passed to the prompt include Deepgram confidence formatted to 2 decimals; only segments are passed, never word-level data.
- Transcripts beyond ~2h30 (9,000,000 ms) get windowed into 30-minute chunks with 90s overlap; overlapping duplicate sections (same type, close titles, overlapping time range) are merged.
- No `any`, ESM imports use `.js` extensions, camelCase vars/functions, PascalCase types, kebab-case filenames (existing repo conventions).

---

## Task 1: Scaffold the `@voxhelp/lecture` package

**Files:**
- Create: `packages/lecture/package.json`
- Create: `packages/lecture/tsconfig.json`
- Create: `packages/lecture/vitest.config.ts`
- Create: `packages/lecture/src/index.ts`
- Modify: `package.json:6-10` (root build scripts)

**Interfaces:**
- Produces: an installable, buildable, testable empty workspace package `@voxhelp/lecture` that later tasks add real exports to.

- [ ] **Step 1: Create the package manifest**

`packages/lecture/package.json`:
```json
{
  "name": "@voxhelp/lecture",
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
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create the TS config (mirrors `packages/shared/tsconfig.json`)**

`packages/lecture/tsconfig.json`:
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

- [ ] **Step 3: Create the vitest config (mirrors `apps/backend/vitest.config.ts`)**

`packages/lecture/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
  },
});
```

- [ ] **Step 4: Create a placeholder entry point**

`packages/lecture/src/index.ts`:
```ts
export const LECTURE_PACKAGE_READY = true;
```

- [ ] **Step 5: Wire the new package into the root build pipeline**

In root `package.json`, change:
```json
"build": "pnpm --filter @voxhelp/shared build && pnpm run --parallel build:web build:backend",
```
to:
```json
"build": "pnpm --filter @voxhelp/shared build && pnpm --filter @voxhelp/lecture build && pnpm run --parallel build:web build:backend",
"build:lecture": "pnpm --filter @voxhelp/lecture build",
```
(add `build:lecture` as a new script key alongside the existing `build:web`/`build:backend`).

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: lockfile updates, `packages/lecture` appears linked in `node_modules/@voxhelp/lecture`.

Run: `cd packages/lecture && npx vitest run`
Expected: "No test files found" (not an error) — confirms the package's own vitest config resolves.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml packages/lecture
git commit -m "chore(lecture): scaffold @voxhelp/lecture package"
```

---

## Task 2: Domain types

**Files:**
- Create: `packages/lecture/src/types.ts`

**Interfaces:**
- Produces: `TranscriptSegment`, `CourseContext`, `Pass1Input`, `LectureSection`, `SectionType`, `GlossaryEntry`, `GlossaryCategory`, `Reference`, `ReferenceType`, `UncertainZone`, `Pass1Output` — consumed by every later task.

- [ ] **Step 1: Write the types**

`packages/lecture/src/types.ts`:
```ts
export type SectionType = "content" | "digression" | "student_question" | "administrative";
export type GlossaryCategory = "proper_noun" | "technical_term" | "concept" | "acronym" | "foreign_term";
export type ReferenceType = "author" | "work" | "article" | "scripture" | "date" | "concept";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: number;
  confidence: number;
}

export interface CourseContext {
  title: string;
  discipline?: string;
  instructor?: string;
  language: string;
}

export interface GlossaryEntry {
  term: string;
  heardVariants: string[];
  category: GlossaryCategory;
  sourceLanguage?: string;
  shortDefinition?: string;
  occurrences: number;
  confidence: number;
}

export interface Pass1Input {
  transcript: TranscriptSegment[];
  course: CourseContext;
  existingGlossary: GlossaryEntry[];
}

export interface LectureSection {
  index: number;
  title: string;
  startMs: number;
  endMs: number;
  oneLineSummary: string;
  type: SectionType;
  confidence: number;
}

export interface Reference {
  type: ReferenceType;
  rawCitation: string;
  normalized?: string;
  contextMs: number;
  confidence: number;
}

export interface UncertainZone {
  startMs: number;
  endMs: number;
  excerpt: string;
  reason: string;
}

export interface Pass1Output {
  detectedLanguage: string;
  transcriptQuality: number;
  plan: LectureSection[];
  glossary: GlossaryEntry[];
  references: Reference[];
  uncertainZones: UncertainZone[];
}
```

- [ ] **Step 2: Re-export from the package entry point**

Replace `packages/lecture/src/index.ts` content with:
```ts
export * from "./types.js";
```

- [ ] **Step 3: Type-check**

Run: `cd packages/lecture && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/lecture/src/types.ts packages/lecture/src/index.ts
git commit -m "feat(lecture): add pass 1 domain types"
```

---

## Task 3: Zod validation schema

**Files:**
- Create: `packages/lecture/src/schemas.ts`
- Test: `packages/lecture/src/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: `Pass1Output` and nested types from `./types.js` (Task 2).
- Produces: `pass1OutputSchema` (Zod schema), `parsePass1Output(raw: unknown): Pass1Output`, `formatZodError(error: z.ZodError): string` — consumed by Task 4's retry prompt and Task 7's `analyzePass1`.

- [ ] **Step 1: Write the failing test**

`packages/lecture/src/__tests__/schemas.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pass1OutputSchema, parsePass1Output, formatZodError } from "../schemas.js";

const validOutput = {
  detectedLanguage: "fr",
  transcriptQuality: 0.82,
  plan: [
    {
      index: 0,
      title: "Introduction",
      startMs: 0,
      endMs: 60000,
      oneLineSummary: "Présentation du plan du cours",
      type: "content",
      confidence: 0.9,
    },
  ],
  glossary: [
    {
      term: "berakhah",
      heardVariants: ["beraka", "béraca"],
      category: "foreign_term",
      sourceLanguage: "he",
      occurrences: 3,
      confidence: 0.75,
    },
  ],
  references: [
    {
      type: "author",
      rawCitation: "Von Rad",
      contextMs: 12000,
      confidence: 0.8,
    },
  ],
  uncertainZones: [
    { startMs: 30000, endMs: 32000, excerpt: "[inaudible]", reason: "audio dégradé" },
  ],
};

describe("pass1OutputSchema", () => {
  it("parses a valid Pass1Output", () => {
    expect(() => parsePass1Output(validOutput)).not.toThrow();
    expect(parsePass1Output(validOutput).plan[0].title).toBe("Introduction");
  });

  it("rejects an invalid section type", () => {
    const invalid = { ...validOutput, plan: [{ ...validOutput.plan[0], type: "banter" }] };
    expect(() => parsePass1Output(invalid)).toThrow();
  });

  it("rejects a confidence above 1", () => {
    const invalid = { ...validOutput, transcriptQuality: 1.5 };
    expect(() => parsePass1Output(invalid)).toThrow();
  });

  it("rejects an oneLineSummary longer than 120 characters", () => {
    const invalid = {
      ...validOutput,
      plan: [{ ...validOutput.plan[0], oneLineSummary: "x".repeat(121) }],
    };
    expect(() => parsePass1Output(invalid)).toThrow();
  });

  it("formats a Zod error into readable path: message lines", () => {
    const result = pass1OutputSchema.safeParse({ ...validOutput, transcriptQuality: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("transcriptQuality");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/schemas.test.ts`
Expected: FAIL — `Cannot find module '../schemas.js'`

- [ ] **Step 3: Write the schema**

`packages/lecture/src/schemas.ts`:
```ts
import { z } from "zod";
import type { Pass1Output } from "./types.js";

const glossaryCategorySchema = z.enum([
  "proper_noun",
  "technical_term",
  "concept",
  "acronym",
  "foreign_term",
]);

const sectionTypeSchema = z.enum(["content", "digression", "student_question", "administrative"]);

const referenceTypeSchema = z.enum(["author", "work", "article", "scripture", "date", "concept"]);

const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  heardVariants: z.array(z.string()),
  category: glossaryCategorySchema,
  sourceLanguage: z.string().optional(),
  shortDefinition: z.string().optional(),
  occurrences: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});

const lectureSectionSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  oneLineSummary: z.string().max(120),
  type: sectionTypeSchema,
  confidence: z.number().min(0).max(1),
});

const referenceSchema = z.object({
  type: referenceTypeSchema,
  rawCitation: z.string().min(1),
  normalized: z.string().optional(),
  contextMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});

const uncertainZoneSchema = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  excerpt: z.string(),
  reason: z.string().min(1),
});

export const pass1OutputSchema = z.object({
  detectedLanguage: z.string().min(1),
  transcriptQuality: z.number().min(0).max(1),
  plan: z.array(lectureSectionSchema),
  glossary: z.array(glossaryEntrySchema),
  references: z.array(referenceSchema),
  uncertainZones: z.array(uncertainZoneSchema),
});

export function parsePass1Output(raw: unknown): Pass1Output {
  return pass1OutputSchema.parse(raw) as Pass1Output;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`)
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/schemas.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Re-export from the package entry point**

Append to `packages/lecture/src/index.ts`:
```ts
export * from "./schemas.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/schemas.ts packages/lecture/src/__tests__/schemas.test.ts packages/lecture/src/index.ts packages/lecture/package.json pnpm-lock.yaml
git commit -m "feat(lecture): add pass 1 output zod schema"
```

---

## Task 4: Prompt builders

**Files:**
- Create: `packages/lecture/src/prompts.ts`
- Test: `packages/lecture/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: `Pass1Input`, `GlossaryEntry`, `TranscriptSegment` from `./types.js`.
- Produces: `buildPass1SystemPrompt(): string`, `buildPass1UserPrompt(input: Pass1Input): string`, `buildPass1RetryPrompt(previousUserPrompt: string, zodErrorMessage: string): string` — consumed by Task 7's `analyzePass1`.

- [ ] **Step 1: Write the failing test**

`packages/lecture/src/__tests__/prompts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildPass1SystemPrompt, buildPass1UserPrompt, buildPass1RetryPrompt } from "../prompts.js";
import type { Pass1Input } from "../types.js";

const baseInput: Pass1Input = {
  transcript: [
    { startMs: 0, endMs: 4000, text: "Alors, on commence par le contexte historique.", confidence: 0.913 },
    { startMs: 4000, endMs: 9000, text: "On va parler de la berakhah, la bénédiction.", confidence: 0.4 },
  ],
  course: {
    title: "Introduction à l'hébreu biblique",
    discipline: "Théologie protestante",
    instructor: "Prof. Martin",
    language: "fr",
  },
  existingGlossary: [],
};

describe("buildPass1SystemPrompt", () => {
  it("instructs analysis only, never rewriting/summarizing", () => {
    const prompt = buildPass1SystemPrompt();
    expect(prompt).toContain("Tu ne réécris rien, tu ne résumes pas");
  });

  it("requires the four output categories", () => {
    const prompt = buildPass1SystemPrompt();
    expect(prompt).toContain("LE PLAN");
    expect(prompt).toContain("LE GLOSSAIRE");
    expect(prompt).toContain("LES RÉFÉRENCES");
    expect(prompt).toContain("LES ZONES INCERTAINES");
  });

  it("forbids inventing corrections and requires strict JSON", () => {
    const prompt = buildPass1SystemPrompt();
    expect(prompt).toContain("N'invente jamais");
    expect(prompt).toContain("uniquement par un objet JSON valide");
  });
});

describe("buildPass1UserPrompt", () => {
  it("includes the course context", () => {
    const prompt = buildPass1UserPrompt(baseInput);
    expect(prompt).toContain("Introduction à l'hébreu biblique");
    expect(prompt).toContain("Théologie protestante");
    expect(prompt).toContain("Prof. Martin");
  });

  it("formats segments with millisecond bounds and 2-decimal confidence", () => {
    const prompt = buildPass1UserPrompt(baseInput);
    expect(prompt).toContain("[0–4000] (0.91) Alors, on commence par le contexte historique.");
    expect(prompt).toContain("[4000–9000] (0.40) On va parler de la berakhah, la bénédiction.");
  });

  it("marks the glossary as empty for a first course", () => {
    const prompt = buildPass1UserPrompt(baseInput);
    expect(prompt).toContain("premier cours");
  });

  it("lists the existing glossary as term — variants", () => {
    const withGlossary: Pass1Input = {
      ...baseInput,
      existingGlossary: [
        { term: "berakhah", heardVariants: ["beraka", "béraca"], category: "foreign_term", occurrences: 5, confidence: 0.9 },
      ],
    };
    const prompt = buildPass1UserPrompt(withGlossary);
    expect(prompt).toContain("berakhah — beraka, béraca");
  });
});

describe("buildPass1RetryPrompt", () => {
  it("appends the zod error and re-requests strict JSON", () => {
    const original = buildPass1UserPrompt(baseInput);
    const retry = buildPass1RetryPrompt(original, "plan.0.type: Invalid enum value");
    expect(retry).toContain(original);
    expect(retry).toContain("plan.0.type: Invalid enum value");
    expect(retry).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — `Cannot find module '../prompts.js'`

- [ ] **Step 3: Write the prompt builders**

`packages/lecture/src/prompts.ts`:
```ts
import type { GlossaryEntry, Pass1Input, TranscriptSegment } from "./types.js";

export function buildPass1SystemPrompt(): string {
  return `Tu es un analyste de transcriptions de cours universitaires. Tu reçois la
transcription automatique brute d'un cours suivi en visioconférence. Elle
contient des erreurs de reconnaissance vocale, des hésitations, des
répétitions et des digressions.

Ton rôle est UNIQUEMENT d'analyser. Tu ne réécris rien, tu ne résumes pas
le contenu, tu ne reformules aucune phrase du cours. Une autre étape s'en
chargera à partir de ton analyse.

Tu produis quatre choses :

1. LE PLAN — le découpage réel du cours en sections. Repère-le à partir des
   marqueurs oraux de l'enseignant ("alors, deuxième point", "on va passer à",
   "je reviens sur", "avant de continuer"), des changements de sujet et des
   silences. Chaque section est bornée par des timestamps. Classe chaque
   section par nature : contenu de cours, digression, question d'étudiant,
   ou point administratif.

2. LE GLOSSAIRE — les termes spécialisés, noms propres, concepts et
   acronymes récurrents. Pour chacun, donne la forme correcte et TOUTES les
   variantes fautives présentes dans la transcription. C'est ce qui permettra
   de corriger le document et d'améliorer la transcription des prochains cours.

3. LES RÉFÉRENCES — auteurs, ouvrages, articles, dates, textes cités par
   l'enseignant. Donne la citation brute telle qu'entendue et sa forme
   normalisée quand tu peux l'identifier avec certitude.

4. LES ZONES INCERTAINES — les passages où la transcription est manifestement
   corrompue et où tu n'es pas capable de reconstituer ce qui a été dit.

RÈGLES ABSOLUES :

- N'invente jamais. Si tu n'identifies pas un terme avec confiance, il va
  dans les zones incertaines, pas dans le glossaire avec une correction
  devinée. Une correction fausse propagée dans tout le document est bien
  pire qu'un terme signalé comme douteux.
- Attribue à chaque entrée un score de confiance entre 0 et 1. Sois sévère.
  En dessous de 0.6, l'entrée sera présentée à l'utilisateur pour validation
  manuelle plutôt qu'appliquée automatiquement.
- Le glossaire existant du cours t'est fourni : traite-le comme une source
  fiable et sers-t'en pour identifier les variantes fautives. Ne le
  redonne pas en sortie, ne signale que les termes nouveaux.
- Les termes en langue étrangère ou ancienne (hébreu, grec, latin,
  anglais technique) sont les plus souvent mal transcrits. Traite-les
  avec une attention particulière et signale la langue d'origine.
- Ne fusionne pas des sections courtes pour faire joli. Un plan de 14
  sections est un plan valide.
- Réponds uniquement par un objet JSON valide, sans texte avant ou après,
  sans balises Markdown.`;
}

function formatExistingGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return "(vide, il s'agit du premier cours pour ce module)";
  return glossary.map((entry) => `${entry.term} — ${entry.heardVariants.join(", ") || "(aucune variante connue)"}`).join("\n");
}

function formatSegments(transcript: TranscriptSegment[]): string {
  return transcript
    .map((segment) => `[${segment.startMs}–${segment.endMs}] (${segment.confidence.toFixed(2)}) ${segment.text}`)
    .join("\n");
}

export function buildPass1UserPrompt(input: Pass1Input): string {
  const { course, existingGlossary, transcript } = input;
  return `CONTEXTE DU COURS
Intitulé : ${course.title}
Discipline : ${course.discipline ?? "non précisée"}
Enseignant : ${course.instructor ?? "non précisé"}
Langue : ${course.language}

GLOSSAIRE DÉJÀ CONNU POUR CE COURS
${formatExistingGlossary(existingGlossary)}

TRANSCRIPTION BRUTE
Format : [début_ms–fin_ms] (confiance) texte
${formatSegments(transcript)}

Produis ton analyse au format JSON défini.`;
}

export function buildPass1RetryPrompt(previousUserPrompt: string, zodErrorMessage: string): string {
  return `${previousUserPrompt}

TA RÉPONSE PRÉCÉDENTE N'A PAS PU ÊTRE VALIDÉE. Erreurs de format :
${zodErrorMessage}

Corrige ta réponse et retourne à nouveau un JSON strict respectant exactement le schéma demandé.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Re-export from the package entry point**

Append to `packages/lecture/src/index.ts`:
```ts
export * from "./prompts.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/prompts.ts packages/lecture/src/__tests__/prompts.test.ts packages/lecture/src/index.ts
git commit -m "feat(lecture): add pass 1 prompt builders"
```

---

## Task 5: Glossary post-processing

**Files:**
- Create: `packages/lecture/src/postprocess.ts`
- Test: `packages/lecture/src/__tests__/postprocess.test.ts`

**Interfaces:**
- Consumes: `GlossaryEntry` from `./types.js`.
- Produces: `normalizeTerm(term: string): string`, `mergeGlossary(existing: GlossaryEntry[], incoming: GlossaryEntry[]): GlossaryEntry[]`, `selectNewGlossaryEntries(existing: GlossaryEntry[], consolidated: GlossaryEntry[]): GlossaryEntry[]`, `splitGlossaryByConfidence(glossary: GlossaryEntry[], threshold?: number): { toApply: GlossaryEntry[]; toValidate: GlossaryEntry[] }`, `selectKeyterms(glossary: GlossaryEntry[], threshold?: number): string[]` — consumed by Task 6 (windowing) and Task 7 (`analyzePass1`), and available for the backend to call after receiving a `Pass1Output`.

- [ ] **Step 1: Write the failing test**

`packages/lecture/src/__tests__/postprocess.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  mergeGlossary,
  selectNewGlossaryEntries,
  splitGlossaryByConfidence,
  selectKeyterms,
} from "../postprocess.js";
import type { GlossaryEntry } from "../types.js";

const existing: GlossaryEntry[] = [
  { term: "berakhah", heardVariants: ["beraka"], category: "foreign_term", occurrences: 2, confidence: 0.7 },
];

describe("mergeGlossary", () => {
  it("adds a genuinely new term untouched", () => {
    const incoming: GlossaryEntry[] = [
      { term: "midrash", heardVariants: ["midrache"], category: "foreign_term", occurrences: 1, confidence: 0.6 },
    ];
    const merged = mergeGlossary(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.term === "midrash")).toBeDefined();
  });

  it("deduplicates on the normalized term, case-insensitively", () => {
    const incoming: GlossaryEntry[] = [
      { term: "Berakhah", heardVariants: ["béraca"], category: "foreign_term", occurrences: 3, confidence: 0.9 },
    ];
    const merged = mergeGlossary(existing, incoming);
    expect(merged).toHaveLength(1);
  });

  it("unions heardVariants, sums occurrences, and keeps the max confidence", () => {
    const incoming: GlossaryEntry[] = [
      { term: "berakhah", heardVariants: ["béraca"], category: "foreign_term", occurrences: 3, confidence: 0.9 },
    ];
    const [merged] = mergeGlossary(existing, incoming);
    expect(merged.heardVariants.sort()).toEqual(["beraka", "béraca"]);
    expect(merged.occurrences).toBe(5);
    expect(merged.confidence).toBe(0.9);
  });
});

describe("selectNewGlossaryEntries", () => {
  it("excludes terms already present in the existing glossary", () => {
    const consolidated: GlossaryEntry[] = [
      ...existing,
      { term: "midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.6 },
    ];
    const result = selectNewGlossaryEntries(existing, consolidated);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe("midrash");
  });
});

describe("splitGlossaryByConfidence", () => {
  it("routes entries below 0.6 to validation and the rest to auto-apply", () => {
    const glossary: GlossaryEntry[] = [
      { term: "a", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.59 },
      { term: "b", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.6 },
      { term: "c", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.9 },
    ];
    const { toApply, toValidate } = splitGlossaryByConfidence(glossary);
    expect(toValidate.map((e) => e.term)).toEqual(["a"]);
    expect(toApply.map((e) => e.term)).toEqual(["b", "c"]);
  });
});

describe("selectKeyterms", () => {
  it("returns deduplicated terms at or above 0.8 confidence", () => {
    const glossary: GlossaryEntry[] = [
      { term: "berakhah", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.8 },
      { term: "midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.79 },
    ];
    expect(selectKeyterms(glossary)).toEqual(["berakhah"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/postprocess.test.ts`
Expected: FAIL — `Cannot find module '../postprocess.js'`

- [ ] **Step 3: Write the implementation**

`packages/lecture/src/postprocess.ts`:
```ts
import type { GlossaryEntry } from "./types.js";

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function mergeGlossary(existing: GlossaryEntry[], incoming: GlossaryEntry[]): GlossaryEntry[] {
  const byKey = new Map<string, GlossaryEntry>();
  for (const entry of existing) {
    byKey.set(normalizeTerm(entry.term), { ...entry, heardVariants: [...entry.heardVariants] });
  }
  for (const entry of incoming) {
    const key = normalizeTerm(entry.term);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...entry, heardVariants: [...entry.heardVariants] });
      continue;
    }
    byKey.set(key, {
      ...current,
      heardVariants: Array.from(new Set([...current.heardVariants, ...entry.heardVariants])),
      occurrences: current.occurrences + entry.occurrences,
      confidence: Math.max(current.confidence, entry.confidence),
      shortDefinition: current.shortDefinition ?? entry.shortDefinition,
      sourceLanguage: current.sourceLanguage ?? entry.sourceLanguage,
    });
  }
  return Array.from(byKey.values());
}

export function selectNewGlossaryEntries(
  existing: GlossaryEntry[],
  consolidated: GlossaryEntry[]
): GlossaryEntry[] {
  const existingKeys = new Set(existing.map((entry) => normalizeTerm(entry.term)));
  return consolidated.filter((entry) => !existingKeys.has(normalizeTerm(entry.term)));
}

export function splitGlossaryByConfidence(
  glossary: GlossaryEntry[],
  threshold = 0.6
): { toApply: GlossaryEntry[]; toValidate: GlossaryEntry[] } {
  const toApply: GlossaryEntry[] = [];
  const toValidate: GlossaryEntry[] = [];
  for (const entry of glossary) {
    (entry.confidence < threshold ? toValidate : toApply).push(entry);
  }
  return { toApply, toValidate };
}

export function selectKeyterms(glossary: GlossaryEntry[], threshold = 0.8): string[] {
  return Array.from(new Set(glossary.filter((entry) => entry.confidence >= threshold).map((entry) => entry.term)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/postprocess.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Re-export from the package entry point**

Append to `packages/lecture/src/index.ts`:
```ts
export * from "./postprocess.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/postprocess.ts packages/lecture/src/__tests__/postprocess.test.ts packages/lecture/src/index.ts
git commit -m "feat(lecture): add glossary merge/threshold post-processing"
```

---

## Task 6: Long-transcript windowing

**Files:**
- Create: `packages/lecture/src/windowing.ts`
- Test: `packages/lecture/src/__tests__/windowing.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment`, `LectureSection` from `./types.js`.
- Produces: `WINDOW_DURATION_MS`, `WINDOW_OVERLAP_MS`, `LONG_TRANSCRIPT_THRESHOLD_MS`, `needsWindowing(transcript: TranscriptSegment[]): boolean`, `splitIntoWindows(transcript: TranscriptSegment[], windowMs?: number, overlapMs?: number): TranscriptSegment[][]`, `mergePlans(plans: LectureSection[][]): LectureSection[]` — consumed by Task 7's `analyzePass1`.

- [ ] **Step 1: Write the failing test**

`packages/lecture/src/__tests__/windowing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { needsWindowing, splitIntoWindows, mergePlans, LONG_TRANSCRIPT_THRESHOLD_MS } from "../windowing.js";
import type { LectureSection, TranscriptSegment } from "../types.js";

function segment(startMs: number, endMs: number): TranscriptSegment {
  return { startMs, endMs, text: `segment ${startMs}`, confidence: 0.9 };
}

describe("needsWindowing", () => {
  it("is false for a 90-minute transcript", () => {
    expect(needsWindowing([segment(0, 90 * 60 * 1000)])).toBe(false);
  });

  it("is true past the 2h30 threshold", () => {
    expect(needsWindowing([segment(0, LONG_TRANSCRIPT_THRESHOLD_MS + 1000)])).toBe(true);
  });

  it("is false for an empty transcript", () => {
    expect(needsWindowing([])).toBe(false);
  });
});

describe("splitIntoWindows", () => {
  it("splits a 70-minute transcript into overlapping 30-minute windows", () => {
    const MIN = 60 * 1000;
    const transcript = [segment(0, 20 * MIN), segment(20 * MIN, 50 * MIN), segment(50 * MIN, 70 * MIN)];
    const windows = splitIntoWindows(transcript, 30 * MIN, 90 * 1000);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    // every window's segments actually fall in [windowStart, windowStart+30min)
    for (const window of windows) {
      expect(window.length).toBeGreaterThan(0);
    }
  });

  it("returns a single window for a short transcript", () => {
    const windows = splitIntoWindows([segment(0, 5 * 60 * 1000)]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(1);
  });

  it("returns no windows for an empty transcript", () => {
    expect(splitIntoWindows([])).toEqual([]);
  });
});

describe("mergePlans", () => {
  const baseSection: LectureSection = {
    index: 0,
    title: "Le contexte historique",
    startMs: 0,
    endMs: 60000,
    oneLineSummary: "Contexte",
    type: "content",
    confidence: 0.8,
  };

  it("concatenates non-overlapping sections from different windows in order", () => {
    const merged = mergePlans([
      [baseSection],
      [{ ...baseSection, title: "La suite", startMs: 60000, endMs: 120000, confidence: 0.7 }],
    ]);
    expect(merged.map((s) => s.title)).toEqual(["Le contexte historique", "La suite"]);
    expect(merged.map((s) => s.index)).toEqual([0, 1]);
  });

  it("drops a duplicate section re-detected in the overlap zone, keeping the higher-confidence copy", () => {
    const duplicateFromNextWindow: LectureSection = {
      ...baseSection,
      startMs: 55000,
      endMs: 90000,
      confidence: 0.95,
    };
    const merged = mergePlans([[baseSection], [duplicateFromNextWindow]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.95);
  });

  it("keeps sections of a different type even if they overlap in time", () => {
    const question: LectureSection = {
      ...baseSection,
      type: "student_question",
      title: "Question sur le contexte",
      startMs: 30000,
      endMs: 45000,
    };
    const merged = mergePlans([[baseSection], [question]]);
    expect(merged).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/windowing.test.ts`
Expected: FAIL — `Cannot find module '../windowing.js'`

- [ ] **Step 3: Write the implementation**

`packages/lecture/src/windowing.ts`:
```ts
import type { LectureSection, TranscriptSegment } from "./types.js";

export const WINDOW_DURATION_MS = 30 * 60 * 1000;
export const WINDOW_OVERLAP_MS = 90 * 1000;
export const LONG_TRANSCRIPT_THRESHOLD_MS = 2.5 * 60 * 60 * 1000;

function transcriptEndMs(transcript: TranscriptSegment[]): number {
  return transcript.reduce((max, segment) => Math.max(max, segment.endMs), 0);
}

export function needsWindowing(transcript: TranscriptSegment[]): boolean {
  if (transcript.length === 0) return false;
  return transcriptEndMs(transcript) > LONG_TRANSCRIPT_THRESHOLD_MS;
}

export function splitIntoWindows(
  transcript: TranscriptSegment[],
  windowMs = WINDOW_DURATION_MS,
  overlapMs = WINDOW_OVERLAP_MS
): TranscriptSegment[][] {
  if (transcript.length === 0) return [];
  const totalMs = transcriptEndMs(transcript);
  const step = windowMs - overlapMs;
  const windows: TranscriptSegment[][] = [];
  for (let windowStart = 0; windowStart < totalMs; windowStart += step) {
    const windowEnd = windowStart + windowMs;
    const segmentsInWindow = transcript.filter(
      (segment) => segment.startMs < windowEnd && segment.endMs > windowStart
    );
    if (segmentsInWindow.length > 0) windows.push(segmentsInWindow);
  }
  return windows;
}

function sectionsOverlap(a: LectureSection, b: LectureSection): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function titlesAreClose(a: string, b: string): boolean {
  const normalizedA = a.trim().toLowerCase();
  const normalizedB = b.trim().toLowerCase();
  return normalizedA === normalizedB || normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

export function mergePlans(plans: LectureSection[][]): LectureSection[] {
  const flatSorted = plans.flat().sort((a, b) => a.startMs - b.startMs);
  const merged: LectureSection[] = [];
  for (const section of flatSorted) {
    const duplicateIndex = merged.findIndex(
      (kept) => kept.type === section.type && sectionsOverlap(kept, section) && titlesAreClose(kept.title, section.title)
    );
    if (duplicateIndex === -1) {
      merged.push(section);
      continue;
    }
    if (section.confidence > merged[duplicateIndex].confidence) {
      merged[duplicateIndex] = { ...section, index: merged[duplicateIndex].index };
    }
  }
  return merged.map((section, index) => ({ ...section, index }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/windowing.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Re-export from the package entry point**

Append to `packages/lecture/src/index.ts`:
```ts
export * from "./windowing.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/windowing.ts packages/lecture/src/__tests__/windowing.test.ts packages/lecture/src/index.ts
git commit -m "feat(lecture): add long-transcript windowing and plan merge"
```

---

## Task 7: `analyzePass1` orchestration

**Files:**
- Create: `packages/lecture/src/analyze.ts`
- Test: `packages/lecture/src/__tests__/analyze.test.ts`

**Interfaces:**
- Consumes: `Pass1Input`, `Pass1Output` (Task 2); `buildPass1SystemPrompt`, `buildPass1UserPrompt`, `buildPass1RetryPrompt` (Task 4); `pass1OutputSchema`, `formatZodError` (Task 3); `needsWindowing`, `splitIntoWindows`, `mergePlans` (Task 6); `mergeGlossary`, `selectNewGlossaryEntries` (Task 5).
- Produces: `CallJSON` type, `analyzePass1(input: Pass1Input, callJSON: CallJSON): Promise<Pass1Output>` — consumed by the backend route in Task 8.

- [ ] **Step 1: Write the failing test**

`packages/lecture/src/__tests__/analyze.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { analyzePass1 } from "../analyze.js";
import type { Pass1Input, Pass1Output, TranscriptSegment } from "../types.js";

function segment(startMs: number, endMs: number, text = "texte"): TranscriptSegment {
  return { startMs, endMs, text, confidence: 0.9 };
}

const baseInput: Pass1Input = {
  transcript: [segment(0, 60000)],
  course: { title: "Cours test", language: "fr" },
  existingGlossary: [],
};

function validOutput(overrides: Partial<Pass1Output> = {}): Pass1Output {
  return {
    detectedLanguage: "fr",
    transcriptQuality: 0.8,
    plan: [],
    glossary: [],
    references: [],
    uncertainZones: [],
    ...overrides,
  };
}

describe("analyzePass1 — single call", () => {
  it("returns the parsed output on a valid first response", async () => {
    const callJSON = vi.fn().mockResolvedValueOnce(validOutput({ detectedLanguage: "fr" }));
    const result = await analyzePass1(baseInput, callJSON);
    expect(result.detectedLanguage).toBe("fr");
    expect(callJSON).toHaveBeenCalledTimes(1);
  });

  it("retries once with the zod error appended when the first response is invalid", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ ...validOutput(), transcriptQuality: 5 })
      .mockResolvedValueOnce(validOutput({ detectedLanguage: "fr" }));
    const result = await analyzePass1(baseInput, callJSON);
    expect(result.detectedLanguage).toBe("fr");
    expect(callJSON).toHaveBeenCalledTimes(2);
    const retryUserPrompt = callJSON.mock.calls[1][1] as string;
    expect(retryUserPrompt).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });

  it("throws an explicit error when the retry also fails validation", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ bad: "shape" })
      .mockResolvedValueOnce({ bad: "still shape" });
    await expect(analyzePass1(baseInput, callJSON)).rejects.toThrow(/Pass 1 analysis failed/);
    expect(callJSON).toHaveBeenCalledTimes(2);
  });
});

describe("analyzePass1 — windowing", () => {
  it("splits a long transcript into multiple windowed calls and consolidates the glossary", async () => {
    const LONG_MS = 3 * 60 * 60 * 1000; // 3h, above the 2h30 threshold
    const longInput: Pass1Input = {
      ...baseInput,
      transcript: [segment(0, LONG_MS)],
    };
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce(
        validOutput({
          glossary: [{ term: "midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.7 }],
        })
      )
      .mockResolvedValue(validOutput());

    const result = await analyzePass1(longInput, callJSON);
    expect(callJSON.mock.calls.length).toBeGreaterThan(1);
    expect(result.glossary.some((entry) => entry.term === "midrash")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/analyze.test.ts`
Expected: FAIL — `Cannot find module '../analyze.js'`

- [ ] **Step 3: Write the implementation**

`packages/lecture/src/analyze.ts`:
```ts
import type { Pass1Input, Pass1Output } from "./types.js";
import { buildPass1SystemPrompt, buildPass1UserPrompt, buildPass1RetryPrompt } from "./prompts.js";
import { pass1OutputSchema, formatZodError } from "./schemas.js";
import { needsWindowing, splitIntoWindows, mergePlans } from "./windowing.js";
import { mergeGlossary, selectNewGlossaryEntries } from "./postprocess.js";

export type CallJSON = (system: string, user: string) => Promise<unknown>;

async function analyzeSingleCall(input: Pass1Input, callJSON: CallJSON): Promise<Pass1Output> {
  const system = buildPass1SystemPrompt();
  const userPrompt = buildPass1UserPrompt(input);

  const first = await callJSON(system, userPrompt);
  const firstResult = pass1OutputSchema.safeParse(first);
  if (firstResult.success) return firstResult.data;

  const retryPrompt = buildPass1RetryPrompt(userPrompt, formatZodError(firstResult.error));
  const second = await callJSON(system, retryPrompt);
  const secondResult = pass1OutputSchema.safeParse(second);
  if (secondResult.success) return secondResult.data;

  throw new Error(`Pass 1 analysis failed after retry: ${formatZodError(secondResult.error)}`);
}

export async function analyzePass1(input: Pass1Input, callJSON: CallJSON): Promise<Pass1Output> {
  if (!needsWindowing(input.transcript)) {
    return analyzeSingleCall(input, callJSON);
  }

  const windows = splitIntoWindows(input.transcript);
  let consolidatedGlossary = input.existingGlossary;
  const plans: Pass1Output["plan"][] = [];
  const allReferences: Pass1Output["references"] = [];
  const allUncertainZones: Pass1Output["uncertainZones"] = [];
  const qualityScores: number[] = [];
  let detectedLanguage = input.course.language;

  for (const windowSegments of windows) {
    const windowOutput = await analyzeSingleCall(
      { ...input, transcript: windowSegments, existingGlossary: consolidatedGlossary },
      callJSON
    );
    consolidatedGlossary = mergeGlossary(consolidatedGlossary, windowOutput.glossary);
    plans.push(windowOutput.plan);
    allReferences.push(...windowOutput.references);
    allUncertainZones.push(...windowOutput.uncertainZones);
    qualityScores.push(windowOutput.transcriptQuality);
    detectedLanguage = windowOutput.detectedLanguage;
  }

  return {
    detectedLanguage,
    transcriptQuality: qualityScores.reduce((sum, quality) => sum + quality, 0) / qualityScores.length,
    plan: mergePlans(plans),
    glossary: selectNewGlossaryEntries(input.existingGlossary, consolidatedGlossary),
    references: allReferences,
    uncertainZones: allUncertainZones,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/analyze.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Re-export from the package entry point, run the full package suite**

Append to `packages/lecture/src/index.ts`:
```ts
export * from "./analyze.js";
```

Run: `cd packages/lecture && npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/analyze.ts packages/lecture/src/__tests__/analyze.test.ts packages/lecture/src/index.ts
git commit -m "feat(lecture): add analyzePass1 orchestration with retry and windowing"
```

---

## Task 8: Wire into the backend

**Files:**
- Modify: `apps/backend/src/llm.ts:70-88` (`callClaudeJSON`)
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/package.json` (add `@voxhelp/lecture` dependency)
- Test: `apps/backend/src/__tests__/lecture-pass1.test.ts`

**Interfaces:**
- Consumes: `analyzePass1`, `Pass1Input` from `@voxhelp/lecture` (Task 7); existing `supabaseAdmin` from `./supabase.js`.
- Produces: `POST /api/lecture/analyze-pass1` route; `callClaudeJSON` gains an optional 5th `temperature` parameter (backward compatible — all existing call sites keep working unchanged).

- [ ] **Step 1: Add the backend dependency**

In `apps/backend/package.json`, add to `dependencies` (alphabetical, next to `@fastify/websocket`):
```json
"@voxhelp/lecture": "workspace:*",
```

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Extend `callClaudeJSON` with an optional temperature**

In `apps/backend/src/llm.ts`, replace:
```ts
export async function callClaudeJSON<T>(
  systemPrompt: string,
  userMessage: string,
  model = "claude-haiku-4-5",
  maxTokens = 4096
): Promise<T> {
  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
```
with:
```ts
export async function callClaudeJSON<T>(
  systemPrompt: string,
  userMessage: string,
  model = "claude-haiku-4-5",
  maxTokens = 4096,
  temperature?: number
): Promise<T> {
  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    ...(temperature !== undefined ? { temperature } : {}),
  });
```

- [ ] **Step 3: Verify existing backend tests still pass unchanged**

Run: `cd apps/backend && npx vitest run src/__tests__/extract-cv-keywords.test.ts src/__tests__/extract-cv-keywords-auth.test.ts`
Expected: PASS — confirms the new optional param doesn't break existing call sites.

- [ ] **Step 4: Write the failing route test**

`apps/backend/src/__tests__/lecture-pass1.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockCallClaudeJSON = vi.hoisted(() => vi.fn());

vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function validPass1Output() {
  return {
    detectedLanguage: "fr",
    transcriptQuality: 0.8,
    plan: [],
    glossary: [],
    references: [],
    uncertainZones: [],
  };
}

function validBody() {
  return {
    transcript: [{ startMs: 0, endMs: 4000, text: "Alors on commence.", confidence: 0.9 }],
    course: { title: "Cours test", language: "fr" },
    existingGlossary: [],
  };
}

describe("POST /api/lecture/analyze-pass1", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockCallClaudeJSON.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the analysis for a valid request", async () => {
    server = await createTestHttpServer();
    mockCallClaudeJSON.mockResolvedValueOnce(validPass1Output());

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detectedLanguage).toBe("fr");
    expect(mockCallClaudeJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "claude-sonnet-4-6",
      8192,
      0
    );
  });

  it("returns 400 when the transcript is missing", async () => {
    server = await createTestHttpServer();
    const { transcript, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockCallClaudeJSON).not.toHaveBeenCalled();
  });

  it("returns 400 when the course context is missing", async () => {
    server = await createTestHttpServer();
    const { course, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when the analysis fails validation twice", async () => {
    server = await createTestHttpServer();
    mockCallClaudeJSON.mockResolvedValue({ bad: "shape" });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-pass1.test.ts`
Expected: FAIL — 404 (route doesn't exist yet)

- [ ] **Step 6: Add the route**

In `apps/backend/src/routes.ts`, add the import at the top:
```ts
import { analyzePass1, type Pass1Input } from "@voxhelp/lecture";
```

Add inside `registerRoutes`, after the existing `/api/extract-cv-keywords` handler:
```ts
  app.post("/api/lecture/analyze-pass1", async (request, reply) => {
    if (supabaseAdmin) {
      const auth = request.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) {
        return reply.code(401).send({ error: "Missing token" });
      }
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        return reply.code(401).send({ error: "Invalid token" });
      }
    }

    const body = request.body as Partial<Pass1Input> | undefined;
    if (!body || !Array.isArray(body.transcript) || body.transcript.length === 0 || !body.course) {
      return reply.code(400).send({ error: "Missing transcript or course context" });
    }

    const input: Pass1Input = {
      transcript: body.transcript,
      course: body.course,
      existingGlossary: Array.isArray(body.existingGlossary) ? body.existingGlossary : [],
    };

    try {
      const output = await analyzePass1(input, (system, user) =>
        callClaudeJSON(system, user, "claude-sonnet-4-6", 8192, 0)
      );
      return reply.send(output);
    } catch (err) {
      console.error("[Routes] Lecture pass1 analysis failed:", err instanceof Error ? err.message : err);
      return reply.code(502).send({ error: "Lecture analysis failed" });
    }
  });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-pass1.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: Run the full backend suite and typecheck**

Run: `cd apps/backend && npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/llm.ts apps/backend/src/routes.ts apps/backend/src/__tests__/lecture-pass1.test.ts apps/backend/package.json pnpm-lock.yaml
git commit -m "feat(backend): expose POST /api/lecture/analyze-pass1"
```

---

## Task 9: Whole-repo verification and cleanup

**Files:**
- Delete: `voxhelp-verticale-cours-passe1.md` (repo root)

**Interfaces:** none — verification only.

- [ ] **Step 1: Run every workspace test suite**

Run: `pnpm --filter @voxhelp/lecture test && pnpm --filter @voxhelp/backend test`
Expected: all green.

- [ ] **Step 2: Typecheck every workspace package**

Run: `cd packages/lecture && npx tsc --noEmit && cd ../../apps/backend && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: no errors anywhere (the web app is untouched by this work, confirming no accidental breakage).

- [ ] **Step 3: Delete the source spec file now that it's implemented**

```bash
git rm voxhelp-verticale-cours-passe1.md
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(lecture): remove implemented pass 1 spec doc"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (context) → informs package boundary decision (Task 1); §2 (pipeline) → windowing/glossary-loop reflected in Task 6/7; §3.1–3.2 (prompts) → Task 4; §3.3 (schema) → Task 3; §3.4 (post-processing) → Task 5 + `analyzePass1`'s use of `selectNewGlossaryEntries`; §3.5 (long transcripts) → Task 6; §4 (acceptance criteria) → covered by schema strictness (no invention), `foreign_term`/`sourceLanguage` fields, Zod-validated JSON parse. §5 (out of scope: pass 2, audio capture, real-time, PDF export) → deliberately not built.
- Backend persistence of `Course`/`Lecture` records and the Deepgram Nova-3 batch integration are **not** part of this plan: the spec's own §5 scopes audio capture out, and §3's `Pass1Input.existingGlossary` is an explicit function parameter (the caller — a future persistence layer — supplies it), so Pass 1 itself has no DB dependency to build.
- Type consistency checked: `Pass1Input`/`Pass1Output`/`GlossaryEntry`/`LectureSection` field names are identical across `types.ts`, `schemas.ts`, `prompts.ts`, `postprocess.ts`, `windowing.ts`, and `analyze.ts`.
