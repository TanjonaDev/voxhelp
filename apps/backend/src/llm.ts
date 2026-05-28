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

export async function correctTranscript(rawText: string): Promise<string> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `Tu corriges les transcriptions audio d'entretiens techniques en français.
Le STT transcrit parfois mal les termes techniques, anglicismes et noms de technos.
Retourne UNIQUEMENT le texte corrigé, sans explication ni formatage.
Ne change pas le sens ni la structure de la phrase. Si tu n'es pas sûr, garde l'original.
Exemples de corrections : "pays publiques" → "APIs publiques", "foulstack" → "fullstack", "réacte" → "React".`,
      messages: [{ role: "user", content: rawText }],
    });
    const content = message.content[0];
    return content.type === "text" ? content.text.trim() : rawText;
  } catch {
    return rawText;
  }
}

export async function callClaudeJSON<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type from Claude");

  return JSON.parse(content.text) as T;
}
