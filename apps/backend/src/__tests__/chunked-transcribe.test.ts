import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { transcribeChunked, CHUNK_PLAN, type ChunkedTranscribeDeps } from "../stt/chunked-transcribe.js";
import { wavFromPcm } from "../stt/providers/inworld-wav.js";
import { cleanupJob, readStep } from "../lecture-job-cache.js";
import type { BatchStt } from "../stt/types.js";
import type { SttUtterance } from "@voxhelp/lecture";

const BYTES_PER_SECOND = 16000 * 2;

/** Same pattern as inworld-batch.test.ts's fakeConvert: writes a WAV of `seconds` of silence. */
function fakeConvert(seconds: number): ChunkedTranscribeDeps["convert"] {
  return async (_input, output) => {
    await writeFile(output, wavFromPcm(Buffer.alloc(Math.round(seconds * BYTES_PER_SECOND))));
    return { silences: [] };
  };
}

describe("transcribeChunked", () => {
  it("sends one request and returns it untouched when the audio fits in a single chunk", async () => {
    const transcribe = vi.fn(async () => [{ start: 0, end: 1, confidence: 0.9, transcript: "Bonjour." }]);
    const batchStt: BatchStt = { transcribe };
    const jobId = randomUUID();

    const result = await transcribeChunked(
      Buffer.from("fake"),
      { language: "fr" },
      batchStt,
      jobId,
      { convert: fakeConvert(60) } // well under CHUNK_PLAN.targetSec
    );

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ start: 0, end: 1, confidence: 0.9, transcript: "Bonjour." }]);
    await cleanupJob(jobId);
  });

  it("splits audio longer than the chunk target into multiple requests, offsetting timestamps by each chunk's start", async () => {
    const totalSec = CHUNK_PLAN.targetSec * 3 + 5; // forces (at least) 3 chunks
    let call = 0;
    const transcribe = vi.fn(async (): Promise<SttUtterance[]> => {
      call += 1;
      return [{ start: 1, end: 2, confidence: 0.9, transcript: `chunk-${call}` }];
    });
    const batchStt: BatchStt = { transcribe };
    const jobId = randomUUID();

    const result = await transcribeChunked(Buffer.from("fake"), { language: "fr" }, batchStt, jobId, {
      convert: fakeConvert(totalSec),
    });

    expect(transcribe.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Each chunk's utterance start/end is offset by that chunk's start time,
    // not raw — the 2nd/3rd chunk's offsets must differ from the 1st's.
    const starts = result.map((u) => u.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect(starts[0]).toBe(1); // first chunk: no offset
    await cleanupJob(jobId);
  });

  it("reuses a cached chunk instead of calling the provider again, and caches a newly transcribed chunk", async () => {
    const totalSec = CHUNK_PLAN.targetSec * 3 + 5;
    const jobId = randomUUID();
    await import("../lecture-job-cache.js").then(({ writeStep }) =>
      writeStep(jobId, "stt-chunk-0", [{ start: 0, end: 1, confidence: 0.9, transcript: "cached" }])
    );

    const transcribe = vi.fn(async (): Promise<SttUtterance[]> => [
      { start: 1, end: 2, confidence: 0.9, transcript: "fresh" },
    ]);
    const batchStt: BatchStt = { transcribe };

    const result = await transcribeChunked(Buffer.from("fake"), { language: "fr" }, batchStt, jobId, {
      convert: fakeConvert(totalSec),
    });

    expect(result.some((u) => u.transcript === "cached")).toBe(true);
    // Chunk 0 was cached: transcribe was only called for the remaining chunks.
    expect(transcribe.mock.calls.length).toBeGreaterThanOrEqual(2);

    const cachedChunk1 = await readStep(jobId, "stt-chunk-1");
    expect(cachedChunk1).not.toBeNull();
    await cleanupJob(jobId);
  });
});
