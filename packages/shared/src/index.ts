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

export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "risk" | "level";
  confidence: "confirmed" | "partial" | "low";
  t: string;
  title: string;
  body: string;
  relance?: string;
  level?: number;
  levelLabel?: string;
}

export interface CandidateReport {
  overall: string;
  strengths: string[];
  gaps: string[];
  recommendation: "hire" | "maybe" | "pass";
  recommendationReason: string;
}

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "trigger:analyze" }
  | { type: "session:summarize" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:buffering" }
  | { type: "transcript:idle" }
  | { type: "transcript:final"; text: string }
  | { type: "assist:card"; card: Insight }
  | { type: "assist:error"; error: string }
  | { type: "analysis:final"; report: CandidateReport }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
