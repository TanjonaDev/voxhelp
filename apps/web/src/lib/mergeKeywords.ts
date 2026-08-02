export function deriveStackKeywords(stack: string): string[] {
  return stack
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 100);
}

export function mergeKeywords(cvKeywords: string[], stackKeywords: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const term of [...cvKeywords, ...stackKeywords]) {
    const key = term.toLowerCase();
    if (seen.has(key) || term.length === 0 || term.length > 100) continue;
    seen.add(key);
    merged.push(term);
    if (merged.length >= 50) break;
  }
  return merged;
}
