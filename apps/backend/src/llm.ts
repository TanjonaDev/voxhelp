import Anthropic from "@anthropic-ai/sdk";
import type { SessionConfig } from "@voxhelp/shared";
import { buildSystemPrompt } from "./prompts.js";

const anthropic = new Anthropic();

interface StreamCallbacks {
  onStart: () => void;
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}

export async function generateResponse(
  transcript: string,
  config: SessionConfig,
  conversationHistory: string[],
  callbacks: StreamCallbacks
): Promise<void> {
  const systemPrompt = buildSystemPrompt(config);

  const contextMessages = conversationHistory.slice(-10).map((t) => `- ${t}`);
  const contextSection =
    contextMessages.length > 0
      ? `\n\nHISTORIQUE RÉCENT DE LA CONVERSATION :\n${contextMessages.join("\n")}`
      : "";

  const userMessage = `${contextSection}\n\nNOUVEAU (l'interlocuteur vient de dire) :\n"${transcript}"`;

  await generateFromPrompt(systemPrompt, userMessage, callbacks);
}

export async function generateFromPrompt(
  systemPrompt: string,
  userMessage: string,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    callbacks.onStart();

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    let fullText = "";

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullText += event.delta.text;
        callbacks.onChunk(event.delta.text);
      }
    }

    callbacks.onDone(fullText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    callbacks.onError(message);
  }
}
