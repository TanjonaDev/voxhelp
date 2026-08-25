import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnect = vi.hoisted(() => vi.fn());

vi.mock("@deepgram/sdk", () => ({
  DeepgramClient: class {
    listen = { v2: { connect: mockConnect } };
  },
}));

const { FluxSTT } = await import("../deepgram-flux.js");

function fakeConnection() {
  return {
    on: vi.fn(),
    connect: vi.fn(),
    waitForOpen: vi.fn().mockResolvedValue(undefined),
    sendMedia: vi.fn(),
    close: vi.fn(),
  };
}

describe("FluxSTT connection config", () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(fakeConnection());
    process.env.DEEPGRAM_API_KEY = "test-key";
  });

  it("configures a conservative end-of-turn threshold to avoid splitting turns on hesitations", async () => {
    const stt = new FluxSTT("fr", undefined, {
      onTranscript: vi.fn(),
      onListening: vi.fn(),
      onError: vi.fn(),
    });

    await stt.start();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    const config = mockConnect.mock.calls[0][0] as Record<string, unknown>;
    expect(config.eot_threshold).toBe(0.85);
  });
});
