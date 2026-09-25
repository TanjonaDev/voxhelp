import { describe, it, expect } from "vitest";
import { BYTES_PER_SECOND, findDataChunk, wavFromPcm } from "../stt/providers/inworld-wav.js";

describe("wavFromPcm", () => {
  it("wraps PCM16 mono 16 kHz data in a canonical 44-byte header", () => {
    const pcm = Buffer.alloc(3200, 1);

    const wav = wavFromPcm(pcm);

    expect(wav.length).toBe(44 + 3200);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 3200);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(BYTES_PER_SECOND);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(3200);
  });
});

describe("findDataChunk", () => {
  it("finds the data chunk after extra chunks such as the LIST chunk ffmpeg writes", () => {
    const riff = Buffer.alloc(12);
    riff.write("RIFF", 0);
    riff.write("WAVE", 8);
    const fmt = Buffer.alloc(24);
    fmt.write("fmt ", 0);
    fmt.writeUInt32LE(16, 4);
    const list = Buffer.alloc(14); // 8 d'en-tête + 5 de contenu + 1 de bourrage (taille impaire)
    list.write("LIST", 0);
    list.writeUInt32LE(5, 4);
    const data = Buffer.alloc(8);
    data.write("data", 0);
    data.writeUInt32LE(96000, 4);

    expect(findDataChunk(Buffer.concat([riff, fmt, list, data]))).toEqual({ offset: 12 + 24 + 14 + 8, size: 96000 });
  });

  it("returns null when the header is not a WAV or is truncated before the data chunk", () => {
    expect(findDataChunk(Buffer.from("not a wav file at all"))).toBeNull();
    expect(findDataChunk(wavFromPcm(Buffer.alloc(4)).subarray(0, 30))).toBeNull();
  });
});
