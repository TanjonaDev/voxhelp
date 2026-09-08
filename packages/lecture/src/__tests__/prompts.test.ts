import { describe, it, expect } from "vitest";
import { buildPass1SystemPrompt, buildPass1UserPrompt, buildPass1RetryPrompt } from "../prompts.js";
import type { Pass1Input } from "../types.js";

const baseInput: Pass1Input = {
  transcript: [
    { startMs: 0, endMs: 4000, text: "Alors, on commence par le contexte historique.", confidence: 0.913 },
    { startMs: 4000, endMs: 9000, text: "On va parler de la berakhah, la bénédiction.", confidence: 0.4 },
  ],
  course: {
    title: "Introduction à l'hébreu biblique",
    discipline: "Théologie protestante",
    instructor: "Prof. Martin",
    language: "fr",
  },
  existingGlossary: [],
};

describe("buildPass1SystemPrompt", () => {
  it("instructs analysis only, never rewriting/summarizing", () => {
    const prompt = buildPass1SystemPrompt();
    expect(prompt).toContain("Tu ne réécris rien, tu ne résumes pas");
  });

  it("requires the four output categories", () => {
    const prompt = buildPass1SystemPrompt();
    expect(prompt).toContain("LE PLAN");
    expect(prompt).toContain("LE GLOSSAIRE");
    expect(prompt).toContain("LES RÉFÉRENCES");
    expect(prompt).toContain("LES ZONES INCERTAINES");
  });

  it("forbids inventing corrections and requires strict JSON", () => {
    const prompt = buildPass1SystemPrompt();
    expect(prompt).toContain("N'invente jamais");
    expect(prompt).toContain("uniquement par un objet JSON valide");
  });

  it("spells out the exact JSON schema with the literal English enum tokens", () => {
    const prompt = buildPass1SystemPrompt();
    // Without this, the model tends to translate the categories described in
    // prose above ("contenu de cours", "question d'étudiant"...) into French
    // JSON values instead of the literal enum tokens the Zod schema expects.
    expect(prompt).toContain('"type": "content | digression | student_question | administrative"');
    expect(prompt).toContain('"category": "proper_noun | technical_term | concept | acronym | foreign_term"');
    expect(prompt).toContain('"type": "author | work | article | scripture | date | concept"');
    expect(prompt).toContain("EXACTEMENT");
    expect(prompt).toContain("jamais une traduction française");
  });
});

describe("buildPass1UserPrompt", () => {
  it("includes the course context", () => {
    const prompt = buildPass1UserPrompt(baseInput);
    expect(prompt).toContain("Introduction à l'hébreu biblique");
    expect(prompt).toContain("Théologie protestante");
    expect(prompt).toContain("Prof. Martin");
  });

  it("formats segments with millisecond bounds and 2-decimal confidence", () => {
    const prompt = buildPass1UserPrompt(baseInput);
    expect(prompt).toContain("[0–4000] (0.91) Alors, on commence par le contexte historique.");
    expect(prompt).toContain("[4000–9000] (0.40) On va parler de la berakhah, la bénédiction.");
  });

  it("marks the glossary as empty for a first course", () => {
    const prompt = buildPass1UserPrompt(baseInput);
    expect(prompt).toContain("premier cours");
  });

  it("lists the existing glossary as term — variants", () => {
    const withGlossary: Pass1Input = {
      ...baseInput,
      existingGlossary: [
        { term: "berakhah", heardVariants: ["beraka", "béraca"], category: "foreign_term", occurrences: 5, confidence: 0.9 },
      ],
    };
    const prompt = buildPass1UserPrompt(withGlossary);
    expect(prompt).toContain("berakhah — beraka, béraca");
  });
});

describe("buildPass1RetryPrompt", () => {
  it("appends the zod error and re-requests strict JSON", () => {
    const original = buildPass1UserPrompt(baseInput);
    const retry = buildPass1RetryPrompt(original, "plan.0.type: Invalid enum value");
    expect(retry).toContain(original);
    expect(retry).toContain("plan.0.type: Invalid enum value");
    expect(retry).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });
});
