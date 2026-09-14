import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockTranscribeAudioBatch = vi.hoisted(() => vi.fn());

vi.mock("../deepgram-batch.js", () => ({ transcribeAudioBatch: mockTranscribeAudioBatch }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function buildForm(options: {
  mimetype?: string;
  filename?: string;
  language?: string;
  existingGlossary?: unknown;
}): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("fake audio content")], { type: options.mimetype ?? "audio/mpeg" }),
    options.filename ?? "cours.mp3"
  );
  if (options.language !== undefined) form.append("language", options.language);
  if (options.existingGlossary !== undefined) {
    form.append("existingGlossary", JSON.stringify(options.existingGlossary));
  }
  return form;
}

describe("POST /api/lecture/transcribe-audio", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockTranscribeAudioBatch.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the mapped transcript for a valid audio upload", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([
      { start: 0, end: 4.5, confidence: 0.92, transcript: "Alors, on commence." },
    ]);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`, {
      method: "POST",
      body: buildForm({ language: "fr" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toEqual([
      { startMs: 0, endMs: 4500, text: "Alors, on commence.", confidence: 0.92 },
    ]);
  });

  it("defaults language to fr when not provided", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([]);

    await fetch(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`, {
      method: "POST",
      body: buildForm({}),
    });

    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(expect.any(Buffer), { language: "fr", keyterms: [] });
  });

  it("extracts keyterms from existingGlossary above the confidence threshold", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockResolvedValueOnce([]);

    await fetch(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`, {
      method: "POST",
      body: buildForm({
        existingGlossary: [
          { term: "Septante", heardVariants: [], category: "proper_noun", occurrences: 3, confidence: 0.9 },
          { term: "truc", heardVariants: [], category: "concept", occurrences: 1, confidence: 0.3 },
        ],
      }),
    });

    expect(mockTranscribeAudioBatch).toHaveBeenCalledWith(expect.any(Buffer), {
      language: "fr",
      keyterms: ["Septante"],
    });
  });

  it("rejects a non-audio upload with 400", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`, {
      method: "POST",
      body: buildForm({ mimetype: "text/plain", filename: "notes.txt" }),
    });

    expect(res.status).toBe(400);
    expect(mockTranscribeAudioBatch).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed existingGlossary JSON", async () => {
    server = await createTestHttpServer();
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("fake audio")], { type: "audio/mpeg" }), "cours.mp3");
    form.append("existingGlossary", "{not valid json");

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(400);
    expect(mockTranscribeAudioBatch).not.toHaveBeenCalled();
  });

  it("returns 502 when Deepgram transcription fails", async () => {
    server = await createTestHttpServer();
    mockTranscribeAudioBatch.mockRejectedValueOnce(new Error("Deepgram error"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/transcribe-audio`, {
      method: "POST",
      body: buildForm({}),
    });

    expect(res.status).toBe(502);
  });
});
