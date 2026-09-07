import { describe, it, expect } from "vitest";
import { needsWindowing, splitIntoWindows, mergePlans, LONG_TRANSCRIPT_THRESHOLD_MS } from "../windowing.js";
import type { LectureSection, TranscriptSegment } from "../types.js";

function segment(startMs: number, endMs: number): TranscriptSegment {
  return { startMs, endMs, text: `segment ${startMs}`, confidence: 0.9 };
}

describe("needsWindowing", () => {
  it("is false for a 90-minute transcript", () => {
    expect(needsWindowing([segment(0, 90 * 60 * 1000)])).toBe(false);
  });

  it("is true past the 2h30 threshold", () => {
    expect(needsWindowing([segment(0, LONG_TRANSCRIPT_THRESHOLD_MS + 1000)])).toBe(true);
  });

  it("is false for an empty transcript", () => {
    expect(needsWindowing([])).toBe(false);
  });
});

describe("splitIntoWindows", () => {
  it("splits a 70-minute transcript into overlapping 30-minute windows", () => {
    const MIN = 60 * 1000;
    const transcript = [segment(0, 20 * MIN), segment(20 * MIN, 50 * MIN), segment(50 * MIN, 70 * MIN)];
    const windows = splitIntoWindows(transcript, 30 * MIN, 90 * 1000);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const window of windows) {
      expect(window.length).toBeGreaterThan(0);
    }
  });

  it("returns a single window for a short transcript", () => {
    const windows = splitIntoWindows([segment(0, 5 * 60 * 1000)]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(1);
  });

  it("returns no windows for an empty transcript", () => {
    expect(splitIntoWindows([])).toEqual([]);
  });
});

describe("mergePlans", () => {
  const baseSection: LectureSection = {
    index: 0,
    title: "Le contexte historique",
    startMs: 0,
    endMs: 60000,
    oneLineSummary: "Contexte",
    type: "content",
    confidence: 0.8,
  };

  it("concatenates non-overlapping sections from different windows in order", () => {
    const merged = mergePlans([
      [baseSection],
      [{ ...baseSection, title: "La suite", startMs: 60000, endMs: 120000, confidence: 0.7 }],
    ]);
    expect(merged.map((s) => s.title)).toEqual(["Le contexte historique", "La suite"]);
    expect(merged.map((s) => s.index)).toEqual([0, 1]);
  });

  it("drops a duplicate section re-detected in the overlap zone, keeping the higher-confidence copy", () => {
    const duplicateFromNextWindow: LectureSection = {
      ...baseSection,
      startMs: 55000,
      endMs: 90000,
      confidence: 0.95,
    };
    const merged = mergePlans([[baseSection], [duplicateFromNextWindow]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.95);
  });

  it("keeps sections of a different type even if they overlap in time", () => {
    const question: LectureSection = {
      ...baseSection,
      type: "student_question",
      title: "Question sur le contexte",
      startMs: 30000,
      endMs: 45000,
    };
    const merged = mergePlans([[baseSection], [question]]);
    expect(merged).toHaveLength(2);
  });
});
