import type { SkillMatchStatus, Verdict } from "@voxhelp/shared";

// Le rapport final est un JSON.parse non validé (callClaudeJSON<T> ne fait aucune
// vérification runtime) : le modèle peut renvoyer des variantes accentuées/espacées
// de ces tokens ternaires. On normalise ici, à la frontière de confiance, plutôt
// que défensivement à chaque site de rendu frontend. Extrait dans son propre module
// pour que les tests (y compris les smoke tests) exercent exactement cette logique.

export function normalizeEnumToken(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");
}

export function normalizeSkillMatchStatus(raw: string): SkillMatchStatus {
  const normalized = normalizeEnumToken(raw);
  if (normalized === "demontre") return "demontre";
  if (normalized === "mentionne") return "mentionne";
  return "non-aborde";
}

export function normalizeVerdict(raw: string): Verdict {
  const normalized = normalizeEnumToken(raw);
  if (normalized === "presenter") return "presenter";
  if (normalized === "ne-pas-presenter") return "ne-pas-presenter";
  return "presenter-avec-reserve";
}
