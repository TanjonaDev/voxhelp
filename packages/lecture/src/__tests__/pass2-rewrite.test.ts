import { describe, it, expect, vi } from "vitest";
import { rewritePass2 } from "../pass2/rewrite.js";
import type { Pass2Input } from "../pass2/types.js";

const input: Pass2Input = {
  transcript: [{ startMs: 0, endMs: 4000, text: "Alors, on commence.", confidence: 0.9 }],
  course: { title: "Cours test", language: "fr" },
  plan: [],
  glossary: [],
  references: [],
  uncertainZones: [],
};

describe("rewritePass2", () => {
  it("builds the system and user prompts and forwards them, along with onChunk, to generateText", async () => {
    const generateText = vi.fn().mockImplementation(async (_system, _user, onChunk) => {
      onChunk("# Cours test\n\n");
      onChunk("## Introduction\nOn commence.\n");
      return "# Cours test\n\n## Introduction\nOn commence.\n";
    });
    const chunks: string[] = [];

    const result = await rewritePass2(input, generateText, (chunk) => chunks.push(chunk));

    expect(result).toBe("# Cours test\n\n## Introduction\nOn commence.\n");
    expect(chunks).toEqual(["# Cours test\n\n", "## Introduction\nOn commence.\n"]);
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
