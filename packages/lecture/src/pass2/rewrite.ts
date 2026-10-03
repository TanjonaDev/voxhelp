import type { Pass2Cache, Pass2Input } from "./types.js";
import { buildPass2SystemPrompt, buildPass2UserPrompt, buildAnnexesMarkdown } from "./prompts.js";
import { groupPlanSections, transcriptInRange } from "./grouping.js";

export type GenerateText = (
  system: string,
  user: string,
  onChunk: (text: string) => void
) => Promise<string>;

/**
 * Rewrites the course group by group instead of in one LLM call, each group
 * streamed in full before the next one starts (the frontend reads the whole
 * response as a single continuous stream, so grouping stays transparent to
 * it). Without a cache (no jobId on the backend route — e.g. the
 * /lecture-test debug page), grouping is a no-op: the whole plan is treated
 * as a single group, matching the pre-chunking behavior exactly. With a
 * cache, a group already rewritten on a previous attempt is read back
 * verbatim instead of calling the LLM again.
 */
export async function rewritePass2(
  input: Pass2Input,
  generateText: GenerateText,
  onChunk: (text: string) => void,
  cache?: Pass2Cache
): Promise<string> {
  const groups = cache ? groupPlanSections(input.plan) : [input.plan];
  const groupStarts = groups.map((group) => group[0]?.startMs ?? 0);

  let full = "";
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const rangeStart = index === 0 ? -Infinity : groupStarts[index];
    const rangeEnd = index === groups.length - 1 ? Infinity : groupStarts[index + 1];

    const groupInput: Pass2Input = {
      ...input,
      plan: group,
      transcript: groups.length === 1 ? input.transcript : transcriptInRange(input.transcript, rangeStart, rangeEnd),
    };

    const cached = await cache?.get(index);
    let text: string;
    if (cached !== null && cached !== undefined) {
      text = cached;
      onChunk(text);
    } else {
      const system = buildPass2SystemPrompt();
      const user = buildPass2UserPrompt(groupInput);
      text = await generateText(system, user, onChunk);
      await cache?.set(index, text);
    }
    full += text;
  }

  const annexes = buildAnnexesMarkdown(input.glossary, input.references, input.pdfAnalyses);
  onChunk(annexes);
  full += annexes;
  return full;
}
