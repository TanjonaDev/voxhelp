import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const batch = vi.hoisted(() => ({ transcribe: vi.fn(), getBatchStt: vi.fn() }));

vi.mock("../stt/index.js", () => {
  class SttProviderError extends Error {}
  return {
    getBatchStt: batch.getBatchStt,
    SttProviderError,
    listBatchProviders: () => [],
    defaultBatchProviderId: () => "deepgram",
    listLiveProviders: () => [],
    defaultLiveProviderId: () => "deepgram",
  };
});
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

const { SttProviderError } = await import("../stt/index.js");

/** Les champs sont ajoutés AVANT le fichier : la route les lit avant de consommer le fichier. */
function multipart(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", new Blob([Buffer.from("fake audio")], { type: "audio/mpeg" }), "cours.mp3");
  return form;
}

describe("sttProvider on the course transcription routes", () => {
  let server: TestHttpServer;
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;

  beforeEach(async () => {
    batch.transcribe.mockReset();
    batch.getBatchStt.mockReset();
    batch.transcribe.mockResolvedValue([{ start: 0, end: 1, confidence: 0.9, transcript: "Bonjour." }]);
    batch.getBatchStt.mockImplementation((id?: string) => {
      if (id === "whisper") throw new SttProviderError('Modèle STT inconnu : "whisper"');
      return { transcribe: batch.transcribe };
    });
    server = await createTestHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const postAudio = (form: FormData) =>
    fetch(url("/api/lecture/transcribe-audio"), { method: "POST", body: form });

  async function chunkedUpload(): Promise<string> {
    const start = await fetch(url("/api/lecture/audio-chunk/start"), { method: "POST" });
    const { uploadId } = (await start.json()) as { uploadId: string };
    await fetch(url("/api/lecture/audio-chunk"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-upload-id": uploadId, "x-chunk-index": "0" },
      body: Buffer.from("fake audio"),
    });
    return uploadId;
  }

  const finalize = (body: unknown) =>
    fetch(url("/api/lecture/audio-chunk/finalize"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("transcribe-audio passes the sttProvider form field to getBatchStt", async () => {
    const res = await postAudio(multipart({ sttProvider: "inworld" }));

    expect(res.status).toBe(200);
    expect(batch.getBatchStt).toHaveBeenCalledWith("inworld");
    expect(batch.transcribe).toHaveBeenCalledTimes(1);
  });

  it("transcribe-audio uses the server default when no sttProvider is sent", async () => {
    const res = await postAudio(multipart({}));

    expect(res.status).toBe(200);
    expect(batch.getBatchStt).toHaveBeenCalledWith(undefined);
  });

  it("transcribe-audio answers 400 for an unknown sttProvider and does not transcribe", async () => {
    const res = await postAudio(multipart({ sttProvider: "whisper" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Modèle STT inconnu : "whisper"' });
    expect(batch.transcribe).not.toHaveBeenCalled();
  });

  it("finalize passes sttProvider from the JSON body to getBatchStt", async () => {
    const uploadId = await chunkedUpload();

    const res = await finalize({ uploadId, totalChunks: 1, language: "fr", sttProvider: "inworld" });

    expect(res.status).toBe(200);
    expect(batch.getBatchStt).toHaveBeenCalledWith("inworld");
    expect(batch.transcribe).toHaveBeenCalledTimes(1);
  });

  it("finalize answers 400 for an unknown sttProvider and does not transcribe", async () => {
    const uploadId = await chunkedUpload();

    const res = await finalize({ uploadId, totalChunks: 1, sttProvider: "whisper" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Modèle STT inconnu : "whisper"' });
    expect(batch.transcribe).not.toHaveBeenCalled();
  });

  it("finalize answers 400 when sttProvider is not a string", async () => {
    const uploadId = await chunkedUpload();

    const res = await finalize({ uploadId, totalChunks: 1, sttProvider: 5 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid sttProvider" });
    expect(batch.getBatchStt).not.toHaveBeenCalled();
  });
});
