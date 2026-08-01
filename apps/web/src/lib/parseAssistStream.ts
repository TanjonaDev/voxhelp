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

export function parsePartialAssist(textSoFar: string, id: string, t: string): PartialCard {
  const lines = textSoFar.split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0] ?? "";

  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|a-creuser|pas-acquis)\]?/
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|a-creuser|pas-acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );
  const cat = (headerMatch?.[1] as AssistCard["cat"]) ?? null;
  const status = (headerMatch?.[2] as AssistCard["status"]) ?? null;
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
