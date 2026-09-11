import { describe, it, expect } from "vitest";
import { buildPass2SystemPrompt, buildPass2UserPrompt } from "../pass2/prompts.js";
import type { Pass2Input } from "../pass2/types.js";

const baseInput: Pass2Input = {
  transcript: [
    { startMs: 0, endMs: 4000, text: "Alors, on commence par le contexte historique.", confidence: 0.9 },
  ],
  course: {
    title: "Introduction à la Théologie protestante — Nouveau Testament",
    discipline: "Théologie protestante",
    instructor: "Christian Grappe",
    language: "fr",
  },
  plan: [
    { index: 0, title: "Le Nouveau Testament dans la Bible", startMs: 0, endMs: 60000, oneLineSummary: "Présentation", type: "content", confidence: 0.9 },
  ],
  glossary: [
    { term: "Septante", heardVariants: ["Sept-Ante"], category: "proper_noun", occurrences: 2, confidence: 0.85 },
  ],
  references: [
    { type: "scripture", rawCitation: "Romains chapitre 1", normalized: "Romains 1,1-4", contextMs: 12000, confidence: 0.8 },
  ],
  uncertainZones: [
    { startMs: 30000, endMs: 32000, excerpt: "[inaudible]", reason: "audio dégradé" },
  ],
  pdfAnalysis: {
    sourceFilename: "theologie-nt.pdf",
    blocks: [
      { page: 7, type: "citation", reference: "Romains 1,1-4", content: "1. Paul, serviteur de Jésus Christ..." },
    ],
  },
};

describe("buildPass2SystemPrompt", () => {
  it("instructs faithful cleanup, not summarizing", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("Nettoyage fidèle");
  });

  it("requires the uncertain-zone inline marker", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("[passage incertain");
  });

  it("requires verbatim insertion of citation/table/exercise blocks and context-only use of heading/paragraph", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("verbatim");
    expect(prompt).toContain("ne les recopie jamais tels quels");
  });

  it("requires the glossary and references appendices", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("## Glossaire");
    expect(prompt).toContain("## Références citées");
  });
});

describe("buildPass2UserPrompt", () => {
  it("includes the course context, plan, glossary, references, uncertain zones, pdf blocks and transcript", () => {
    const prompt = buildPass2UserPrompt(baseInput);
    expect(prompt).toContain("Introduction à la Théologie protestante");
    expect(prompt).toContain("Le Nouveau Testament dans la Bible");
    expect(prompt).toContain("Septante");
    expect(prompt).toContain("Romains 1,1-4");
    expect(prompt).toContain("audio dégradé");
    expect(prompt).toContain("Paul, serviteur de Jésus Christ");
    expect(prompt).toContain("on commence par le contexte historique");
  });

  it("reports an explicit placeholder when there is no PDF support", () => {
    const { pdfAnalysis, ...withoutPdf } = baseInput;
    const prompt = buildPass2UserPrompt(withoutPdf);
    expect(prompt).toContain("aucun support PDF fourni");
  });
});
