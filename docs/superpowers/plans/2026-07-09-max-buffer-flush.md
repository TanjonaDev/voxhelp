# Forced Transcript Flush After 3min Monologue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee the live-assist copilot analyzes a candidate's speech at least once every 3 minutes, even during a continuous monologue where Deepgram Flux never reports a pause longer than the existing 1.5s debounce.

**Architecture:** `Session` (`apps/backend/src/session.ts`) gains a second, independent timer (`maxBufferTimer`) that starts the moment `transcriptBuffer` goes from empty to non-empty and — unlike the existing debounce timer — is never reset by subsequent transcript pieces. When it fires, it forces the same flush-and-analyze path the debounce timer already uses. The flush logic (currently duplicated between the debounce timeout callback and `triggerAnalysis()`) is extracted into one shared `flushBuffer()` method so both timers and the manual trigger go through identical logic.

**Tech Stack:** Fastify + `@fastify/websocket`, Vitest with real timers (no fake timers — consistent with the existing suite's convention of waiting out real, short timer values in tests).

## Global Constraints

- TypeScript strict, no `any` (project convention).
- ESM imports with `.js` extensions in backend source (project convention).
- Default duration is 3 minutes (`3 * 60 * 1000` ms), but the value must be injectable via an optional `Session` constructor parameter (not a hardcoded-only constant), so tests can use a short duration instead of waiting 3 real minutes — same precedent as the existing optional `userId` constructor parameter.
- The max-buffer timer starts only when `transcriptBuffer` transitions from empty to non-empty, and is **never** reset by subsequent transcript pieces (that's what distinguishes it from the debounce timer).
- Any flush — via the debounce timer, the max-buffer timer, or the manual `triggerAnalysis()` path — must clear both timers, so a stale debounce (or a stale max-buffer timer) can never fire a second time against an already-emptied buffer.
- `cleanup()` must clear the max-buffer timer, same as it already clears the debounce timer.
- Spec reference: `docs/superpowers/specs/2026-07-09-max-buffer-flush-design.md`.

---

## Task 1: Extract `flushBuffer()` and add the max-buffer timer (TDD)

**Files:**
- Modify: `apps/backend/src/session.ts`
- Modify: `apps/backend/src/__tests__/helpers/server.ts`
- Create: `apps/backend/src/__tests__/session-max-buffer.test.ts`

**Interfaces:**
- Consumes: `waitForMessage` from `apps/backend/src/__tests__/helpers/ws.ts` (existing).
- Produces: `new Session(ws: WebSocket, userId?: string | null, maxBufferMs?: number)` — `maxBufferMs` defaults to `3 * 60 * 1000`. `createTestServer(userId?: string | null, maxBufferMs?: number): Promise<TestServer>` — `maxBufferMs` defaults to `3 * 60 * 1000` and is passed through to `Session`.

- [ ] **Step 1: Add the optional `maxBufferMs` parameter to the test server helper**

Read `apps/backend/src/__tests__/helpers/server.ts` first to confirm it's unchanged from what's shown below. Change:

```ts
export async function createTestServer(userId: string | null = null): Promise<TestServer> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    new Session(socket, userId);
  });
```

to:

```ts
export async function createTestServer(
  userId: string | null = null,
  maxBufferMs: number = 3 * 60 * 1000
): Promise<TestServer> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    new Session(socket, userId, maxBufferMs);
  });
```

- [ ] **Step 2: Write the failing tests**

Create `apps/backend/src/__tests__/session-max-buffer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
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

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const sampleAssistText = [
  "[strength] [high]",
  "# Expérience terrain confirmée en React",
  "Le candidat montre une vraie expérience React en production.",
].join("\n");

describe("Session max buffer flush", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockLlm.streamAssist.mockImplementation(
      async (_sys: string, _user: string, onChunk: (t: string) => void) => {
        onChunk(sampleAssistText);
        return sampleAssistText;
      }
    );
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("flushes the buffered transcript after maxBufferMs even if new turns keep arriving faster than the debounce", async () => {
    server = await createTestServer(null, 150);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    const start = Date.now();
    stt.callbacks!.onTranscript("Premier segment du monologue.");
    await wait(60);
    stt.callbacks!.onTranscript("Deuxième segment du monologue.");
    await wait(60);
    stt.callbacks!.onTranscript("Troisième segment du monologue.");

    await waitForMessage(ws, "assist:done");
    const elapsed = Date.now() - start;

    // With only the 1500ms debounce (pre-implementation), this flush wouldn't
    // happen until ~1500ms after the last piece (~1620ms total). The 150ms
    // maxBufferMs must force it far sooner than that.
    expect(elapsed).toBeLessThan(800);
    expect(mockLlm.streamAssist).toHaveBeenCalledTimes(1);
    const userText = mockLlm.streamAssist.mock.calls[0][1] as string;
    expect(userText).toContain("Premier segment du monologue.");
    expect(userText).toContain("Deuxième segment du monologue.");
    expect(userText).toContain("Troisième segment du monologue.");
  });

  it("does not double-flush once the stale debounce timer's original deadline passes", async () => {
    server = await createTestServer(null, 100);
    ws = await connect(server.port);

    ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    await waitForMessage(ws, "session:ready");

    const start = Date.now();
    stt.callbacks!.onTranscript("Un seul segment.");
    await waitForMessage(ws, "assist:done");
    const elapsed = Date.now() - start;

    // Confirms this particular flush was driven by maxBufferMs (100ms), not
    // the 1500ms debounce — otherwise the check below would be meaningless.
    expect(elapsed).toBeLessThan(500);

    // Wait past the original (1500ms) debounce deadline that was pending
    // when the buffer was flushed early. If flushBuffer() didn't clear it,
    // it would fire again here with an empty buffer.
    await wait(1700);

    expect(mockLlm.streamAssist).toHaveBeenCalledTimes(1);
  });
});
```

Note on the second test: `Session`'s existing debounce is a fixed `DEBOUNCE_MS = 1500` (not configurable — only `maxBufferMs` is). With `maxBufferMs = 100`, the max-buffer timer fires first and (once Step 4 is implemented) clears the pending 1500ms debounce. Waiting 1700ms total after the transcript confirms that stale debounce never fires a second, redundant analysis.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/__tests__/session-max-buffer.test.ts`
Expected: both tests FAIL on their `expect(elapsed).toBeLessThan(...)` assertion. `Session`'s constructor doesn't accept a third parameter yet (the extra constructor arg is silently ignored by JS — no crash), so the only flush mechanism still active is the existing 1500ms debounce. In test 1, the flush won't happen until ~1500ms after the last of the three pieces (~1620ms total), failing `toBeLessThan(800)`. In test 2, the single flush won't happen until ~1500ms after the transcript, failing `toBeLessThan(500)`. Both are genuine, deterministic timing failures — not a coincidental pass — because nothing today can flush faster than the fixed 1500ms debounce.

- [ ] **Step 4: Implement `flushBuffer()` and the max-buffer timer**

In `apps/backend/src/session.ts`, make these changes:

**4a. Constructor and fields** — change:

```ts
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

to:

```ts
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
  private maxBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBufferMs: number;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 1500;

  constructor(ws: WebSocket, userId: string | null = null, maxBufferMs: number = 3 * 60 * 1000) {
    this.ws = ws;
    this.userId = userId;
    this.maxBufferMs = maxBufferMs;
    this.setupHandlers();
  }
```

**4b. `triggerAnalysis()`** — change:

```ts
  private triggerAnalysis(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const existing = this.transcriptBuffer.join(" ").trim();
    if (existing) {
      this.transcriptBuffer = [];
      if (this.isProcessing) {
        this.pendingTranscript = existing;
      } else {
        this.processTranscript(existing);
      }
    }
  }
```

to:

```ts
  private triggerAnalysis(): void {
    this.flushBuffer();
  }

  private flushBuffer(): void {
    if (this.maxBufferTimer) {
      clearTimeout(this.maxBufferTimer);
      this.maxBufferTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const fullText = this.transcriptBuffer.join(" ").trim();
    this.transcriptBuffer = [];

    if (!fullText) return;

    if (this.isProcessing) {
      this.pendingTranscript = fullText;
    } else {
      this.processTranscript(fullText);
    }
  }
```

**4c. `handleFinalTranscript()`** — change:

```ts
  private async handleFinalTranscript(rawText: string): Promise<void> {
    if (!rawText.trim()) return;

    const sttContext = this.jobContext
      ? `${this.jobContext.title || ""} ${this.jobContext.stack || ""}`.trim()
      : undefined;
    const text = await correctTranscript(rawText, sttContext);

    this.send({ type: "transcript:final", text });
    this.transcriptBuffer.push(text);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      const fullText = this.transcriptBuffer.join(" ");
      this.transcriptBuffer = [];

      if (!fullText.trim()) return;

      if (this.isProcessing) {
        this.pendingTranscript = fullText;
        return;
      }

      this.processTranscript(fullText);
    }, this.DEBOUNCE_MS);
  }
```

to:

```ts
  private async handleFinalTranscript(rawText: string): Promise<void> {
    if (!rawText.trim()) return;

    const sttContext = this.jobContext
      ? `${this.jobContext.title || ""} ${this.jobContext.stack || ""}`.trim()
      : undefined;
    const text = await correctTranscript(rawText, sttContext);

    this.send({ type: "transcript:final", text });

    if (this.transcriptBuffer.length === 0 && !this.maxBufferTimer) {
      this.maxBufferTimer = setTimeout(() => this.flushBuffer(), this.maxBufferMs);
    }

    this.transcriptBuffer.push(text);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.flushBuffer();
    }, this.DEBOUNCE_MS);
  }
