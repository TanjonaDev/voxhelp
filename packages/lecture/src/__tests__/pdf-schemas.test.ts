import { describe, it, expect } from "vitest";
import { pdfAnalysisSchema, parsePdfAnalysis } from "../pdf/schemas.js";

const validAnalysis = {
  sourceFilename: "theologie-nt.pdf",
  blocks: [
    { page: 1, type: "heading", anchorTitle: "Le Nouveau Testament dans la Bible", content: "Le Nouveau Testament dans la Bible" },
    { page: 3, type: "paragraph", content: "Si vous êtes protestant, vous disposez peut-être de la Bible Segond..." },
    { page: 7, type: "citation", reference: "Romains 1,1-4", content: "1. Paul, serviteur de Jésus Christ..." },
    { page: 2, type: "table", content: "BIBLE RABBINIQUE | SEPTANTE | ..." },
    { page: 5, type: "exercise", content: "1. Le texte évoque d'abord un événement marquant..." },
  ],
};

describe("pdfAnalysisSchema", () => {
  it("parses a valid PdfAnalysis", () => {
    expect(() => parsePdfAnalysis(validAnalysis)).not.toThrow();
    expect(parsePdfAnalysis(validAnalysis).blocks[0].type).toBe("heading");
  });

  it("rejects an invalid block type", () => {
    const invalid = { ...validAnalysis, blocks: [{ page: 1, type: "banter", content: "x" }] };
    expect(() => parsePdfAnalysis(invalid)).toThrow();
  });

  it("rejects a non-positive page number", () => {
    const invalid = { ...validAnalysis, blocks: [{ page: 0, type: "paragraph", content: "x" }] };
    expect(() => parsePdfAnalysis(invalid)).toThrow();
  });

  it("rejects an empty content string", () => {
    const invalid = { ...validAnalysis, blocks: [{ page: 1, type: "paragraph", content: "" }] };
    expect(() => parsePdfAnalysis(invalid)).toThrow();
  });

  it("accepts blocks without anchorTitle or reference", () => {
    const minimal = { sourceFilename: "f.pdf", blocks: [{ page: 1, type: "paragraph", content: "texte" }] };
    expect(() => parsePdfAnalysis(minimal)).not.toThrow();
  });

  it("safeParse reports failure without throwing", () => {
    const result = pdfAnalysisSchema.safeParse({ ...validAnalysis, sourceFilename: "" });
    expect(result.success).toBe(false);
  });
});
