export interface AssistCard {
  cat: "jargon" | "strength" | "attention" | "translation";
  status: "acquis" | "a-creuser" | "pas-acquis";
  theme: string | null;
  title: string;
  body: string;
  relance: string | null;
}

export function parseAssistCard(raw: string): AssistCard {
  const lines = raw.trim().split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0] ?? "";

  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|a-creuser|pas-acquis)\]?/
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|a-creuser|pas-acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );

  const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(2, bodyEnd).join(" ").trim();

  return {
    cat: (headerMatch?.[1] as AssistCard["cat"]) ?? "translation",
    status: (headerMatch?.[2] as AssistCard["status"]) ?? "a-creuser",
    theme: themeMatch?.[1]?.toLowerCase() ?? null,
    title,
    body,
    relance,
  };
}
