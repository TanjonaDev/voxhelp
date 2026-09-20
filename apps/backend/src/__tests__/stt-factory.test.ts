import { describe, it, expect, vi, beforeEach } from "vitest";

const flux = vi.hoisted(() => ({ ctorArgs: null as unknown[] | null }));

vi.mock("../stt/providers/deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(...args: unknown[]) {
      flux.ctorArgs = args;
    }
  },
}));

const { createLiveStt } = await import("../stt/index.js");

const callbacks = { onTranscript: vi.fn(), onListening: vi.fn(), onError: vi.fn() };

beforeEach(() => {
  delete process.env.STT_LIVE_PROVIDER;
  delete process.env.STT_BATCH_PROVIDER;
  flux.ctorArgs = null;
});

describe("createLiveStt", () => {
  it("creates the Deepgram Flux adapter by default", () => {
    const stt = createLiveStt({ language: "fr", keyterms: ["Kubernetes"] }, callbacks);

    expect(stt).toBeDefined();
    expect(flux.ctorArgs).toEqual(["fr", ["Kubernetes"], callbacks]);
  });

  it("throws on an unknown STT_LIVE_PROVIDER, listing the valid values", () => {
    process.env.STT_LIVE_PROVIDER = "whisper";

    expect(() => createLiveStt({ language: "fr" }, callbacks)).toThrow(
      /STT_LIVE_PROVIDER "whisper".*deepgram/
    );
  });
});
