import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzePdfOcr, extractPdfPages } from "@voxhelp/lecture";
import { callClaudeJSONWithPdf } from "../../llm.js";

// Smoke test opt-in du fallback OCR (PDF scanné, sans couche texte) contre le
// vrai Claude, PDF joint en bloc "document" (vision native, pas de moteur OCR
// séparé). Fixture = 1 page réelle d'un scan fourni par l'utilisateur qui a
// fait échouer /api/lecture/analyze-pdf avant ce fix.
//
// Garde-fou principal : on vérifie d'abord que la fixture n'a réellement
// aucun texte extractible (sinon le test ne teste pas ce qu'il prétend
// tester), puis que Claude produit un contenu non trivial à partir de
// l'image seule.

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "scanned-page.pdf");

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("smoke: PDF OCR fallback (real Claude, vision)", () => {
  it("extracts readable content from a scanned page via document attachment", async () => {
    const buffer = readFileSync(fixturePath);

    const pages = await extractPdfPages(buffer);
    expect(
      pages.every((page) => page.text.trim().length === 0),
      "la fixture doit être un scan sans texte extractible pour que ce test soit valide"
    ).toBe(true);

    const analysis = await analyzePdfOcr(
      "scanned-page.pdf",
      Math.max(pages.length, 1),
      (system, user) =>
        callClaudeJSONWithPdf(system, user, buffer.toString("base64"), "claude-sonnet-5", 16000, undefined, true)
    );

    console.log(`\n--- OCR blocks ---\n${JSON.stringify(analysis.blocks, null, 2)}`);

    expect(analysis.blocks.length).toBeGreaterThan(0);
    const combinedText = analysis.blocks.map((b) => b.content).join(" ");
    expect(combinedText.trim().length).toBeGreaterThan(20);
  });
});
