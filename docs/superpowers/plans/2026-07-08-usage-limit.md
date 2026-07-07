# Usage Limit (per-user session cap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the number of interview sessions each authenticated user can start, backed by a `session_count`/`session_limit` pair on `profiles`, enforced in the WebSocket `Session` class.

**Architecture:** `apps/backend/src/index.ts` already resolves a `userId` from the Supabase auth token when verifying the WebSocket connection. That `userId` is threaded into `Session`, which checks `profiles.session_count >= profiles.session_limit` before starting STT on `session:start`, and increments `session_count` via an atomic Postgres RPC in `cleanup()` — but only if the session actually processed at least one transcript. Everything fails open (session allowed) when Supabase isn't configured or a profile read errors, matching the existing WS-auth fallback behavior.

**Tech Stack:** Fastify + `@fastify/websocket`, `@supabase/supabase-js` (already installed), Vitest for tests.

## Global Constraints

- TypeScript strict, no `any` (project convention — see `CLAUDE.md`).
- ESM imports with `.js` extensions in backend source (project convention).
- Default `session_limit` is 5, per-user override happens by editing the `profiles` row directly in Supabase Dashboard (no admin UI).
- Quota check happens on `session:start`; increment happens on session end (`cleanup()`), only if `conversationLog.length > 0`.
- Fail open (allow the session) if `supabaseAdmin` is `null` or the profile read errors.
- Spec reference: `docs/superpowers/specs/2026-07-08-usage-limit-design.md`.

---

## Task 1: Extract shared `waitForMessage` WebSocket test helper

This is a pure refactor — `session.test.ts` currently defines `waitForMessage` locally. The new test file added in Task 3/4 needs the same helper, so it moves to a shared location first. No behavior changes; the full existing suite must stay green.

**Files:**
- Create: `apps/backend/src/__tests__/helpers/ws.ts`
- Modify: `apps/backend/src/__tests__/session.test.ts:1-52`

**Interfaces:**
- Produces: `waitForMessage(ws: WebSocket, type: string, timeout?: number): Promise<ServerMessage>` — exported from `apps/backend/src/__tests__/helpers/ws.ts`, consumed by Task 3 and Task 4's new test file.

- [ ] **Step 1: Create the shared helper file**

Create `apps/backend/src/__tests__/helpers/ws.ts`:

```ts
import type WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";

export function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for message type "${type}"`));
    }, timeout);

    function handler(data: Buffer) {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}
```

- [ ] **Step 2: Update `session.test.ts` to use the shared helper**

In `apps/backend/src/__tests__/session.test.ts`, replace the local `waitForMessage` definition (lines 35-52) with an import, and remove the now-unused `ServerMessage` import if it becomes unused (it's still used elsewhere in the file for type casts, so keep the import).

Remove this block (lines 35-52):

```ts
function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for message type "${type}"`));
    }, timeout);

    function handler(data: Buffer) {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}
```

Add this import near the top, after the existing `import { createTestServer, ... }` line (line 4):

```ts
import { waitForMessage } from "./helpers/ws.js";
```

- [ ] **Step 3: Run the full backend test suite to confirm nothing broke**

Run: `cd apps/backend && npx vitest run`
Expected: `Test Files 2 passed (2)`, `Tests 14 passed (14)` — identical to the pre-refactor baseline.

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/__tests__/helpers/ws.ts apps/backend/src/__tests__/session.test.ts
git commit -m "test: extract shared waitForMessage WebSocket test helper"
```

---

## Task 2: Thread `userId` through `Session`, `index.ts`, and the test server helper

Pure plumbing — no quota logic yet. `Session` accepts an optional `userId`, `index.ts` passes the one it already resolves from the auth token, and the test helper gains an optional parameter so later tasks can simulate an authenticated user. Existing tests must stay green because they call `createTestServer()` with no arguments, defaulting `userId` to `null`.

**Files:**
- Modify: `apps/backend/src/session.ts:12-32`
- Modify: `apps/backend/src/index.ts:19-40`
- Modify: `apps/backend/src/__tests__/helpers/server.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `new Session(ws: WebSocket, userId?: string | null)` — `userId` defaults to `null`. `createTestServer(userId?: string | null): Promise<TestServer>` — `userId` defaults to `null`, consumed by Task 3 and Task 4's tests.

