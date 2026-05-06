export type ContextType = "RECRUIT";

export type ClientMessage =
  | { type: "session:start"; interviewId: string; contextType: ContextType }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "user:question"; question: string }
  | { type: "user:followup" }
  | { type: "user:mark-asked"; questionId: string }
  | { type: "user:score"; criterionId: string; score: number }
  | { type: "ping" };

export type SuggestionSource = "assist" | "question" | "followup";

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string; speaker?: string }
  | { type: "transcript:final"; text: string; speaker?: string }
  | { type: "suggestion:start"; source: SuggestionSource }
  | { type: "suggestion:chunk"; text: string }
  | { type: "suggestion:done"; fullText: string }
  | { type: "suggestion:error"; error: string }
  | { type: "question:suggested"; questionId: string; text: string }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_CHUNK_MS = 250;
export const WS_PING_INTERVAL_MS = 30000;
export const DEBOUNCE_MS = 1800;
