---
name: project-live-assist-card-merge
description: "Card-merge feature for live-assist redundant cards was tried and reverted after real-world testing; what's still open, what was learned."
metadata: 
  node_type: memory
  type: project
  originSessionId: bd925815-a4c2-4123-b490-0384fd6f5320
---

`bilan-retours-voxhelp-tests.md` (repo root) flagged that live-assist over-generates near-duplicate cards during a continuous candidate monologue, because the flush trigger is purely temporal (pause debounce), not semantic.

**Tried (2026-07-16):** a `[merge]` marker mechanism — before generating a new card, the backend offered the LLM the last emitted card (if <90s old) and let it decide whether to fold the new segment into it instead of creating a new card. Full plan/spec at `docs/superpowers/specs/2026-07-16-card-merge-dedup-design.md` and `docs/superpowers/plans/2026-07-16-card-merge-dedup.md`.

**Reverted the same day**, after the user tested it live: the LLM incorrectly merged a self-introduction card ("8 ans de dev backend, a rejoint RMC BFM") with a later, distinct card about which projects the candidate works on — even though a recruiter relance sat between the two topics. The LLM's "same sub-topic continues" judgment doesn't reliably respect turn/relance boundaries; it merges on surface topical similarity (e.g. both cards mention `backend`/`projet`) rather than true conversational continuity.

**Lesson for [[feedback-style]]-adjacent future work:** if revisiting this problem, don't trust an LLM merge-decision alone across flush boundaries — the relance/question that triggered the new answer is a much stronger continuity signal than the card content and should probably gate merge eligibility (e.g. no merge if a recruiter relance was asked in between), not just a time window.

**What's still in place:** `DEBOUNCE_MS` stays at 2500ms (was 1500ms) in `apps/backend/src/session.ts` — this part of the same plan was kept, since it reduces flush frequency on natural speech micro-pauses independently of the merge-decision problem and wasn't implicated in the bad merge.

**Still open:** points 2 (Traduction/Jargon overlap), 4 (factual inconsistency between cards), 5 (empty "amorce de réponse" cards), 6 (relances too technical) from `bilan-retours-voxhelp-tests.md` — untouched by this attempt.