- [ ] **Step 1: Add `userId` to the `Session` constructor**

In `apps/backend/src/session.ts`, change lines 12-32 from:

```ts
export class Session {
  private ws: WebSocket;
  private stt: FluxSTT | null = null;
  private config: SessionConfig | null = null;
  private jobContext: JobContext | undefined = undefined;
  private transcriptBuffer: string[] = [];
  private conversationLog: string[] = [];
  private relanceLog: string[] = [];
  private cardLog: Insight[] = [];
  private sessionStartMs = 0;
  private readonly MAX_LOG_ENTRIES = 15;
  private readonly MAX_CARD_LOG = 30;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 1500;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupHandlers();
  }
```

to:

```ts
export class Session {
  private ws: WebSocket;
  private userId: string | null;
  private stt: FluxSTT | null = null;
  private config: SessionConfig | null = null;
  private jobContext: JobContext | undefined = undefined;
  private transcriptBuffer: string[] = [];
  private conversationLog: string[] = [];
  private relanceLog: string[] = [];
  private cardLog: Insight[] = [];
  private sessionStartMs = 0;
  private readonly MAX_LOG_ENTRIES = 15;
  private readonly MAX_CARD_LOG = 30;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 1500;

  constructor(ws: WebSocket, userId: string | null = null) {
    this.ws = ws;
    this.userId = userId;
    this.setupHandlers();
  }
```

- [ ] **Step 2: Pass the resolved `userId` from `index.ts`**

In `apps/backend/src/index.ts`, change lines 19-40 from:

```ts
  app.get("/ws", { websocket: true }, async (socket, req) => {
    if (supabaseAdmin) {
      const token = new URL(req.url ?? "", `http://${req.headers.host}`).searchParams.get("token");

      if (!token) {
        socket.close(4001, "Missing token");
        return;
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        socket.close(4003, "Invalid token");
        return;
      }

      console.log(`[Server] New WebSocket connection (user ${data.user.id})`);
    } else {
      console.log("[Server] New WebSocket connection (auth disabled)");
    }

    new Session(socket);
  });
```

to:

```ts
  app.get("/ws", { websocket: true }, async (socket, req) => {
    let userId: string | null = null;

    if (supabaseAdmin) {
      const token = new URL(req.url ?? "", `http://${req.headers.host}`).searchParams.get("token");

      if (!token) {
        socket.close(4001, "Missing token");
        return;
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        socket.close(4003, "Invalid token");
        return;
      }

      userId = data.user.id;
      console.log(`[Server] New WebSocket connection (user ${userId})`);
    } else {
      console.log("[Server] New WebSocket connection (auth disabled)");
    }

    new Session(socket, userId);
  });
```

- [ ] **Step 3: Add an optional `userId` parameter to the test server helper**

Read current content first: `apps/backend/src/__tests__/helpers/server.ts`. Change:

```ts
export async function createTestServer(): Promise<TestServer> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    new Session(socket);
  });
```

to:

```ts
export async function createTestServer(userId: string | null = null): Promise<TestServer> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    new Session(socket, userId);
  });
```

- [ ] **Step 4: Run the full backend test suite to confirm nothing broke**

Run: `cd apps/backend && npx vitest run`
Expected: `Test Files 2 passed (2)`, `Tests 14 passed (14)`.

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/index.ts apps/backend/src/__tests__/helpers/server.ts
git commit -m "refactor: thread userId through Session and test server helper"
```

---

## Task 3: Block `session:start` when the user's quota is exhausted

TDD: write both the blocked and allowed cases first, watch the blocked one fail, then implement the quota check in `startSession`.

