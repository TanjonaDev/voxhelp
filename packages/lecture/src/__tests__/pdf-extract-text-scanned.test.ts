import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractPdfPages } from "../pdf/extract-text.js";

// Contrairement à pdf-extract-text.test.ts (unpdf mocké), ce test exécute la
// vraie extraction pdf.js sur un vrai PDF scanné (1 page d'un scan fourni par
// l'utilisateur) : confirme que le déclencheur du fallback OCR
// (packages/lecture/src/pdf/analyze-pdf.ts::analyzePdfOcr, cf.
// apps/backend/src/routes.ts) reste correct — un scan n'a réellement aucune
// couche de texte, ce n'est pas une hypothèse.

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "scanned-page.pdf");

describe("extractPdfPages — real scanned PDF fixture", () => {
  it("returns no extractable text for a genuinely scanned (image-only) page", async () => {
    const buffer = readFileSync(fixturePath);
    const pages = await extractPdfPages(buffer);

    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((page) => page.text.trim().length === 0)).toBe(true);
  });
});
