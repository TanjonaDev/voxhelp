import { describe, it, expect, vi, beforeEach } from "vitest";

// callClaudeJSON n'est jamais testé contre le vrai SDK ailleurs (tous les
// autres tests mockent "../llm.js" directement) : ce fichier mocke le SDK
// Anthropic lui-même pour exercer la vraie logique de parsing JSON, en
// particulier le cas trouvé par le smoke test "extract-cv-keywords" — Claude
// ajoute parfois du texte après le JSON malgré la consigne de JSON strict.
//
// callClaudeJSON stream désormais en interne (real run: Anthropic's SDK
// refuses a plain non-streaming call once the estimated duration crosses
// ~10 min at a high maxTokens), donc le mock simule .stream(), pas .create().

const mockStream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn(), stream: mockStream };
  },
}));

const { callClaudeJSON } = await import("../llm.js");

function textStream(text: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: "content_block_delta", delta: { type: "text_delta", text } };
    },
  };
}

describe("callClaudeJSON", () => {
  beforeEach(() => mockStream.mockReset());

  it("parses clean JSON", async () => {
    mockStream.mockReturnValueOnce(textStream('{"a":1}'));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: 1 });
  });

  it("strips markdown code fences", async () => {
    mockStream.mockReturnValueOnce(textStream('```json\n{"a":1}\n```'));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: 1 });
  });

  it("recovers JSON followed by trailing prose", async () => {
    mockStream.mockReturnValueOnce(
      textStream('{"keywords":["Doctolib"]}\n\nCes termes sont les plus pertinents pour le boosting Deepgram.')
    );
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ keywords: ["Doctolib"] });
  });

  it("recovers JSON preceded by leading prose", async () => {
    mockStream.mockReturnValueOnce(textStream('Voici le résultat :\n{"a":1}'));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: 1 });
  });

  it("does not get confused by braces inside string values or nested objects", async () => {
    mockStream.mockReturnValueOnce(
      textStream('{"a":{"b":1},"c":"texte avec une } accolade"}\nmerci !')
    );
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: { b: 1 }, c: "texte avec une } accolade" });
  });

  it("parses a top-level JSON array", async () => {
    mockStream.mockReturnValueOnce(textStream("[1,2,3]\nvoilà."));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual([1, 2, 3]);
  });
});