**Files:**
- Modify: `apps/backend/src/session.ts` (the `startSession` method, and `handleMessage`'s `session:start` case)
- Create: `apps/backend/src/__tests__/session-usage-limit.test.ts`

**Interfaces:**
- Consumes: `waitForMessage` from `apps/backend/src/__tests__/helpers/ws.ts` (Task 1); `createTestServer(userId)` from `apps/backend/src/__tests__/helpers/server.ts` (Task 2).
- Produces: a mocked `../supabase.js` module shape (`supabaseAdmin.from().select().eq().single()` and `supabaseAdmin.rpc()`) that Task 4 reuses in the same test file.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/__tests__/session-usage-limit.test.ts`:

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
const mockLlm = vi.hoisted(() => ({
  streamAssist: vi.fn(),
}));
const mockSupabase = vi.hoisted(() => ({
  profileResult: { data: null as { session_count: number; session_limit: number } | null, error: null as { message: string } | null },
  rpc: vi.fn(() => Promise.resolve({ error: null as { message: string } | null })),
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
  callClaudeJSON: vi.fn(),
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

vi.mock("../supabase.js", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve(mockSupabase.profileResult),
        }),
      }),
    }),
    rpc: mockSupabase.rpc,
  },
}));

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
  });
}

const sampleAssistText = [
  "[strength] [high]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
].join("\n");

describe("Session usage limit", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockSupabase.rpc.mockClear();
    mockSupabase.rpc.mockResolvedValue({ error: null });
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("blocks session:start and does not create an STT connection when quota is exhausted", async () => {
    mockSupabase.profileResult = { data: { session_count: 5, session_limit: 5 }, error: null };
    server = await createTestServer("user-at-limit");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = (await waitForMessage(ws, "session:error")) as Extract<ServerMessage, { type: "session:error" }>;
    expect(msg.error).toContain("Limite de 5 entretiens atteinte");
    expect(stt.callbacks).toBeNull();
  });

  it("allows session:start when the user is under quota", async () => {
    mockSupabase.profileResult = { data: { session_count: 2, session_limit: 5 }, error: null };
    server = await createTestServer("user-under-limit");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = await waitForMessage(ws, "session:ready");
    expect(msg.type).toBe("session:ready");
  });

  it("allows session:start when Supabase profile read errors (fail open)", async () => {
    mockSupabase.profileResult = { data: null, error: { message: "boom" } };
    server = await createTestServer("user-error");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = await waitForMessage(ws, "session:ready");
    expect(msg.type).toBe("session:ready");
  });

  it("allows session:start when userId is null (auth disabled)", async () => {
    mockSupabase.profileResult = { data: { session_count: 5, session_limit: 5 }, error: null };
    server = await createTestServer(null);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));

    const msg = await waitForMessage(ws, "session:ready");
    expect(msg.type).toBe("session:ready");
  });
});
```

Note: `sampleAssistText` and `mockLlm.streamAssist` are declared here for parity with the mocked modules but aren't exercised by these four tests — they're used starting in Task 4. Keep them; removing and re-adding would just create churn between tasks.

- [ ] **Step 2: Run the tests to verify the blocked case fails**

Run: `cd apps/backend && npx vitest run src/__tests__/session-usage-limit.test.ts`
Expected: `blocks session:start...` FAILS (times out waiting for `session:error`, because `session:ready` is sent instead — no quota check exists yet). The other three tests PASS already since they only require the pre-existing "always start" behavior.

- [ ] **Step 3: Implement the quota check**

In `apps/backend/src/session.ts`, add the import and add a local interface near the top of the file. Change the import block (lines 1-10) from:

```ts
import type { WebSocket } from "ws";
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { FluxSTT } from "./deepgram-flux.js";
import { streamAssist, callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";
```

to:

```ts
import type { WebSocket } from "ws";
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { FluxSTT } from "./deepgram-flux.js";
import { streamAssist, callClaudeJSON, correctTranscript } from "./llm.js";
import { buildLiveAssistPrompt } from "./prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "./prompts/final-analysis.js";
import { supabaseAdmin } from "./supabase.js";

interface ProfileUsage {
  session_count: number;
  session_limit: number;
}
```

Change `handleMessage`'s `session:start` case from:

```ts
      case "session:start":
        this.startSession(message.config);
        break;
```

to:

```ts
      case "session:start":
        void this.startSession(message.config);
        break;
```

Change `startSession` from:

```ts
  private startSession(config: SessionConfig): void {
    this.config = config;
    this.jobContext = config.jobContext;
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = Date.now();

    this.stt?.close();
    this.stt = new FluxSTT(config.language, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    void this.stt.start();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}, jobContext=${config.jobContext ? config.jobContext.title : "none"}`);
  }
