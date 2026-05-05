// ============================================
// Session & Mode types
// ============================================

export type InterviewLanguage = "fr" | "en" | "es" | "pt" | "zh";

export interface SessionConfig {
  language: InterviewLanguage;
  jobDescription?: string;
  cvContent?: string;
  techStack?: string;
}

// ============================================
// WebSocket message types (client → server)
// ============================================

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string } // base64 encoded PCM
  | { type: "user:expand" }
  | { type: "ping" };

// ============================================
// WebSocket message types (server → client)
// ============================================

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string; speaker?: string }
  | { type: "transcript:final"; text: string; speaker?: string }
  | { type: "suggestion:start"; source?: SuggestionSource }
  | { type: "suggestion:chunk"; text: string } // streamed token
  | { type: "suggestion:done"; fullText: string }
  | { type: "suggestion:error"; error: string }
  | { type: "pong" };

// ============================================
// UI State
// ============================================

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type SuggestionSource = "assist" | "expand";

export interface TranscriptEntry {
  id: string;
  text: string;
  speaker?: string;
  timestamp: number;
  isFinal: boolean;
}

export interface Suggestion {
  id: string;
  text: string;
  isStreaming: boolean;
  timestamp: number;
  source: SuggestionSource;
}

// ============================================
// Constants
// ============================================

export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_CHUNK_MS = 250; // send audio every 250ms
export const WS_PING_INTERVAL_MS = 30000;

// ============================================
// Helpers
// ============================================

export function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
