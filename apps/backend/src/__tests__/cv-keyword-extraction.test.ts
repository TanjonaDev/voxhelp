import { describe, it, expect } from "vitest";
import { buildCvKeywordExtractionPrompt } from "../prompts/cv-keyword-extraction.js";

describe("buildCvKeywordExtractionPrompt", () => {
  it("embeds the CV text verbatim", () => {
    const prompt = buildCvKeywordExtractionPrompt("Jean Dupont, ingénieur chez RMC BFM, expert Kubernetes.");
    expect(prompt).toContain("Jean Dupont, ingénieur chez RMC BFM, expert Kubernetes.");
  });

  it("requires strict JSON with a keywords array", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain('{ "keywords": ["terme1", "terme2", ...] }');
    expect(prompt).toContain("JSON strict");
  });

  it("caps the count and length of keywords", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain("Maximum 40 termes");
    expect(prompt).toContain("maximum 100 caractères");
  });

  it("excludes generic terms in favor of proper nouns", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain("noms d'entreprises");
    expect(prompt).toContain("Pas de mots génériques");
  });

  it("handles the empty-result case explicitly", () => {
    const prompt = buildCvKeywordExtractionPrompt("some cv text");
    expect(prompt).toContain('{ "keywords": [] }');
  });
});
