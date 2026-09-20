import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTranscribeFile = vi.hoisted(() => vi.fn());

vi.mock("@deepgram/sdk", () => ({
  DeepgramClient: class {
    listen = { v1: { media: { transcribeFile: mockTranscribeFile } } };
  },
}));

const { deepgramBatchStt } = await import("../stt/providers/deepgram-batch.js");

describe("deepgramBatchStt.transcribe", () => {
  beforeEach(() => {
    mockTranscribeFile.mockReset();
  });

  it("requests nova-3 with utterances/punctuate/smart_format and the given language", async () => {
    mockTranscribeFile.mockResolvedValueOnce({
      metadata: {},
      results: { channels: [], utterances: [] },
    });

    await deepgramBatchStt.transcribe(Buffer.from("fake audio"), { language: "fr" });

    expect(mockTranscribeFile).toHaveBeenCalledTimes(1);
    const [buffer, options] = mockTranscribeFile.mock.calls[0];
    expect(buffer).toBeInstanceOf(Buffer);
    expect(options).toMatchObject({
      model: "nova-3",
      language: "fr",
      utterances: true,
      punctuate: true,
      smart_format: true,
    });
    expect(options).not.toHaveProperty("keyterm");
  });

  it("passes keyterms through when provided", async () => {
    mockTranscribeFile.mockResolvedValueOnce({
      metadata: {},
      results: { channels: [], utterances: [] },
    });

    await deepgramBatchStt.transcribe(Buffer.from("fake audio"), { language: "fr", keyterms: ["berakhah", "Septante"] });

    const [, options] = mockTranscribeFile.mock.calls[0];
    expect(options.keyterm).toEqual(["berakhah", "Septante"]);
  });

  it("omits keyterm when the array is empty", async () => {
    mockTranscribeFile.mockResolvedValueOnce({
      metadata: {},
      results: { channels: [], utterances: [] },
    });

    await deepgramBatchStt.transcribe(Buffer.from("fake audio"), { language: "fr", keyterms: [] });

    const [, options] = mockTranscribeFile.mock.calls[0];
    expect(options).not.toHaveProperty("keyterm");
  });

  it("returns the utterances array from the response", async () => {
    const utterances = [{ start: 0, end: 1.5, confidence: 0.9, transcript: "Bonjour." }];
    mockTranscribeFile.mockResolvedValueOnce({
      metadata: {},
      results: { channels: [], utterances },
    });

    const result = await deepgramBatchStt.transcribe(Buffer.from("fake audio"), { language: "fr" });

    expect(result).toEqual(utterances);
  });

  it("returns an empty array when the response has no utterances", async () => {
    mockTranscribeFile.mockResolvedValueOnce({
      metadata: {},
      results: { channels: [] },
    });

    const result = await deepgramBatchStt.transcribe(Buffer.from("fake audio"), { language: "fr" });

    expect(result).toEqual([]);
  });

  it("throws when Deepgram returns an async/accepted response instead of a synchronous result", async () => {
    mockTranscribeFile.mockResolvedValueOnce({ request_id: "abc123" });

    await expect(deepgramBatchStt.transcribe(Buffer.from("fake audio"), { language: "fr" })).rejects.toThrow(
      /accepted/i
    );
  });
});
