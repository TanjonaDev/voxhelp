import type { LectureSection, TranscriptSegment } from "@voxhelp/lecture";

// Pass 2's output is a single flat Markdown document ("## " headings in plan
// order, followed by "## Glossaire" / "## Références citées" annexes) with
// no inline timestamps — the rewrite prompt never asks for them. There is
// no per-paragraph timestamp for the clean/rewritten text: only the
// chapter's own startMs (from Pass 1's plan) is real data, so it is shown
// once, on the chapter's first paragraph, and left blank on the rest —
// rather than inventing a per-paragraph time.

export interface ChapterBlock {
  timestampMs: number | null;
  text: string;
}

const ANNEX_TITLES = new Set(["Glossaire", "Références citées"]);

// Each "## " heading the rewrite/condense prompts produce is preceded by an
// invisible "<!-- s:{index} -->" marker carrying the plan section's own
// index (see pass2/prompts.ts and condense/prompts.ts). Matching sections by
// this id — instead of by the Nth heading found in the document — survives
// the model dropping or merging a section it judged too minor for its own
// heading: real run, one skipped "## " among ~75 silently shifted every
// section after it by one position, cascading all the way to "no content"
// on several real chapters near the end. An id-keyed map only loses the one
// section that's actually missing.
const SECTION_MARKER = /^<!--\s*s:\s*(\d+)\s*-->\s*$/;

/** Splits the rewritten/condensed Markdown into one paragraph list per plan section. */
export function splitCleanDocumentByChapter(markdown: string, plan: LectureSection[]): ChapterBlock[][] {
  const lines = markdown.split(/\r?\n/);
  const sectionTexts = new Map<number, string>();
  let pendingIndex: number | null = null;
  let currentIndex: number | null = null;
  let current: string[] | null = null;

  const flush = () => {
    if (currentIndex !== null && current !== null) sectionTexts.set(currentIndex, current.join("\n"));
    current = null;
    currentIndex = null;
  };

  for (const line of lines) {
    const marker = line.match(SECTION_MARKER);
    if (marker) {
      pendingIndex = Number(marker[1]);
      continue;
    }
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      flush();
      const title = heading[1].replace(/^Digression\s*—\s*/, "").trim();
      if (pendingIndex !== null && !ANNEX_TITLES.has(title)) {
        currentIndex = pendingIndex;
        current = [];
      }
      pendingIndex = null;
      continue;
    }
    if (current !== null) current.push(line);
  }
  flush();

  return plan.map((section) => {
    const raw = sectionTexts.get(section.index) ?? "";
    const paragraphs = raw
      .split(/\n{2,}/)
      .map((p) => p.replace(/^>\s?/gm, "").trim())
      .filter(Boolean);
    return paragraphs.map((text, pIndex) => ({
      timestampMs: pIndex === 0 ? section.startMs : null,
      text,
    }));
  });
}

/**
 * Groups raw transcript segments within a chapter's time range into
 * paragraph-like blocks, splitting on silences longer than gapMs. Every
 * timestamp here is a real segment startMs — no invented data, just a
 * display grouping over what transcribe-audio already returned.
 */
export function groupRawSegmentsByChapter(
  transcript: TranscriptSegment[],
  plan: LectureSection[],
  gapMs = 1500
): ChapterBlock[][] {
  return plan.map((section) => {
    const inRange = transcript
      .filter((s) => s.startMs >= section.startMs && s.startMs < section.endMs)
      .sort((a, b) => a.startMs - b.startMs);

    const blocks: ChapterBlock[] = [];
    let currentTexts: string[] = [];
    let currentStart = section.startMs;
    let lastEnd = section.startMs;

    for (const segment of inRange) {
      if (currentTexts.length > 0 && segment.startMs - lastEnd > gapMs) {
        blocks.push({ timestampMs: currentStart, text: currentTexts.join(" ") });
        currentTexts = [];
      }
      if (currentTexts.length === 0) currentStart = segment.startMs;
      currentTexts.push(segment.text);
      lastEnd = segment.endMs;
    }
    if (currentTexts.length > 0) blocks.push({ timestampMs: currentStart, text: currentTexts.join(" ") });
    return blocks;
  });
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDurationLabel(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export function formatFileSize(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} Mo`;
}