```

to:

```ts
  private async startSession(config: SessionConfig): Promise<void> {
    if (this.userId && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("session_count, session_limit")
        .eq("id", this.userId)
        .single();

      const usage = data as ProfileUsage | null;

      if (!error && usage && usage.session_count >= usage.session_limit) {
        this.send({
          type: "session:error",
          error: `Limite de ${usage.session_limit} entretiens atteinte pour ce compte. Contacte-nous pour continuer.`,
        });
        return;
      }
    }

    this.config = config;
    this.jobContext = config.jobContext;
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = Date.now();

    this.stt?.close();
    this.stt = new FluxSTT(config.language, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });

    void this.stt.start();

    const sessionId = `session_${Date.now()}`;
    this.send({ type: "session:ready", sessionId });
    console.log(`[Session] Started: language=${config.language}, jobContext=${config.jobContext ? config.jobContext.title : "none"}`);
  }
```

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `cd apps/backend && npx vitest run src/__tests__/session-usage-limit.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd apps/backend && npx vitest run`
Expected: `Test Files 3 passed (3)`, `Tests 18 passed (18)`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/session-usage-limit.test.ts
git commit -m "feat(usage-limit): block session:start when a user's quota is exhausted"
```

---

## Task 4: Increment `session_count` on session end, only if the session had content

TDD: write the positive case (real transcript → increments) and the negative case (empty session → no increment) in the same test file, watch the positive one fail, then implement in `cleanup()`.

**Files:**
- Modify: `apps/backend/src/session.ts` (the `cleanup` method)
- Modify: `apps/backend/src/__tests__/session-usage-limit.test.ts` (append two tests)

**Interfaces:**
- Consumes: `mockSupabase.rpc` and `mockSupabase.profileResult` from Task 3's mock setup in the same test file; `sampleAssistText` and `mockLlm.streamAssist` already declared in Task 3's file.
- Produces: none for later tasks — this is the last behavioral task.

- [ ] **Step 1: Write the failing tests**

Append to `apps/backend/src/__tests__/session-usage-limit.test.ts`, inside the existing `describe("Session usage limit", ...)` block, after the four tests from Task 3:

```ts
  it("increments session_count after a session with at least one transcript", async () => {
    mockSupabase.profileResult = { data: { session_count: 0, session_limit: 5 }, error: null };
    mockLlm.streamAssist.mockImplementationOnce(
      async (_sys: string, _user: string, onChunk: (t: string) => void) => {
        onChunk(sampleAssistText);
        return sampleAssistText;
      }
    );
    server = await createTestServer("user-with-content");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    stt.callbacks!.onTranscript("J'utilise React depuis 3 ans en production");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:stop" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSupabase.rpc).toHaveBeenCalledWith("increment_session_count", { uid: "user-with-content" });
  });

  it("does not increment session_count when the session had no transcript", async () => {
    mockSupabase.profileResult = { data: { session_count: 0, session_limit: 5 }, error: null };
    server = await createTestServer("user-empty-session");
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    ws.send(JSON.stringify({ type: "session:stop" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify the positive case fails**

Run: `cd apps/backend && npx vitest run src/__tests__/session-usage-limit.test.ts`
Expected: `increments session_count after a session with at least one transcript` FAILS (`mockSupabase.rpc` was never called — `cleanup()` doesn't call it yet). `does not increment session_count when the session had no transcript` PASSES already (trivially — no code path calls `rpc` yet), which is expected; it becomes a real regression guard once Step 3 lands.

- [ ] **Step 3: Implement the increment in `cleanup()`**

In `apps/backend/src/session.ts`, change `cleanup()` from:

```ts
  private cleanup(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = 0;
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    this.jobContext = undefined;
    console.log("[Session] Cleaned up");
  }
