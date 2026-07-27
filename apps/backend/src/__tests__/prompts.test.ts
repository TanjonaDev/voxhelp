import { describe, it, expect } from "vitest";
import { buildLiveAssistPrompt } from "../prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "../prompts/final-analysis.js";
import type { Insight } from "@voxhelp/shared";

const confirmedCard: Insight = {
  id: "test-1",
  t: "01:00",
  cat: "strength",
  evidence: "high",
  title: "Expérience terrain solide en React",
  body: "Le candidat a démontré une utilisation concrète de React en production.",
  relance: "Dans quel contexte avez-vous utilisé React ?",
};

const vagueCard: Insight = {
  id: "test-2",
  t: "02:00",
  cat: "attention",
  evidence: "low",
  title: "Manque de concret",
  body: "Réponse trop générale, sans exemple précis.",
  relance: "Pouvez-vous donner un exemple précis ?",
};

describe("buildLiveAssistPrompt", () => {
  it("includes job context when provided", () => {
    const prompt = buildLiveAssistPrompt({ title: "Frontend Dev", level: "Senior", stack: "React, TypeScript" });
    expect(prompt).toContain("Frontend Dev");
    expect(prompt).toContain("Senior");
    expect(prompt).toContain("React, TypeScript");
  });

  it("includes transcript history", () => {
    const prompt = buildLiveAssistPrompt(undefined, ["Le candidat a mentionné Docker"]);
    expect(prompt).toContain("Le candidat a mentionné Docker");
  });

  it("lists previous questions with a no-repeat instruction", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], ["Quel était votre rôle ?"]);
    expect(prompt).toContain("Quel était votre rôle ?");
    expect(prompt).toContain("ne pas répéter");
  });

  it("includes previous Insights for context continuity", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [confirmedCard]);
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("[strength]");
  });

  it("omits cards section when previousCards is empty", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], []);
    expect(prompt).not.toContain("Sujets déjà analysés");
  });

  it("omits cards section when previousCards is undefined", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).not.toContain("Sujets déjà analysés");
  });

  it("includes the theme-continuity instruction when lastTheme is provided", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1);
    expect(prompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(prompt).toContain("réutilise EXACTEMENT ce slug");
  });

  it("lists all 3 remaining angles with definitions when no angle is covered yet", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 1);
    expect(prompt).toContain("Angles déjà couverts sur ce thème : aucun");
    expect(prompt).toContain("Angles restants : contexte, ownership, impact");
    expect(prompt).toContain("contexte : architecture ou projet global");
    expect(prompt).toContain("ownership : rôle personnel du candidat");
    expect(prompt).toContain("impact : problème résolu ou résultat concret");
    expect(prompt).toContain("Ne pose JAMAIS deux relances techniques de suite sur le même outil");
    expect(prompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("lists only the remaining angles once some are already covered", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", ["contexte"], 2);
    expect(prompt).toContain("Angles déjà couverts sur ce thème : contexte");
    expect(prompt).toContain("Angles restants : ownership, impact");
    expect(prompt).not.toContain("contexte : architecture ou projet global");
    expect(prompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("includes the forced-pivot warning once all 3 angles are covered", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", ["contexte", "ownership", "impact"], 3);
    expect(prompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(prompt).toContain("DOIT changer complètement de sujet");
    expect(prompt).not.toContain("Angles restants");
  });

  it("includes the forced-pivot warning at the 5-card fallback even if angles are missing", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", [], 5);
    expect(prompt).toContain("ATTENTION — ce thème a déjà été couvert par 5 cards consécutives");
    expect(prompt).toContain("DOIT changer complètement de sujet");
  });

  it("omits the theme section entirely when lastTheme is null or undefined", () => {
    const promptNull = buildLiveAssistPrompt(undefined, [], [], [], null, [], 5);
    expect(promptNull).not.toContain("Thème de la dernière card");
    const promptUndefined = buildLiveAssistPrompt(undefined, [], [], []);
    expect(promptUndefined).not.toContain("Thème de la dernière card");
  });

  it("documents the 4th angle bracket in the format instructions and drops the old generic diversification line", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).toContain("[catégorie] [evidence] [theme-slug] [angle]");
    expect(prompt).toContain("angle : contexte | ownership | impact | none");
    expect(prompt).not.toContain("DIVERSIFICATION OBLIGATOIRE");
  });
});

describe("buildFinalAnalysisPrompt", () => {
  it("includes job context when provided", () => {
    const prompt = buildFinalAnalysisPrompt({ title: "Backend Dev", level: "Junior", stack: "Node.js" });
    expect(prompt).toContain("Backend Dev");
    expect(prompt).toContain("Junior");
    expect(prompt).toContain("Node.js");
  });

  it("includes all card titles and evidence levels", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [confirmedCard, vagueCard]);
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("Manque de concret");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("LOW");
  });

  it("mentions when no analysis is available", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, []);
    expect(prompt).toContain("Aucune analyse disponible");
  });
});
