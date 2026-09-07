# Vertical Package Boundaries — Design

## Context

VoxHelp now has two verticals sharing one monorepo:

- **Recruit** (existing product): real-time interview copilot. Its domain logic
  (prompts, CV parsing) currently lives directly inside `apps/backend/src`,
  mixed in with the Fastify host, the WebSocket session orchestrator
  (`session.ts`), and the Deepgram/Anthropic client wrappers.
- **Cours** (new vertical, in progress): async post-hoc lecture analysis.
  Its Pass 1 domain logic already lives in its own workspace package,
  `@voxhelp/lecture` (types, Zod schema, prompts, windowing, orchestration —
  zero direct dependency on `@anthropic-ai/sdk`, the LLM call is injected).

The asymmetry — Cours has a clean package boundary, Recruit doesn't — makes
it hard to reason about which code is "Recruit-specific business logic" vs.
"shared backend infrastructure" as more verticals get added. This raised the
question of how verticals should be organized going forward.

## Decision

**Give every vertical's domain logic its own workspace package, but keep one
shared deployable backend (`apps/backend`) and one shared frontend
(`apps/web`) for now.** No plan to deploy verticals as separate apps/servers
in the near term — this is purely a code-organization change, not an infra
change. If a vertical later needs independent scaling or a separate release
cycle, its logic is already decoupled into a package and lifting it into its
own `apps/<vertical>-backend` becomes a mechanical follow-up, not a rewrite.

Two approaches were considered and rejected for now:

- **Separate deployable apps per vertical** (`apps/recruit-backend` +
  `apps/cours-backend`, etc.): true isolation (a slow Cours batch job can't
  affect Recruit's real-time WebSocket loop), but doubles ops overhead
  (2 servers, 2 CORS/auth configs, 2 deploy pipelines) for no immediate
  benefit — there's no plan to sell or scale these verticals independently
  yet.
- **Status quo** (Cours logic packaged, Recruit logic left inside
  `apps/backend`): asymmetric, and the boundary between "Recruit domain
  logic" and "shared backend infra" stays implicit and erodes over time as
  more routes get added to the same files.

## Scope

### Extracted into `@voxhelp/recruit` (this pass)

Pure, infra-free functions with no coupling to Fastify, WebSockets, Supabase,
or the Anthropic SDK — safe to move mechanically with zero behavior change:

- `apps/backend/src/prompts/cv-keyword-extraction.ts`
- `apps/backend/src/prompts/final-analysis.ts`
- `apps/backend/src/prompts/live-assist.ts`
- `apps/backend/src/cv-parser.ts` (and its `unpdf`/`mammoth` dependencies)

### Explicitly NOT touched in this pass

- `apps/backend/src/session.ts` (566 lines) — the per-connection WebSocket
  orchestrator. It imports `ws`, `supabaseAdmin`, `FluxSTT`
  (`deepgram-flux.ts`), and the SDK-touching functions in `llm.ts` directly.
  Turning this into an injectable, infra-free package (matching the
  `@voxhelp/lecture` shape) is a real redesign, not a file move — and
  `session.ts` is the file `CLAUDE.md` flags as the current #1 debugging
  priority (tab-audio capture for Google Meet). Refactoring it purely for
  organization right now risks regressing fragile, actively-worked-on code.
  Revisit as its own dedicated design if/when it needs to happen.
- `deepgram-flux.ts`, `groq-stt.ts`, `llm.ts`, `supabase.ts` — infrastructure
  adapters shared by both verticals' backend routes (Cours' route already
  wires `callClaudeJSON` from `llm.ts`). These stay in `apps/backend` as host
  utilities.
- `packages/shared` — `Insight`, `CandidateReport`, `SkillMatch`, etc. stay
  put. They're consumed by `apps/web` too, so moving them into
  `@voxhelp/recruit` would cross the frontend/backend boundary, which is a
  separate concern from this pass.

## Structure

```
packages/recruit/
  package.json         @voxhelp/recruit — deps: unpdf, mammoth, @voxhelp/shared (workspace:*)
  tsconfig.json         same pattern as packages/lecture (extends ../../tsconfig.json)
  vitest.config.ts       same pattern as packages/lecture
  src/
    cv-parser.ts
    prompts/
      cv-keyword-extraction.ts
      final-analysis.ts
      live-assist.ts
    index.ts             re-exports everything above
    __tests__/
      cv-keyword-extraction.test.ts   (moved)
      prompts.test.ts                  (moved, covers live-assist + final-analysis)
```

In `apps/backend`:
- `package.json`: remove `unpdf`/`mammoth` (no longer used directly), add
  `"@voxhelp/recruit": "workspace:*"`.
- `routes.ts`: `import { extractTextFromCv, buildCvKeywordExtractionPrompt, type CvFormat } from "@voxhelp/recruit"` replaces the relative imports.
- `session.ts`: only its two prompt-builder import lines change to point at
  `"@voxhelp/recruit"`. No logic line is touched.
- `extract-cv-keywords.test.ts` / `extract-cv-keywords-auth.test.ts` (route-level
  HTTP tests) stay in `apps/backend`; their `vi.mock("../cv-parser.js", ...)`
  becomes `vi.mock("@voxhelp/recruit", ...)`.

## Migration approach

Purely mechanical — no business logic changes. Safety net: the existing
95-test backend suite must stay green, unchanged, after every step. No new
tests are written for this move; the moved unit tests (`prompts.test.ts`,
`cv-keyword-extraction.test.ts`) travel with their source files unmodified
except import paths.

Order (each step run + verified before the next):
1. Scaffold `packages/recruit` (package.json/tsconfig/vitest.config), mirroring `packages/lecture`.
2. Move `cv-parser.ts` and the three prompt files into `packages/recruit/src/`, add `index.ts` re-exports, move their two test files alongside, fix import paths, run `packages/recruit`'s own suite green.
3. Update `apps/backend/package.json` deps (`+@voxhelp/recruit`, `-unpdf`, `-mammoth`), `pnpm install`.
4. Update `routes.ts` and `session.ts` imports to `@voxhelp/recruit`; delete the now-empty `apps/backend/src/prompts/` dir and `apps/backend/src/cv-parser.ts`.
5. Update the two route-level test files' `vi.mock` target.
6. Run the full backend suite + `tsc --noEmit` on `packages/recruit`, `apps/backend`, `apps/web` — all must be green/clean, byte-for-byte same pass count as before the move.

## Out of scope

- Any change to `session.ts`, `deepgram-flux.ts`, or `groq-stt.ts`.
- Moving `packages/shared` types.
- Any behavior change to prompts, CV parsing, or the CV-keywords route.
- Splitting `apps/backend`/`apps/web` into per-vertical deployables (revisit
  only if/when a vertical needs independent scaling or release cadence).
