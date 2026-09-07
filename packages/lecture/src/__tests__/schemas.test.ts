import { describe, it, expect } from "vitest";
import { pass1OutputSchema, parsePass1Output, formatZodError } from "../schemas.js";

const validOutput = {
  detectedLanguage: "fr",
  transcriptQuality: 0.82,
  plan: [
    {
      index: 0,
      title: "Introduction",
      startMs: 0,
      endMs: 60000,
      oneLineSummary: "Présentation du plan du cours",
      type: "content",
      confidence: 0.9,
    },
  ],
  glossary: [
    {
      term: "berakhah",
      heardVariants: ["beraka", "béraca"],
      category: "foreign_term",
      sourceLanguage: "he",
      occurrences: 3,
      confidence: 0.75,
    },
  ],
  references: [
    {
      type: "author",
      rawCitation: "Von Rad",
      contextMs: 12000,
      confidence: 0.8,
    },
  ],
  uncertainZones: [
    { startMs: 30000, endMs: 32000, excerpt: "[inaudible]", reason: "audio dégradé" },
  ],
};

describe("pass1OutputSchema", () => {
  it("parses a valid Pass1Output", () => {
    expect(() => parsePass1Output(validOutput)).not.toThrow();
    expect(parsePass1Output(validOutput).plan[0].title).toBe("Introduction");
  });

  it("rejects an invalid section type", () => {
    const invalid = { ...validOutput, plan: [{ ...validOutput.plan[0], type: "banter" }] };
    expect(() => parsePass1Output(invalid)).toThrow();
  });

  it("rejects a confidence above 1", () => {
    const invalid = { ...validOutput, transcriptQuality: 1.5 };
    expect(() => parsePass1Output(invalid)).toThrow();
  });

  it("rejects an oneLineSummary longer than 120 characters", () => {
    const invalid = {
      ...validOutput,
      plan: [{ ...validOutput.plan[0], oneLineSummary: "x".repeat(121) }],
    };
    expect(() => parsePass1Output(invalid)).toThrow();
  });

  it("formats a Zod error into readable path: message lines", () => {
    const result = pass1OutputSchema.safeParse({ ...validOutput, transcriptQuality: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("transcriptQuality");
    }
  });
});
