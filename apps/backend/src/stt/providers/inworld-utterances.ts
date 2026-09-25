import type { SttUtterance } from "@voxhelp/lecture";

export interface InworldWord {
  word: string;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * Inworld renvoie une confiance de 0 pour chaque mot ; le pipeline cours affiche celle de chaque
 * segment au LLM (`(0.00)` partout serait trompeur) : valeur neutre.
 */
export const UNKNOWN_CONFIDENCE = 0.9;

const MAX_UTTERANCE_WORDS = 60;
const CHUNK_WORDS = 40;

// Un « mot » = lettres/chiffres avec apostrophes ou traits d'union internes : un `?` isolé
// (typographie française, « mot ? ») n'en est pas un, sinon l'alignement se décale d'un cran.
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const SENTENCE_END = /[.!?…]+(?=\s|$)/gu;

interface Token {
  start: number;
  end: number;
}

interface SentenceRange {
  from: number;
  to: number; // exclusif, en indices de mots
  charEnd: number;
}

/**
 * Énoncés d'un morceau : le texte ponctué est coupé après `. ! ? …`, chaque mot du texte est
 * aligné sur un mot horodaté (un pour un, sinon proportionnellement), les temps sont décalés de
 * `offsetSec` (début du morceau dans le cours).
 */
export function buildUtterances(
  transcript: string,
  words: readonly InworldWord[],
  offsetSec: number,
  segmentDurationSec: number
): SttUtterance[] {
  if (transcript.trim() === "") return [];

  const tokens: Token[] = [...transcript.matchAll(WORD)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

  if (tokens.length === 0 || words.length === 0) {
    return [
      { start: offsetSec, end: offsetSec + segmentDurationSec, transcript: transcript.trim(), confidence: UNKNOWN_CONFIDENCE },
    ];
  }

  const wordIndexOf = (tokenIndex: number): number =>
    tokens.length === words.length
      ? tokenIndex
      : Math.min(words.length - 1, Math.floor((tokenIndex * words.length) / tokens.length));

  const ranges: SentenceRange[] = [];
  let from = 0;
  for (const match of transcript.matchAll(SENTENCE_END)) {
    const charEnd = match.index + match[0].length;
    let to = from;
    while (to < tokens.length && tokens[to].end <= charEnd) to++;
    if (to > from) {
      ranges.push({ from, to, charEnd });
      from = to;
    }
  }
  if (from < tokens.length) ranges.push({ from, to: tokens.length, charEnd: transcript.length });

  const utterances: SttUtterance[] = [];
  let previousCharEnd = 0;
  for (const range of ranges) {
    const size = range.to - range.from;
    const step = size > MAX_UTTERANCE_WORDS ? CHUNK_WORDS : size;
    for (let a = range.from; a < range.to; a += step) {
      const b = Math.min(range.to, a + step);
      const text = transcript
        .slice(a === range.from ? previousCharEnd : tokens[a].start, b === range.to ? range.charEnd : tokens[b].start)
        .trim();
      const first = words[wordIndexOf(a)];
      const last = words[wordIndexOf(b - 1)];
      utterances.push({
        start: offsetSec + first.startTimeMs / 1000,
        end: offsetSec + last.endTimeMs / 1000,
        transcript: text,
        confidence: UNKNOWN_CONFIDENCE,
      });
    }
    previousCharEnd = range.charEnd;
  }
  return utterances;
}
