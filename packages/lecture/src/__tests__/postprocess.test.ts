import { describe, it, expect } from "vitest";
import {
  mergeGlossary,
  selectNewGlossaryEntries,
  splitGlossaryByConfidence,
  selectKeyterms,
} from "../postprocess.js";
import type { GlossaryEntry } from "../types.js";

const existing: GlossaryEntry[] = [
  { term: "berakhah", heardVariants: ["beraka"], category: "foreign_term", occurrences: 2, confidence: 0.7 },
];

describe("mergeGlossary", () => {
  it("adds a genuinely new term untouched", () => {
    const incoming: GlossaryEntry[] = [
      { term: "midrash", heardVariants: ["midrache"], category: "foreign_term", occurrences: 1, confidence: 0.6 },
    ];
    const merged = mergeGlossary(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.term === "midrash")).toBeDefined();
  });

  it("deduplicates on the normalized term, case-insensitively", () => {
    const incoming: GlossaryEntry[] = [
      { term: "Berakhah", heardVariants: ["béraca"], category: "foreign_term", occurrences: 3, confidence: 0.9 },
    ];
    const merged = mergeGlossary(existing, incoming);
    expect(merged).toHaveLength(1);
  });

  it("unions heardVariants, sums occurrences, and keeps the max confidence", () => {
    const incoming: GlossaryEntry[] = [
      { term: "berakhah", heardVariants: ["béraca"], category: "foreign_term", occurrences: 3, confidence: 0.9 },
    ];
    const [merged] = mergeGlossary(existing, incoming);
    expect(merged.heardVariants.sort()).toEqual(["beraka", "béraca"]);
    expect(merged.occurrences).toBe(5);
    expect(merged.confidence).toBe(0.9);
  });
});

describe("selectNewGlossaryEntries", () => {
  it("excludes terms already present in the existing glossary", () => {
    const consolidated: GlossaryEntry[] = [
      ...existing,
      { term: "midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.6 },
    ];
    const result = selectNewGlossaryEntries(existing, consolidated);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe("midrash");
  });
});

describe("splitGlossaryByConfidence", () => {
  it("routes entries below 0.6 to validation and the rest to auto-apply", () => {
    const glossary: GlossaryEntry[] = [
      { term: "a", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.59 },
      { term: "b", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.6 },
      { term: "c", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.9 },
    ];
    const { toApply, toValidate } = splitGlossaryByConfidence(glossary);
    expect(toValidate.map((e) => e.term)).toEqual(["a"]);
    expect(toApply.map((e) => e.term)).toEqual(["b", "c"]);
  });
});

describe("selectKeyterms", () => {
  it("returns deduplicated terms at or above 0.8 confidence", () => {
    const glossary: GlossaryEntry[] = [
      { term: "berakhah", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.8 },
      { term: "midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.79 },
    ];
    expect(selectKeyterms(glossary)).toEqual(["berakhah"]);
  });
});
