import { describe, it, expect, vi } from "vitest";
import { rewritePass2 } from "../pass2/rewrite.js";
import { buildAnnexesMarkdown } from "../pass2/prompts.js";
import type { Pass2Cache, Pass2Input } from "../pass2/types.js";
import type { GlossaryEntry, LectureSection, Reference } from "../types.js";

const input: Pass2Input = {
  transcript: [{ startMs: 0, endMs: 4000, text: "Alors, on commence.", confidence: 0.9 }],
  course: { title: "Cours test", language: "fr" },
  plan: [],
  glossary: [],
  references: [],
  uncertainZones: [],
};

function echoGenerateText(label: string) {
  return vi.fn().mockImplementation(async (_system: string, _user: string, onChunk: (text: string) => void) => {
    onChunk(`[${label}]`);
    return `[${label}]`;
  });
}

describe("rewritePass2 — no cache (single group, matches pre-chunking behavior)", () => {
  it("builds the system and user prompts and forwards them, along with onChunk, to generateText", async () => {
    const generateText = vi.fn().mockImplementation(async (_system, _user, onChunk) => {
      onChunk("# Cours test\n\n");
      onChunk("## Introduction\nOn commence.\n");
      return "# Cours test\n\n## Introduction\nOn commence.\n";
    });
    const chunks: string[] = [];

    const result = await rewritePass2(input, generateText, (chunk) => chunks.push(chunk));

    const annexes = buildAnnexesMarkdown(input.glossary, input.references);
    expect(result).toBe(`# Cours test\n\n## Introduction\nOn commence.\n${annexes}`);
    expect(chunks).toEqual(["# Cours test\n\n", "## Introduction\nOn commence.\n", annexes]);
    expect(generateText).toHaveBeenCalledTimes(1);
    const [system, user] = generateText.mock.calls[0];
    expect(system).toContain("Nettoyage fidèle");
    expect(user).toContain("Cours test");
  });

  it("propagates a rejection from generateText", async () => {
    const generateText = vi.fn().mockRejectedValueOnce(new Error("provider error"));
    await expect(rewritePass2(input, generateText, () => {})).rejects.toThrow("provider error");
  });
});

describe("rewritePass2 — grouped with cache", () => {
  const glossary: GlossaryEntry[] = [
    { term: "Septante", heardVariants: [], category: "proper_noun", occurrences: 1, confidence: 0.9, shortDefinition: "def" },
  ];
  const references: Reference[] = [
    { type: "scripture", rawCitation: "Romains 1", normalized: "Romains 1,1-4", contextMs: 1000, confidence: 0.8 },
  ];

  function section(index: number, startMs: number, endMs: number): LectureSection {
    return { index, title: `Section ${index}`, startMs, endMs, oneLineSummary: "s", type: "content", confidence: 0.9 };
  }

  function makeCache(): Pass2Cache & { store: Map<number, string> } {
    const store = new Map<number, string>();
    return {
      store,
      get: vi.fn(async (index: number) => store.get(index) ?? null),
      set: vi.fn(async (index: number, text: string) => {
        store.set(index, text);
      }),
    };
  }

  it("splits the plan into time-based groups, streams each group fully before the next, and appends annexes once at the end", async () => {
    const MIN = 60 * 1000;
    const groupedInput: Pass2Input = {
      ...input,
      transcript: [
        { startMs: 0, endMs: 10 * MIN, text: "FIRSTMARKER", confidence: 0.9 },
        { startMs: 25 * MIN, endMs: 30 * MIN, text: "SECONDMARKER", confidence: 0.9 },
      ],
      plan: [section(0, 0, 10 * MIN), section(1, 25 * MIN, 30 * MIN)], // 25min apart: 2 groups (> 20min threshold)
      glossary,
      references,
    };
    const cache = makeCache();
    const generateText = echoGenerateText("group");
    const chunks: string[] = [];

    const result = await rewritePass2(groupedInput, generateText, (chunk) => chunks.push(chunk), cache);

    expect(generateText).toHaveBeenCalledTimes(2);
    const annexes = buildAnnexesMarkdown(glossary, references);
    expect(result).toBe(`[group][group]${annexes}`);
    expect(chunks).toEqual(["[group]", "[group]", annexes]);
    expect(cache.set).toHaveBeenCalledTimes(2);

    // Each group's user prompt only carries its own plan section + transcript, but the full glossary/references.
    const firstUser = generateText.mock.calls[0][1] as string;
    const secondUser = generateText.mock.calls[1][1] as string;
    expect(firstUser).toContain("FIRSTMARKER");
    expect(firstUser).not.toContain("SECONDMARKER");
    expect(secondUser).toContain("SECONDMARKER");
    expect(secondUser).not.toContain("FIRSTMARKER");
  });

  it("reuses a cached group's text verbatim instead of calling generateText again", async () => {
    const MIN = 60 * 1000;
    const groupedInput: Pass2Input = {
      ...input,
      transcript: [
        { startMs: 0, endMs: 10 * MIN, text: "début", confidence: 0.9 },
        { startMs: 25 * MIN, endMs: 30 * MIN, text: "suite", confidence: 0.9 },
      ],
      plan: [section(0, 0, 10 * MIN), section(1, 25 * MIN, 30 * MIN)],
    };
    const cache = makeCache();
    cache.store.set(0, "[cached-group-0]");
    const generateText = echoGenerateText("group");
    const chunks: string[] = [];

    await rewritePass2(groupedInput, generateText, (chunk) => chunks.push(chunk), cache);

    expect(generateText).toHaveBeenCalledTimes(1); // only group 1 called the LLM
    expect(chunks[0]).toBe("[cached-group-0]");
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it("concatenating all groups plus annexes is equivalent to the old single-call document shape", async () => {
    const MIN = 60 * 1000;
    const groupedInput: Pass2Input = {
      ...input,
      transcript: [{ startMs: 0, endMs: 10 * MIN, text: "unique", confidence: 0.9 }],
      plan: [section(0, 0, 10 * MIN)],
      glossary,
      references,
    };
    const cache = makeCache();
    const generateText = vi.fn().mockImplementation(async (_s, _u, onChunk) => {
      onChunk("## Section 0\nTexte.\n");
      return "## Section 0\nTexte.\n";
    });

    const grouped = await rewritePass2(groupedInput, generateText, () => {}, cache);
    const ungrouped = await rewritePass2(groupedInput, generateText, () => {});

    expect(grouped).toBe(ungrouped);
  });
});
