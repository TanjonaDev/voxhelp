import type { AssistCard } from "./parseAssistCard.js";

export interface PartialCard {
  id: string;
  t: string;
  cat: AssistCard["cat"] | null;
  evidence: AssistCard["evidence"] | null;
  title: string | null;
  body: string;
  relance: string | null;
}

export function parsePartialAssist(textSoFar: string, id: string, t: string): PartialCard {
  const lines = textSoFar.split("\n").filter((l) => l.trim() !== "");

  const headerMatch = lines[0]?.match(
    /\[(jargon|strength|attention|translation)\]\s*\[(high|medium|low)\]/
  );
  const cat = (headerMatch?.[1] as AssistCard["cat"]) ?? null;
  const evidence = (headerMatch?.[2] as AssistCard["evidence"]) ?? null;

  const titleLine = lines[1];
  const title = titleLine?.startsWith("#") ? titleLine.replace(/^#\s*/, "").trim() : null;

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyStart = title !== null ? 2 : cat !== null ? 1 : 0;
  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(bodyStart, bodyEnd).join(" ").trim();

  return { id, t, cat, evidence, title, body, relance };
}
