import { describe, it, expect } from "vitest";
import { buildPass2SystemPrompt, buildPass2UserPrompt, buildAnnexesMarkdown } from "../pass2/prompts.js";
import type { Pass2Input } from "../pass2/types.js";
import type { GlossaryEntry, Reference } from "../types.js";

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
  pdfAnalyses: [
    {
      sourceFilename: "theologie-nt.pdf",
      blocks: [
        { page: 7, type: "citation", reference: "Romains 1,1-4", content: "1. Paul, serviteur de Jésus Christ..." },
      ],
    },
  ],
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

  it("forbids the model from generating the glossary/references annexes itself", () => {
    const prompt = buildPass2SystemPrompt();
    expect(prompt).toContain("Ne génère PAS d'annexe");
  });
});

describe("buildAnnexesMarkdown", () => {
  const glossary: GlossaryEntry[] = [
    { term: "Septante", heardVariants: ["Sept-Ante"], category: "proper_noun", occurrences: 2, confidence: 0.85, shortDefinition: "Traduction grecque de l'Ancien Testament" },
    { term: "Midrash", heardVariants: [], category: "foreign_term", occurrences: 1, confidence: 0.7 },
  ];
  const references: Reference[] = [
    { type: "scripture", rawCitation: "Romains chapitre 1", normalized: "Romains 1,1-4", contextMs: 12000, confidence: 0.8 },
    { type: "author", rawCitation: "comme dit Paul", contextMs: 20000, confidence: 0.6 },
  ];

  it("produces a Glossaire entry per term, with its short definition when known", () => {
    const md = buildAnnexesMarkdown(glossary, []);
    expect(md).toContain("## Glossaire");
    expect(md).toContain("**Septante** — Traduction grecque de l'Ancien Testament");
    expect(md).toContain("**Midrash**");
  });

  it("produces a Références citées entry per reference, normalized form or raw citation", () => {
    const md = buildAnnexesMarkdown([], references);
    expect(md).toContain("## Références citées");
    expect(md).toContain("Romains 1,1-4");
    expect(md).toContain("comme dit Paul");
  });

  it("reports explicit placeholders when glossary/references are empty", () => {
    const md = buildAnnexesMarkdown([], []);
    expect(md).toContain("(aucun terme)");
    expect(md).toContain("(aucune référence)");
  });

  it("skips a reference already quoted in the body via a matching PDF citation block", () => {
    const md = buildAnnexesMarkdown([], references, [
      { sourceFilename: "x.pdf", blocks: [{ page: 1, type: "citation", content: "...", reference: "Romains 1,1-4" }] },
    ]);
    expect(md).not.toContain("Romains 1,1-4");
    expect(md).toContain("comme dit Paul");
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
    const { pdfAnalyses, ...withoutPdf } = baseInput;
    const prompt = buildPass2UserPrompt(withoutPdf);
    expect(prompt).toContain("aucun support PDF fourni");
  });

  it("reports an explicit placeholder when pdfAnalyses is an empty array", () => {
    const prompt = buildPass2UserPrompt({ ...baseInput, pdfAnalyses: [] });
    expect(prompt).toContain("aucun support PDF fourni");
  });

  it("includes blocks from every PDF, each tagged with its source filename", () => {
    const prompt = buildPass2UserPrompt({
      ...baseInput,
      pdfAnalyses: [
        {
          sourceFilename: "slides-semaine1.pdf",
          blocks: [{ page: 1, type: "heading", anchorTitle: "Introduction", content: "Introduction" }],
        },
        {
          sourceFilename: "slides-semaine2.pdf",
          blocks: [{ page: 3, type: "table", content: "Tableau comparatif des évangiles" }],
        },
      ],
    });
    expect(prompt).toContain("slides-semaine1.pdf");
    expect(prompt).toContain("Introduction");
    expect(prompt).toContain("slides-semaine2.pdf");
    expect(prompt).toContain("Tableau comparatif des évangiles");
  });
});
