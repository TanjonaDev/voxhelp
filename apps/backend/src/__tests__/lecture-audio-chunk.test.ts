import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockTranscribeAudioBatch = vi.hoisted(() => vi.fn());

vi.mock("../deepgram-batch.js", () => ({ transcribeAudioBatch: mockTranscribeAudioBatch }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

async function startUpload(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/lecture/audio-chunk/start`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.uploadId;
}

async function uploadChunk(port: number, uploadId: string, index: number, data: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/lecture/audio-chunk`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-upload-id": uploadId,
      "x-chunk-index": String(index),
    },
    body: Buffer.from(data),
  });
}

describe("chunked audio upload (/api/lecture/audio-chunk*)", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockTranscribeAudioBatch.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("starts a session, accepts chunks in order, and finalizes into one transcribed buffer", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([
      { start: 0, end: 4.5, confidence: 0.92, transcript: "Alors, on commence." },
    ]);

    const uploadId = await startUpload(server.port);
    expect(await uploadChunk(server.port, uploadId, 0, "hello ").then((r) => r.status)).toBe(200);
    expect(await uploadChunk(server.port, uploadId, 1, "world").then((r) => r.status)).toBe(200);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/audio-chunk/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, totalChunks: 2, language: "fr" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toEqual([
      { startMs: 0, endMs: 4500, text: "Alors, on commence.", confidence: 0.92 },
    ]);
    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(Buffer.from("hello world"), {
      language: "fr",
      keyterms: [],
    });
  });

  it("accepts chunks arriving out of order (assembled by index, not arrival order)", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([]);

    const uploadId = await startUpload(server.port);
    await uploadChunk(server.port, uploadId, 1, "world");
    await uploadChunk(server.port, uploadId, 0, "hello ");

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/audio-chunk/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, totalChunks: 2 }),
    });

    expect(res.status).toBe(200);
    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(Buffer.from("hello world"), expect.anything());
  });

  it("returns 400 on finalize when a chunk is missing", async () => {
    server = await createTestHttpServer();
    const uploadId = await startUpload(server.port);
    await uploadChunk(server.port, uploadId, 0, "hello ");
    // chunk 1 never sent

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/audio-chunk/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, totalChunks: 2 }),
    });

    expect(res.status).toBe(400);
    expect(mockTranscribeAudioBatch).not.toHaveBeenCalled();
  });

  it("returns 400 for a chunk upload missing x-upload-id or x-chunk-index", async () => {
    server = await createTestHttpServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/audio-chunk`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("data"),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for finalize with a malformed uploadId", async () => {
    server = await createTestHttpServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/audio-chunk/finalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: "../../etc/passwd", totalChunks: 1 }),
    });
    expect(res.status).toBe(400);
    expect(mockTranscribeAudioBatch).not.toHaveBeenCalled();
  });
});
