import { describe, it, expect } from "vitest";
import { buildLiveAssistPrompt } from "../prompts/live-assist.js";
import { buildFinalAnalysisPrompt } from "../prompts/final-analysis.js";
import type { InsightCard } from "@voxhelp/shared";

const confirmedCard: InsightCard = {
  meaning: "Expérience terrain solide en React",
  signal: { label: "Expert confirmé" },
  followUp: "Dans quel contexte avez-vous utilisé React ?",
  confidence: "confirmed",
};

const vagueCard: InsightCard = {
  meaning: "Réponse trop générale, sans exemple",
  signal: { label: "Manque de concret" },
  followUp: "Pouvez-vous donner un exemple précis ?",
  confidence: "vague",
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

  it("includes previous InsightCards for context continuity", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [confirmedCard]);
    expect(prompt).toContain("CONFIRMED");
    expect(prompt).toContain("Expert confirmé");
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

  it("includes all card signals and confidence levels", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [confirmedCard, vagueCard]);
    expect(prompt).toContain("Expert confirmé");
    expect(prompt).toContain("Manque de concret");
    expect(prompt).toContain("CONFIRMED");
    expect(prompt).toContain("VAGUE");
  });

  it("mentions when no analysis is available", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, []);
    expect(prompt).toContain("Aucune analyse disponible");
  });
});
