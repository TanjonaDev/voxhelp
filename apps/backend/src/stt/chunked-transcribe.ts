import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { SttUtterance } from "@voxhelp/lecture";
import { readStep, writeStep } from "../lecture-job-cache.js";
import { convertToWav16kMono } from "./providers/ffmpeg.js";
import { planCuts, type PlanOptions, type Silence } from "./providers/inworld-batch-plan.js";
import { findDataChunk, wavFromPcm } from "./providers/inworld-wav.js";
import type { BatchStt, BatchTranscribeOptions } from "./types.js";

export interface ChunkedTranscribeDeps {
  /** Overridable for tests — defaults to the real ffmpeg conversion. */
  convert: (input: string, output: string) => Promise<{ silences: Silence[] }>;
}

// A single synchronous transcription request over a whole 1h40 course
// recording risks a silent provider-side timeout or size limit (seen on
// Deepgram — the course's last section came back empty, with no error at
// all). Splitting the file into ~15 min chunks keeps each external request
// small, and caching each chunk's result as soon as it lands (via
// lecture-job-cache) means a crash or a provider error partway through a
// long course doesn't throw away the chunks already transcribed — a retry
// picks up at the first missing chunk instead of re-transcribing from zero.
//
// 15 min was picked as a middle ground: short enough that a provider hiccup
// only costs one chunk's worth of work, long enough to keep the chunk count
// (and therefore the number of external calls) reasonable for a ~1h30-2h
// course. windowSec/minTailSec mirror inworld-batch-plan's own defaults.
export const CHUNK_PLAN: PlanOptions = { targetSec: 15 * 60, windowSec: 60, minTailSec: 60 };

const BYTES_PER_SECOND = AUDIO_SAMPLE_RATE * 2;

function offsetUtterances(utterances: SttUtterance[], offsetSec: number): SttUtterance[] {
  return utterances.map((utterance) => ({
    ...utterance,
    start: utterance.start !== undefined ? utterance.start + offsetSec : utterance.start,
    end: utterance.end !== undefined ? utterance.end + offsetSec : utterance.end,
  }));
}

/**
 * Provider-agnostic chunking: converts the whole file to WAV 16kHz mono once
 * (reusing the same ffmpeg pass that already detects silences for a
 * silence-aware cut plan), then hands each chunk — itself a self-contained
 * WAV, valid audio on its own for either Deepgram or Inworld — to
 * `batchStt.transcribe` one at a time, offsetting the returned timestamps by
 * the chunk's start. Chunks already cached under `jobId` are reused as-is,
 * without calling the provider again.
 */
export async function transcribeChunked(
  buffer: Buffer,
  options: BatchTranscribeOptions,
  batchStt: BatchStt,
  jobId: string,
  deps: ChunkedTranscribeDeps = { convert: convertToWav16kMono }
): Promise<SttUtterance[]> {
  const workDir = await mkdtemp(path.join(tmpdir(), "voxhelp-stt-chunk-"));
  try {
    const inputPath = path.join(workDir, "input.bin");
    const wavPath = path.join(workDir, "audio.wav");
    await writeFile(inputPath, buffer);
    const { silences } = await deps.convert(inputPath, wavPath);

    const handle = await open(wavPath, "r");
    try {
      const head = Buffer.alloc(4096);
      await handle.read(head, 0, head.length, 0);
      const dataChunk = findDataChunk(head);
      if (!dataChunk) throw new Error("ffmpeg a produit un WAV illisible");

      const available = (await handle.stat()).size - dataChunk.offset;
      const declared = dataChunk.size > 0 && dataChunk.size <= available ? dataChunk.size : available;
      const pcmBytes = declared - (declared % 2);
      const totalSec = pcmBytes / BYTES_PER_SECOND;
      if (totalSec <= 0) return [];

      const bounds = [0, ...planCuts(totalSec, silences, CHUNK_PLAN), totalSec];
      const segments = bounds.slice(0, -1).map((start, index) => ({ start, end: bounds[index + 1] }));

      const allUtterances: SttUtterance[] = [];
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        const step = `stt-chunk-${index}`;
        const cached = await readStep<SttUtterance[]>(jobId, step);
        if (cached) {
          allUtterances.push(...cached);
          continue;
        }

        const from = Math.floor(segment.start * AUDIO_SAMPLE_RATE) * 2;
        const to = Math.min(pcmBytes, Math.floor(segment.end * AUDIO_SAMPLE_RATE) * 2);
        const pcm = Buffer.alloc(to - from);
        const { bytesRead } = await handle.read(pcm, 0, pcm.length, dataChunk.offset + from);
        if (bytesRead !== pcm.length) throw new Error("Lecture incomplète du WAV converti");

        const raw = await batchStt.transcribe(wavFromPcm(pcm), options);
        const utterances = offsetUtterances(raw, segment.start);
        await writeStep(jobId, step, utterances);
        allUtterances.push(...utterances);
      }
      return allUtterances;
    } finally {
      await handle.close();
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
