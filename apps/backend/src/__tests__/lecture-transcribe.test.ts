import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockTranscribeAudioBatch = vi.hoisted(() => vi.fn());

vi.mock("../deepgram-batch.js", () => ({ transcribeAudioBatch: mockTranscribeAudioBatch }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function buildUrl(port: number, params: { language?: string; existingGlossary?: unknown } = {}): string {
  const url = new URL(`http://127.0.0.1:${port}/api/lecture/transcribe-audio`);
  if (params.language !== undefined) url.searchParams.set("language", params.language);
  if (params.existingGlossary !== undefined) {
    url.searchParams.set("existingGlossary", JSON.stringify(params.existingGlossary));
  }
  return url.toString();
}

describe("POST /api/lecture/transcribe-audio", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockTranscribeAudioBatch.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("streams the raw request body to Deepgram and returns the mapped transcript", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([
      { start: 0, end: 4.5, confidence: 0.92, transcript: "Alors, on commence." },
    ]);

    const res = await fetch(buildUrl(server.port, { language: "fr" }), {
      method: "POST",
      headers: { "content-type": "audio/mpeg" },
      body: Buffer.from("fake audio content"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toEqual([
      { startMs: 0, endMs: 4500, text: "Alors, on commence.", confidence: 0.92 },
    ]);
    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(expect.any(Buffer), { language: "fr", keyterms: [] });
  });

  it("defaults language to fr when not provided", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([]);

    await fetch(buildUrl(server.port), {
      method: "POST",
      headers: { "content-type": "audio/mpeg" },
      body: Buffer.from("fake audio content"),
    });

    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(expect.any(Buffer), { language: "fr", keyterms: [] });
  });

  it("extracts keyterms from existingGlossary above the confidence threshold", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([]);

    await fetch(
      buildUrl(server.port, {
        existingGlossary: [
          { term: "Septante", heardVariants: [], category: "proper_noun", occurrences: 3, confidence: 0.9 },
          { term: "truc", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.3 },
        ],
      }),
      {
        method: "POST",
        headers: { "content-type": "audio/mpeg" },
        body: Buffer.from("fake audio content"),
      }
    );

    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(expect.any(Buffer), {
      language: "fr",
      keyterms: ["Septante"],
    });
  });

  it("accepts a video container upload (e.g. .m4v screen/lecture recordings)", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([]);

    const res = await fetch(buildUrl(server.port), {
      method: "POST",
      headers: { "content-type": "video/x-m4v" },
      body: Buffer.from("fake video content"),
    });

    expect(res.status).toBe(200);
    expect(mockTranscribeAudioBatch).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-audio, non-video content-type with 400", async () => {
    server = await createTestHttpServer();

    const res = await fetch(buildUrl(server.port), {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: Buffer.from("notes"),
    });

    expect(res.status).toBe(400);
    expect(mockTranscribeAudioBatch).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed existingGlossary JSON", async () => {
    server = await createTestHttpServer();
    const url = new URL(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`);
    url.searchParams.set("existingGlossary", "{not valid json");

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "audio/mpeg" },
      body: Buffer.from("fake audio"),
    });

    expect(res.status).toBe(400);
    expect(mockTranscribeAudioBatch).not.toHaveBeenCalled();
  });

  it("returns 502 when Deepgram transcription fails", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockRejectedValueOnce(new Error("Deepgram error"));

    const res = await fetch(buildUrl(server.port), {
      method: "POST",
      headers: { "content-type": "audio/mpeg" },
      body: Buffer.from("fake audio content"),
    });

    expect(res.status).toBe(502);
  });
});
