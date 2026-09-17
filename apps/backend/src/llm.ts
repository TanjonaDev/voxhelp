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

// Anthropic's SDK requires streaming for requests estimated to run past ~10
// minutes — a plain messages.create() throws instead of returning
// ("Streaming is strongly recommended for operations that may take longer
// than 10 minutes") once maxTokens is high enough (real run: hit this at
// 32000 maxTokens on a dense PDF). Every call below streams internally and
// accumulates the full text, even the JSON-returning ones that don't need
// incremental chunks — this sidesteps the limit instead of tuning maxTokens
// under it, which would just resurface the same failure on a bigger input.
async function collectStreamedText(
  params: Parameters<typeof anthropic.messages.stream>[0],
  onChunk?: (text: string) => void
): Promise<string> {
  const stream = anthropic.messages.stream(params);
  let fullText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      fullText += event.delta.text;
      onChunk?.(event.delta.text);
    } else if (event.type === "message_delta" && event.delta.stop_reason === "max_tokens") {
      console.warn("[LLM] hit max_tokens — output was truncated");
    }
  }
  return fullText;
}

export async function streamAssist(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  model = "claude-haiku-4-5",
  maxTokens = 1024,
  temperature?: number,
  // Sonnet 5 / Opus 5 run adaptive thinking by default when `thinking` is
  // omitted (4.6 ran thinking-off by default) — that eats into maxTokens
  // and changes cost/latency. Callers migrating from 4.6 pass this to keep
  // the old thinking-off behavior instead of inheriting adaptive thinking.
  disableThinking = false
): Promise<string> {
  return collectStreamedText(
    {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      ...(temperature !== undefined ? { temperature } : {}),
      ...(disableThinking ? { thinking: { type: "disabled" as const } } : {}),
    },
    onChunk
  );
}

function parseClaudeJsonText<T>(text: string): T {
  const stripped = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(extractJsonPayload(stripped)) as T;
}

export async function callClaudeJSON<T>(
  systemPrompt: string,
  userMessage: string,
  model = "claude-haiku-4-5",
  maxTokens = 4096,
  temperature?: number,
  disableThinking = false
): Promise<T> {
  const text = await collectStreamedText({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    ...(temperature !== undefined ? { temperature } : {}),
    ...(disableThinking ? { thinking: { type: "disabled" as const } } : {}),
  });

  return parseClaudeJsonText<T>(text);
}

/**
 * Same as callClaudeJSON, but attaches a PDF as a native document content
 * block so Claude reads it directly (including scanned/image-only pages via
 * vision) instead of relying on pre-extracted text.
 */
export async function callClaudeJSONWithPdf<T>(
  systemPrompt: string,
  userMessage: string,
  pdfBase64: string,
  model = "claude-haiku-4-5",
  maxTokens = 4096,
  temperature?: number,
  disableThinking = false
): Promise<T> {
  const text = await collectStreamedText({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: userMessage },
        ],
      },
    ],
    ...(temperature !== undefined ? { temperature } : {}),
    ...(disableThinking ? { thinking: { type: "disabled" as const } } : {}),
  });

  return parseClaudeJsonText<T>(text);
}
