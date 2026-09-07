import { describe, it, expect, vi } from "vitest";
import { analyzePass1 } from "../analyze.js";
import type { Pass1Input, Pass1Output, TranscriptSegment } from "../types.js";

function segment(startMs: number, endMs: number, text = "texte"): TranscriptSegment {
  return { startMs, endMs, text, confidence: 0.9 };
}

const baseInput: Pass1Input = {
  transcript: [segment(0, 60000)],
  course: { title: "Cours test", language: "fr" },
  existingGlossary: [],
};

function validOutput(overrides: Partial<Pass1Output> = {}): Pass1Output {
  return {
    detectedLanguage: "fr",
    transcriptQuality: 0.8,
    plan: [],
    glossary: [],
    references: [],
    uncertainZones: [],
    ...overrides,
  };
}

describe("analyzePass1 — single call", () => {
  it("returns the parsed output on a valid first response", async () => {
    const callJSON = vi.fn().mockResolvedValueOnce(validOutput({ detectedLanguage: "fr" }));
    const result = await analyzePass1(baseInput, callJSON);
    expect(result.detectedLanguage).toBe("fr");
    expect(callJSON).toHaveBeenCalledTimes(1);
  });

  it("retries once with the zod error appended when the first response is invalid", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ ...validOutput(), transcriptQuality: 5 })
      .mockResolvedValueOnce(validOutput({ detectedLanguage: "fr" }));
    const result = await analyzePass1(baseInput, callJSON);
    expect(result.detectedLanguage).toBe("fr");
    expect(callJSON).toHaveBeenCalledTimes(2);
    const retryUserPrompt = callJSON.mock.calls[1][1] as string;
    expect(retryUserPrompt).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });

  it("throws an explicit error when the retry also fails validation", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ bad: "shape" })
      .mockResolvedValueOnce({ bad: "still shape" });
    await expect(analyzePass1(baseInput, callJSON)).rejects.toThrow(/Pass 1 analysis failed/);
    expect(callJSON).toHaveBeenCalledTimes(2);
  });
});

describe("analyzePass1 — windowing", () => {
  it("splits a long transcript into multiple windowed calls and consolidates the glossary", async () => {
    const LONG_MS = 3 * 60 * 60 * 1000; // 3h, above the 2h30 threshold
    const longInput: Pass1Input = {
      ...baseInput,
      transcript: [segment(0, LONG_MS)],
    };
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce(
        validOutput({
          glossary: [{ term: "midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.7 }],
        })
      )
      .mockResolvedValue(validOutput());

    const result = await analyzePass1(longInput, callJSON);
    expect(callJSON.mock.calls.length).toBeGreaterThan(1);
    expect(result.glossary.some((entry) => entry.term === "midrash")).toBe(true);
  });
});
