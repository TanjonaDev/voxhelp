import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { InterviewLanguage } from "@voxhelp/shared";
import { createLiveStt } from "../src/stt/index.js";

const execFileAsync = promisify(execFile);

const CHUNK_MS = 100;
const BYTES_PER_CHUNK = (AUDIO_SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
// Après le dernier chunk, on continue d'envoyer du silence pendant TAIL_MS : la détection de fin de tour
// se base sur le silence reçu, sans lui le dernier tour ne se finaliserait jamais. Dans l'app, l'audio
// est diffusé en continu, donc le silence arrive naturellement.
const TAIL_MS = 4000;

const USAGE =
  "Usage: STT_LIVE_PROVIDER=<deepgram|inworld> tsx scripts/stt-compare.ts <audio-file> [language]\n" +
  "  <audio-file>: 16 kHz mono 16-bit .wav, or any other audio/video file (converted with afconvert on macOS)";

function extractPcm(wav: Buffer): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      const channels = wav.readUInt16LE(offset + 10);
      const rate = wav.readUInt32LE(offset + 12);
      const bits = wav.readUInt16LE(offset + 22);
      if (channels !== 1 || rate !== AUDIO_SAMPLE_RATE || bits !== 16) {
        throw new Error(`Expected 16 kHz mono 16-bit PCM, got ${rate} Hz / ${channels} ch / ${bits} bit`);
      }
    }
    if (id === "data") return wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk found");
}

async function readInputFile(file: string): Promise<Buffer> {
  try {
    return await readFile(file);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read input file: ${reason}`);
  }
}

/** Résume l'échec d'un execFile en une ligne : binaire absent, ou première ligne de stderr. */
function describeExecError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const { code, stderr } = err as { code?: unknown; stderr?: unknown };
    if (code === "ENOENT") return "not found (afconvert is only available on macOS)";
    if (typeof stderr === "string") {
      const line = stderr.split("\n").find((l) => l.trim() !== "");
      if (line) return `failed: ${line.trim()}`;
    }
  }
  return "failed";
}

/** Convertit n'importe quel fichier audio/vidéo en WAV 16 kHz mono 16-bit via afconvert (macOS), puis en extrait le PCM. */
async function convertToPcm(file: string): Promise<Buffer> {
  await readInputFile(file); // échoue tôt avec un message clair si le fichier est illisible
  const dir = await mkdtemp(join(tmpdir(), "stt-compare-"));
  try {
    const out = join(dir, "converted.wav");
    try {
      await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", file, out]);
    } catch (err) {
      throw new Error(
        `afconvert ${describeExecError(err)}. ` +
          `Convert manually with: ffmpeg -i <input> -ar 16000 -ac 1 -c:a pcm_s16le out.wav, then re-run on the WAV.`
      );
    }
    return extractPcm(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function loadPcm(file: string): Promise<Buffer> {
  if (extname(file).toLowerCase() === ".wav") return extractPcm(await readInputFile(file));
  return convertToPcm(file);
}

async function main(): Promise<void> {
  const [file, language = "fr"] = process.argv.slice(2);
  if (!file) {
    console.error(USAGE);
    process.exit(1);
  }

  const keyterms = process.env.STT_COMPARE_KEYTERMS?.split(",").map((term) => term.trim()).filter(Boolean);
  const pcm = await loadPcm(file);

  const startedAt = Date.now();
  const stamp = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  let turns = 0;

  const stt = createLiveStt(
    { language: language as InterviewLanguage, keyterms },
    {
      onTranscript: (text) => {
        turns += 1;
        console.log(`[${stamp()}] TURN ${turns}: ${text}`);
      },
      onListening: () => console.log(`[${stamp()}] listening (provider=${process.env.STT_LIVE_PROVIDER || "deepgram"})`),
      onError: (message) => console.error(`[${stamp()}] ERROR: ${message}`),
    }
  );

  await stt.start();
  for (let i = 0; i < pcm.length; i += BYTES_PER_CHUNK) {
    stt.sendAudio(pcm.subarray(i, i + BYTES_PER_CHUNK));
    await sleep(CHUNK_MS);
  }
  const silence = Buffer.alloc(BYTES_PER_CHUNK);
  for (let elapsed = 0; elapsed < TAIL_MS; elapsed += CHUNK_MS) {
    stt.sendAudio(silence);
    await sleep(CHUNK_MS);
  }
  stt.close();
  console.log(`--- ${turns} tour(s) en ${stamp()}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
