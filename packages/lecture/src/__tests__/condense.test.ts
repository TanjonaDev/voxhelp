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

  it("requires an invisible section-index marker before every kept heading, in both modes", () => {
    expect(buildCondenseSystemPrompt("synthesis")).toContain("<!-- s:{index} -->");
    expect(buildCondenseSystemPrompt("revision")).toContain("<!-- s:{index} -->");
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
    const document = "<!-- s:0 -->\n## Introduction\n\nTexte réécrit.";

    const result = await condenseCourse("synthesis", { course, plan, document }, generateText, onChunk);

    expect(result).toBe("condensed text");
    expect(onChunk).toHaveBeenCalledWith("condensed text");
    const [system, user] = generateText.mock.calls[0];
    expect(system).toContain("paragraphe court");
    expect(user).toContain("Introduction");
    expect(user).toContain("Texte réécrit.");
  });

  it("splits a long course into time-based groups, calling generateText once per group with only that group's slice", async () => {
    const MIN = 60 * 1000;
    const longPlan: LectureSection[] = [
      { index: 0, title: "Début", startMs: 0, endMs: 5 * MIN, oneLineSummary: "s", type: "content", confidence: 0.9 },
      { index: 1, title: "Fin, bien après", startMs: 25 * MIN, endMs: 30 * MIN, oneLineSummary: "s", type: "content", confidence: 0.9 },
    ];
    const document = [
      "<!-- s:0 -->",
      "## Début",
      "Texte du début.",
      "",
      "<!-- s:1 -->",
      "## Fin, bien après",
      "Texte de la fin.",
    ].join("\n");
    const generateText = vi.fn().mockImplementation(async (_system: string, _user: string, cb: (t: string) => void) => {
      cb("[groupe]");
      return "[groupe]";
    });

    const result = await condenseCourse("revision", { course, plan: longPlan, document }, generateText, () => {});

    expect(result).toBe("[groupe][groupe]");
    expect(generateText).toHaveBeenCalledTimes(2);
    const [, firstUser] = generateText.mock.calls[0];
    const [, secondUser] = generateText.mock.calls[1];
    expect(firstUser).toContain("Texte du début.");
    expect(firstUser).not.toContain("Texte de la fin.");
    expect(secondUser).toContain("Texte de la fin.");
    expect(secondUser).not.toContain("Texte du début.");
  });

  it("a section the source document never marked condenses to an empty body instead of failing the whole group", async () => {
    const document = "## Introduction\n\nTexte sans marqueur (jamais tagué par pass2)."; // no "<!-- s:0 -->"
    const generateText = vi.fn().mockImplementation(async (_system: string, _user: string, cb: (t: string) => void) => {
      cb("[groupe]");
      return "[groupe]";
    });

    await condenseCourse("synthesis", { course, plan, document }, generateText, () => {});

    const [, user] = generateText.mock.calls[0];
    expect(user).toContain("## Introduction"); // title still passed through from the plan
    expect(user).not.toContain("Texte sans marqueur");
  });
});
