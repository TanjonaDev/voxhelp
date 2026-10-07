import type { GenerateText } from "../pass2/rewrite.js";
import { groupPlanSections } from "../pass2/grouping.js";
import { extractMarkedSections } from "../markdown-sections.js";
import type { CondenseInput, CondenseMode } from "./types.js";
import { buildCondenseSystemPrompt, buildCondenseUserPrompt } from "./prompts.js";

/**
 * Rebuilds, for one group of consecutive plan sections, the "## Title\nBody"
 * text each of those sections had in the source document — condense only
 * needs readable context per section, not the marker itself (its own prompt
 * asks the model to emit a fresh one for whatever it keeps).
 */
function groupDocument(group: ReturnType<typeof groupPlanSections>[number], sectionBodies: Map<number, string>): string {
  return group
    .map((section) => `## ${section.title}\n${sectionBodies.get(section.index) ?? ""}`.trim())
    .join("\n\n");
}

/**
 * Condenses the course group by group instead of in one call: a single
 * request covering a whole ~1h30-2h course's ~70+ sections risks running
 * past the response's max token budget and getting cut off mid-document —
 * real run: everything after the point it ran out of room rendered as
 * "no content", even though the course kept going for another 15 minutes.
 * Each group is streamed in full before the next starts, so the frontend
 * (which reads the response as one continuous stream) needs no change.
 */
export async function condenseCourse(
  mode: CondenseMode,
  input: CondenseInput,
  generateText: GenerateText,
  onChunk: (text: string) => void
): Promise<string> {
  const groups = groupPlanSections(input.plan);
  const sectionBodies = extractMarkedSections(input.document);

  let full = "";
  for (const group of groups) {
    const system = buildCondenseSystemPrompt(mode);
    const user = buildCondenseUserPrompt(input.course, group, groupDocument(group, sectionBodies));
    const text = await generateText(system, user, onChunk);
    full += text;
  }
  return full;
}
