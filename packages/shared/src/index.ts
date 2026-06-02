export type InterviewLanguage = "fr" | "en" | "es" | "pt" | "zh";

export interface JobContext {
  title: string;
  level: string;
  stack: string;
}

export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
}

export interface InsightCard {
  meaning: string;
  signal: {
    label: string;
    type: "positive" | "weak" | "dig";
  };
  followUp: string;
  confidence: "confirmed" | "partial" | "vague";
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
  | { type: "transcript:buffering" }
  | { type: "transcript:idle" }
  | { type: "transcript:final"; text: string }
  | { type: "assist:card"; card: InsightCard }
  | { type: "assist:error"; error: string }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
