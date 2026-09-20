import { describe, it, expect, vi, beforeEach } from "vitest";

const flux = vi.hoisted(() => ({ ctorArgs: null as unknown[] | null }));
const inworld = vi.hoisted(() => ({ ctorArgs: null as unknown[] | null }));

vi.mock("../stt/providers/deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(...args: unknown[]) {
      flux.ctorArgs = args;
    }
  },
}));

vi.mock("../stt/providers/inworld-live.js", () => ({
  InworldSTT: class MockInworldSTT {
    constructor(...args: unknown[]) {
      inworld.ctorArgs = args;
    }
  },
}));

vi.mock("../stt/providers/deepgram-batch.js", () => ({
  deepgramBatchStt: { transcribe: vi.fn() },
}));

const { createLiveStt, getBatchStt, assertSttConfig } = await import("../stt/index.js");
const { deepgramBatchStt } = await import("../stt/providers/deepgram-batch.js");

const callbacks = { onTranscript: vi.fn(), onListening: vi.fn(), onError: vi.fn() };

beforeEach(() => {
  delete process.env.STT_LIVE_PROVIDER;
  delete process.env.STT_BATCH_PROVIDER;
  flux.ctorArgs = null;
  inworld.ctorArgs = null;
});

describe("createLiveStt", () => {
  it("creates the Deepgram Flux adapter by default", () => {
    const stt = createLiveStt({ language: "fr", keyterms: ["Kubernetes"] }, callbacks);

    expect(stt).toBeDefined();
    expect(flux.ctorArgs).toEqual(["fr", ["Kubernetes"], callbacks]);
  });

  it("creates the Inworld adapter when STT_LIVE_PROVIDER=inworld", () => {
    process.env.STT_LIVE_PROVIDER = "inworld";

    const stt = createLiveStt({ language: "en", keyterms: ["Cléo"] }, callbacks);

    expect(stt).toBeDefined();
    expect(inworld.ctorArgs).toEqual(["en", ["Cléo"], callbacks]);
    expect(flux.ctorArgs).toBeNull();
  });

  it("throws on an unknown STT_LIVE_PROVIDER, listing the valid values", () => {
    process.env.STT_LIVE_PROVIDER = "whisper";

    expect(() => createLiveStt({ language: "fr" }, callbacks)).toThrow(
      /STT_LIVE_PROVIDER "whisper".*deepgram/
    );
  });
});

describe("getBatchStt", () => {
  it("returns the Deepgram batch adapter by default", () => {
    expect(getBatchStt()).toBe(deepgramBatchStt);
  });

  it("throws on an unknown STT_BATCH_PROVIDER", () => {
    process.env.STT_BATCH_PROVIDER = "inworld";

    expect(() => getBatchStt()).toThrow(/STT_BATCH_PROVIDER "inworld".*deepgram/);
  });
});

describe("assertSttConfig", () => {
  it("rejects an invalid provider so the server fails fast at boot", () => {
    process.env.STT_LIVE_PROVIDER = "whisper";

    expect(() => assertSttConfig()).toThrow(/STT_LIVE_PROVIDER/);
  });
});
