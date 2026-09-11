import { describe, it, expect } from "vitest";
import {
  buildPdfAnalysisSystemPrompt,
  buildPdfAnalysisUserPrompt,
  buildPdfAnalysisRetryPrompt,
} from "../pdf/prompts.js";
import type { PdfPage } from "../pdf/types.js";

const pages: PdfPage[] = [
  { page: 1, text: "Introduction à la Bible : Nouveau Testament" },
  { page: 7, text: "Romains 1, versets 1-4\n1. Paul, serviteur de Jésus Christ..." },
];

describe("buildPdfAnalysisSystemPrompt", () => {
  it("instructs segmentation only, never reformulating citation/table/exercise blocks", () => {
    const prompt = buildPdfAnalysisSystemPrompt();
    expect(prompt).toContain("Ne reformule jamais un bloc");
  });

  it("lists all five block types", () => {
    const prompt = buildPdfAnalysisSystemPrompt();
    for (const type of ["heading", "paragraph", "citation", "table", "exercise"]) {
      expect(prompt).toContain(type);
    }
  });

  it("forbids inventing a reference and requires strict JSON", () => {
    const prompt = buildPdfAnalysisSystemPrompt();
    expect(prompt).toContain("N'invente jamais de");
    expect(prompt).toContain("uniquement par un objet JSON valide");
  });
});

describe("buildPdfAnalysisUserPrompt", () => {
  it("includes the filename and each page's text with its page number", () => {
    const prompt = buildPdfAnalysisUserPrompt("theologie-nt.pdf", pages);
    expect(prompt).toContain("theologie-nt.pdf");
    expect(prompt).toContain("[page 1]");
    expect(prompt).toContain("Introduction à la Bible");
    expect(prompt).toContain("[page 7]");
    expect(prompt).toContain("Romains 1, versets 1-4");
  });
});

describe("buildPdfAnalysisRetryPrompt", () => {
  it("appends the zod error message to the previous prompt", () => {
    const retry = buildPdfAnalysisRetryPrompt("PREVIOUS PROMPT", "blocks.0.type: Invalid enum value");
    expect(retry).toContain("PREVIOUS PROMPT");
    expect(retry).toContain("blocks.0.type: Invalid enum value");
    expect(retry).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });
});
