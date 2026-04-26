interface GroqCallbacks {
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

export class GroqWhisperSTT {
  private callbacks: GroqCallbacks;
  private audioBuffer: Buffer[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private language: string;

  constructor(language: string, callbacks: GroqCallbacks) {
    this.callbacks = callbacks;
    this.language = language;
  }

  connect(): void {
    // Groq is REST-based, no persistent connection needed
    // We accumulate audio and flush every ~3 seconds
    this.flushTimer = setInterval(() => {
      this.flush();
    }, 3000);

    console.log("[GroqWhisper] Ready (chunk mode, flush every 3s)");
  }

  sendAudio(chunk: Buffer): void {
    this.audioBuffer.push(chunk);
  }

  private async flush(): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    const combined = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];

    // Skip if too short (< 0.5s of audio at 16kHz 16bit mono)
    if (combined.length < 16000) return;

    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        this.callbacks.onError("GROQ_API_KEY not set");
        return;
      }

      // Create WAV header for the raw PCM data
      const wavBuffer = createWavBuffer(combined, 16000, 1, 16);

      // Build multipart form data manually
      const boundary = `----FormBoundary${Date.now()}`;
      const formParts: Buffer[] = [];

      // File part
      formParts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
        )
      );
      formParts.push(wavBuffer);
      formParts.push(Buffer.from("\r\n"));

      // Model part
      formParts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`
        )
      );

      // Language part
      formParts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${this.language}\r\n`
        )
      );

      formParts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(formParts);

      const response = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body,
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error("[GroqWhisper] API error:", errText);
        this.callbacks.onError(`Groq API error: ${response.status}`);
        return;
      }

      const result = (await response.json()) as { text?: string };
      if (result.text && result.text.trim().length > 0) {
        this.callbacks.onFinal(result.text.trim());
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Groq error";
      console.error("[GroqWhisper] Error:", message);
      this.callbacks.onError(message);
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Flush remaining audio
    this.flush();
  }
}

function createWavBuffer(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // subchunk1 size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}
