// Règles de `prompts` de la passerelle Inworld STT, mesurées sur l'API réelle
// (2026-09-21) : la doc ne donne que les caractères, pas les limites.
// Toute violation fait échouer la config avec INVALID_ARGUMENT (code 3) et la
// session meurt : les mots-clés doivent donc être nettoyés avant envoi.
export const MAX_PROMPTS = 100;
export const MAX_PROMPT_LENGTH = 100;

export interface SanitizedPrompts {
  prompts: string[];
  /** Termes modifiés (symboles remplacés, apostrophes normalisées, espaces). */
  adjusted: number;
  /** Termes écartés (vides, trop longs, doublons, au-delà de MAX_PROMPTS). */
  dropped: number;
}

function cleanTerm(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[‘’′]/g, "'")
    // Formes parlées (C#, F#, C++) : uniquement collées à une lettre ou un chiffre.
    .replace(/(?<=[\p{L}\p{N}])\+\+/gu, " plus plus ")
    .replace(/(?<=[\p{L}\p{N}])#/gu, " sharp ")
    // Tout ce que la passerelle refuse devient une espace (CI/CD -> "CI CD").
    .replace(/[^\p{L}0-9 .,;:!?'()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `terms` vient d'un client (SessionConfig.keywords) : rien ne garantit un tableau de
 * chaînes. Un non-tableau donne un résultat vide, un élément non-chaîne est écarté.
 */
export function sanitizeInworldPrompts(terms: unknown): SanitizedPrompts {
  const prompts: string[] = [];
  const seen = new Set<string>();
  let adjusted = 0;
  let dropped = 0;

  const list: readonly unknown[] = Array.isArray(terms) ? terms : [];

  for (const raw of list) {
    if (typeof raw !== "string") {
      dropped += 1;
      continue;
    }
    const cleaned = cleanTerm(raw);
    const key = cleaned.toLowerCase();
    if (cleaned === "" || cleaned.length > MAX_PROMPT_LENGTH || seen.has(key) || prompts.length >= MAX_PROMPTS) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    if (cleaned !== raw.trim()) adjusted += 1;
    prompts.push(cleaned);
  }

  return { prompts, adjusted, dropped };
}
