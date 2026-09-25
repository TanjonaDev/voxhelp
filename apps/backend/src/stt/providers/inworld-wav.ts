import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";

/** PCM16 mono : 2 octets par échantillon. */
export const BYTES_PER_SECOND = AUDIO_SAMPLE_RATE * 2;

/** Enveloppe des données PCM16 mono 16 kHz dans un WAV canonique (en-tête de 44 octets). */
export function wavFromPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Position et taille déclarée du chunk `data` dans les premiers octets d'un WAV. ffmpeg écrit un
 * chunk `LIST` : l'en-tête n'a pas toujours 44 octets, il faut le parser.
 */
export function findDataChunk(head: Buffer): { offset: number; size: number } | null {
  if (head.length < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let position = 12;
  while (position + 8 <= head.length) {
    const id = head.toString("ascii", position, position + 4);
    const size = head.readUInt32LE(position + 4);
    if (id === "data") return { offset: position + 8, size };
    position += 8 + size + (size % 2);
  }
  return null;
}
