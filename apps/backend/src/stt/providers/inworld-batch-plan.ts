export interface Silence {
  start: number;
  end: number;
}

export interface PlanOptions {
  /** Durée visée d'un morceau (s). */
  targetSec: number;
  /** On cherche le silence à ±windowSec du multiple de targetSec (doit rester < targetSec / 2). */
  windowSec: number;
  /** Pas de coupe si le reste après elle serait plus court (s). */
  minTailSec: number;
}

// Morceaux <= targetSec + 2×windowSec = 720 s (~23 Mo en PCM16 16 kHz), sous la limite de 32 Mio
// d'audio par appel de l'API synchrone d'Inworld.
export const DEFAULT_PLAN: PlanOptions = { targetSec: 600, windowSec: 60, minTailSec: 30 };

const SILENCE_START = /silence_start: (-?\d+(?:\.\d+)?)/g;
const SILENCE_END = /silence_end: (-?\d+(?:\.\d+)?)/g;

/**
 * Silences détectés par le filtre `silencedetect` d'ffmpeg (sortie stderr). Un silence sans fin
 * (l'audio se termine en silence) est ignoré.
 */
export function parseSilences(stderr: string): Silence[] {
  const starts = [...stderr.matchAll(SILENCE_START)].map((match) => Math.max(0, Number(match[1])));
  const ends = [...stderr.matchAll(SILENCE_END)].map((match) => Number(match[1]));
  const silences: Silence[] = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    if (ends[i] > starts[i]) silences.push({ start: starts[i], end: ends[i] });
  }
  return silences;
}

/**
 * Instants (s) où couper l'audio : près de chaque multiple de targetSec, au milieu du plus long
 * silence dans ±windowSec (à égalité, le plus proche du multiple), sinon exactement au multiple.
 */
export function planCuts(totalSec: number, silences: readonly Silence[], options: PlanOptions = DEFAULT_PLAN): number[] {
  const { targetSec, windowSec, minTailSec } = options;
  const cuts: number[] = [];

  for (let k = 1; k * targetSec < totalSec - minTailSec; k++) {
    const target = k * targetSec;
    let best: { at: number; length: number; distance: number } | null = null;

    for (const silence of silences) {
      const at = (silence.start + silence.end) / 2;
      const distance = Math.abs(at - target);
      if (distance > windowSec) continue;
      const length = silence.end - silence.start;
      if (!best || length > best.length || (length === best.length && distance < best.distance)) {
        best = { at, length, distance };
      }
    }

    cuts.push(best ? best.at : target);
  }

  return cuts;
}
