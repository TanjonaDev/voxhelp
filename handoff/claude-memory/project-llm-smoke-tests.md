---
name: project-llm-smoke-tests
description: "Smoke test harness that calls the real Claude (cards + bilan + CV keywords) to catch hallucinations, and 3 real findings from the first run"
metadata: 
  node_type: memory
  type: project
  originSessionId: 400c23b3-bce8-4c7f-9516-cce6f5a8d771
  modified: 2026-09-09T12:13:25.664Z
---

Added `apps/backend/src/__tests__/smoke/` — opt-in tests that call the real
Anthropic API (never mocked) on adversarial fixtures: STT-garbled transcripts,
a job stack never mentioned aloud (hallucination bait for techMatching), weak
CVs with only generic terms, recruiter-questions-only sessions, empty
sessions. Run with `pnpm --filter @voxhelp/backend test:smoke` (needs
`ANTHROPIC_API_KEY` in `.env`; skips cleanly without it). Excluded from
`pnpm test`/CI (`vitest.config.ts` excludes the smoke dir) — real cost,
non-deterministic. Checks are deterministic string/enum matching, not an
LLM-judge: citation-verbatim + timestamp match, never-spoken skills stay
`non-aborde`, no invented candidate name, strict card header format, empty
session rule. See `apps/backend/src/__tests__/smoke/README.md`.

Small supporting refactor (pure, no behavior change): `parseAssistText` /
`extractThemeAndAngle` / `normalizeStatus` extracted from `session.ts` to
`apps/backend/src/insight-parsing.ts`; `normalizeSkillMatchStatus` /
`normalizeVerdict` to `apps/backend/src/report-normalize.ts`. Both imported
by `session.ts` and by the smoke tests, so the tests exercise the exact same
interpretation logic as production — no drift risk. [[project-jargon-removal-validates-density]]

**3 findings from the first live run (2026-09-09) — outcome after fixing, verified over 5 real runs:**

1. **FIXED & verified.** `callClaudeJSON` (`apps/backend/src/llm.ts`) threw
   `SyntaxError: Unexpected non-whitespace character after JSON` when Claude
   appended prose after the JSON block (weak-signal CV in
   `extract-cv-keywords`). Fixed with `extractJsonPayload()` — scans for the
   first balanced `{...}`/`[...]` (string-aware) instead of assuming the
   whole trimmed response is JSON. Unit-tested in
   `apps/backend/src/__tests__/llm-json-parsing.test.ts`. Green on 3
   consecutive real runs after the fix.

2. **FIXED & verified.** `extract-cv-keywords` returned a paraphrase
   ("outil de déploiement") rather than a literal CV excerpt. Fixed by
   adding an explicit verbatim-copy rule to
   `packages/recruit/src/prompts/cv-keyword-extraction.ts`. Green on 3
   consecutive real runs (one fixture fix needed too: "bootcamp" isn't
   actually generic, removed from that fixture's `shouldNotAppear`).

3. **IMPROVED, NOT ELIMINATED — still open.** live-assist's `[skip]` fires
   on legitimate new-topic candidate answers that match neither skip rule.
   Reproduced on every one of 5 real runs (2-6 turns per run, varying which
   ones). Added to `buildLiveAssistPrompt`: an explicit "skip only when rule
   1 or 2 clearly applies, default to a card when in doubt" framing, and a
   caveat that a short affirmative opener ("Oui,") isn't itself a skip
   signal. Measurable effect unclear given high run-to-run variance — this
   looks like a real limitation of `claude-haiku-4-5` on this prompt rather
   than a wording fix. Net effect stays the same: no hallucination risk in
   the final bilan (it independently reads `fullTranscriptLog`), only a
   live-signal-loss UX gap (recruiter doesn't see the card pop up). Next
   step if this matters enough: try a stronger model for `streamAssist` in
   live-assist, or a more structural prompt rework — both bigger decisions
   than a wording tweak.

**Also found while fixing #3:** a companion issue where the angle field
sometimes renders as the English "context" instead of "contexte" — added a
one-line safeguard in the prompt, only partially effective (still seen once
after the fix). Likely the same underlying Haiku-adherence gap as #3.

**Also found and fixed a self-inflicted regression:** the first attempt to
harden `buildFinalAnalysisPrompt`'s citation-casing rule ("never capitalize
a lowercase source word") was over-applied by Claude as "always lowercase
the citation" — it started lowercasing genuinely-capitalized sentence-start
quotes, breaking the verbatim check the other way. Fixed by rephrasing to a
symmetric rule ("casse identique dans un sens comme dans l'autre") — caught
by the smoke suite itself on the very next run, confirms the harness works
as a regression net for prompt edits, not just a one-time finder. [[project-live-assist-card-merge]]

**How to apply:** before touching `live-assist.ts`'s skip rules again,
re-run `pnpm test:smoke` to get a fresh baseline first (model behavior is
noisy run-to-run) — don't judge a single run's skip count as proof of
better or worse. Treat the smoke suite's red as the regression signal after
any prompt edit; don't loosen fixtures/checks to force green without first
confirming the underlying behavior actually changed.
