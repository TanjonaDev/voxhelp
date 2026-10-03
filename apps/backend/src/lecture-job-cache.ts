import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Checkpoint cache for the course ("lecture") pipeline (STT chunks, pass1
// windows, pass2 section groups). Same pattern as audio-upload-sessions.ts —
// a tmp dir per job, no external dependency — but generic over any pipeline
// step, keyed by a caller-chosen string, so every stage can resume from
// where it crashed instead of redoing already-paid-for LLM/STT calls.

const JOBS_ROOT = path.join(tmpdir(), "voxhelp-lecture-jobs");
const JOB_ID_PATTERN = /^[0-9a-f-]{36}$/;

export function jobDir(jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error("Invalid jobId");
  }
  return path.join(JOBS_ROOT, jobId);
}

function stepFile(jobId: string, step: string): string {
  return path.join(jobDir(jobId), `${step}.json`);
}

export async function readStep<T>(jobId: string, step: string): Promise<T | null> {
  try {
    const raw = await readFile(stepFile(jobId, step), "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeStep<T>(jobId: string, step: string, data: T): Promise<void> {
  const dir = jobDir(jobId);
  await mkdir(dir, { recursive: true });
  await writeFile(stepFile(jobId, step), JSON.stringify(data));
}

/** Called only once the FULL pipeline (STT + pass1 + pass2) has succeeded — checkpoints are no longer needed. */
export async function cleanupJob(jobId: string): Promise<void> {
  await rm(jobDir(jobId), { recursive: true, force: true });
}
