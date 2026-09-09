import { describe, it, expect } from "vitest";
import { correctTranscript } from "../../llm.js";
import { garbledTranscriptFixtures } from "./fixtures/garbled-transcripts.js";

// Smoke test opt-in de correctTranscript() (correction Haiku des erreurs STT)
// contre le vrai Claude — isolé du reste du pipeline pour un signal rapide et
// bon marché. Exclu de `pnpm test`, lancé via `pnpm test:smoke`.

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("smoke: correctTranscript (real Claude)", () => {
  it.each(garbledTranscriptFixtures)("$name", async (fixture) => {
    const corrected = await correctTranscript(fixture.raw, fixture.sttContext);
    console.log(`\n--- ${fixture.name} ---\nraw:       "${fixture.raw}"\ncorrected: "${corrected}"`);

    const missing = fixture.expectedSubstrings.filter(
      (term) => !corrected.toLowerCase().includes(term.toLowerCase())
    );
    expect(
      missing,
      `termes attendus absents de la correction pour "${fixture.name}" : ${missing.join(", ")}\ncorrected: "${corrected}"`
    ).toEqual([]);

    // Garde-fou anti-dérive : la correction ne doit pas s'éloigner du texte
    // d'origine (même règle défensive que dans correctTranscript lui-même).
    expect(corrected.length).toBeLessThanOrEqual(fixture.raw.length * 3);
  });
});
