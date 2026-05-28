import { WebSocket } from "ws";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";

interface DeepgramCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

export class DeepgramSTT {
  private ws: WebSocket | null = null;
  private callbacks: DeepgramCallbacks;
  private language: string;
  private finalBuffer: string[] = [];

  constructor(language: string, callbacks: DeepgramCallbacks) {
    this.callbacks = callbacks;
    this.language = language;
  }

  connect(): void {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      this.callbacks.onError("DEEPGRAM_API_KEY not set");
      return;
    }

    const params = new URLSearchParams({
      model: "nova-3",
      language: this.language,
      smart_format: "true",
      interim_results: "true",
      utterance_end_ms: "3000",
      vad_events: "true",
      sample_rate: String(AUDIO_SAMPLE_RATE),
      channels: "1",
      encoding: "linear16",
    });

    const url = `wss://api.deepgram.com/v1/listen?${params}`;

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    this.ws.on("open", () => {
      console.log("[Deepgram] Connected");
    });

    this.ws.on("message", (data) => {
      try {
        const response = JSON.parse(data.toString());

        if (response.type === "Results") {
          const alt = response.channel?.alternatives?.[0];
          if (!alt) return;

          if (response.is_final) {
            if (alt.transcript) this.finalBuffer.push(alt.transcript);
          } else {
            if (alt.transcript) this.callbacks.onPartial(alt.transcript);
          }
        } else if (response.type === "UtteranceEnd") {
          // Only flush after 3s of silence — avoids cutting mid-sentence
          if (this.finalBuffer.length > 0) {
            const full = this.finalBuffer.join(" ").trim();
            this.finalBuffer = [];
            if (full) this.callbacks.onFinal(full);
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    this.ws.on("error", (err) => {
      console.error("[Deepgram] WS error:", err.message);
      this.callbacks.onError(err.message);
    });

    this.ws.on("close", () => {
      console.log("[Deepgram] Disconnected");
    });
  }

  sendAudio(audioBuffer: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioBuffer);
    }
  }

  close(): void {
    if (this.ws) {
      // Send close message to Deepgram
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      this.ws.close();
      this.ws = null;
    }
  }
}
