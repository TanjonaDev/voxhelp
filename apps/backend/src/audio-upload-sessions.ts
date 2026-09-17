import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Chunked audio upload: the browser was crashing (renderer OOM) building a
// single multipart/FormData request body for a full course recording
// (900MB+). Splitting the upload into small chunks (each a separate small
// request) keeps the browser's per-request memory footprint tiny regardless
// of the final file size — root cause of the single-request crash aside,
// this sidesteps it entirely. The assembled buffer only exists server-side,
// where memory is not the constraint the browser tab is.

const UPLOAD_ROOT = path.join(tmpdir(), "voxhelp-audio-uploads");
const UPLOAD_ID_PATTERN = /^[0-9a-f-]{36}$/;

function sessionDir(uploadId: string): string {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) {
    throw new Error("Invalid uploadId");
  }
  return path.join(UPLOAD_ROOT, uploadId);
}

function chunkFilename(index: number): string {
  return `${String(index).padStart(8, "0")}.chunk`;
}

export async function startUploadSession(): Promise<string> {
  const uploadId = randomUUID();
  await mkdir(sessionDir(uploadId), { recursive: true });
  return uploadId;
}

export async function writeChunk(uploadId: string, index: number, buffer: Buffer): Promise<void> {
  const dir = sessionDir(uploadId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, chunkFilename(index)), buffer);
}

/** Reads back every chunk in order and concatenates them into one buffer. */
export async function assembleUpload(uploadId: string, expectedChunkCount: number): Promise<Buffer> {
  const dir = sessionDir(uploadId);
  const entries = (await readdir(dir)).filter((name) => name.endsWith(".chunk")).sort();
  if (entries.length !== expectedChunkCount) {
    throw new Error(`Expected ${expectedChunkCount} chunks, received ${entries.length}`);
  }
  const buffers = await Promise.all(entries.map((name) => readFile(path.join(dir, name))));
  return Buffer.concat(buffers);
}

export async function cleanupUpload(uploadId: string): Promise<void> {
  await rm(sessionDir(uploadId), { recursive: true, force: true });
}
