import type { Insight } from "@voxhelp/shared";

// Interprétation du texte brut renvoyé par live-assist (buildLiveAssistPrompt +
// streamAssist). Extrait dans son propre module (plutôt que privé dans Session)
// pour que les tests — y compris les smoke tests qui appellent le vrai Claude —
// exercent exactement cette logique, sans la dupliquer.

export function extractThemeAndAngle(text: string): { theme: string | null; angle: string | null } {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[?(?:strength|attention|translation)\]?\s*\[?(?:acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?\s*\[?([a-z0-9-]+)\]?(?:\s*\[?(contexte|ownership|impact|none)\]?)?/i
  );
  return {
    theme: match?.[1]?.toLowerCase() ?? null,
    angle: match?.[2]?.toLowerCase() ?? null,
  };
}

export function normalizeStatus(raw: string | undefined): Insight["status"] {
  const normalized = raw?.toLowerCase().trim() ?? "";
  if (normalized === "acquis") return "acquis";
  if (/^pas[\s-]?acquis$/.test(normalized)) return "pas-acquis";
  if (/^[aà][\s-]?creuser$/.test(normalized)) return "a-creuser";
  return "a-creuser";
}

export function parseAssistText(text: string, id: string, t: string): Insight {
  const lines = text.trim().split("\n").filter((l) => l.trim() !== "");

  const headerMatch = lines[0]?.match(
    /\[?(strength|attention|translation)\]?\s*\[?(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]?/i
  );
  const cat = (headerMatch?.[1]?.toLowerCase() as Insight["cat"]) ?? "translation";
  const status = normalizeStatus(headerMatch?.[2]);
  const { theme } = extractThemeAndAngle(text);

  const title = lines[1]?.replace(/^#\s*/, "").trim() ?? "";

  const lastLine = lines[lines.length - 1];
  const hasRelance = lastLine?.startsWith(">>");
  const relance = hasRelance ? lastLine.replace(/^>>\s*/, "").trim() : undefined;

  const bodyEnd = hasRelance ? lines.length - 1 : lines.length;
  const body = lines.slice(2, bodyEnd).join(" ").trim();

  return { id, cat, status, theme, t, title, body, relance };
}
