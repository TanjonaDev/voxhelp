import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

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
    if (content.type !== "text") return rawText;
    const corrected = content.text.trim();
    // If response is much longer than input, Haiku gave a meta-response instead of correcting
    return corrected.length <= rawText.length * 3 ? corrected : rawText;
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

  const raw = content.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(raw) as T;
}
