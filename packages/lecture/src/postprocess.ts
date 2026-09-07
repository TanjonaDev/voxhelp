import type { GlossaryEntry } from "./types.js";

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function mergeGlossary(existing: GlossaryEntry[], incoming: GlossaryEntry[]): GlossaryEntry[] {
  const byKey = new Map<string, GlossaryEntry>();
  for (const entry of existing) {
    byKey.set(normalizeTerm(entry.term), { ...entry, heardVariants: [...entry.heardVariants] });
  }
  for (const entry of incoming) {
    const key = normalizeTerm(entry.term);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...entry, heardVariants: [...entry.heardVariants] });
      continue;
    }
    byKey.set(key, {
      ...current,
      heardVariants: Array.from(new Set([...current.heardVariants, ...entry.heardVariants])),
      occurrences: current.occurrences + entry.occurrences,
      confidence: Math.max(current.confidence, entry.confidence),
      shortDefinition: current.shortDefinition ?? entry.shortDefinition,
      sourceLanguage: current.sourceLanguage ?? entry.sourceLanguage,
    });
  }
  return Array.from(byKey.values());
}

export function selectNewGlossaryEntries(
  existing: GlossaryEntry[],
  consolidated: GlossaryEntry[]
): GlossaryEntry[] {
  const existingKeys = new Set(existing.map((entry) => normalizeTerm(entry.term)));
  return consolidated.filter((entry) => !existingKeys.has(normalizeTerm(entry.term)));
}

export function splitGlossaryByConfidence(
  glossary: GlossaryEntry[],
  threshold = 0.6
): { toApply: GlossaryEntry[]; toValidate: GlossaryEntry[] } {
  const toApply: GlossaryEntry[] = [];
  const toValidate: GlossaryEntry[] = [];
  for (const entry of glossary) {
    (entry.confidence < threshold ? toValidate : toApply).push(entry);
  }
  return { toApply, toValidate };
}

export function selectKeyterms(glossary: GlossaryEntry[], threshold = 0.8): string[] {
  return Array.from(new Set(glossary.filter((entry) => entry.confidence >= threshold).map((entry) => entry.term)));
}
