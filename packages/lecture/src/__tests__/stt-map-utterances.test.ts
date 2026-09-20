import { describe, it, expect } from "vitest";
import { mapUtterancesToSegments } from "../stt/map-utterances.js";
import type { SttUtterance } from "../stt/types.js";

describe("mapUtterancesToSegments", () => {
  it("converts seconds to milliseconds and maps transcript/confidence", () => {
    const utterances: SttUtterance[] = [
      { start: 0, end: 4.5, confidence: 0.92, transcript: "Alors, on commence." },
    ];

    const segments = mapUtterancesToSegments(utterances);

    expect(segments).toEqual([
      { startMs: 0, endMs: 4500, text: "Alors, on commence.", confidence: 0.92 },
    ]);
  });

  it("rounds fractional millisecond boundaries to the nearest integer", () => {
    const utterances: SttUtterance[] = [
      { start: 1.2345, end: 2.6789, confidence: 0.8, transcript: "texte" },
    ];

    const segments = mapUtterancesToSegments(utterances);

    expect(segments[0].startMs).toBe(1235);
    expect(segments[0].endMs).toBe(2679);
  });

  it("passes through the speaker field when present", () => {
    const utterances: SttUtterance[] = [
      { start: 0, end: 1, confidence: 0.9, transcript: "texte", speaker: 2 },
    ];

    const segments = mapUtterancesToSegments(utterances);

    expect(segments[0].speaker).toBe(2);
  });

  it("omits the speaker field when absent", () => {
    const utterances: SttUtterance[] = [{ start: 0, end: 1, confidence: 0.9, transcript: "texte" }];

    const segments = mapUtterancesToSegments(utterances);

    expect(segments[0]).not.toHaveProperty("speaker");
  });

  it("skips an utterance missing a required field (start, end, confidence, or transcript)", () => {
    const utterances: SttUtterance[] = [
      { start: 0, end: 1, confidence: 0.9, transcript: "gardé" },
      { start: 1, end: 2, confidence: 0.9 }, // no transcript
      { start: 2, confidence: 0.9, transcript: "pas de end" }, // no end
    ];

    const segments = mapUtterancesToSegments(utterances);

    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("gardé");
  });

  it("returns an empty array for no utterances", () => {
    expect(mapUtterancesToSegments([])).toEqual([]);
    expect(mapUtterancesToSegments(undefined)).toEqual([]);
  });
});
