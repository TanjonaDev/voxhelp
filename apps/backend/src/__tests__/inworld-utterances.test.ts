import { describe, it, expect } from "vitest";
import { buildUtterances, UNKNOWN_CONFIDENCE, type InworldWord } from "../stt/providers/inworld-utterances.js";

/** Un mot toutes les 500 ms, chacun durant 400 ms (comme les mots horodatés d'Inworld : sans ponctuation). */
function timedWords(words: string[]): InworldWord[] {
  return words.map((word, i) => ({ word, startTimeMs: i * 500, endTimeMs: i * 500 + 400 }));
}

describe("buildUtterances", () => {
  it("splits on sentence punctuation and times each sentence from its first and last word", () => {
    const words = timedWords(["Bonjour", "tout", "le", "monde", "Ça", "va", "Très", "bien"]);

    const result = buildUtterances("Bonjour tout le monde. Ça va ? Très bien !", words, 0, 10);

    expect(result).toEqual([
      { start: 0, end: 1.9, transcript: "Bonjour tout le monde.", confidence: UNKNOWN_CONFIDENCE },
      { start: 2, end: 2.9, transcript: "Ça va ?", confidence: UNKNOWN_CONFIDENCE },
      { start: 3, end: 3.9, transcript: "Très bien !", confidence: UNKNOWN_CONFIDENCE },
    ]);
  });

  it("keeps a standalone French question mark out of the word alignment", () => {
    const words = timedWords(["Quelle", "forme", "Quelle", "durée"]);

    const result = buildUtterances("Quelle forme ? Quelle durée ?", words, 0, 10);

    expect(result.map((u) => u.transcript)).toEqual(["Quelle forme ?", "Quelle durée ?"]);
    expect(result.map((u) => [u.start, u.end])).toEqual([
      [0, 0.9],
      [1, 1.9],
    ]);
  });

  it("applies the segment offset to every timestamp", () => {
    const result = buildUtterances("Un deux. Trois.", timedWords(["Un", "deux", "Trois"]), 600, 10);

    expect(result.map((u) => u.start)).toEqual([600, 601]);
    expect(result[1].end).toBeCloseTo(601.4);
  });

  it("keeps hyphens and apostrophes inside a single word", () => {
    const result = buildUtterances("Peut-être qu'il vient.", timedWords(["Peut-être", "qu'il", "vient"]), 0, 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 1.4, transcript: "Peut-être qu'il vient." });
  });

  it("falls back to a proportional mapping when the word counts differ", () => {
    // 6 mots dans le texte, 5 mots horodatés (le modèle en a fusionné deux)
    const words = timedWords(["un", "deux", "trois", "quatre", "cinq"]);

    const result = buildUtterances("un deux trois quatre. cinq six.", words, 0, 10);

    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(0);
    expect(result[1].end).toBe(words[4].endTimeMs / 1000);
    expect(result[0].end).toBeLessThanOrEqual(result[1].start!);
  });

  it("splits a very long sentence into chunks of at most 40 words", () => {
    const tokens = Array.from({ length: 100 }, (_, i) => `mot${i}`);
    const text = `${tokens.join(" ")}.`;

    const result = buildUtterances(text, timedWords(tokens), 0, 100);

    expect(result.map((u) => u.transcript!.split(/\s+/).length)).toEqual([40, 40, 20]);
    expect(result.map((u) => u.transcript).join(" ")).toBe(text);
    expect(result[1].start).toBe(20);
  });

  it("returns a single utterance spanning the segment when there are no timed words", () => {
    const result = buildUtterances("Bonjour tout le monde.", [], 600, 42);

    expect(result).toEqual([{ start: 600, end: 642, transcript: "Bonjour tout le monde.", confidence: UNKNOWN_CONFIDENCE }]);
  });

  it("returns nothing for a blank transcript", () => {
    expect(buildUtterances("   ", timedWords(["a"]), 0, 10)).toEqual([]);
  });
});
