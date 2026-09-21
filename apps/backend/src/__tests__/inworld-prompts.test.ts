import { describe, it, expect } from "vitest";
import { sanitizeInworldPrompts, MAX_PROMPTS, MAX_PROMPT_LENGTH } from "../stt/providers/inworld-prompts.js";

describe("sanitizeInworldPrompts", () => {
  it("leaves plain terms untouched and counts nothing", () => {
    const result = sanitizeInworldPrompts(["Kubernetes", "Spring Boot", "S3"]);

    expect(result).toEqual({ prompts: ["Kubernetes", "Spring Boot", "S3"], adjusted: 0, dropped: 0 });
  });

  it("speaks C#, F# and C++ instead of dropping the symbol", () => {
    const { prompts } = sanitizeInworldPrompts(["C#", "F#", "C++", "c++11"]);

    expect(prompts).toEqual(["C sharp", "F sharp", "C plus plus", "c plus plus 11"]);
  });

  it("turns characters Inworld rejects into spaces", () => {
    const { prompts } = sanitizeInworldPrompts(["CI/CD", "TCP/IP", "@angular/core", "snake_case", "R&D", "A/B testing"]);

    expect(prompts).toEqual(["CI CD", "TCP IP", "angular core", "snake case", "R D", "A B testing"]);
  });

  it("keeps every character Inworld accepts", () => {
    const accepted = ["Node.js", ".NET", "OAuth 2.0", "l'agilité", "e-commerce", "M.E.C.C.", "Genèse", "中文", "Qu'est-ce que c'est ? (oui), non; ok: fin !"];

    const { prompts, adjusted } = sanitizeInworldPrompts(accepted);

    expect(prompts).toEqual(accepted);
    expect(adjusted).toBe(0);
  });

  it("normalizes curly apostrophes to a straight one", () => {
    const { prompts } = sanitizeInworldPrompts(["l’agilité", "l‘Ancien Testament"]);

    expect(prompts).toEqual(["l'agilité", "l'Ancien Testament"]);
  });

  it("collapses whitespace and trims the edges", () => {
    const { prompts } = sanitizeInworldPrompts(["  spaced    out  ", "tab\tseparated"]);

    expect(prompts).toEqual(["spaced out", "tab separated"]);
  });

  it("drops empty and symbol-only terms", () => {
    const result = sanitizeInworldPrompts(["", "   ", "###", "@/|", "ok"]);

    expect(result.prompts).toEqual(["ok"]);
    expect(result.dropped).toBe(4);
  });

  it("drops case-insensitive duplicates and keeps the first spelling", () => {
    const result = sanitizeInworldPrompts(["Java", "java", "JAVA", "Go"]);

    expect(result.prompts).toEqual(["Java", "Go"]);
    expect(result.dropped).toBe(2);
  });

  it("drops terms longer than the limit but keeps a term of exactly the limit", () => {
    const atLimit = "a".repeat(MAX_PROMPT_LENGTH);
    const tooLong = "b".repeat(MAX_PROMPT_LENGTH + 1);

    const result = sanitizeInworldPrompts([atLimit, tooLong]);

    expect(result.prompts).toEqual([atLimit]);
    expect(result.dropped).toBe(1);
  });

  it("caps the list at the maximum number of prompts, in the order received", () => {
    const terms = Array.from({ length: MAX_PROMPTS + 50 }, (_, i) => `terme${i}`);

    const result = sanitizeInworldPrompts(terms);

    expect(result.prompts).toHaveLength(MAX_PROMPTS);
    expect(result.prompts[0]).toBe("terme0");
    expect(result.prompts[MAX_PROMPTS - 1]).toBe(`terme${MAX_PROMPTS - 1}`);
    expect(result.dropped).toBe(50);
  });

  it("counts adjusted terms separately from dropped ones", () => {
    const result = sanitizeInworldPrompts(["C#", "Kubernetes", "", "CI/CD"]);

    expect(result.prompts).toEqual(["C sharp", "Kubernetes", "CI CD"]);
    expect(result.adjusted).toBe(2);
    expect(result.dropped).toBe(1);
  });

  it("ignores non-string terms and a non-array input", () => {
    const result = sanitizeInworldPrompts([null, 5, {}, "ok"]);

    expect(result.prompts).toEqual(["ok"]);
    expect(result.dropped).toBe(3);
    expect(sanitizeInworldPrompts(5)).toEqual({ prompts: [], adjusted: 0, dropped: 0 });
    expect(sanitizeInworldPrompts({})).toEqual({ prompts: [], adjusted: 0, dropped: 0 });
  });

  it("returns an empty result when there are no terms", () => {
    expect(sanitizeInworldPrompts(undefined)).toEqual({ prompts: [], adjusted: 0, dropped: 0 });
    expect(sanitizeInworldPrompts([])).toEqual({ prompts: [], adjusted: 0, dropped: 0 });
  });
});