```

to:

```ts
  private cleanup(): void {
    if (this.userId && supabaseAdmin && this.conversationLog.length > 0) {
      void supabaseAdmin
        .rpc("increment_session_count", { uid: this.userId })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error("[Session] Failed to increment session_count:", error.message);
        });
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = 0;
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.config = null;
    this.jobContext = undefined;
    console.log("[Session] Cleaned up");
  }
```

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `cd apps/backend && npx vitest run src/__tests__/session-usage-limit.test.ts`
Expected: all 6 tests in this file PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd apps/backend && npx vitest run`
Expected: `Test Files 3 passed (3)`, `Tests 20 passed (20)`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0. If the `.rpc(...).then(({ error }) => ...)` callback parameter typing conflicts with the real `@supabase/supabase-js` return type (the mock in tests is untyped, but production code type-checks against the real SDK), remove the explicit `{ error: { message: string } | null }` annotation on the callback parameter and let it infer from `supabaseAdmin.rpc`'s real return type instead — the mock in the test file doesn't affect production type-checking since Vitest mocks aren't visible to `tsc`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/session-usage-limit.test.ts
git commit -m "feat(usage-limit): increment session_count on cleanup when the session had content"
```

---

## Task 5: Document the SQL migration and default limit in the deploy doc

Keeps the SQL the user runs by hand in one place, alongside the JOUR 1 schema it extends, instead of only living in the design spec.

**Files:**
- Modify: `SUPABASE_AUTH_DEPLOY.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Append the migration SQL after the JOUR 1 schema section**

Read `SUPABASE_AUTH_DEPLOY.md` first to find the end of section "1.3 Schéma de base de données" (the SQL code block that ends with the `set_updated_at` trigger, just before "### 1.4 Installer le SDK Supabase"). Insert a new subsection immediately after that SQL block and before `### 1.4`:

```markdown
### 1.3bis Limite d'usage par utilisateur (bêta)

Pendant la bêta, chaque utilisateur est limité à un nombre de sessions (entretiens démarrés avec succès). À exécuter après le schéma ci-dessus :

```sql
-- ═══════════════════════════════════
-- Limite d'usage (bêta)
-- ═══════════════════════════════════

alter table public.profiles
  add column session_count int not null default 0,
  add column session_limit int not null default 5;

create or replace function public.increment_session_count(uid uuid)
returns void as $$
begin
  update public.profiles set session_count = session_count + 1 where id = uid;
end;
$$ language plpgsql;
```

Pour donner un accès illimité (ou une limite différente) à un utilisateur donné, modifier directement `session_limit` sur sa ligne dans Supabase Dashboard → Table Editor → `profiles`.
```

- [ ] **Step 2: Commit**

```bash
git add SUPABASE_AUTH_DEPLOY.md
git commit -m "docs: add usage-limit SQL migration to Supabase deploy guide"
```

---

## Task 6: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: `Test Files 3 passed (3)`, `Tests 20 passed (20)`.

- [ ] **Step 2: Full backend typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Full web typecheck (confirm no cross-package breakage)**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Manual smoke test against a real Supabase project**

Requires `apps/backend/.env` and `apps/web/.env` already populated with real Supabase keys (already done per prior session) and the JOUR 1 + Task 5 SQL executed in Supabase Dashboard.

1. In Supabase Dashboard → Table Editor → `profiles`, set `session_limit = 0` for your own test user.
2. Run `pnpm dev` from the repo root.
3. Log in as that user in the browser, click "Démarrer l'écoute".
4. Confirm the red error banner shows "Limite de 0 entretiens atteinte pour ce compte..." and no live cards ever appear.
5. Set `session_limit` back to `5` and `session_count = 0` for that user.
6. Repeat: log in, start a session, speak a sentence (or use the existing dev flow for feeding a transcript), stop the session.
7. Confirm in Supabase Table Editor that `session_count` is now `1`.
