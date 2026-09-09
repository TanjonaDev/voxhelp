import { describe, it, expect } from "vitest";
import { buildCvKeywordExtractionPrompt } from "@voxhelp/recruit";
import { callClaudeJSON } from "../../llm.js";
import { cvFixtures } from "./fixtures/cv-texts.js";

// Smoke test opt-in de l'extraction de keywords CV (boosting Deepgram) contre
// le vrai Claude. Exclu de `pnpm test`, lancé via `pnpm test:smoke`.
//
// Garde-fou principal, déterministe : chaque keyword renvoyé DOIT être une
// sous-chaîne littérale du CV fourni — un keyword absent du texte source est
// une hallucination pure, pas une question d'appréciation.

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("smoke: extract-cv-keywords (real Claude)", () => {
  it.each(cvFixtures)("$name", async (fixture) => {
    const result = await callClaudeJSON<{ keywords: unknown }>(
      buildCvKeywordExtractionPrompt(fixture.cvText),
      "Extrais les keywords."
    );
    const keywords = Array.isArray(result?.keywords)
      ? result.keywords.filter((k): k is string => typeof k === "string" && k.length > 0)
      : [];

    console.log(`\n--- ${fixture.name} ---\nkeywords: [${keywords.join(", ")}]`);

    // Normalise les tirets (-, \u2010\u2015) et espaces avant le match : Claude
    // reformate parfois la ponctuation d'un terme qu'il cite par ailleurs mot
    // pour mot (ex: "Architect \u2013 Associate" -> "Architect Associate"),
    // ce qui n'est pas une hallucination.
    const normalize = (s: string) => s.toLowerCase().replace(/[\-\u2010-\u2015]/g, " ").replace(/\s+/g, " ").trim();
    const cvTextNormalized = normalize(fixture.cvText);
    const invented = keywords.filter((k) => !cvTextNormalized.includes(normalize(k)));
    expect(
      invented,
      `keyword(s) absent(s) du texte du CV pour "${fixture.name}" (hallucination) : ${invented.join(", ")}`
    ).toEqual([]);

    const tooGeneric = keywords.filter((k) =>
      fixture.shouldNotAppear.some((generic) => k.toLowerCase() === generic.toLowerCase())
    );
    expect(
      tooGeneric,
      `keyword(s) trop générique(s) remonté(s) pour "${fixture.name}" : ${tooGeneric.join(", ")}`
    ).toEqual([]);

    expect(keywords.length, "au maximum 40 keywords (règle du prompt)").toBeLessThanOrEqual(40);
  });
});
