import WebSocket from "ws";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { InterviewLanguage } from "@voxhelp/shared";
import type { LiveStt, LiveSttCallbacks } from "../types.js";

const INWORLD_STT_URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional";
const MODEL_ID = "inworld/inworld-stt-1";

// Détection de fin de tour. Les défauts Inworld (maxTurnSilence 300 ms,
// confiance 0.4) sont trop agressifs pour un entretien : une hésitation
// couperait le tour. Valeurs de départ = exemple de la doc Inworld, à
// ajuster au test réel (cf. eot_threshold 0.85 côté Flux).
const END_OF_TURN_CONFIDENCE_THRESHOLD = 0.7;
const MIN_END_OF_TURN_SILENCE_MS = 300;
const MAX_TURN_SILENCE_MS = 1200;

// Langues absentes du streaming Inworld (InterviewLanguage = fr|en|es|pt|zh).
const UNSUPPORTED_LANGUAGES: ReadonlySet<string> = new Set(["zh"]);

interface InworldServerMessage {
  result?: { transcription?: { transcript?: string; isFinal?: boolean } };
  // Forme non documentée : à confirmer au test réel.
  error?: { message?: string };
}

export class InworldSTT implements LiveStt {
  private socket: WebSocket | null = null;
  private callbacks: LiveSttCallbacks;
  private language: InterviewLanguage;
  private keyterms: string[] | undefined;
  private configSent = false;
  private closed = false;
  // Un échec de socket émet "error" puis "close" : un seul onError par connexion.
  private connectionErrorReported = false;

  constructor(language: InterviewLanguage, keyterms: string[] | undefined, callbacks: LiveSttCallbacks) {
    this.language = language;
    this.keyterms = keyterms;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      this.callbacks.onError("INWORLD_API_KEY not set");
      return;
    }
    if (UNSUPPORTED_LANGUAGES.has(this.language)) {
      this.callbacks.onError(`Inworld STT streaming does not support language "${this.language}"`);
      return;
    }

    const hasKeyterms = Boolean(this.keyterms && this.keyterms.length > 0);
    console.log(
      `[InworldSTT] Connecting: language=${this.language} prompts=${hasKeyterms ? `[${this.keyterms!.join(", ")}]` : "none"}`
    );

    // La clé du portail est déjà en Base64 : on ne la ré-encode pas.
    this.connectionErrorReported = false;
    const socket = new WebSocket(INWORLD_STT_URL, {
      headers: { Authorization: `Basic ${apiKey}` },
    });
    this.socket = socket;

    socket.on("message", (data) => this.handleMessage(data.toString()));

    socket.on("error", (err) => {
      if (!this.closed && !this.connectionErrorReported) {
        this.connectionErrorReported = true;
        this.callbacks.onError(err.message || "Inworld connection error");
      }
    });

    // Un échec de connexion émet "error" puis "close" : seule une fermeture
    // survenue après l'établissement de la session est signalée ici.
    socket.on("close", (code) => {
      const wasConnected = this.configSent;
      this.configSent = false;
      if (wasConnected && !this.closed && !this.connectionErrorReported) {
        this.connectionErrorReported = true;
        this.callbacks.onError(`Inworld STT connection closed unexpectedly (code ${code})`);
      }
    });

    await new Promise<void>((resolve) => {
      socket.once("open", () => {
        this.sendConfig(socket);
        resolve();
      });
      socket.once("close", () => resolve());
    });

    if (this.configSent && !this.closed) {
      this.callbacks.onListening();
    }
  }

  sendAudio(buf: Buffer): void {
    if (this.closed || !this.configSent || !this.socket) return;
    if (this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify({ audioChunk: { content: buf.toString("base64") } }));
    } catch {
      // socket may have closed between check and send
    }
  }

  close(): void {
    this.closed = true;
    this.configSent = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ closeStream: {} }));
      }
      socket.close();
    } catch {
      // ignore cleanup errors
    }
  }

  private sendConfig(socket: WebSocket): void {
    const hasKeyterms = Boolean(this.keyterms && this.keyterms.length > 0);
    socket.send(
      JSON.stringify({
        transcribeConfig: {
          modelId: MODEL_ID,
          audioEncoding: "LINEAR16",
          sampleRateHertz: AUDIO_SAMPLE_RATE,
          language: this.language,
          ...(hasKeyterms ? { prompts: this.keyterms } : {}),
          endOfTurnConfidenceThreshold: END_OF_TURN_CONFIDENCE_THRESHOLD,
          inworldSttV1Config: {
            minEndOfTurnSilenceWhenConfident: MIN_END_OF_TURN_SILENCE_MS,
            maxTurnSilence: MAX_TURN_SILENCE_MS,
          },
        },
      })
    );
    this.configSent = true;
  }

  private handleMessage(raw: string): void {
    if (this.closed) return;

    let message: InworldServerMessage;
    try {
      message = JSON.parse(raw) as InworldServerMessage;
    } catch {
      return;
    }

    if (message.error) {
      this.callbacks.onError(message.error.message ?? "Inworld STT error");
      return;
    }

    const transcription = message.result?.transcription;
    if (!transcription?.isFinal) return;

    const text = transcription.transcript?.trim();
    if (text) {
      this.callbacks.onTranscript(text);
    }
  }
}
