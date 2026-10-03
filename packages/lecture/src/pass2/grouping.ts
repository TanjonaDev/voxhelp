import type { LectureSection, TranscriptSegment } from "../types.js";

// 20-25 min of transcript per group: enough context for coherent prose
// within a group, small enough to keep each pass2 LLM call (and therefore
// each resumable checkpoint) a reasonable size — and it lines up with
// pass1's own windowing threshold (see windowing.ts), so a course that got
// windowed in pass1 gets grouped the same way in pass2.
export const PASS2_GROUP_DURATION_MS = 20 * 60 * 1000;

/** Splits the plan into groups of consecutive sections, each spanning at most `groupDurationMs`. */
export function groupPlanSections(
  plan: LectureSection[],
  groupDurationMs = PASS2_GROUP_DURATION_MS
): LectureSection[][] {
  if (plan.length === 0) return [];
  const groups: LectureSection[][] = [];
  let current: LectureSection[] = [];
  let groupStart = plan[0].startMs;

  for (const section of plan) {
    if (current.length > 0 && section.startMs - groupStart >= groupDurationMs) {
      groups.push(current);
      current = [];
      groupStart = section.startMs;
    }
    current.push(section);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Transcript segments overlapping [rangeStart, rangeEnd) — same half-open convention as splitIntoWindows. */
export function transcriptInRange(
  transcript: TranscriptSegment[],
  rangeStart: number,
  rangeEnd: number
): TranscriptSegment[] {
  return transcript.filter((segment) => segment.startMs < rangeEnd && segment.endMs > rangeStart);
}
