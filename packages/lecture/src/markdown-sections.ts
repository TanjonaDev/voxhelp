// Shared by the frontend reader (deriveChapters.ts) and condense.ts: both
// need to pull a specific plan section's body out of a document the model
// wrote as one flat stream of "## " headings. Matching by the invisible
// "<!-- s:{index} -->" marker the rewrite/condense prompts are required to
// emit before each heading they keep (see pass2/prompts.ts,
// condense/prompts.ts) — instead of by the Nth heading found — means a
// section the model drops or merges into its neighbor only loses that one
// section's content, rather than shifting every section after it.
const SECTION_MARKER = /^<!--\s*s:\s*(\d+)\s*-->\s*$/;
const HEADING = /^##\s+(.*)$/;
const ANNEX_TITLES = new Set(["Glossaire", "Références citées"]);

/**
 * Splits a marked-up Markdown document into one raw body (everything between
 * a marked heading and the next one) per plan section index. The heading
 * line itself is not included — callers that need it already have the
 * title from the plan. Headings with no preceding marker (the deterministic
 * annexes) are skipped entirely.
 */
export function extractMarkedSections(markdown: string): Map<number, string> {
  const lines = markdown.split(/\r?\n/);
  const blocks = new Map<number, string>();
  let pendingIndex: number | null = null;
  let currentIndex: number | null = null;
  let current: string[] | null = null;

  const flush = () => {
    if (currentIndex !== null && current !== null) blocks.set(currentIndex, current.join("\n"));
    current = null;
    currentIndex = null;
  };

  for (const line of lines) {
    const marker = line.match(SECTION_MARKER);
    if (marker) {
      pendingIndex = Number(marker[1]);
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const title = heading[1].replace(/^Digression\s*—\s*/, "").trim();
      if (pendingIndex !== null && !ANNEX_TITLES.has(title)) {
        currentIndex = pendingIndex;
        current = [];
      }
      pendingIndex = null;
      continue;
    }
    if (current !== null) current.push(line);
  }
  flush();
  return blocks;
}
