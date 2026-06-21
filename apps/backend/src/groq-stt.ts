import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";

interface GroqSTTCallbacks {
  onBuffering: () => void;
  onIdle: () => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

const RMS_THRESHOLD = 0.005;
const SILENCE_THRESHOLD_MS = 1800;
const MIN_BUFFER_BYTES = AUDIO_SAMPLE_RATE * 2 * 0.5; // 0.5s = 16 000 bytes
const TICK_INTERVAL_MS = 200;

function buildWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function calcRms(buf: Buffer): number {
  const samples = buf.length / 2;
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    const s = buf.readInt16LE(i) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

export class GroqSTT {
  private callbacks: GroqSTTCallbacks;
  private language: string;
  private sttPrompt: string;
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private lastSoundAt = 0;
  private isBufferingActive = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(language: string, callbacks: GroqSTTCallbacks, sttPrompt?: string) {
    this.language = language;
    this.callbacks = callbacks;
    this.sttPrompt = sttPrompt ?? "";
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  sendAudio(buf: Buffer): void {
    if (this.closed) return;

    const rms = calcRms(buf);
    if (rms > RMS_THRESHOLD) {
      this.lastSoundAt = Date.now();
      if (!this.isBufferingActive) {
        this.isBufferingActive = true;
        this.callbacks.onBuffering();
      }
    }

    this.chunks.push(buf);
    this.totalBytes += buf.length;
  }

  private tick(): void {
    if (this.closed || this.totalBytes === 0 || this.lastSoundAt === 0) return;
    if (Date.now() - this.lastSoundAt >= SILENCE_THRESHOLD_MS) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.totalBytes < MIN_BUFFER_BYTES || !this.isBufferingActive) {
      const wasBuffering = this.isBufferingActive;
      this.reset();
      if (wasBuffering) this.callbacks.onIdle();
      return;
    }

    const pcm = Buffer.concat(this.chunks);
    this.reset();

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      this.callbacks.onError("GROQ_API_KEY not set");
      return;
    }

    try {
      const wav = buildWav(pcm);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
      form.append("model", "whisper-large-v3-turbo");
      form.append("language", this.language);
      form.append("response_format", "text");
      if (this.sttPrompt) {
        form.append("prompt", this.sttPrompt);
      }

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        throw new Error(`Groq ${res.status}: ${await res.text()}`);
      }

      const text = (await res.text()).trim();
      if (text && !this.closed) {
        this.callbacks.onFinal(text);
      } else if (!this.closed) {
        this.callbacks.onIdle();
      }
    } catch (err) {
      if (!this.closed) {
        this.callbacks.onError(err instanceof Error ? err.message : String(err));
        this.callbacks.onIdle();
      }
    }
  }

  private reset(): void {
    this.chunks = [];
    this.totalBytes = 0;
    this.isBufferingActive = false;
    this.lastSoundAt = 0;
  }

  close(): void {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.reset();
  }
}
