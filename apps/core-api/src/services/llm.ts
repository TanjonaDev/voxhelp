import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface StreamCallbacks {
  onStart: () => void;
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
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

export async function callLlmJson<T>(system: string, user: string): Promise<T> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return JSON.parse(text) as T;
}
