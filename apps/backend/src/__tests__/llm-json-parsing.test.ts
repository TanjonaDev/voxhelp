import { describe, it, expect, vi, beforeEach } from "vitest";

// callClaudeJSON n'est jamais testé contre le vrai SDK ailleurs (tous les
// autres tests mockent "../llm.js" directement) : ce fichier mocke le SDK
// Anthropic lui-même pour exercer la vraie logique de parsing JSON, en
// particulier le cas trouvé par le smoke test "extract-cv-keywords" — Claude
// ajoute parfois du texte après le JSON malgré la consigne de JSON strict.

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: vi.fn() };
  },
}));

const { callClaudeJSON } = await import("../llm.js");

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("callClaudeJSON", () => {
  beforeEach(() => mockCreate.mockReset());

  it("parses clean JSON", async () => {
    mockCreate.mockResolvedValueOnce(textResponse('{"a":1}'));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: 1 });
  });

  it("strips markdown code fences", async () => {
    mockCreate.mockResolvedValueOnce(textResponse('```json\n{"a":1}\n```'));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: 1 });
  });

  it("recovers JSON followed by trailing prose", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse('{"keywords":["Doctolib"]}\n\nCes termes sont les plus pertinents pour le boosting Deepgram.')
    );
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ keywords: ["Doctolib"] });
  });

  it("recovers JSON preceded by leading prose", async () => {
    mockCreate.mockResolvedValueOnce(textResponse('Voici le résultat :\n{"a":1}'));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: 1 });
  });

  it("does not get confused by braces inside string values or nested objects", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse('{"a":{"b":1},"c":"texte avec une } accolade"}\nmerci !')
    );
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual({ a: { b: 1 }, c: "texte avec une } accolade" });
  });

  it("parses a top-level JSON array", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("[1,2,3]\nvoilà."));
    await expect(callClaudeJSON("sys", "user")).resolves.toEqual([1, 2, 3]);
  });
});