```

**4d. `cleanup()`** — change:

```ts
  private cleanup(): void {
    if (this.userId && supabaseAdmin && this.conversationLog.length > 0) {
      void supabaseAdmin
        .rpc("increment_session_count", { uid: this.userId })
        .then(({ error }) => {
          if (error) console.error("[Session] Failed to increment session_count:", error.message);
        });
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.transcriptBuffer = [];
```

to:

```ts
  private cleanup(): void {
    if (this.userId && supabaseAdmin && this.conversationLog.length > 0) {
      void supabaseAdmin
        .rpc("increment_session_count", { uid: this.userId })
        .then(({ error }) => {
          if (error) console.error("[Session] Failed to increment session_count:", error.message);
        });
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxBufferTimer) {
      clearTimeout(this.maxBufferTimer);
      this.maxBufferTimer = null;
    }
    this.transcriptBuffer = [];
```

(The rest of `cleanup()` — `this.conversationLog = []` onward — is unchanged.)

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/__tests__/session-max-buffer.test.ts`
Expected: both tests PASS, and the first test's total run time is close to ~120ms (not ~1500ms+), confirming the max-buffer timer — not the debounce — triggered the flush.

- [ ] **Step 6: Run the full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: all test files pass, total test count is 21 (previous) + 2 (new) = 23.

- [ ] **Step 7: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/helpers/server.ts apps/backend/src/__tests__/session-max-buffer.test.ts
git commit -m "feat(live-assist): force a transcript flush after 3min of continuous monologue"
```

---

## Task 2: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: all test files pass, 23 tests total.

- [ ] **Step 2: Full backend typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Full web typecheck (confirm no cross-package breakage)**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Sanity-check the production default**

Run: `grep -n "maxBufferMs: number = " apps/backend/src/session.ts`
Expected: shows the constructor default as `3 * 60 * 1000` — confirms no test-only override leaked into the production default.
