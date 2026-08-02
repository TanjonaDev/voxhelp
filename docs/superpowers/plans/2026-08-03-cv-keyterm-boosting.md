# CV/Job Keyword Boosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recruiter optionally upload a candidate's CV (PDF/DOCX) before starting an interview; extract recruiter-relevant proper nouns/tech terms from it via Claude, merge them with a cheap client-side split of the existing "Stack" field, and pass the combined list to Deepgram Flux's `keyterm` parameter to improve STT recognition of candidate-specific vocabulary.

**Architecture:** New REST route (`POST /api/extract-cv-keywords`) parses the uploaded file (mammoth for DOCX, unpdf for PDF) and calls Claude for extraction. The frontend triggers this upload as soon as a CV is selected (not blocking on "Démarrer" beyond the extraction's own duration), merges the result with a locally-split Stack field at start time, and sends the combined list through the existing `session:start` message as a new `SessionConfig.keywords` field, which flows through `session.ts` into `FluxSTT`'s Deepgram connection.

**Tech Stack:** TypeScript (ESM, strict), Vitest, Fastify + `@fastify/multipart`, `mammoth`, `unpdf`, React 19.

## Global Constraints

- TypeScript strict, no `any`, ESM imports with `.js` extensions in the backend.
- Keywords feed **only** the Deepgram STT connection (`keyterm` parameter) — never the live-assist LLM prompt (`buildLiveAssistPrompt` stays untouched).
- Each keyword ≤ 100 characters; combined list ≤ 50 keywords (Deepgram v2 Listen API limits: 100 chars/term, ~500 tokens total).
- CV upload/parsing is best-effort: any failure (unsupported type, parse error, LLM error) must never block starting the session — it just means no CV-derived keywords for that session.
- No persistence of the CV file or its extracted text — processed in memory for the duration of the request only.
- `apps/web` has no test infra (no vitest configured) — frontend tasks are implement + typecheck only, verified manually per Task 13.
- Spec: `docs/superpowers/specs/2026-08-03-cv-keyterm-boosting-design.md`.

---

### Task 1: `packages/shared` — `SessionConfig.keywords`

**Files:**
- Modify: `packages/shared/src/index.ts:9-11`

**Interfaces:**
- Produces: `SessionConfig.keywords?: string[]`. Consumed by `session.ts` (Task 7), `OverlayPanel.tsx` (Task 12).

- [ ] **Step 1: Add the field**

Replace:
```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
}
```
with:
```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add SessionConfig.keywords for Deepgram keyterm boosting"
```

---

### Task 2: Backend dependencies

**Files:**
- Modify: `apps/backend/package.json`

**Interfaces:**
- Produces: `@fastify/multipart`, `mammoth`, `unpdf` available as imports for Tasks 3, 8, 9.

- [ ] **Step 1: Install the dependencies**

Run: `pnpm --filter @voxhelp/backend add @fastify/multipart mammoth unpdf`

- [ ] **Step 2: Verify they resolve under the project's ESM/strict TS setup**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors (nothing imports them yet, this just confirms `pnpm add` didn't break anything).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): add multipart upload and CV parsing dependencies"
```

---

### Task 3: CV text extraction module

**Files:**
- Create: `apps/backend/src/cv-parser.ts`

**Interfaces:**
- Consumes: `mammoth`, `unpdf` (Task 2).
- Produces: `extractTextFromCv(buffer: Buffer, mimetype: string): Promise<string>` — throws on unrecognized mimetype or parse failure. Consumed by the route in Task 9.

**Note:** No automated test for this file per the spec ("Pas de test automatisé sur le parsing PDF/DOCX lui-même... vérification manuelle recommandée") — real PDF/DOCX parsing needs real file fixtures, which the backend test suite doesn't currently maintain. Manual verification happens in Task 13.

- [ ] **Step 1: Write the module**

```ts
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const MAX_CHARS = 20000;

