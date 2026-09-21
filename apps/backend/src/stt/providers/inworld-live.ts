// Vérifié contre l'API Inworld réelle (2026-09-20 / 2026-09-21), voir la spec
// docs/superpowers/specs/2026-09-20-stt-provider-decoupling-design.md,
// « Résultats du test réel », et docs/superpowers/specs/2026-09-21-stt-model-selector-design.md :
// - authentification `Authorization: Basic <clé>` (clé du portail déjà en Base64)
// - `language: "fr"` accepté ; config acceptée avec `endOfTurnConfidenceThreshold` à la
//   racine de transcribeConfig et les silences sous `inworldSttV1Config`
// - `isFinal` : un final par tour, texte complet du tour ; en parole continue les tours sont
//   coupés à ~30 s (plafond de durée) et les seuils de silence se déclenchent rarement
// - erreurs serveur : `{ "error": { "code": 3, "message": "..." } }` puis fermeture 1000
// - `prompts` : caractères, 100 termes, 100 caractères par terme (voir inworld-prompts.ts)
// Encore NON vérifié :
// - `language: "fr-FR"` et FR/EN mélangés (auto-détection ?)
// - réglage des seuils de fin de tour sur un vrai entretien (alternance de locuteurs)
// - `inactivityTimeoutSeconds` volontairement omis : une longue pause pourrait fermer le flux
// - support streaming de `es` et `pt` (seul `zh` est bloqué explicitement)
import WebSocket from "ws";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { InterviewLanguage } from "@voxhelp/shared";
import type { LiveStt, LiveSttCallbacks } from "../types.js";
import { sanitizeInworldPrompts } from "./inworld-prompts.js";

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
  // Forme confirmée : { "error": { "code": 3, "message": "...", "details": [] } }
  error?: { message?: string };
}

export class InworldSTT implements LiveStt {
  private socket: WebSocket | null = null;
  private callbacks: LiveSttCallbacks;
  private language: InterviewLanguage;
  private keyterms: string[] | undefined;
  private prompts: string[] = [];
  private configSent = false;
  private closed = false;
  // Un échec émet plusieurs signaux (message serveur `error`, événement socket `error`, puis
  // `close`) : un seul onError par connexion.
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

    const { prompts, adjusted, dropped } = sanitizeInworldPrompts(this.keyterms);
    this.prompts = prompts;
    console.log(
      `[InworldSTT] Connecting: language=${this.language} prompts=${prompts.length > 0 ? `[${prompts.join(", ")}]` : "none"}` +
        (adjusted > 0 || dropped > 0 ? ` (${adjusted} adapté(s), ${dropped} écarté(s))` : "")
    );

    // La clé du portail est déjà en Base64 : on ne la ré-encode pas.
    this.connectionErrorReported = false;
    const socket = new WebSocket(INWORLD_STT_URL, {
      headers: { Authorization: `Basic ${apiKey}` },
    });
    this.socket = socket;

    socket.on("message", (data) => this.handleMessage(data.toString()));

    socket.on("error", (err) => {
      this.reportConnectionError(err.message || "Inworld connection error");
    });

    // Un échec de connexion émet "error" puis "close" : seule une fermeture
    // survenue après l'établissement de la session est signalée ici.
    socket.on("close", (code) => {
      const wasConnected = this.configSent;
      this.configSent = false;
      if (wasConnected) {
        this.reportConnectionError(`Inworld STT connection closed unexpectedly (code ${code})`);
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
    socket.send(
      JSON.stringify({
        transcribeConfig: {
          modelId: MODEL_ID,
          audioEncoding: "LINEAR16",
          sampleRateHertz: AUDIO_SAMPLE_RATE,
          language: this.language,
          ...(this.prompts.length > 0 ? { prompts: this.prompts } : {}),
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    // Donnée tierce non fiable : "null", un nombre, etc. sont du JSON valide.
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as InworldServerMessage;

    if (message.error) {
      const detail = message.error.message;
      this.reportConnectionError(typeof detail === "string" && detail !== "" ? detail : "Inworld STT error");
      return;
    }

    const transcription = message.result?.transcription;
    if (!transcription?.isFinal) return;

    const text = typeof transcription.transcript === "string" ? transcription.transcript.trim() : "";
    if (text) {
      this.callbacks.onTranscript(text);
    }
  }

  private reportConnectionError(message: string): void {
    if (this.closed || this.connectionErrorReported) return;
    this.connectionErrorReported = true;
    this.callbacks.onError(message);
  }
}
