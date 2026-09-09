import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

/**
 * Extrait le premier objet/tableau JSON complet d'une chaîne, en ignorant tout
 * ce qui suit — malgré la consigne de JSON strict, Claude ajoute parfois une
 * phrase après (ou avant) le JSON. Un `JSON.parse` naïf sur la chaîne entière
 * casse dans ce cas (trouvé via un smoke test sur un CV à faible signal).
 * Suit les accolades/crochets en ignorant ceux contenus dans des chaînes.
 */
function extractJsonPayload(raw: string): string {
  const start = raw.search(/[[{]/);
  if (start === -1) return raw;

  const openChar = raw[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === openChar) depth++;
    else if (char === closeChar) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw.slice(start);
}

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

export async function streamAssist(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  model = "claude-haiku-4-5"
): Promise<string> {
  const stream = anthropic.messages.stream({
    model,
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
      const chunk = event.delta.text;
      fullText += chunk;
      onChunk(chunk);
    }
  }
  return fullText;
}

export async function callClaudeJSON<T>(
  systemPrompt: string,
  userMessage: string,
  model = "claude-haiku-4-5",
  maxTokens = 4096,
  temperature?: number
): Promise<T> {
  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    ...(temperature !== undefined ? { temperature } : {}),
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type from Claude");

  const stripped = content.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(extractJsonPayload(stripped)) as T;
}
