import type { GenerateText } from "../pass2/rewrite.js";
import type { CondenseInput, CondenseMode } from "./types.js";
import { buildCondenseSystemPrompt, buildCondenseUserPrompt } from "./prompts.js";

export async function condenseCourse(
  mode: CondenseMode,
  input: CondenseInput,
  generateText: GenerateText,
  onChunk: (text: string) => void
): Promise<string> {
  const system = buildCondenseSystemPrompt(mode);
  const user = buildCondenseUserPrompt(input.course, input.plan, input.document);
  return generateText(system, user, onChunk);
}
