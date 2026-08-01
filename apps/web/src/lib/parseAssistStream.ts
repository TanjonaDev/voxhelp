import type { AssistCard } from "./parseAssistCard.js";

export interface PartialCard {
  id: string;
  t: string;
  cat: AssistCard["cat"] | null;
  status: AssistCard["status"] | null;
  theme: string | null;
  title: string | null;
  body: string;
  relance: string | null;
}

function normalizeStatus(raw: string | undefined): AssistCard["status"] | null {
  if (raw === undefined) return null;
  const normalized = raw.toLowerCase().trim();
  if (normalized === "acquis") return "acquis";
  if (/^pas[\s-]?acquis$/.test(normalized)) return "pas-acquis";
  if (/^[aà][\s-]?creuser$/.test(normalized)) return "a-creuser";
  return null;
}

export function parsePartialAssist(textSoFar: string, id: string, t: string): PartialCard {
  const lines = textSoFar.split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0] ?? "";

  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
  const cat = (headerMatch?.[1]?.toLowerCase() as AssistCard["cat"]) ?? null;
  const status = normalizeStatus(headerMatch?.[2]);
  const theme = themeMatch?.[1]?.toLowerCase() ?? null;

  const titleLine = lines[1];
  const title = titleLine?.startsWith("#") ? titleLine.replace(/^#\s*/, "").trim() : null;

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyStart = title !== null ? 2 : cat !== null ? 1 : 0;
  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(bodyStart, bodyEnd).join(" ").trim();

  return { id, t, cat, status, theme, title, body, relance };
}
