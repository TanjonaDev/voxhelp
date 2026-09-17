import { describe, it, expect, vi } from "vitest";
import { condenseCourse } from "../condense/condense.js";
import { buildCondenseSystemPrompt, buildCondenseUserPrompt } from "../condense/prompts.js";
import type { CourseContext, LectureSection } from "../types.js";

const course: CourseContext = { title: "Second principe", discipline: "Physique", language: "fr" };
const plan: LectureSection[] = [
  { index: 0, title: "Introduction", startMs: 0, endMs: 60000, oneLineSummary: "Intro", type: "content", confidence: 0.9 },
];

describe("buildCondenseSystemPrompt", () => {
  it("asks for prose paragraphs per section in synthesis mode", () => {
    const prompt = buildCondenseSystemPrompt("synthesis");
    expect(prompt).toContain("paragraphe court");
    expect(prompt).toContain("N'invente rien");
  });

  it("asks for bullet lists per section in revision mode", () => {
    const prompt = buildCondenseSystemPrompt("revision");
    expect(prompt).toContain("liste à");
    expect(prompt).toContain("puces");
    expect(prompt).toContain("N'invente rien");
  });
});

describe("buildCondenseUserPrompt", () => {
  it("includes the course title, plan, and source document", () => {
    const prompt = buildCondenseUserPrompt(course, plan, "## Introduction\n\nTexte réécrit.");
    expect(prompt).toContain("Second principe");
    expect(prompt).toContain("Introduction");
    expect(prompt).toContain("Texte réécrit.");
  });
});

describe("condenseCourse", () => {
  it("calls generateText with the mode-specific system prompt and streams chunks", async () => {
    const onChunk = vi.fn();
    const generateText = vi.fn().mockImplementation(async (_system, _user, cb) => {
      cb("condensed text");
      return "condensed text";
    });

    const result = await condenseCourse("synthesis", { course, plan, document: "## Introduction\n\nTexte." }, generateText, onChunk);

    expect(result).toBe("condensed text");
    expect(onChunk).toHaveBeenCalledWith("condensed text");
    const [system, user] = generateText.mock.calls[0];
    expect(system).toContain("paragraphe court");
    expect(user).toContain("Introduction");
  });
});
