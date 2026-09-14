import type { TranscriptSegment } from "../types.js";
import type { DeepgramUtterance } from "./types.js";

export function mapUtterancesToSegments(utterances: DeepgramUtterance[] | undefined): TranscriptSegment[] {
  if (!utterances) return [];

  const segments: TranscriptSegment[] = [];
  for (const utterance of utterances) {
    if (
      utterance.start === undefined ||
      utterance.end === undefined ||
      utterance.confidence === undefined ||
      utterance.transcript === undefined
    ) {
      continue;
    }

    const segment: TranscriptSegment = {
      startMs: Math.round(utterance.start * 1000),
      endMs: Math.round(utterance.end * 1000),
      text: utterance.transcript,
      confidence: utterance.confidence,
    };
    if (utterance.speaker !== undefined) segment.speaker = utterance.speaker;

    segments.push(segment);
  }
  return segments;
}
