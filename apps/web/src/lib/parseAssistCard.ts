export interface AssistCard {
  cat: "jargon" | "strength" | "attention" | "translation";
  status: "acquis" | "a-creuser" | "pas-acquis";
  theme: string | null;
  title: string;
  body: string;
  relance: string | null;
}

function normalizeStatus(raw: string | undefined): AssistCard["status"] {
  const normalized = raw?.toLowerCase().trim() ?? "";
  if (normalized === "acquis") return "acquis";
  if (/^pas[\s-]?acquis$/.test(normalized)) return "pas-acquis";
  if (/^[aà][\s-]?creuser$/.test(normalized)) return "a-creuser";
  return "a-creuser";
}

export function parseAssistCard(raw: string): AssistCard {
  const lines = raw.trim().split("\n").filter((l) => l.trim() !== "");
  const headerLine = lines[0] ?? "";

  const headerMatch = headerLine.match(
    /\[?(jargon|strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const themeMatch = headerLine.match(
    /\[?(?:jargon|strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?/i
  );

  const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : null;

  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(2, bodyEnd).join(" ").trim();

  return {
    cat: (headerMatch?.[1]?.toLowerCase() as AssistCard["cat"]) ?? "translation",
    status: normalizeStatus(headerMatch?.[2]),
    theme: themeMatch?.[1]?.toLowerCase() ?? null,
    title,
    body,
    relance,
  };
}
