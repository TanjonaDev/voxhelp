import { describe, it, expect, vi } from "vitest";
import { analyzePdf } from "../pdf/analyze-pdf.js";
import type { PdfAnalysis, PdfPage } from "../pdf/types.js";

const pages: PdfPage[] = [{ page: 1, text: "Introduction à la Bible" }];

function validOutput(overrides: Partial<PdfAnalysis> = {}): PdfAnalysis {
  return {
    sourceFilename: "cours.pdf",
    blocks: [{ page: 1, type: "heading", anchorTitle: "Introduction à la Bible", content: "Introduction à la Bible" }],
    ...overrides,
  };
}

describe("analyzePdf — single call", () => {
  it("returns the parsed analysis on a valid first response", async () => {
    const callJSON = vi.fn().mockResolvedValueOnce(validOutput());
    const result = await analyzePdf("cours.pdf", pages, callJSON);
    expect(result.blocks).toHaveLength(1);
    expect(callJSON).toHaveBeenCalledTimes(1);
  });

  it("retries once with the zod error appended when the first response is invalid", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ sourceFilename: "cours.pdf", blocks: [{ page: 1, type: "banter", content: "x" }] })
      .mockResolvedValueOnce(validOutput());
    const result = await analyzePdf("cours.pdf", pages, callJSON);
    expect(result.blocks[0].type).toBe("heading");
    expect(callJSON).toHaveBeenCalledTimes(2);
    const retryUserPrompt = callJSON.mock.calls[1][1] as string;
    expect(retryUserPrompt).toContain("N'A PAS PU ÊTRE VALIDÉE");
  });

  it("throws an explicit error when the retry also fails validation", async () => {
    const callJSON = vi
      .fn()
      .mockResolvedValueOnce({ bad: "shape" })
      .mockResolvedValueOnce({ bad: "still shape" });
    await expect(analyzePdf("cours.pdf", pages, callJSON)).rejects.toThrow(/PDF analysis failed/);
    expect(callJSON).toHaveBeenCalledTimes(2);
  });
});
