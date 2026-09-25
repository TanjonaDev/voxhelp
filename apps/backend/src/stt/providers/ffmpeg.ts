import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { parseSilences, type Silence } from "./inworld-batch-plan.js";

const MAX_STDERR_CHARS = 20_000_000;

/** `FFMPEG_PATH` (binaire du serveur) l'emporte sur le binaire fourni par `ffmpeg-static`. */
export function resolveFfmpegPath(): string {
  const binary = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!binary) throw new Error("ffmpeg introuvable : définir FFMPEG_PATH ou installer ffmpeg-static");
  return binary;
}

export function ffmpegArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-y",
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-af",
    "silencedetect=noise=-35dB:d=0.4",
    "-c:a",
    "pcm_s16le",
    output,
  ];
}

/** Convertit n'importe quel audio/vidéo en WAV 16 kHz mono et détecte les silences dans la même passe. */
export function convertToWav16kMono(input: string, output: string): Promise<{ silences: Silence[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ffmpegArgs(input, output), { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString();
    });
    child.on("error", (err) => reject(new Error(`ffmpeg n'a pas pu démarrer : ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve({ silences: parseSilences(stderr) });
      else reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.slice(-500).trim()}`));
    });
  });
}
