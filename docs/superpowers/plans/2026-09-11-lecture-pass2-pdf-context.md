# Lecture Pass 2 (Rewrite) + PDF Context Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pass 2 (transcript rewriting into a clean Markdown course document) and PDF course-support ingestion to the `packages/lecture` "cours" vertical, building on the existing Pass 1 implementation.

**Architecture:** Two new independent sub-modules inside `packages/lecture/src/` — `pdf/` (PDF text extraction + typed-block segmentation via LLM) and `pass2/` (single-call streamed rewrite consuming Pass 1 output + optional PDF blocks). Two new stateless Fastify routes expose them. No persistence, no live mode — matches the existing Pass 1 architecture exactly.

**Tech Stack:** TypeScript strict/ESM, Zod (schema validation), `unpdf` (PDF text extraction, already used in `packages/recruit/src/cv-parser.ts`), `@anthropic-ai/sdk` via the existing `apps/backend/src/llm.ts` helpers, Fastify 5 + `@fastify/multipart`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-lecture-pass2-pdf-context-design.md`

## Global Constraints

- Post-hoc only — no live/real-time mode for this vertical.
- Stateless — no `Course`/`Lecture`/`PdfAnalysis` persistence in any database.
- One PDF support file per course in this iteration (no multi-PDF handling).
- PDF `citation`/`table`/`exercise` blocks are never reformulated — inserted verbatim. `heading`/`paragraph` blocks are context-only, never copied into the output.
- PDF analysis: `claude-sonnet-4-6`, `temperature: 0` (extraction task, same policy as Pass 1), single retry on Zod validation failure, then explicit failure (no retry loop).
- Pass 2 rewrite: `claude-sonnet-4-6`, `temperature: 0.3`, single LLM call for the whole document (no per-section chunking, no sliding context), streamed as Markdown text — no Zod validation of the output (free text, not JSON).
- Uncertain zones render as an inline literal marker `[passage incertain — {reason}]` — never guessed/invented text.
- PDF-anchor matching to Pass 1 plan section titles happens entirely inside the Pass 2 prompt (the PDF analysis step does not see the plan).

---

## Task 1: Extend `streamAssist` with configurable `maxTokens` and `temperature`

Pass 2 needs to stream a potentially long document (full 90-120 min course) at `temperature: 0.3`, but the existing `streamAssist` in `apps/backend/src/llm.ts` hardcodes `max_tokens: 1024` and never passes `temperature`. Both new parameters must default to the current behavior so the two existing call sites in `apps/backend/src/session.ts` (lines 251 and 394) keep working unchanged.

**Files:**
- Modify: `apps/backend/src/llm.ts:78-99` (the `streamAssist` function)
- Test: `apps/backend/src/__tests__/llm-stream-assist.test.ts` (create)

**Interfaces:**
- Produces: `streamAssist(systemPrompt: string, userMessage: string, onChunk: (text: string) => void, model = "claude-haiku-4-5", maxTokens = 1024, temperature?: number): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/__tests__/llm-stream-assist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn(), stream: mockStream };
  },
}));

const { streamAssist } = await import("../llm.js");

function fakeStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: chunk } };
      }
    },
  };
}

describe("streamAssist", () => {
  beforeEach(() => mockStream.mockReset());

  it("passes a custom model, maxTokens and temperature through to the Anthropic stream call", async () => {
    mockStream.mockReturnValueOnce(fakeStream(["Bon", "jour"]));
    const chunks: string[] = [];

    const result = await streamAssist(
      "sys",
      "user",
      (c) => chunks.push(c),
      "claude-sonnet-4-6",
      8192,
      0.3
    );

    expect(result).toBe("Bonjour");
    expect(chunks).toEqual(["Bon", "jour"]);
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6", max_tokens: 8192, temperature: 0.3 })
    );
  });

  it("defaults maxTokens to 1024 and omits temperature when not provided", async () => {
    mockStream.mockReturnValueOnce(fakeStream(["Bonjour"]));

    await streamAssist("sys", "user", () => {});

    const callArgs = mockStream.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.max_tokens).toBe(1024);
    expect(callArgs).not.toHaveProperty("temperature");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/llm-stream-assist.test.ts`
Expected: FAIL — `streamAssist` currently ignores the 5th/6th arguments and always sends `max_tokens: 1024` with no `temperature`, so the first test's `objectContaining` assertion fails.

- [ ] **Step 3: Update `streamAssist`**

In `apps/backend/src/llm.ts`, replace the existing `streamAssist` function with:

```ts
export async function streamAssist(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  model = "claude-haiku-4-5",
  maxTokens = 1024,
  temperature?: number
): Promise<string> {
  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    ...(temperature !== undefined ? { temperature } : {}),
  });

  let fullText = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const chunk = event.delta.text;
      fullText += chunk;
      onChunk(chunk);
    }
  }
  return fullText;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/llm-stream-assist.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — the two existing `streamAssist` call sites in `session.ts` are unaffected since they only pass 4 arguments.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/llm.ts apps/backend/src/__tests__/llm-stream-assist.test.ts
git commit -m "feat(backend): let streamAssist take configurable maxTokens and temperature"
```

---

## Task 2: PDF domain types and Zod schema

**Files:**
- Create: `packages/lecture/src/pdf/types.ts`
- Create: `packages/lecture/src/pdf/schemas.ts`
- Test: `packages/lecture/src/__tests__/pdf-schemas.test.ts`

**Interfaces:**
- Produces: `PdfBlockType`, `PdfBlock`, `PdfAnalysis`, `PdfPage` (types), `pdfAnalysisSchema` (Zod schema), `parsePdfAnalysis(raw: unknown): PdfAnalysis`
- Consumes: `formatZodError` from `packages/lecture/src/schemas.ts` (already exists, used by later tasks — not by this one)

- [ ] **Step 1: Write the failing test**

Create `packages/lecture/src/__tests__/pdf-schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pdfAnalysisSchema, parsePdfAnalysis } from "../pdf/schemas.js";

