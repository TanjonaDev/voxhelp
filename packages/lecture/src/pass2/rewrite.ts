import type { Pass2Input } from "./types.js";
import { buildPass2SystemPrompt, buildPass2UserPrompt } from "./prompts.js";

export type GenerateText = (
  system: string,
  user: string,
  onChunk: (text: string) => void
) => Promise<string>;

export async function rewritePass2(
  input: Pass2Input,
  generateText: GenerateText,
  onChunk: (text: string) => void
): Promise<string> {
  const system = buildPass2SystemPrompt();
  const user = buildPass2UserPrompt(input);
  return generateText(system, user, onChunk);
}