export async function extractTextFromCv(buffer: Buffer, mimetype: string): Promise<string> {
  let text: string;

  if (mimetype === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    throw new Error(`Unsupported CV mimetype: ${mimetype}`);
  }

  return text.slice(0, MAX_CHARS);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/cv-parser.ts
git commit -m "feat(backend): add PDF/DOCX to plain text extraction module"
```

---

### Task 4: Keyword-extraction prompt — tests

**Files:**
- Create: `apps/backend/src/__tests__/cv-keyword-extraction.test.ts`

**Interfaces:**
- Produces: a failing test suite that Task 5 must satisfy.

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect } from "vitest";
import { buildCvKeywordExtractionPrompt } from "../prompts/cv-keyword-extraction.js";

describe("buildCvKeywordExtractionPrompt", () => {
  it("embeds the CV text verbatim", () => {
    const prompt = buildCvKeywordExtractionPrompt("Jean Dupont, ingénieur chez RMC BFM, expert Kubernetes.");
    expect(prompt).toContain("Jean Dupont, ingénieur chez RMC BFM, expert Kubernetes.");
  });

  it("requires strict JSON with a keywords array", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain('{ "keywords": ["terme1", "terme2", ...] }');
    expect(prompt).toContain("JSON strict");
  });

  it("caps the count and length of keywords", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain("Maximum 40 termes");
    expect(prompt).toContain("maximum 100 caractères");
  });

  it("excludes generic terms in favor of proper nouns", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain("noms d'entreprises");
    expect(prompt).toContain("Pas de mots génériques");
  });

  it("handles the empty-result case explicitly", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain('{ "keywords": [] }');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/cv-keyword-extraction.test.ts`
Expected: FAIL — `../prompts/cv-keyword-extraction.js` doesn't exist yet.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/__tests__/cv-keyword-extraction.test.ts
git commit -m "test(prompts): add failing tests for CV keyword extraction prompt"
```

---

### Task 5: Keyword-extraction prompt — implementation

**Files:**
- Create: `apps/backend/src/prompts/cv-keyword-extraction.ts`

**Interfaces:**
- Consumes: `apps/backend/src/__tests__/cv-keyword-extraction.test.ts` (Task 4) as the acceptance test.
- Produces: `buildCvKeywordExtractionPrompt(cvText: string): string`. Consumed by the route in Task 9.

- [ ] **Step 1: Write the prompt**

```ts
export function buildCvKeywordExtractionPrompt(cvText: string): string {
  return `Tu extrais les termes qui aideront un système de reconnaissance vocale à bien transcrire un entretien technique avec ce candidat.

Contenu du CV :
"""
${cvText}
"""

Retourne un JSON strict (sans backticks, sans texte autour) :
{ "keywords": ["terme1", "terme2", ...] }

Règles :
- Uniquement des noms propres et termes spécifiques à CE candidat : noms d'entreprises, noms de produits/outils internes, certifications, technologies/frameworks nommés précisément, noms de projets.
- Pas de mots génériques (ex : "développeur", "expérience", "gestion de projet").
- Maximum 40 termes, les plus susceptibles d'être mal transcrits en priorité (noms propres rares avant termes techniques courants).
- Chaque terme fait au maximum 100 caractères, idéalement 1 à 4 mots.
- Si rien de pertinent n'est trouvé, retourne { "keywords": [] }.`;
}
```

- [ ] **Step 2: Run and confirm it passes**

Run: `cd apps/backend && npx vitest run src/__tests__/cv-keyword-extraction.test.ts`
Expected: PASS (5/5).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/prompts/cv-keyword-extraction.ts
git commit -m "feat(prompts): add CV keyword extraction prompt"
```

---

### Task 6: `session.ts`/`deepgram-flux.ts` keyword wiring — tests

**Files:**
- Modify: `apps/backend/src/__tests__/session.test.ts`
- Modify: `apps/backend/src/__tests__/session-theme-angle.test.ts`
- Modify: `apps/backend/src/__tests__/session-theme-rollup.test.ts`
- Modify: `apps/backend/src/__tests__/session-max-buffer.test.ts`
- Modify: `apps/backend/src/__tests__/session-usage-limit.test.ts`
- Create: `apps/backend/src/__tests__/session-keywords.test.ts`

**Interfaces:**
- Produces: a failing test suite (all 6 files) that Task 7 must satisfy.

**Why 5 existing files must change:** each defines a `MockFluxSTT` class with `constructor(_lang: string, callbacks: STTCallbacks)`. Task 7 changes the real `FluxSTT` constructor to `constructor(language: string, keywords: string[] | undefined, callbacks: FluxSTTCallbacks)` — `session.ts` will then call `new FluxSTT(config.language, config.keywords, {...})` with 3 positional arguments. If the mocks keep their 2-parameter signature, the callbacks object would land in the mock's `callbacks` parameter position shifted by one arg — silently breaking every existing test that relies on `stt.callbacks!.onTranscript(...)`. This must be fixed **before** Task 7 lands the real signature change, which is why it belongs in this tests-first task.

- [ ] **Step 1: Update the 5 existing `MockFluxSTT` constructors**

In each of the 5 files listed above, replace:
```ts
    constructor(_lang: string, callbacks: STTCallbacks) {
```
with:
```ts
    constructor(_lang: string, _keywords: string[] | undefined, callbacks: STTCallbacks) {
```
(The line is otherwise identical in all 5 files — same indentation, same body on the next line assigning `stt.callbacks = callbacks`.)

- [ ] **Step 2: Write the new keyword-flow test file**

Create `apps/backend/src/__tests__/session-keywords.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({
  callbacks: null as STTCallbacks | null,
  lastKeywords: undefined as string[] | undefined,
}));
const mockLlm = vi.hoisted(() => ({ streamAssist: vi.fn(), callClaudeJSON: vi.fn() }));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, keywords: string[] | undefined, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
      stt.lastKeywords = keywords;
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

function connectAndStart(port: number, keywords?: string[]): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr", keywords } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

describe("Session keyword passthrough", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    stt.callbacks = null;
    stt.lastKeywords = undefined;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("passes SessionConfig.keywords to the FluxSTT constructor", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port, ["Cléo", "RMC BFM", "Kubernetes"]);

    expect(stt.lastKeywords).toEqual(["Cléo", "RMC BFM", "Kubernetes"]);
  });

  it("passes undefined when no keywords are provided", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    expect(stt.lastKeywords).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd apps/backend && npx vitest run`
Expected: FAIL — the 5 modified mock files now have a 3-parameter constructor while `session.ts` still calls `new FluxSTT(config.language, {...})` with 2 arguments, so `callbacks` never gets set (breaking most existing tests with null-reference errors on `stt.callbacks!`), and the new `session-keywords.test.ts` fails because `stt.lastKeywords` is always `undefined` even when keywords are sent.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/__tests__/session.test.ts apps/backend/src/__tests__/session-theme-angle.test.ts apps/backend/src/__tests__/session-theme-rollup.test.ts apps/backend/src/__tests__/session-max-buffer.test.ts apps/backend/src/__tests__/session-usage-limit.test.ts apps/backend/src/__tests__/session-keywords.test.ts
git commit -m "test(session): add failing tests for Deepgram keyword passthrough"
```

---

### Task 7: `session.ts`/`deepgram-flux.ts` keyword wiring — implementation

**Files:**
- Modify: `apps/backend/src/deepgram-flux.ts`
- Modify: `apps/backend/src/session.ts:140-144`

**Interfaces:**
- Consumes: `apps/backend/src/__tests__/session-keywords.test.ts` and the 5 updated mock files (Task 6) as the acceptance tests.
- Produces: `FluxSTT` constructor signature `constructor(language: string, keywords: string[] | undefined, callbacks: FluxSTTCallbacks)` — this is a breaking signature change; the only call site is `session.ts`, updated in this same task.

- [ ] **Step 1: Update `FluxSTT` in `deepgram-flux.ts`**

Replace:
```ts
export class FluxSTT {
  private connection: FluxConnection | null = null;
  private callbacks: FluxSTTCallbacks;
  private language: string;
  private closed = false;

  constructor(language: string, callbacks: FluxSTTCallbacks) {
    this.callbacks = callbacks;
    this.language = language;
  }
```
with:
```ts
export class FluxSTT {
  private connection: FluxConnection | null = null;
  private callbacks: FluxSTTCallbacks;
  private language: string;
  private keywords: string[] | undefined;
  private closed = false;

  constructor(language: string, keywords: string[] | undefined, callbacks: FluxSTTCallbacks) {
    this.callbacks = callbacks;
    this.language = language;
    this.keywords = keywords;
  }
```

- [ ] **Step 2: Pass `keyterm` to the Deepgram connection**

Replace:
```ts
      const connection = await client.listen.v2.connect({
        model: "flux-general-multi",
        encoding: "linear16",
        sample_rate: 16000,
        language_hint: hints,
        Authorization: `Token ${apiKey}`,
      }) as unknown as FluxConnection;
```
with:
```ts
      const connection = await client.listen.v2.connect({
        model: "flux-general-multi",
        encoding: "linear16",
        sample_rate: 16000,
        language_hint: hints,
        ...(this.keywords && this.keywords.length > 0 ? { keyterm: this.keywords } : {}),
        Authorization: `Token ${apiKey}`,
      }) as unknown as FluxConnection;
```

- [ ] **Step 3: Update the call site in `session.ts`**

Replace (lines 140-144):
```ts
    this.stt?.close();
    this.stt = new FluxSTT(config.language, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });
```
with:
```ts
    this.stt?.close();
    this.stt = new FluxSTT(config.language, config.keywords, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });
```

- [ ] **Step 4: Run the full suite and confirm it passes**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — all test files, including `session-keywords.test.ts` (Task 6).

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/deepgram-flux.ts apps/backend/src/session.ts
git commit -m "feat(session): pass SessionConfig.keywords to Deepgram as keyterm boosting"
```

---

### Task 8: `POST /api/extract-cv-keywords` route — tests

**Files:**
- Create: `apps/backend/src/__tests__/helpers/http-server.ts`
- Create: `apps/backend/src/__tests__/extract-cv-keywords.test.ts`

**Interfaces:**
- Produces: a failing test suite that Task 9 must satisfy. `createTestHttpServer()` — mirrors `createTestServer()` from `helpers/server.ts` but for the new HTTP route instead of the WebSocket.

- [ ] **Step 1: Write the HTTP test server helper**

Create `apps/backend/src/__tests__/helpers/http-server.ts`:
```ts
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerRoutes } from "../../routes.js";

export interface TestHttpServer {
  port: number;
  close: () => Promise<void>;
}

export async function createTestHttpServer(): Promise<TestHttpServer> {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  registerRoutes(app);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };

  return {
    port: address.port,
    close: () => app.close(),
  };
}
```

- [ ] **Step 2: Write the route test file**

Create `apps/backend/src/__tests__/extract-cv-keywords.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockExtract = vi.hoisted(() => vi.fn());
const mockCallClaudeJSON = vi.hoisted(() => vi.fn());

vi.mock("../cv-parser.js", () => ({ extractTextFromCv: mockExtract }));
vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function buildForm(mimetype: string, filename: string): FormData {
  const form = new FormData();
  form.append("cv", new Blob([Buffer.from("fake file content")], { type: mimetype }), filename);
  return form;
}

describe("POST /api/extract-cv-keywords", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockExtract.mockReset();
    mockCallClaudeJSON.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns extracted keywords for a valid PDF upload", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("Cléo, RMC BFM, TypeScript");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["Cléo", "RMC BFM", "TypeScript"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["Cléo", "RMC BFM", "TypeScript"]);
  });

  it("returns extracted keywords for a valid DOCX upload", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some docx text");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["AWS Lambda"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "cv.docx"
      ),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["AWS Lambda"]);
  });

  it("rejects unsupported file types with 400", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("text/plain", "cv.txt"),
    });

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("returns 400 when parsing the file content fails", async () => {
    server = await createTestHttpServer();
    mockExtract.mockRejectedValueOnce(new Error("corrupt file"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when keyword extraction fails", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some cv text");
    mockCallClaudeJSON.mockRejectedValueOnce(new Error("LLM error"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd apps/backend && npx vitest run src/__tests__/extract-cv-keywords.test.ts`
Expected: FAIL — `../../routes.js` doesn't exist yet.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/__tests__/helpers/http-server.ts apps/backend/src/__tests__/extract-cv-keywords.test.ts
git commit -m "test(routes): add failing tests for POST /api/extract-cv-keywords"
```

---

### Task 9: `POST /api/extract-cv-keywords` route — implementation

**Files:**
- Create: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/index.ts`

**Interfaces:**
- Consumes: `extractTextFromCv` (Task 3), `buildCvKeywordExtractionPrompt` (Task 5), `callClaudeJSON` (existing `llm.ts`), `supabaseAdmin` (existing `supabase.ts`).
- Consumes: `apps/backend/src/__tests__/extract-cv-keywords.test.ts` (Task 8) as the acceptance test.
- Produces: `registerRoutes(app: FastifyInstance): void`, importable by both `index.ts` and the test helper from Task 8.

- [ ] **Step 1: Write the route module**

Create `apps/backend/src/routes.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "./supabase.js";
import { extractTextFromCv } from "./cv-parser.js";
import { callClaudeJSON } from "./llm.js";
import { buildCvKeywordExtractionPrompt } from "./prompts/cv-keyword-extraction.js";

const SUPPORTED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function registerRoutes(app: FastifyInstance): void {
  app.post("/api/extract-cv-keywords", async (request, reply) => {
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

    const file = await request.file();
    if (!file || !SUPPORTED_MIMETYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: "Unsupported or missing file (PDF or DOCX only)" });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(400).send({ error: "Failed to read uploaded file" });
    }

    let cvText: string;
    try {
      cvText = await extractTextFromCv(buffer, file.mimetype);
    } catch {
      return reply.code(400).send({ error: "Failed to parse file content" });
    }

    try {
      const result = await callClaudeJSON<{ keywords: string[] }>(
        buildCvKeywordExtractionPrompt(cvText),
        "Extrais les keywords."
      );
      return reply.send({ keywords: result.keywords });
    } catch {
      return reply.code(502).send({ error: "Keyword extraction failed" });
    }
  });
}
```

- [ ] **Step 2: Wire it into `index.ts`**

Replace:
```ts
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Session } from "./session.js";
import { supabaseAdmin } from "./supabase.js";

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(websocket);

  app.get("/health", async () => ({ status: "ok", timestamp: Date.now() }));
```
with:
```ts
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { Session } from "./session.js";
import { supabaseAdmin } from "./supabase.js";
import { registerRoutes } from "./routes.js";

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  registerRoutes(app);

  app.get("/health", async () => ({ status: "ok", timestamp: Date.now() }));
```

- [ ] **Step 3: Run the new route tests and confirm they pass**

Run: `cd apps/backend && npx vitest run src/__tests__/extract-cv-keywords.test.ts`
Expected: PASS (5/5).

- [ ] **Step 4: Run the full backend suite**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — all files.

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes.ts apps/backend/src/index.ts
git commit -m "feat(backend): add POST /api/extract-cv-keywords route"
```

---

### Task 10: Frontend — keyword merge helper

**Files:**
- Create: `apps/web/src/lib/mergeKeywords.ts`

**Interfaces:**
- Produces: `deriveStackKeywords(stack: string): string[]`, `mergeKeywords(cvKeywords: string[], stackKeywords: string[]): string[]`. Consumed by `OverlayPanel.tsx` (Task 12).

**Note:** No test runner in `apps/web` — implement + typecheck only.

- [ ] **Step 1: Write the module**

```ts
export function deriveStackKeywords(stack: string): string[] {
  return stack
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 100);
}

