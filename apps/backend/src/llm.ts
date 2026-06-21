import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function correctTranscript(rawText: string, sttContext?: string): Promise<string> {
  try {
    const contextHint = sttContext ? `\nContexte de l'entretien : ${sttContext}` : "";
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: `Tu corriges les transcriptions audio d'entretiens techniques en français.
Le STT transcrit parfois mal les termes techniques, anglicismes et noms de technos.${contextHint}

Retourne UNIQUEMENT le texte corrigé, sans explication ni formatage.
Ne change pas le sens ni la structure de la phrase. Si tu n'es pas sûr, garde l'original.

Exemples de corrections :
- "pays publiques" → "APIs publiques"
- "foulstack" → "fullstack"
- "réacte" → "React"
- "côté Sarra" → "côté serveur"
- "l'inscrire pour s'exécuter" → "le script va s'exécuter"
- "No Jess" → "Node.js"
- "taille scripte" → "TypeScript"
- "dock air" → "Docker"
- "quai bernaise" → "Kubernetes"
- "les haches TTP" → "les requêtes HTTP"
- "un point de terminaison" → "un endpoint"
- "la mise en cache" → "le cache" (si c'est clairement du jargon dev)
- "Gitte" ou "guite" → "Git"
- "Poste Grèce" → "PostgreSQL"`,
      messages: [{ role: "user", content: rawText }],
    });
    const content = message.content[0];
    if (content.type !== "text") return rawText;
    const corrected = content.text.trim();
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
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type from Claude");

  const raw = content.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(raw) as T;
}
