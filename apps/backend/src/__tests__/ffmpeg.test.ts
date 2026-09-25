import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { convertToWav16kMono, ffmpegArgs, resolveFfmpegPath } from "../stt/providers/ffmpeg.js";
import { findDataChunk } from "../stt/providers/inworld-wav.js";

/** WAV 44,1 kHz stéréo : ton de 440 Hz, silence numérique, puis ton de nouveau. */
function stereoWav(parts: { toneSec: number; silenceSec: number; toneAfterSec: number }): Buffer {
  const rate = 44100;
  const samples = (sec: number) => Math.round(sec * rate);
  const toneEnd = samples(parts.toneSec);
  const silenceEnd = toneEnd + samples(parts.silenceSec);
  const total = silenceEnd + samples(parts.toneAfterSec);
  const pcm = Buffer.alloc(total * 4); // 2 canaux × 2 octets
  for (let i = 0; i < total; i++) {
    const inSilence = i >= toneEnd && i < silenceEnd;
    const value = inSilence ? 0 : Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate));
    pcm.writeInt16LE(value, i * 4);
    pcm.writeInt16LE(value, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe("ffmpegArgs", () => {
  it("converts to 16 kHz mono PCM16 and detects silences in the same pass", () => {
    const args = ffmpegArgs("in.bin", "out.wav");

    expect(args).toEqual(expect.arrayContaining(["-nostdin", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]));
    expect(args).toContain("silencedetect=noise=-35dB:d=0.4");
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual(["-i", "in.bin"]);
    expect(args[args.length - 1]).toBe("out.wav");
  });
});

describe("resolveFfmpegPath", () => {
  afterEach(() => {
    delete process.env.FFMPEG_PATH;
  });

  it("prefers FFMPEG_PATH over the bundled ffmpeg-static binary", () => {
    process.env.FFMPEG_PATH = "/opt/custom/ffmpeg";

    expect(resolveFfmpegPath()).toBe("/opt/custom/ffmpeg");
  });
});

describe("convertToWav16kMono (real ffmpeg)", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("converts a 44.1 kHz stereo WAV to 16 kHz mono and reports the silence in the middle", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "voxhelp-ffmpeg-test-"));
    const input = path.join(dir, "in.wav");
    const output = path.join(dir, "out.wav");
    await writeFile(input, stereoWav({ toneSec: 1, silenceSec: 1.5, toneAfterSec: 1 }));

    const { silences } = await convertToWav16kMono(input, output);

    const written = await readFile(output);
    expect(written.readUInt16LE(22)).toBe(1); // mono
    expect(written.readUInt32LE(24)).toBe(16000); // 16 kHz
    const data = findDataChunk(written.subarray(0, 4096));
    expect(data).not.toBeNull();
    expect(data!.size / 32000).toBeCloseTo(3.5, 1);
    expect(silences).toHaveLength(1);
    expect(silences[0].start).toBeGreaterThan(0.9);
    expect(silences[0].end).toBeLessThan(2.7);
  });
});