export function mergeKeywords(cvKeywords: string[], stackKeywords: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const term of [...cvKeywords, ...stackKeywords]) {
    const key = term.toLowerCase();
    if (seen.has(key) || term.length === 0 || term.length > 100) continue;
    seen.add(key);
    merged.push(term);
    if (merged.length >= 50) break;
  }
  return merged;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/mergeKeywords.ts
git commit -m "feat(web): add CV/stack keyword merge helper"
```

---

### Task 11: Frontend — CV upload hook + token propagation

**Files:**
- Create: `apps/web/src/hooks/useCvKeywords.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `useCvKeywords(token: string)` returning `{ status: "idle" | "extracting" | "done" | "error"; keywords: string[]; upload: (file: File) => Promise<void> }`. Consumed by `OverlayPanel.tsx` (Task 12).
- Produces: `SessionApp` now passes `token` down to `OverlayPanel` as a new prop, consumed by Task 12.

**Note:** No test runner in `apps/web` — implement + typecheck only.

- [ ] **Step 1: Write the hook**

Create `apps/web/src/hooks/useCvKeywords.ts`:
```ts
import { useState, useCallback } from "react";

type CvKeywordsStatus = "idle" | "extracting" | "done" | "error";

interface UseCvKeywordsReturn {
  status: CvKeywordsStatus;
  keywords: string[];
  upload: (file: File) => Promise<void>;
}

export function useCvKeywords(token: string): UseCvKeywordsReturn {
  const [status, setStatus] = useState<CvKeywordsStatus>("idle");
  const [keywords, setKeywords] = useState<string[]>([]);

  const upload = useCallback(
    async (file: File) => {
      setStatus("extracting");
      try {
        const form = new FormData();
        form.append("cv", file);

        const res = await fetch(`http://${window.location.hostname}:3001/api/extract-cv-keywords`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        if (!res.ok) {
          setKeywords([]);
          setStatus("error");
          return;
        }

        const data = (await res.json()) as { keywords: string[] };
        setKeywords(data.keywords);
        setStatus("done");
      } catch {
        setKeywords([]);
        setStatus("error");
      }
    },
    [token]
  );

  return { status, keywords, upload };
}
```

- [ ] **Step 2: Propagate the token to `OverlayPanel`**

In `apps/web/src/App.tsx`, replace:
```tsx
  return (
    <OverlayPanel
      insights={ws.insights}
      streamingCard={ws.streamingCard}
```
with:
```tsx
  return (
    <OverlayPanel
      token={token}
      insights={ws.insights}
      streamingCard={ws.streamingCard}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: error on `OverlayPanelProps` not accepting a `token` prop yet — that's expected, Task 12 adds it. Confirm no OTHER errors beyond that one.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useCvKeywords.ts apps/web/src/App.tsx
git commit -m "feat(web): add CV upload hook, propagate auth token to OverlayPanel"
```

---

### Task 12: Frontend — Setup form wiring

**Files:**
- Modify: `apps/web/src/components/OverlayPanel.tsx`

**Interfaces:**
- Consumes: `useCvKeywords` (Task 11), `deriveStackKeywords`/`mergeKeywords` (Task 10), `SessionConfig.keywords` (Task 1).

**Note:** No test runner in `apps/web` — implement + typecheck only.

- [ ] **Step 1: Add `token` to `OverlayPanelProps` and accept it as a prop**

Replace:
```ts
export interface OverlayPanelProps {
  insights: Insight[];
```
with:
```ts
export interface OverlayPanelProps {
  token: string;
  insights: Insight[];
```

Replace:
```ts
export function OverlayPanel({
  insights,
```
with:
```ts
export function OverlayPanel({
  token,
  insights,
```

- [ ] **Step 2: Import the new hook and helper**

Replace:
```ts
import type { Insight, CandidateReport, JobContext, ThemeStatus } from "@voxhelp/shared";
```
with:
```ts
import type { Insight, CandidateReport, JobContext, ThemeStatus } from "@voxhelp/shared";
import { useCvKeywords } from "../hooks/useCvKeywords.js";
import { deriveStackKeywords, mergeKeywords } from "../lib/mergeKeywords.js";
```

- [ ] **Step 3: Wire the hook and `handleStart`**

Replace:
```ts
  const [jobTitle, setJobTitle] = useState("");
  const [jobLevel, setJobLevel] = useState("");
  const [jobStack, setJobStack] = useState("");
```
with:
```ts
  const [jobTitle, setJobTitle] = useState("");
  const [jobLevel, setJobLevel] = useState("");
  const [jobStack, setJobStack] = useState("");
  const cvKeywords = useCvKeywords(token);
```

Replace:
```ts
  const handleStart = async () => {
    const jobContext =
      jobTitle || jobLevel || jobStack
        ? { title: jobTitle, level: jobLevel, stack: jobStack }
        : undefined;
    await onStartAudio(jobContext);
    setAudioStarted(true);
  };
```
with:
```ts
  const handleStart = async () => {
    const jobContext =
      jobTitle || jobLevel || jobStack
        ? { title: jobTitle, level: jobLevel, stack: jobStack }
        : undefined;
    const keywords = mergeKeywords(cvKeywords.keywords, deriveStackKeywords(jobStack));
    await onStartAudio(jobContext, keywords.length > 0 ? keywords : undefined);
    setAudioStarted(true);
  };
```

- [ ] **Step 4: Update `onStartAudio`'s type and the "Démarrer" button**

`onStartAudio` currently has the signature `(jobContext?: JobContext) => Promise<void>` in `OverlayPanelProps` (around line 754) — replace with `(jobContext?: JobContext, keywords?: string[]) => Promise<void>`.

Replace the "Démarrer" button (lines 1006-1027):
```tsx
                <button
                  onClick={handleStart}
                  style={{
                    all: "unset" as "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: "10px 14px",
                    borderRadius: 11,
                    background: "var(--accent)",
                    color: "white",
                    fontSize: 13.5,
                    fontWeight: 600,
                    marginTop: 4,
                    fontFamily: "var(--font)",
                  }}
                >
                  <VIcon name="mic" size={15} />
                  Démarrer l'écoute
                </button>
```
with:
```tsx
                <button
                  onClick={handleStart}
                  disabled={cvKeywords.status === "extracting"}
                  style={{
                    all: "unset" as "unset",
                    cursor: cvKeywords.status === "extracting" ? "default" : "pointer",
                    opacity: cvKeywords.status === "extracting" ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: "10px 14px",
                    borderRadius: 11,
                    background: "var(--accent)",
                    color: "white",
                    fontSize: 13.5,
                    fontWeight: 600,
                    marginTop: 4,
                    fontFamily: "var(--font)",
                  }}
                >
                  <VIcon name="mic" size={15} />
                  {cvKeywords.status === "extracting" ? "Analyse du CV..." : "Démarrer l'écoute"}
                </button>
```

- [ ] **Step 5: Add the CV file input**

In the "Contexte du poste (optionnel)" block, immediately after the closing `/>` of the `jobStack` `<input>` (the one with `placeholder="Stack — ex: React, TypeScript"`) and before the "Démarrer" `<button>`, add:
```tsx
                <div>
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void cvKeywords.upload(file);
                    }}
                    style={{
                      fontSize: 12,
                      color: "var(--text-3)",
                      width: "100%",
                    }}
                  />
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-3)" }}>
                    CV du candidat (PDF ou DOCX) — recommandé, améliore la reconnaissance vocale des noms propres
                  </p>
                  {cvKeywords.status === "error" && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--risk)" }}>
                      CV non pris en compte — la session démarrera sans ces mots-clés
                    </p>
                  )}
                </div>
```

- [ ] **Step 6: Update `SessionApp`'s `handleStartAudio` in `App.tsx`**

Replace:
```tsx
  const handleStartAudio = async (jobContext?: JobContext) => {
    ws.startSession({ language: "fr", jobContext });
```
with:
```tsx
  const handleStartAudio = async (jobContext?: JobContext, keywords?: string[]) => {
    ws.startSession({ language: "fr", jobContext, keywords });
```

- [ ] **Step 7: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors — this closes out the `token` prop error left open at the end of Task 11.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/OverlayPanel.tsx apps/web/src/App.tsx
git commit -m "feat(web): add CV upload to the setup form, merge keywords on start"
```

---

### Task 13: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `cd packages/shared && npx tsc --noEmit && cd ../../apps/backend && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: no errors on any of the 3 packages.

- [ ] **Step 2: Full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: PASS, all files.

- [ ] **Step 3: Grep for leftover references to the old 2-arg `FluxSTT` constructor**

Run: `grep -rn "new FluxSTT(config.language, {" apps/backend/src`
Expected: no matches (only the 3-arg call site from Task 7 should exist).

- [ ] **Step 4: Manual verification with a real CV**

Run: `pnpm dev` (from repo root), with real `DEEPGRAM_API_KEY`/`ANTHROPIC_API_KEY`/Supabase env vars configured in `apps/backend/.env`.
- Log in, reach the setup form.
- Upload a real PDF or DOCX CV containing at least one proper noun (a company name, a tool name). Confirm the "Démarrer" button becomes disabled briefly, then re-enables.
- Fill in the Stack field with a couple of comma-separated terms.
- Start the session, speak the proper noun from the CV out loud, and check the transcript recognizes it correctly (compare against starting a session with no CV uploaded, where the same term is more likely to be mis-transcribed).
- Try an unsupported file type (e.g. a `.txt` renamed to bypass the `accept` filter, or just note the browser file picker already restricts to `.pdf`/`.docx`) and confirm the error path doesn't block starting the session.

- [ ] **Step 5: Commit any adjustments found during manual verification**

```bash
git status
```
If manual verification surfaces an issue (e.g. mimetype mismatch between what a real browser/OS reports and `SUPPORTED_MIMETYPES`), fix it and commit separately with a message describing the fix.
