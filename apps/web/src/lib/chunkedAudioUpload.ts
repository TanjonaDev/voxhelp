import type { GlossaryEntry, TranscriptSegment } from "@voxhelp/lecture";

// Splits the audio/video file into small chunks and uploads each as its own
// small request, instead of one multipart body holding the whole file.
// Building a single request body for a 900MB+ recording was crashing the
// browser tab (renderer OOM) — chunking keeps the per-request memory
// footprint tiny (CHUNK_SIZE) no matter how large the final file is. The
// assembled buffer only ever exists server-side, where memory isn't the
// constraint a browser tab is.
const CHUNK_SIZE = 8 * 1024 * 1024;

async function postJson<T>(url: string, body: unknown, token: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function uploadAudioChunked(
  file: File,
  language: string,
  existingGlossary: GlossaryEntry[],
  token: string,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
  sttProvider?: string
): Promise<{ transcript: TranscriptSegment[] }> {
  const startRes = await fetch("/api/lecture/audio-chunk/start", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({ error: startRes.statusText }));
    throw new Error(err.error ?? `HTTP ${startRes.status}`);
  }
  const { uploadId } = (await startRes.json()) as { uploadId: string };

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  for (let index = 0; index < totalChunks; index++) {
    const chunk = file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const res = await fetch("/api/lecture/audio-chunk", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-upload-id": uploadId,
        "x-chunk-index": String(index),
      },
      body: chunk,
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    onProgress?.((index + 1) / totalChunks);
  }

  return postJson<{ transcript: TranscriptSegment[] }>(
    "/api/lecture/audio-chunk/finalize",
    { uploadId, totalChunks, language, existingGlossary, ...(sttProvider ? { sttProvider } : {}) },
    token,
    signal
  );
}
