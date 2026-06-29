export interface AssistCard {
  cat: "jargon" | "strength" | "attention" | "translation";
  evidence: "high" | "medium" | "low";
  title: string;
  body: string;
  relance: string | null;
}

export function parseAssistCard(raw: string): AssistCard {
  const lines = raw.trim().split("\n").filter((l) => l.trim() !== "");

  const headerMatch = lines[0]?.match(
    /\[(jargon|strength|attention|translation)\]\s*\[(high|medium|low)\]/
  );

  const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(2, bodyEnd).join(" ").trim();

  return {
    cat: (headerMatch?.[1] as AssistCard["cat"]) ?? "translation",
    evidence: (headerMatch?.[2] as AssistCard["evidence"]) ?? "medium",
    title,
    body,
    relance,
  };
}
