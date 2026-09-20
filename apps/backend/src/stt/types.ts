import type { InterviewLanguage } from "@voxhelp/shared";
import type { SttUtterance } from "@voxhelp/lecture";

export interface LiveSttOptions {
  language: InterviewLanguage;
  keyterms?: string[];
}

export interface LiveSttCallbacks {
  /** Un tour de parole terminé : texte final, non vide, trimé. */
  onTranscript(text: string): void;
  onListening(): void;
  onError(message: string): void;
}

export interface LiveStt {
  start(): Promise<void>;
  /** Toujours du PCM16 16 kHz mono (AUDIO_SAMPLE_RATE). */
  sendAudio(pcm: Buffer): void;
  close(): void;
}

export interface BatchTranscribeOptions {
  language: string;
  keyterms?: string[];
}

export interface BatchStt {
  transcribe(audio: Buffer, options: BatchTranscribeOptions): Promise<SttUtterance[]>;
}