const validAnalysis = {
  sourceFilename: "theologie-nt.pdf",
  blocks: [
    { page: 1, type: "heading", anchorTitle: "Le Nouveau Testament dans la Bible", content: "Le Nouveau Testament dans la Bible" },
    { page: 3, type: "paragraph", content: "Si vous êtes protestant, vous disposez peut-être de la Bible Segond..." },
    { page: 7, type: "citation", reference: "Romains 1,1-4", content: "1. Paul, serviteur de Jésus Christ..." },
    { page: 2, type: "table", content: "BIBLE RABBINIQUE | SEPTANTE | ..." },
    { page: 5, type: "exercise", content: "1. Le texte évoque d'abord un événement marquant..." },
  ],
};

describe("pdfAnalysisSchema", () => {
  it("parses a valid PdfAnalysis", () => {
    expect(() => parsePdfAnalysis(validAnalysis)).not.toThrow();
    expect(parsePdfAnalysis(validAnalysis).blocks[0].type).toBe("heading");
  });

  it("rejects an invalid block type", () => {
    const invalid = { ...validAnalysis, blocks: [{ page: 1, type: "banter", content: "x" }] };
    expect(() => parsePdfAnalysis(invalid)).toThrow();
  });

  it("rejects a non-positive page number", () => {
    const invalid = { ...validAnalysis, blocks: [{ page: 0, type: "paragraph", content: "x" }] };
    expect(() => parsePdfAnalysis(invalid)).toThrow();
  });

  it("rejects an empty content string", () => {
    const invalid = { ...validAnalysis, blocks: [{ page: 1, type: "paragraph", content: "" }] };
    expect(() => parsePdfAnalysis(invalid)).toThrow();
  });

  it("accepts blocks without anchorTitle or reference", () => {
    const minimal = { sourceFilename: "f.pdf", blocks: [{ page: 1, type: "paragraph", content: "texte" }] };
    expect(() => parsePdfAnalysis(minimal)).not.toThrow();
  });

  it("safeParse reports failure without throwing", () => {
    const result = pdfAnalysisSchema.safeParse({ ...validAnalysis, sourceFilename: "" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-schemas.test.ts`
Expected: FAIL with "Cannot find module '../pdf/schemas.js'"

- [ ] **Step 3: Write the types**

Create `packages/lecture/src/pdf/types.ts`:

```ts
export type PdfBlockType = "heading" | "paragraph" | "citation" | "table" | "exercise";

export interface PdfBlock {
  page: number;
  type: PdfBlockType;
  anchorTitle?: string;
  content: string;
  reference?: string;
}

export interface PdfAnalysis {
  sourceFilename: string;
  blocks: PdfBlock[];
}

export interface PdfPage {
  page: number;
  text: string;
}
```

- [ ] **Step 4: Write the schema**

Create `packages/lecture/src/pdf/schemas.ts`:

```ts
import { z } from "zod";
import type { PdfAnalysis } from "./types.js";

const pdfBlockTypeSchema = z.enum(["heading", "paragraph", "citation", "table", "exercise"]);

const pdfBlockSchema = z.object({
  page: z.number().int().positive(),
  type: pdfBlockTypeSchema,
  anchorTitle: z.string().optional(),
  content: z.string().min(1),
  reference: z.string().optional(),
});

export const pdfAnalysisSchema = z.object({
  sourceFilename: z.string().min(1),
  blocks: z.array(pdfBlockSchema),
});

export function parsePdfAnalysis(raw: unknown): PdfAnalysis {
  return pdfAnalysisSchema.parse(raw) as PdfAnalysis;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-schemas.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/pdf/types.ts packages/lecture/src/pdf/schemas.ts packages/lecture/src/__tests__/pdf-schemas.test.ts
git commit -m "feat(lecture): add PDF block domain types and zod schema"
```

---

## Task 3: PDF analysis prompts

**Files:**
- Create: `packages/lecture/src/pdf/prompts.ts`
- Test: `packages/lecture/src/__tests__/pdf-prompts.test.ts`

**Interfaces:**
- Consumes: `PdfPage` from `packages/lecture/src/pdf/types.ts` (Task 2)
- Produces: `buildPdfAnalysisSystemPrompt(): string`, `buildPdfAnalysisUserPrompt(sourceFilename: string, pages: PdfPage[]): string`, `buildPdfAnalysisRetryPrompt(previousUserPrompt: string, zodErrorMessage: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/lecture/src/__tests__/pdf-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildPdfAnalysisSystemPrompt,
  buildPdfAnalysisUserPrompt,
  buildPdfAnalysisRetryPrompt,
} from "../pdf/prompts.js";
import type { PdfPage } from "../pdf/types.js";

const pages: PdfPage[] = [
  { page: 1, text: "Introduction à la Bible : Nouveau Testament" },
  { page: 7, text: "Romains 1, versets 1-4\n1. Paul, serviteur de Jésus Christ..." },
];

describe("buildPdfAnalysisSystemPrompt", () => {
  it("instructs segmentation only, never reformulating citation/table/exercise blocks", () => {
    const prompt = buildPdfAnalysisSystemPrompt();
    expect(prompt).toContain("Ne reformule jamais un bloc");
  });

  it("lists all five block types", () => {
    const prompt = buildPdfAnalysisSystemPrompt();
    for (const type of ["heading", "paragraph", "citation", "table", "exercise"]) {
      expect(prompt).toContain(type);
    }
  });

  it("forbids inventing a reference and requires strict JSON", () => {
    const prompt = buildPdfAnalysisSystemPrompt();
    expect(prompt).toContain("N'invente jamais de");
    expect(prompt).toContain("uniquement par un objet JSON valide");
  });
});

describe("buildPdfAnalysisUserPrompt", () => {
  it("includes the filename and each page's text with its page number", () => {
    const prompt = buildPdfAnalysisUserPrompt("theologie-nt.pdf", pages);
    expect(prompt).toContain("theologie-nt.pdf");
    expect(prompt).toContain("[page 1]");
    expect(prompt).toContain("Introduction à la Bible");
    expect(prompt).toContain("[page 7]");
    expect(prompt).toContain("Romains 1, versets 1-4");
  });
});

describe("buildPdfAnalysisRetryPrompt", () => {
  it("appends the zod error message to the previous prompt", () => {
    const retry = buildPdfAnalysisRetryPrompt("PREVIOUS PROMPT", "blocks.0.type: Invalid enum value");
    expect(retry).toContain("PREVIOUS PROMPT");
    expect(retry).toContain("blocks.0.type: Invalid enum value");
    expect(retry).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-prompts.test.ts`
Expected: FAIL with "Cannot find module '../pdf/prompts.js'"

- [ ] **Step 3: Write the prompts**

Create `packages/lecture/src/pdf/prompts.ts`:

```ts
import type { PdfPage } from "./types.js";

export function buildPdfAnalysisSystemPrompt(): string {
  return `Tu es un analyste de supports de cours (PDF de slides ou de polycopié) utilisés
en complément d'un cours universitaire enregistré.

Ton rôle est UNIQUEMENT de segmenter et classer le contenu du PDF en blocs.
Tu ne résumes rien, tu ne reformules aucun passage, tu ne combles aucune lacune.

Pour chaque bloc de contenu identifiable dans le texte extrait, donne :
- la page où il se trouve
- son type :
  - "heading" : titre de section ou de diapositive
  - "paragraph" : texte explicatif courant
  - "citation" : citation de texte source (Écritures, œuvre citée verbatim),
    à préserver mot pour mot avec sa référence si identifiable
  - "table" : contenu tabulaire, à préserver tel quel
  - "exercise" : question(s) ou exercice destiné aux étudiants
- pour un bloc "heading" uniquement : le titre détecté verbatim dans
  "anchorTitle" (il servira d'ancre pour rapprocher ce point du plan du
  cours dans une étape ultérieure)
- pour un bloc "citation" uniquement, si identifiable avec certitude : la
  référence normalisée dans "reference" (ex: "Romains 1,1-4")
- le contenu du bloc verbatim dans "content" — pour "citation", "table" et
  "exercise", recopie fidèlement, sans reformuler ni résumer

RÈGLES ABSOLUES :

- Ne reformule jamais un bloc "citation", "table" ou "exercise". La fidélité
  du contenu source prime sur tout.
- N'invente jamais de "reference" si tu ne peux pas l'identifier avec
  certitude — omets le champ plutôt que de deviner.
- Un tableau complexe (comparatif, multi-colonnes) reste un seul bloc
  "table", même s'il est long : ne le découpe pas artificiellement en
  plusieurs blocs.
- Réponds uniquement par un objet JSON valide, sans texte avant ou après,
  sans balises Markdown, ayant EXACTEMENT cette forme :

{
  "sourceFilename": "nom du fichier",
  "blocks": [
    {
      "page": 1,
      "type": "heading | paragraph | citation | table | exercise",
      "anchorTitle": "titre détecté, uniquement si type = heading",
      "content": "contenu du bloc",
      "reference": "référence normalisée, uniquement si type = citation et identifiable"
    }
  ]
}

Les champs "anchorTitle" et "reference" sont à omettre entièrement (pas de
null, pas de chaîne vide) quand ils ne s'appliquent pas.`;
}

function formatPages(pages: PdfPage[]): string {
  return pages.map((page) => `[page ${page.page}] ${page.text}`).join("\n\n");
}

export function buildPdfAnalysisUserPrompt(sourceFilename: string, pages: PdfPage[]): string {
  return `FICHIER : ${sourceFilename}

CONTENU EXTRAIT PAR PAGE
${formatPages(pages)}

Produis ta segmentation au format JSON défini.`;
}

export function buildPdfAnalysisRetryPrompt(previousUserPrompt: string, zodErrorMessage: string): string {
  return `${previousUserPrompt}

TA RÉPONSE PRÉCÉDENTE N'A PAS PU ÊTRE VALIDÉE. Erreurs de format :
${zodErrorMessage}

Corrige ta réponse et retourne à nouveau un JSON strict respectant exactement le schéma demandé.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-prompts.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/lecture/src/pdf/prompts.ts packages/lecture/src/__tests__/pdf-prompts.test.ts
git commit -m "feat(lecture): add pdf analysis prompt builders"
```

---

## Task 4: PDF text extraction (unpdf wrapper)

**Files:**
- Create: `packages/lecture/src/pdf/extract-text.ts`
- Test: `packages/lecture/src/__tests__/pdf-extract-text.test.ts`

**Interfaces:**
- Consumes: `PdfPage` from `packages/lecture/src/pdf/types.ts` (Task 2)
- Produces: `extractPdfPages(buffer: Buffer): Promise<PdfPage[]>`

- [ ] **Step 1: Add the `unpdf` dependency**

`unpdf` is already a dependency of `@voxhelp/recruit`, not of `@voxhelp/lecture`. Add it:

```bash
pnpm --filter @voxhelp/lecture add unpdf
```

- [ ] **Step 2: Write the failing test**

Create `packages/lecture/src/__tests__/pdf-extract-text.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDocumentProxy = vi.hoisted(() => vi.fn());
const mockExtractText = vi.hoisted(() => vi.fn());

vi.mock("unpdf", () => ({
  getDocumentProxy: mockGetDocumentProxy,
  extractText: mockExtractText,
}));

const { extractPdfPages } = await import("../pdf/extract-text.js");

describe("extractPdfPages", () => {
  beforeEach(() => {
    mockGetDocumentProxy.mockReset();
    mockExtractText.mockReset();
  });

  it("maps unpdf's per-page text array to PdfPage[] with 1-based page numbers", async () => {
    const fakeProxy = { id: "fake-pdf-proxy" };
    mockGetDocumentProxy.mockResolvedValueOnce(fakeProxy);
    mockExtractText.mockResolvedValueOnce({
      totalPages: 3,
      text: ["Page un.", "Page deux.", "Page trois."],
    });

    const pages = await extractPdfPages(Buffer.from("fake pdf bytes"));

    expect(mockExtractText).toHaveBeenCalledWith(fakeProxy, { mergePages: false });
    expect(pages).toEqual([
      { page: 1, text: "Page un." },
      { page: 2, text: "Page deux." },
      { page: 3, text: "Page trois." },
    ]);
  });

  it("returns an empty array for a PDF with no extractable text", async () => {
    mockGetDocumentProxy.mockResolvedValueOnce({});
    mockExtractText.mockResolvedValueOnce({ totalPages: 0, text: [] });

    const pages = await extractPdfPages(Buffer.from("fake pdf bytes"));

    expect(pages).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-extract-text.test.ts`
Expected: FAIL with "Cannot find module '../pdf/extract-text.js'"

- [ ] **Step 4: Write the extraction wrapper**

Create `packages/lecture/src/pdf/extract-text.ts`:

```ts
import { extractText, getDocumentProxy } from "unpdf";
import type { PdfPage } from "./types.js";

export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  return result.text.map((text, index) => ({ page: index + 1, text }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-extract-text.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/package.json pnpm-lock.yaml packages/lecture/src/pdf/extract-text.ts packages/lecture/src/__tests__/pdf-extract-text.test.ts
git commit -m "feat(lecture): add unpdf-based per-page PDF text extraction"
```

---

## Task 5: PDF analysis orchestration + module exports

**Files:**
- Create: `packages/lecture/src/pdf/analyze-pdf.ts`
- Create: `packages/lecture/src/pdf/index.ts`
- Modify: `packages/lecture/src/index.ts`
- Test: `packages/lecture/src/__tests__/pdf-analyze.test.ts`

**Interfaces:**
- Consumes: `PdfAnalysis`, `PdfPage` (Task 2), `buildPdfAnalysisSystemPrompt`, `buildPdfAnalysisUserPrompt`, `buildPdfAnalysisRetryPrompt` (Task 3), `pdfAnalysisSchema` (Task 2), `formatZodError` from `packages/lecture/src/schemas.ts` (already exists)
- Produces: `type CallJSON = (system: string, user: string) => Promise<unknown>`, `analyzePdf(sourceFilename: string, pages: PdfPage[], callJSON: CallJSON): Promise<PdfAnalysis>` — this is what Task 7 (the backend route) calls.

- [ ] **Step 1: Write the failing test**

Create `packages/lecture/src/__tests__/pdf-analyze.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzePdf } from "../pdf/analyze-pdf.js";
import type { PdfAnalysis, PdfPage } from "../pdf/types.js";

const pages: PdfPage[] = [{ page: 1, text: "Introduction à la Bible" }];

function validOutput(overrides: Partial<PdfAnalysis> = {}): PdfAnalysis {
  return {
    sourceFilename: "cours.pdf",
    blocks: [{ page: 1, type: "heading", anchorTitle: "Introduction à la Bible", content: "Introduction à la Bible" }],
    ...overrides,
  };
}

describe("analyzePdf — single call", () => {
  it("returns the parsed analysis on a valid first response", async () => {
    const callJSON = vi.fn().mockResolvedValueOnce(validOutput());
    const result = await analyzePdf("cours.pdf", pages, callJSON);
    expect(result.blocks).toHaveLength(1);
    expect(callJSON).toHaveBeenCalledTimes(1);
  });

  it("retries once with the zod error appended when the first response is invalid", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ sourceFilename: "cours.pdf", blocks: [{ page: 1, type: "banter", content: "x" }] })
      .mockResolvedValueOnce(validOutput());
    const result = await analyzePdf("cours.pdf", pages, callJSON);
    expect(result.blocks[0].type).toBe("heading");
    expect(callJSON).toHaveBeenCalledTimes(2);
    const retryUserPrompt = callJSON.mock.calls[1][1] as string;
    expect(retryUserPrompt).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });

  it("throws an explicit error when the retry also fails validation", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ bad: "shape" })
      .mockResolvedValueOnce({ bad: "still shape" });
    await expect(analyzePdf("cours.pdf", pages, callJSON)).rejects.toThrow(/PDF analysis failed/);
    expect(callJSON).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-analyze.test.ts`
Expected: FAIL with "Cannot find module '../pdf/analyze-pdf.js'"

- [ ] **Step 3: Write the orchestration**

Create `packages/lecture/src/pdf/analyze-pdf.ts`:

```ts
import type { PdfAnalysis, PdfPage } from "./types.js";
import { buildPdfAnalysisSystemPrompt, buildPdfAnalysisUserPrompt, buildPdfAnalysisRetryPrompt } from "./prompts.js";
import { pdfAnalysisSchema } from "./schemas.js";
import { formatZodError } from "../schemas.js";

export type CallJSON = (system: string, user: string) => Promise<unknown>;

export async function analyzePdf(
  sourceFilename: string,
  pages: PdfPage[],
  callJSON: CallJSON
): Promise<PdfAnalysis> {
  const system = buildPdfAnalysisSystemPrompt();
  const userPrompt = buildPdfAnalysisUserPrompt(sourceFilename, pages);

  const first = await callJSON(system, userPrompt);
  const firstResult = pdfAnalysisSchema.safeParse(first);
  if (firstResult.success) return firstResult.data;

  const retryPrompt = buildPdfAnalysisRetryPrompt(userPrompt, formatZodError(firstResult.error));
  const second = await callJSON(system, retryPrompt);
  const secondResult = pdfAnalysisSchema.safeParse(second);
  if (secondResult.success) return secondResult.data;

  throw new Error(`PDF analysis failed after retry: ${formatZodError(secondResult.error)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/pdf-analyze.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the module exports**

Create `packages/lecture/src/pdf/index.ts`:

```ts
export * from "./types.js";
export * from "./schemas.js";
export * from "./prompts.js";
export * from "./extract-text.js";
export * from "./analyze-pdf.js";
```

Modify `packages/lecture/src/index.ts` to add one line at the end:

```ts
export * from "./types.js";
export * from "./schemas.js";
export * from "./prompts.js";
export * from "./postprocess.js";
export * from "./windowing.js";
export * from "./analyze.js";
export * from "./pdf/index.js";
```

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/lecture && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Run the full lecture package test suite**

Run: `cd packages/lecture && npx vitest run`
Expected: PASS (all tests, including Tasks 2-5's new tests)

- [ ] **Step 8: Commit**

```bash
git add packages/lecture/src/pdf/analyze-pdf.ts packages/lecture/src/pdf/index.ts packages/lecture/src/index.ts packages/lecture/src/__tests__/pdf-analyze.test.ts
git commit -m "feat(lecture): add pdf analysis orchestration with retry, wire pdf module exports"
```

---

## Task 6: Backend route `POST /api/lecture/analyze-pdf`

**Files:**
- Modify: `apps/backend/src/routes.ts`
- Test: `apps/backend/src/__tests__/lecture-pdf.test.ts`

**Interfaces:**
- Consumes: `extractPdfPages`, `analyzePdf` from `@voxhelp/lecture` (Tasks 4-5), `callClaudeJSON` from `./llm.js` (existing)
- Produces: the route `POST /api/lecture/analyze-pdf`, multipart file upload → `PdfAnalysis` JSON response

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/__tests__/lecture-pdf.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockExtractPdfPages = vi.hoisted(() => vi.fn());
const mockCallClaudeJSON = vi.hoisted(() => vi.fn());

vi.mock("@voxhelp/lecture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@voxhelp/lecture")>()),
  extractPdfPages: mockExtractPdfPages,
}));
vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function buildForm(mimetype: string, filename: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("fake pdf content")], { type: mimetype }), filename);
  return form;
}

function validPdfAnalysis() {
  return {
    sourceFilename: "cours.pdf",
    blocks: [{ page: 1, type: "heading", anchorTitle: "Introduction", content: "Introduction" }],
  };
}

describe("POST /api/lecture/analyze-pdf", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockExtractPdfPages.mockReset();
    mockCallClaudeJSON.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the pdf analysis for a valid PDF upload", async () => {
    server = await createTestHttpServer();
    mockExtractPdfPages.mockResolvedValueOnce([{ page: 1, text: "Introduction" }]);
    mockCallClaudeJSON.mockResolvedValueOnce(validPdfAnalysis());

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("application/pdf", "cours.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blocks).toHaveLength(1);
    expect(mockCallClaudeJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "claude-sonnet-4-6",
      8192,
      0
    );
  });

  it("rejects a non-PDF upload with 400", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("text/plain", "notes.txt"),
    });

    expect(res.status).toBe(400);
    expect(mockExtractPdfPages).not.toHaveBeenCalled();
  });

  it("returns 400 when PDF text extraction fails", async () => {
    server = await createTestHttpServer();
    mockExtractPdfPages.mockRejectedValueOnce(new Error("corrupt pdf"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("application/pdf", "cours.pdf"),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when the analysis fails validation twice", async () => {
    server = await createTestHttpServer();
    mockExtractPdfPages.mockResolvedValueOnce([{ page: 1, text: "Introduction" }]);
    mockCallClaudeJSON.mockResolvedValue({ bad: "shape" });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("application/pdf", "cours.pdf"),
    });

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-pdf.test.ts`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Add the route**

In `apps/backend/src/routes.ts`, add the import and the route. First, update the import line:

```ts
import { analyzePass1, extractPdfPages, analyzePdf, type Pass1Input } from "@voxhelp/lecture";
```

Then add this route inside `registerRoutes`, after the existing `/api/lecture/analyze-pass1` route:

```ts
  app.post("/api/lecture/analyze-pdf", async (request, reply) => {
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

    let file: Awaited<ReturnType<typeof request.file>>;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({ error: "Unsupported or missing file (PDF only)" });
    }
    const isPdf = file && (file.mimetype === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf"));
    if (!file || !isPdf) {
      return reply.code(400).send({ error: "Unsupported or missing file (PDF only)" });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(400).send({ error: "Failed to read uploaded file" });
    }

    let pages: Awaited<ReturnType<typeof extractPdfPages>>;
    try {
      pages = await extractPdfPages(buffer);
    } catch {
      return reply.code(400).send({ error: "Failed to parse PDF content" });
    }

    try {
      const analysis = await analyzePdf(file.filename, pages, (system, user) =>
        callClaudeJSON(system, user, "claude-sonnet-4-6", 8192, 0)
      );
      return reply.send(analysis);
    } catch (err) {
      console.error("[Routes] PDF analysis failed:", err instanceof Error ? err.message : err);
      return reply.code(502).send({ error: "PDF analysis failed" });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-pdf.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck the backend**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes.ts apps/backend/src/__tests__/lecture-pdf.test.ts
git commit -m "feat(backend): expose POST /api/lecture/analyze-pdf"
```

---

## Task 7: Pass 2 domain types + prompts

**Files:**
- Create: `packages/lecture/src/pass2/types.ts`
- Create: `packages/lecture/src/pass2/prompts.ts`
- Test: `packages/lecture/src/__tests__/pass2-prompts.test.ts`

**Interfaces:**
- Consumes: `CourseContext`, `GlossaryEntry`, `LectureSection`, `Reference`, `TranscriptSegment`, `UncertainZone` from `packages/lecture/src/types.ts` (existing); `PdfAnalysis` from `packages/lecture/src/pdf/types.ts` (Task 2)
- Produces: `Pass2Input` (type); `buildPass2SystemPrompt(): string`, `buildPass2UserPrompt(input: Pass2Input): string`

- [ ] **Step 1: Write the failing test**

Create `packages/lecture/src/__tests__/pass2-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPass2SystemPrompt, buildPass2UserPrompt } from "../pass2/prompts.js";
import type { Pass2Input } from "../pass2/types.js";

const baseInput: Pass2Input = {
  transcript: [
    { startMs: 0, endMs: 4000, text: "Alors, on commence par le contexte historique.", confidence: 0.9 },
  ],
  course: {
    title: "Introduction à la Théologie protestante — Nouveau Testament",
    discipline: "Théologie protestante",
    instructor: "Christian Grappe",
    language: "fr",
  },
  plan: [
    { index: 0, title: "Le Nouveau Testament dans la Bible", startMs: 0, endMs: 60000, oneLineSummary: "Présentation", type: "content", confidence: 0.9 },
  ],
  glossary: [
    { term: "Septante", heardVariants: ["Sept-Ante"], category: "proper_noun", occurrences: 2, confidence: 0.85 },
  ],
  references: [
    { type: "scripture", rawCitation: "Romains chapitre 1", normalized: "Romains 1,1-4", contextMs: 12000, confidence: 0.8 },
  ],
  uncertainZones: [
    { startMs: 30000, endMs: 32000, excerpt: "[inaudible]", reason: "audio dégradé" },
  ],
  pdfAnalysis: {
    sourceFilename: "theologie-nt.pdf",
    blocks: [
      { page: 7, type: "citation", reference: "Romains 1,1-4", content: "1. Paul, serviteur de Jésus Christ..." },
    ],
  },
};

describe("buildPass2SystemPrompt", () => {
  it("instructs faithful cleanup, not summarizing", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("Nettoyage fidèle");
  });

  it("requires the uncertain-zone inline marker", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("[passage incertain");
  });

  it("requires verbatim insertion of citation/table/exercise blocks and context-only use of heading/paragraph", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("verbatim");
    expect(prompt).toContain("ne les recopie jamais tels quels");
  });

  it("requires the glossary and references appendices", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("## Glossaire");
    expect(prompt).toContain("## Références citées");
  });
});

describe("buildPass2UserPrompt", () => {
  it("includes the course context, plan, glossary, references, uncertain zones, pdf blocks and transcript", () => {
    const prompt = buildPass2UserPrompt(baseInput);
    expect(prompt).toContain("Introduction à la Théologie protestante");
    expect(prompt).toContain("Le Nouveau Testament dans la Bible");
    expect(prompt).toContain("Septante");
    expect(prompt).toContain("Romains 1,1-4");
    expect(prompt).toContain("audio dégradé");
    expect(prompt).toContain("Paul, serviteur de Jésus Christ");
    expect(prompt).toContain("on commence par le contexte historique");
  });

  it("reports an explicit placeholder when there is no PDF support", () => {
    const { pdfAnalysis, ...withoutPdf } = baseInput;
    const prompt = buildPass2UserPrompt(withoutPdf);
    expect(prompt).toContain("aucun support PDF fourni");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/pass2-prompts.test.ts`
Expected: FAIL with "Cannot find module '../pass2/prompts.js'"

- [ ] **Step 3: Write the types**

Create `packages/lecture/src/pass2/types.ts`:

```ts
import type {
  CourseContext,
  GlossaryEntry,
  LectureSection,
  Reference,
  TranscriptSegment,
  UncertainZone,
} from "../types.js";
import type { PdfAnalysis } from "../pdf/types.js";

export interface Pass2Input {
  transcript: TranscriptSegment[];
  course: CourseContext;
  plan: LectureSection[];
  glossary: GlossaryEntry[];
  references: Reference[];
  uncertainZones: UncertainZone[];
  pdfAnalysis?: PdfAnalysis;
}
```

- [ ] **Step 4: Write the prompts**

Create `packages/lecture/src/pass2/prompts.ts`:

```ts
import type { GlossaryEntry, LectureSection, Reference, TranscriptSegment, UncertainZone } from "../types.js";
import type { PdfAnalysis } from "../pdf/types.js";
import type { Pass2Input } from "./types.js";

export function buildPass2SystemPrompt(): string {
  return `Tu es un rédacteur de cours universitaires. Tu reçois la transcription
automatique brute d'un cours, déjà analysée : un plan de sections, un
glossaire des termes spécialisés, les références citées, et les zones où
la transcription est incertaine. Tu reçois aussi, si disponible, le
contenu structuré d'un support PDF utilisé pendant le cours.

Ton rôle est de RÉÉCRIRE le cours en un document de cours propre et
lisible, fidèle à ce qui a été dit.

RÈGLES DE RÉÉCRITURE :

- Nettoyage fidèle : supprime les hésitations, répétitions et fausses
  pistes, restructure en phrases complètes. Garde le vocabulaire, l'ordre
  des idées et le ton de l'enseignant. N'invente rien, ne réorganise pas
  le déroulé du cours, ne résume pas — réécris.
- Structure le document selon le plan fourni : un titre de niveau 2 (##)
  par section, dans l'ordre, avec le titre donné. Les sections de type
  "digression", "student_question" et "administrative" restent dans le
  document, à leur place, mais leur titre le signale explicitement
  (ex: "## Digression — {titre}").
- Corrige silencieusement dans le texte les termes du glossaire :
  remplace toute variante fautive ("heardVariants") par la forme
  correcte ("term"). Ne signale pas la correction, elle fait partie du
  texte final.
- Pour chaque zone incertaine ("uncertainZones") qui tombe dans une
  section, insère à l'endroit correspondant le marqueur littéral
  [passage incertain — {reason}]. N'invente jamais de texte pour combler
  le trou.
- Si un support PDF est fourni : les blocs de type "citation", "table" et
  "exercise" dont le "anchorTitle" ou le contenu se rapproche du titre
  d'une section doivent être insérés dans cette section, sous forme de
  citation Markdown (précédée de ">"), verbatim, sans reformulation. Les
  blocs "heading" et "paragraph" ne servent QUE de contexte pour recaler
  le vocabulaire et la structure — ne les recopie jamais tels quels dans
  le document.
- Termine le document par deux annexes, dans cet ordre :
  "## Glossaire" (une entrée par terme du glossaire, avec sa définition
  courte si connue) et "## Références citées" (une entrée par référence,
  sous sa forme normalisée si connue, sinon sa citation brute telle
  qu'entendue). Si une référence orale correspond à une citation PDF déjà
  insérée dans le corps du document, ne la liste qu'une fois dans les
  annexes.
- Réponds uniquement par le document Markdown final, sans texte avant ou
  après, sans balises de code englobantes.`;
}

function formatPlan(plan: LectureSection[]): string {
  return plan
    .map((section) => `${section.index}. [${section.type}] ${section.title} (${section.startMs}–${section.endMs}ms) — ${section.oneLineSummary}`)
    .join("\n");
}

function formatGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return "(vide)";
  return glossary
    .map((entry) => {
      const variants = entry.heardVariants.length > 0 ? entry.heardVariants.join(", ") : "aucune";
      const definition = entry.shortDefinition ? ` — ${entry.shortDefinition}` : "";
      return `${entry.term} (variantes entendues : ${variants})${definition}`;
    })
    .join("\n");
}

function formatReferences(references: Reference[]): string {
  if (references.length === 0) return "(vide)";
  return references.map((reference) => `${reference.type} — ${reference.normalized ?? reference.rawCitation}`).join("\n");
}

function formatUncertainZones(zones: UncertainZone[]): string {
  if (zones.length === 0) return "(vide)";
  return zones.map((zone) => `[${zone.startMs}–${zone.endMs}] ${zone.reason} — extrait : "${zone.excerpt}"`).join("\n");
}

function formatPdfBlocks(pdfAnalysis?: PdfAnalysis): string {
  if (!pdfAnalysis || pdfAnalysis.blocks.length === 0) return "(aucun support PDF fourni)";
  return pdfAnalysis.blocks
    .map((block) => {
      const anchor = block.anchorTitle ? `, ancre : "${block.anchorTitle}"` : "";
      const reference = block.reference ? `, réf : ${block.reference}` : "";
      return `[page ${block.page}] (${block.type}${anchor}${reference}) ${block.content}`;
    })
    .join("\n---\n");
}

function formatSegments(transcript: TranscriptSegment[]): string {
  return transcript.map((segment) => `[${segment.startMs}–${segment.endMs}] ${segment.text}`).join("\n");
}

export function buildPass2UserPrompt(input: Pass2Input): string {
  const { course, transcript, plan, glossary, references, uncertainZones, pdfAnalysis } = input;
  return `CONTEXTE DU COURS
Intitulé : ${course.title}
Discipline : ${course.discipline ?? "non précisée"}
Enseignant : ${course.instructor ?? "non précisé"}
Langue : ${course.language}

PLAN DU COURS
${formatPlan(plan)}

GLOSSAIRE
${formatGlossary(glossary)}

RÉFÉRENCES CITÉES
${formatReferences(references)}

ZONES INCERTAINES
${formatUncertainZones(uncertainZones)}

SUPPORT PDF (blocs structurés)
${formatPdfBlocks(pdfAnalysis)}

TRANSCRIPTION BRUTE
Format : [début_ms–fin_ms] texte
${formatSegments(transcript)}

Rédige le document de cours final au format défini.`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/pass2-prompts.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/lecture/src/pass2/types.ts packages/lecture/src/pass2/prompts.ts packages/lecture/src/__tests__/pass2-prompts.test.ts
git commit -m "feat(lecture): add pass2 rewrite domain types and prompt builders"
```

---

## Task 8: Pass 2 rewrite orchestration + module exports

**Files:**
- Create: `packages/lecture/src/pass2/rewrite.ts`
- Create: `packages/lecture/src/pass2/index.ts`
- Modify: `packages/lecture/src/index.ts`
- Test: `packages/lecture/src/__tests__/pass2-rewrite.test.ts`

**Interfaces:**
- Consumes: `Pass2Input` (Task 7), `buildPass2SystemPrompt`, `buildPass2UserPrompt` (Task 7)
- Produces: `type GenerateText = (system: string, user: string, onChunk: (text: string) => void) => Promise<string>`, `rewritePass2(input: Pass2Input, generateText: GenerateText, onChunk: (text: string) => void): Promise<string>` — this is what Task 9 (the backend route) calls.

- [ ] **Step 1: Write the failing test**

Create `packages/lecture/src/__tests__/pass2-rewrite.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { rewritePass2 } from "../pass2/rewrite.js";
import type { Pass2Input } from "../pass2/types.js";

const input: Pass2Input = {
  transcript: [{ startMs: 0, endMs: 4000, text: "Alors, on commence.", confidence: 0.9 }],
  course: { title: "Cours test", language: "fr" },
  plan: [],
  glossary: [],
  references: [],
  uncertainZones: [],
};

describe("rewritePass2", () => {
  it("builds the system and user prompts and forwards them, along with onChunk, to generateText", async () => {
    const generateText = vi.fn().mockImplementation(async (_system, _user, onChunk) => {
      onChunk("# Cours test\n\n");
      onChunk("## Introduction\nOn commence.\n");
      return "# Cours test\n\n## Introduction\nOn commence.\n";
    });
    const chunks: string[] = [];

    const result = await rewritePass2(input, generateText, (chunk) => chunks.push(chunk));

    expect(result).toBe("# Cours test\n\n## Introduction\nOn commence.\n");
    expect(chunks).toEqual(["# Cours test\n\n", "## Introduction\nOn commence.\n"]);
    expect(generateText).toHaveBeenCalledTimes(1);
    const [system, user] = generateText.mock.calls[0];
    expect(system).toContain("Nettoyage fidèle");
    expect(user).toContain("Cours test");
  });

  it("propagates a rejection from generateText", async () => {
    const generateText = vi.fn().mockRejectedValueOnce(new Error("provider error"));
    await expect(rewritePass2(input, generateText, () => {})).rejects.toThrow("provider error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lecture && npx vitest run src/__tests__/pass2-rewrite.test.ts`
Expected: FAIL with "Cannot find module '../pass2/rewrite.js'"

- [ ] **Step 3: Write the orchestration**

Create `packages/lecture/src/pass2/rewrite.ts`:

```ts
import type { Pass2Input } from "./types.js";
import { buildPass2SystemPrompt, buildPass2UserPrompt } from "./prompts.js";

export type GenerateText = (
  system: string,
  user: string,
  onChunk: (text: string) => void
) => Promise<string>;

export async function rewritePass2(
  input: Pass2Input,
  generateText: GenerateText,
  onChunk: (text: string) => void
): Promise<string> {
  const system = buildPass2SystemPrompt();
  const user = buildPass2UserPrompt(input);
  return generateText(system, user, onChunk);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lecture && npx vitest run src/__tests__/pass2-rewrite.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the module exports**

Create `packages/lecture/src/pass2/index.ts`:

```ts
export * from "./types.js";
export * from "./prompts.js";
export * from "./rewrite.js";
```

Modify `packages/lecture/src/index.ts` to add one more line at the end:

```ts
export * from "./types.js";
export * from "./schemas.js";
export * from "./prompts.js";
export * from "./postprocess.js";
export * from "./windowing.js";
export * from "./analyze.js";
export * from "./pdf/index.js";
export * from "./pass2/index.js";
```

- [ ] **Step 6: Typecheck the package**

Run: `cd packages/lecture && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Run the full lecture package test suite**

Run: `cd packages/lecture && npx vitest run`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add packages/lecture/src/pass2/rewrite.ts packages/lecture/src/pass2/index.ts packages/lecture/src/index.ts packages/lecture/src/__tests__/pass2-rewrite.test.ts
git commit -m "feat(lecture): add pass2 rewrite orchestration, wire pass2 module exports"
```

---

## Task 9: Backend route `POST /api/lecture/rewrite-pass2`

**Files:**
- Modify: `apps/backend/src/routes.ts`
- Test: `apps/backend/src/__tests__/lecture-pass2.test.ts`

**Interfaces:**
- Consumes: `rewritePass2`, `type Pass2Input` from `@voxhelp/lecture` (Task 8), `streamAssist` from `./llm.js` (Task 1)
- Produces: the route `POST /api/lecture/rewrite-pass2`, JSON `Pass2Input` body → chunked `text/plain` Markdown stream response

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/__tests__/lecture-pass2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockStreamAssist = vi.hoisted(() => vi.fn());

vi.mock("../llm.js", () => ({ streamAssist: mockStreamAssist }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function validBody() {
  return {
    transcript: [{ startMs: 0, endMs: 4000, text: "Alors, on commence.", confidence: 0.9 }],
    course: { title: "Cours test", language: "fr" },
    plan: [
      { index: 0, title: "Introduction", startMs: 0, endMs: 4000, oneLineSummary: "Début", type: "content", confidence: 0.9 },
    ],
    glossary: [],
    references: [],
    uncertainZones: [],
  };
}

describe("POST /api/lecture/rewrite-pass2", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockStreamAssist.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("streams the rewritten Markdown document", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockImplementation(async (_system, _user, onChunk) => {
      onChunk("# Cours test\n\n");
      onChunk("## Introduction\nOn commence.\n");
      return "# Cours test\n\n## Introduction\nOn commence.\n";
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("# Cours test\n\n## Introduction\nOn commence.\n");
    expect(mockStreamAssist).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      "claude-sonnet-4-6",
      8192,
      0.3
    );
  });

  it("returns 400 when the transcript is missing", async () => {
    server = await createTestHttpServer();
    const { transcript, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });

  it("returns 400 when the plan is missing", async () => {
    server = await createTestHttpServer();
    const { plan, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-pass2.test.ts`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Add the route**

In `apps/backend/src/routes.ts`, update the imports:

```ts
import { supabaseAdmin } from "./supabase.js";
import { callClaudeJSON, streamAssist } from "./llm.js";
import { extractTextFromCv, buildCvKeywordExtractionPrompt, type CvFormat } from "@voxhelp/recruit";
import {
  analyzePass1,
  extractPdfPages,
  analyzePdf,
  rewritePass2,
  type Pass1Input,
  type Pass2Input,
} from "@voxhelp/lecture";
```

Then add this route inside `registerRoutes`, after the `/api/lecture/analyze-pdf` route:

```ts
  app.post("/api/lecture/rewrite-pass2", async (request, reply) => {
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

    const body = request.body as Partial<Pass2Input> | undefined;
    if (!body || !Array.isArray(body.transcript) || body.transcript.length === 0 || !body.course || !Array.isArray(body.plan)) {
      return reply.code(400).send({ error: "Missing transcript, course context, or plan" });
    }

    const input: Pass2Input = {
      transcript: body.transcript,
      course: body.course,
      plan: body.plan,
      glossary: Array.isArray(body.glossary) ? body.glossary : [],
      references: Array.isArray(body.references) ? body.references : [],
      uncertainZones: Array.isArray(body.uncertainZones) ? body.uncertainZones : [],
      pdfAnalysis: body.pdfAnalysis,
    };

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    });

    try {
      await rewritePass2(
        input,
        (system, user, onChunk) => streamAssist(system, user, onChunk, "claude-sonnet-4-6", 8192, 0.3),
        (chunk) => reply.raw.write(chunk)
      );
    } catch (err) {
      console.error("[Routes] Lecture pass2 rewrite failed:", err instanceof Error ? err.message : err);
    } finally {
      reply.raw.end();
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-pass2.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck the backend**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes.ts apps/backend/src/__tests__/lecture-pass2.test.ts
git commit -m "feat(backend): expose POST /api/lecture/rewrite-pass2 as a streamed markdown response"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full lecture package test suite**

Run: `cd packages/lecture && npx vitest run`
Expected: PASS (all tests across Pass 1, PDF, and Pass 2)

- [ ] **Step 2: Run the full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: PASS (all tests, including the pre-existing WebSocket/session and CV routes)

- [ ] **Step 3: Typecheck both packages**

Run:
```bash
cd packages/lecture && npx tsc --noEmit
cd ../../apps/backend && npx tsc --noEmit
```
Expected: no errors in either

- [ ] **Step 4: Confirm no stray changes**

Run: `git status`
Expected: clean working tree (everything already committed task-by-task)
