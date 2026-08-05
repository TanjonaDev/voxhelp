export type InterviewLanguage = "fr" | "en" | "es" | "pt" | "zh";

export interface JobContext {
  title: string;
  level: string;
  stack: string;
}

export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
  candidateName?: string;
}

export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "attention";
  status: "acquis" | "a-creuser" | "pas-acquis";
  theme: string | null;
  t: string;
  title: string;
  body: string;
  relance?: string;
}

export interface TranscriptEntry {
  t: string;
  text: string;
}

export interface Citation {
  quote: string;
  t: string;
}

export type SkillMatchStatus = "demontre" | "mentionne" | "non-aborde";

export interface SkillMatch {
  skill: string;
  status: SkillMatchStatus;
  evidence: string;
  citation?: Citation;
}

export interface QuotedPoint {
  text: string;
  citation: Citation;
}

export interface AttentionPoint {
  text: string;
  citation?: Citation;
}

export interface KeyProject {
  company: string;
  period: string;
  stack: string;
  role: string;
  impact: string;
}

export type Verdict = "presenter" | "presenter-avec-reserve" | "ne-pas-presenter";

export interface CandidateReport {
  candidateName: string;
  jobTitle: string;
  interviewDate: string;
  durationLabel: string;
  summary: string;
  techMatching: SkillMatch[];
  strengths: QuotedPoint[];
  attentionPoints: AttentionPoint[];
  keyProjects: KeyProject[];
  verdict: Verdict;
  verdictReason: string;
  verdictChecklist: string[];
  nextSteps: string[];
  suggestedQuestions: string[];
}

export type ClientMessage =
  | { type: "session:start"; config: SessionConfig }
  | { type: "session:stop" }
  | { type: "audio:chunk"; data: string }
  | { type: "trigger:analyze" }
  | { type: "session:summarize" }
  | { type: "ask:question"; text: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session:ready"; sessionId: string }
  | { type: "session:error"; error: string }
  | { type: "transcript:partial"; text: string }
  | { type: "transcript:buffering" }
  | { type: "transcript:idle" }
  | { type: "transcript:final"; text: string }
  | { type: "assist:start"; id: string; t: string }
  | { type: "assist:chunk"; id: string; text: string }
  | { type: "assist:done"; id: string; fullText: string }
  | { type: "assist:cancel"; id: string }
  | { type: "assist:error"; error: string }
  | { type: "analysis:final"; report: CandidateReport }
  | { type: "pong" };

export const AUDIO_SAMPLE_RATE = 16000;
export const WS_PING_INTERVAL_MS = 30000;

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
