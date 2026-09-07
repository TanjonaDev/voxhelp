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
