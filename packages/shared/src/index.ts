// ============================================
// Session & Mode types
// ============================================

export type SessionMode = "interview" | "translator";

export type TranslatorLanguage = "mg" | "fr" | "en";

export interface SessionConfig {
  mode: SessionMode;
  // Interview mode
  jobDescription?: string;
  cvContent?: string;
  // Translator mode
  sourceLanguage?: TranslatorLanguage;
  targetLanguage?: TranslatorLanguage;
}

// ============================================
// WebSocket message types (client → server)
// ============================================

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string } // base64 encoded PCM
  | { type: "ping" };

// ============================================
// WebSocket message types (server → client)
// ============================================

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string; speaker?: string }
  | { type: "transcript:final"; text: string; speaker?: string }
  | { type: "suggestion:start" }
  | { type: "suggestion:chunk"; text: string } // streamed token
  | { type: "suggestion:done"; fullText: string }
  | { type: "suggestion:error"; error: string }
  | { type: "pong" };

// ============================================
// UI State
// ============================================

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

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
