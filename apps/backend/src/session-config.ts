import type { InterviewLanguage, JobContext, SessionConfig } from "@voxhelp/shared";

export const INVALID_SESSION_CONFIG = "Configuration de session invalide";
export const MAX_KEYWORDS = 100;
export const MAX_KEYWORD_LENGTH = 100;
const MAX_CANDIDATE_NAME_LENGTH = 200;
const LANGUAGES: readonly InterviewLanguage[] = ["fr", "en", "es", "pt", "zh"];

export type ParsedSessionConfig =
  | { ok: true; config: SessionConfig }
  | { ok: false; error: string };

const REJECTED: ParsedSessionConfig = { ok: false, error: INVALID_SESSION_CONFIG };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLanguage(value: unknown): value is InterviewLanguage {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanKeywords(items: unknown[]): string[] {
  const kept: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const term = item.trim();
    if (term.length === 0 || term.length > MAX_KEYWORD_LENGTH) continue;
    kept.push(term);
    if (kept.length >= MAX_KEYWORDS) break;
  }
  return kept;
}

/**
 * Valide et normalise le `config` d'un `session:start`. Le JSON du WebSocket est
 * non fiable : tout ce que le vrai front n'envoie jamais est rejeté, et seuls les
 * champs connus sont recopiés.
 */
export function parseSessionConfig(raw: unknown): ParsedSessionConfig {
  if (!isPlainObject(raw)) return REJECTED;
  if (!isLanguage(raw.language)) return REJECTED;

  const config: SessionConfig = { language: raw.language };

  if (raw.keywords !== undefined) {
    if (!Array.isArray(raw.keywords)) return REJECTED;
    config.keywords = cleanKeywords(raw.keywords);
  }

  if (raw.jobContext !== undefined) {
    if (!isPlainObject(raw.jobContext)) return REJECTED;
    const jobContext: JobContext = {
      title: stringOrEmpty(raw.jobContext.title),
      level: stringOrEmpty(raw.jobContext.level),
      stack: stringOrEmpty(raw.jobContext.stack),
    };
    config.jobContext = jobContext;
  }

  if (raw.candidateName !== undefined) {
    if (typeof raw.candidateName !== "string") return REJECTED;
    config.candidateName = raw.candidateName.slice(0, MAX_CANDIDATE_NAME_LENGTH);
  }

  if (raw.sttProvider !== undefined) {
    if (typeof raw.sttProvider !== "string") return REJECTED;
    config.sttProvider = raw.sttProvider;
  }

  return { ok: true, config };
}
