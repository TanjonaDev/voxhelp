import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn(), stream: mockStream };
  },
}));

const { streamAssist } = await import("../llm.js");

function fakeStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: chunk } };
      }
    },
  };
}

describe("streamAssist", () => {
  beforeEach(() => mockStream.mockReset());

  it("passes a custom model, maxTokens and temperature through to the Anthropic stream call", async () => {
    mockStream.mockReturnValueOnce(fakeStream(["Bon", "jour"]));
    const chunks: string[] = [];

    const result = await streamAssist(
      "sys",
      "user",
      (c) => chunks.push(c),
      "claude-sonnet-4-6",
      8192,
      0.3
    );

    expect(result).toBe("Bonjour");
    expect(chunks).toEqual(["Bon", "jour"]);
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6", max_tokens: 8192, temperature: 0.3 })
    );
  });

  it("defaults maxTokens to 1024 and omits temperature when not provided", async () => {
    mockStream.mockReturnValueOnce(fakeStream(["Bonjour"]));

    await streamAssist("sys", "user", () => {});

    const callArgs = mockStream.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.max_tokens).toBe(1024);
    expect(callArgs).not.toHaveProperty("temperature");
  });
});
