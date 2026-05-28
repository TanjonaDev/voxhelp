export type InterviewLanguage = "fr" | "en" | "es" | "pt" | "zh";

export interface SessionConfig {
  language: InterviewLanguage;
}

export interface TechTranslation {
  term: string;
  definition: string;
  relatedTechs: string[];
  criticality: "HIGH" | "MEDIUM" | "LOW";
}

export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: number;
}

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:final"; text: string }
  | { type: "tech:translation"; translation: TechTranslation }
  | { type: "assist:start" }
  | { type: "assist:chunk"; text: string }
  | { type: "assist:done"; fullText: string }
  | { type: "assist:error"; error: string }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
