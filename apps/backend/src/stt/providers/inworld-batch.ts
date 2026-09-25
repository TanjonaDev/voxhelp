import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { SttUtterance } from "@voxhelp/lecture";
import type { BatchStt, BatchTranscribeOptions } from "../types.js";
import { convertToWav16kMono } from "./ffmpeg.js";
import { DEFAULT_PLAN, planCuts, type PlanOptions, type Silence } from "./inworld-batch-plan.js";
import { sanitizeInworldPrompts } from "./inworld-prompts.js";
import { buildUtterances, isPromptEcho, type InworldWord } from "./inworld-utterances.js";
import { BYTES_PER_SECOND, findDataChunk, wavFromPcm } from "./inworld-wav.js";

const INWORLD_STT_URL = "https://api.inworld.ai/stt/v1/transcribe";
const MODEL_ID = "inworld/inworld-stt-1";
const CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1000, 3000];
const REQUEST_TIMEOUT_MS = 180_000;
const HEADER_PROBE_BYTES = 4096;

export interface InworldBatchDeps {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  convert: (input: string, output: string) => Promise<{ silences: Silence[] }>;
  plan: PlanOptions;
  sleep: (ms: number) => Promise<void>;
}

interface SegmentResult {
  transcript: string;
  words: InworldWord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseResponse(raw: unknown): SegmentResult {
  const transcription = isRecord(raw) && isRecord(raw.transcription) ? raw.transcription : null;
  if (!transcription) throw new Error("Réponse Inworld STT invalide");

  const transcript = typeof transcription.transcript === "string" ? transcription.transcript : "";
  const words: InworldWord[] = [];
  if (Array.isArray(transcription.wordTimestamps)) {
    for (const item of transcription.wordTimestamps as unknown[]) {
      if (
        isRecord(item) &&
        typeof item.word === "string" &&
        typeof item.startTimeMs === "number" &&
        typeof item.endTimeMs === "number"
      ) {
        words.push({ word: item.word, startTimeMs: item.startTimeMs, endTimeMs: item.endTimeMs });
      }
    }
  }
  return { transcript, words };
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.message === "string") return parsed.message.slice(0, 200);
  } catch {
    // corps non JSON : on garde le texte brut, borné
  }
  return text.slice(0, 200);
}

async function transcribeSegment(
  wav: Buffer,
  language: string,
  prompts: string[],
  apiKey: string,
  deps: InworldBatchDeps
): Promise<SegmentResult> {
  const body = JSON.stringify({
    transcribe_config: {
      model_id: MODEL_ID,
      language,
      audio_encoding: "LINEAR16",
      sample_rate_hertz: AUDIO_SAMPLE_RATE,
      include_word_timestamps: true,
      ...(prompts.length > 0 ? { prompts } : {}),
    },
    audio_data: { content: wav.toString("base64") },
  });

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await deps.fetchFn(INWORLD_STT_URL, {
        method: "POST",
        headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await deps.sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(`Inworld STT injoignable : ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.ok) return parseResponse(await response.json());

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < RETRY_DELAYS_MS.length) {
      await deps.sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(`Inworld STT HTTP ${response.status} : ${await describeError(response)}`);
  }
}

/** Résultats dans l'ordre des éléments ; au premier échec, plus aucun élément n'est démarré. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function transcribeWav(
  wavPath: string,
  silences: Silence[],
  options: BatchTranscribeOptions,
  apiKey: string,
  deps: InworldBatchDeps
): Promise<SttUtterance[]> {
  const handle = await open(wavPath, "r");
  try {
    const head = Buffer.alloc(HEADER_PROBE_BYTES);
    await handle.read(head, 0, head.length, 0);
    const dataChunk = findDataChunk(head);
    if (!dataChunk) throw new Error("ffmpeg a produit un WAV illisible");

    const available = (await handle.stat()).size - dataChunk.offset;
    const declared = dataChunk.size > 0 && dataChunk.size <= available ? dataChunk.size : available;
    const pcmBytes = declared - (declared % 2);
    const totalSec = pcmBytes / BYTES_PER_SECOND;
    if (totalSec <= 0) return [];

    const bounds = [0, ...planCuts(totalSec, silences, deps.plan), totalSec];
    const segments = bounds.slice(0, -1).map((start, index) => ({ start, end: bounds[index + 1] }));
    const prompts = sanitizeInworldPrompts(options.keyterms).prompts;

    const perSegment = await mapWithConcurrency(segments, CONCURRENCY, async (segment) => {
      const from = Math.floor(segment.start * AUDIO_SAMPLE_RATE) * 2;
      const to = Math.min(pcmBytes, Math.floor(segment.end * AUDIO_SAMPLE_RATE) * 2);
      const pcm = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(pcm, 0, pcm.length, dataChunk.offset + from);
      if (bytesRead !== pcm.length) throw new Error("Lecture incomplète du WAV converti");

      const result = await transcribeSegment(wavFromPcm(pcm), options.language, prompts, apiKey, deps);
      const utterances = buildUtterances(result.transcript, result.words, segment.start, segment.end - segment.start);
      const kept = utterances.filter((utterance) => !isPromptEcho(utterance.transcript ?? "", prompts));
      if (kept.length < utterances.length) {
        console.warn(`[Inworld batch] ${utterances.length - kept.length} énoncé(s) écarté(s) : écho des prompts`);
      }
      return kept;
    });
    return perSegment.flat();
  } finally {
    await handle.close();
  }
}

/** Adapter batch Inworld : ffmpeg (WAV 16 kHz mono + silences) -> morceaux <= 720 s -> API synchrone. */
export function createInworldBatchStt(overrides: Partial<InworldBatchDeps> = {}): BatchStt {
  const deps: InworldBatchDeps = {
    fetchFn: (url, init) => fetch(url, init),
    convert: convertToWav16kMono,
    plan: DEFAULT_PLAN,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };

  return {
    async transcribe(audio: Buffer, options: BatchTranscribeOptions): Promise<SttUtterance[]> {
      const apiKey = process.env.INWORLD_API_KEY;
      if (!apiKey) throw new Error("INWORLD_API_KEY not set");

      const workDir = await mkdtemp(path.join(tmpdir(), "voxhelp-inworld-batch-"));
      try {
        const inputPath = path.join(workDir, "input.bin");
        const wavPath = path.join(workDir, "audio.wav");
        await writeFile(inputPath, audio);
        const { silences } = await deps.convert(inputPath, wavPath);
        return await transcribeWav(wavPath, silences, options, apiKey, deps);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

export const inworldBatchStt: BatchStt = createInworldBatchStt();
