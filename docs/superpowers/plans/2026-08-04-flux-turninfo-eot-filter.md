# Flux TurnInfo EndOfTurn Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop forwarding every Deepgram Flux `TurnInfo` message (including the ~4/second `Update` events, each carrying the full cumulative turn transcript) into the session's transcript buffer — only the `event === "EndOfTurn"` message represents a clean, final, complete transcript for a turn.

**Architecture:** One-condition change in the message handler inside `apps/backend/src/deepgram-flux.ts`. No changes to `session.ts` or any other file — once the filter is correct, `handleFinalTranscript` receives exactly what it was always designed to receive (one clean text per turn).

**Tech Stack:** TypeScript (ESM, strict), backend-only.

## Global Constraints

- Only `apps/backend/src/deepgram-flux.ts` changes — do not touch `session.ts`.
- No `EagerEndOfTurn`/`TurnResumed` handling — deliberately out of scope (see spec).
- No automated test for this file (no existing mock of the raw `@deepgram/sdk` WebSocket message shape in this project) — implement + typecheck, manual verification only.
- TypeScript strict, no `any`.
- Spec: `docs/superpowers/specs/2026-08-04-flux-turninfo-eot-filter-design.md`.

---

### Task 1: Filter `TurnInfo` messages on `event === "EndOfTurn"`

**Files:**
- Modify: `apps/backend/src/deepgram-flux.ts:9-17,61-66`

**Interfaces:**
- No exported signatures change — `FluxSTT`'s public API (`constructor`, `start`, `sendAudio`, `close`) is untouched. This is a pure internal filtering fix.

- [ ] **Step 1: Add `event` to the inline message type**

Replace:
```ts
interface FluxConnection {
  on(event: "message", cb: (msg: { type?: string; transcript?: string }) => void): void;
```
with:
```ts
interface FluxConnection {
  on(event: "message", cb: (msg: { type?: string; event?: string; transcript?: string }) => void): void;
```

- [ ] **Step 2: Filter on `event === "EndOfTurn"`**

Replace:
```ts
      connection.on("message", (message) => {
        if (this.closed) return;
        if (message.type === "TurnInfo" && message.transcript?.trim()) {
          this.callbacks.onTranscript(message.transcript.trim());
        }
      });
```
with:
```ts
      connection.on("message", (message) => {
        if (this.closed) return;
        if (message.type === "TurnInfo" && message.event === "EndOfTurn" && message.transcript?.trim()) {
          this.callbacks.onTranscript(message.transcript.trim());
        }
      });
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: PASS, all 73 tests. This file has no dedicated tests (see Global Constraints), so this run confirms nothing else broke — `session.ts`'s tests all mock `FluxSTT` entirely, so they're unaffected by this change.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/deepgram-flux.ts
git commit -m "fix(deepgram-flux): only forward EndOfTurn transcripts, not every Update event"
```

---

### Task 2: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Real interview test with continuous speech**

Run: `pnpm dev` (from repo root), with real `DEEPGRAM_API_KEY` configured.
- Start a session, and speak a continuous technical explanation lasting 10+ seconds without a long pause (the exact scenario that produced the corrupted transcript in the original bug report).
- Watch the backend terminal for `[Session] Card [...]` logs — confirm the analyzed text (visible indirectly through the card's body, or by temporarily checking `transcript` in `processTranscript` if deeper inspection is needed) is no longer a repeated/escalating wall of text.
- Confirm no `[Session] Card skippée` log shows a giant repeated transcript like the one in the original bug report.

- [ ] **Step 2: Report back**

Since this fix's correctness can only be confirmed by ear (comparing what was actually said vs. what got analyzed), summarize what was observed — clean transcript, or still some repetition (which would mean a different/additional cause is at play, e.g. `EagerEndOfTurn` messages slipping through with a different `type` value not yet accounted for).
