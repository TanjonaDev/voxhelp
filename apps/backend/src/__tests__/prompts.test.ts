import { describe, it, expect } from "vitest";
import { buildLiveAssistPrompt } from "../prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "../prompts/final-analysis.js";
import type { Insight } from "@voxhelp/shared";

const confirmedCard: Insight = {
  id: "test-1",
  t: "01:00",
  cat: "strength",
  confidence: "confirmed",
  title: "Expérience terrain solide en React",
  body: "Le candidat a démontré une utilisation concrète de React en production.",
  relance: "Dans quel contexte avez-vous utilisé React ?",
};

const vagueCard: Insight = {
  id: "test-2",
  t: "02:00",
  cat: "risk",
  confidence: "low",
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
    expect(prompt).toContain("NE PAS répéter");
  });

  it("includes previous Insights for context continuity", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [confirmedCard]);
    expect(prompt).toContain("CONFIRMED");
    expect(prompt).toContain("Expérience terrain solide en React");
  });

  it("omits cards section when previousCards is empty", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], []);
    expect(prompt).not.toContain("Analyses déjà effectuées");
  });

  it("omits cards section when previousCards is undefined", () => {
    const prompt = buildLiveAssistPrompt();
    expect(prompt).not.toContain("Analyses déjà effectuées");
  });
});

describe("buildFinalAnalysisPrompt", () => {
  it("includes job context when provided", () => {
    const prompt = buildFinalAnalysisPrompt({ title: "Backend Dev", level: "Junior", stack: "Node.js" });
    expect(prompt).toContain("Backend Dev");
    expect(prompt).toContain("Junior");
    expect(prompt).toContain("Node.js");
  });

  it("includes all card titles and confidence levels", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [confirmedCard, vagueCard]);
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("Manque de concret");
    expect(prompt).toContain("CONFIRMED");
    expect(prompt).toContain("LOW");
  });

  it("mentions when no analysis is available", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, []);
    expect(prompt).toContain("Aucune analyse disponible");
  });
});
