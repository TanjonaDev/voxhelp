import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInworldBatchStt, type InworldBatchDeps } from "../stt/providers/inworld-batch.js";
import { BYTES_PER_SECOND, wavFromPcm } from "../stt/providers/inworld-wav.js";
import { UNKNOWN_CONFIDENCE } from "../stt/providers/inworld-utterances.js";

const PLAN = { targetSec: 10, windowSec: 2, minTailSec: 3 };
const HELLO = [{ word: "Bonjour", startTimeMs: 0, endTimeMs: 500 }];

/** Fausse conversion : écrit un WAV de `seconds` secondes de silence à l'emplacement demandé. */
function fakeConvert(seconds: number, silences: Array<{ start: number; end: number }> = []): InworldBatchDeps["convert"] {
  return async (_input, output) => {
    await writeFile(output, wavFromPcm(Buffer.alloc(Math.round(seconds * BYTES_PER_SECOND))));
    return { silences };
  };
}

function ok(transcript: string, words: Array<{ word: string; startTimeMs: number; endTimeMs: number }>): Response {
  return new Response(JSON.stringify({ transcription: { transcript, isFinal: true, wordTimestamps: words } }), { status: 200 });
}

/** Durée (s) de l'audio d'une requête Inworld, lue dans le WAV en base64. */
function requestSeconds(init: RequestInit): number {
  const body = JSON.parse(String(init.body)) as { audio_data: { content: string } };
  return (Buffer.from(body.audio_data.content, "base64").length - 44) / BYTES_PER_SECOND;
}

const noSleep = async (_ms: number): Promise<void> => {};

describe("inworldBatchStt.transcribe", () => {
  beforeEach(() => {
    process.env.INWORLD_API_KEY = "test-key";
  });

  it("sends one request for short audio, with the Inworld sync config and sanitized prompts", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Bonjour.", HELLO));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("fake input"), { language: "fr", keyterms: ["C#", "Genèse"] });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.inworld.ai/stt/v1/transcribe");
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic test-key");
    expect(JSON.parse(String(init.body)).transcribe_config).toEqual({
      model_id: "inworld/inworld-stt-1",
      language: "fr",
      audio_encoding: "LINEAR16",
      sample_rate_hertz: 16000,
      include_word_timestamps: true,
      prompts: ["C sharp", "Genèse"],
    });
    expect(requestSeconds(init)).toBe(5);
    expect(result).toEqual([{ start: 0, end: 0.5, transcript: "Bonjour.", confidence: UNKNOWN_CONFIDENCE }]);
  });

  it("drops an utterance that only echoes the prompts", async () => {
    const words = ["Bonjour", "Genèse", "MECC", "C", "sharp"].map((word, i) => ({
      word,
      startTimeMs: i * 500,
      endTimeMs: i * 500 + 400,
    }));
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Bonjour. Genèse, MECC, C sharp.", words));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr", keyterms: ["Genèse", "MECC", "C#"] });

    expect(result.map((u) => u.transcript)).toEqual(["Bonjour."]);
  });

  it("omits prompts when there are no keyterms", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Hello.", HELLO));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    await stt.transcribe(Buffer.from("x"), { language: "en" });

    const config = JSON.parse(String(fetchFn.mock.calls[0][1].body)).transcribe_config;
    expect(config).not.toHaveProperty("prompts");
    expect(config.language).toBe("en");
  });

  it("cuts long audio at the planned silences and offsets the timestamps of each piece", async () => {
    const transcripts: Record<string, string> = { "8.5": "Premier.", "11.5": "Deuxième.", "5": "Troisième." };
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const text = transcripts[String(requestSeconds(init))];
      return ok(text, [{ word: text.replace(".", ""), startTimeMs: 0, endTimeMs: 500 }]);
    });
    const stt = createInworldBatchStt({
      fetchFn,
      convert: fakeConvert(25, [{ start: 8, end: 9 }]),
      plan: PLAN,
      sleep: noSleep,
    });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.map((u) => [u.transcript, u.start])).toEqual([
      ["Premier.", 0],
      ["Deuxième.", 8.5],
      ["Troisième.", 20],
    ]);
  });

  it("retries on 429 and then succeeds", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ code: 8, message: "rate limited" }), { status: 429 })
        : ok("Bonjour.", HELLO);
    });
    const sleep = vi.fn(noSleep);
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result).toHaveLength(1);
  });

  it("does not retry a client error and never leaks the API key", async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ code: 3, message: "invalid transcribe config" }), { status: 400 })
    );
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    const error = await stt.transcribe(Buffer.from("x"), { language: "fr" }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/HTTP 400/);
    expect((error as Error).message).not.toContain("test-key");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries on a persistent 5xx", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => new Response("boom", { status: 500 }));
    const sleep = vi.fn(noSleep);
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep });

    await expect(stt.transcribe(Buffer.from("x"), { language: "fr" })).rejects.toThrow(/HTTP 500/);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 3000]);
  });

  it("fails fast without an API key, before converting anything", async () => {
    delete process.env.INWORLD_API_KEY;
    const convert = vi.fn(fakeConvert(5));
    const stt = createInworldBatchStt({ convert, plan: PLAN, sleep: noSleep });

    await expect(stt.transcribe(Buffer.from("x"), { language: "fr" })).rejects.toThrow("INWORLD_API_KEY not set");

    expect(convert).not.toHaveBeenCalled();
  });

  it("removes the temporary directory even when the conversion fails", async () => {
    let workDir = "";
    const convert: InworldBatchDeps["convert"] = async (input) => {
      workDir = path.dirname(input);
      throw new Error("ffmpeg a échoué");
    };
    const stt = createInworldBatchStt({ convert, plan: PLAN, sleep: noSleep });

    await expect(stt.transcribe(Buffer.from("x"), { language: "fr" })).rejects.toThrow("ffmpeg a échoué");

    expect(workDir).not.toBe("");
    expect(existsSync(workDir)).toBe(false);
  });

  it("runs at most three requests at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return ok("Bonjour.", HELLO);
    });
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(50), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(3);
    expect(result).toHaveLength(5);
  });

  it("returns nothing for empty audio without calling Inworld", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Bonjour.", HELLO));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(0), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
