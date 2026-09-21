import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

describe("GET /api/stt/providers", () => {
  let server: TestHttpServer;

  beforeEach(async () => {
    delete process.env.STT_LIVE_PROVIDER;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.INWORLD_API_KEY;
    server = await createTestHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("lists the live providers with their availability and the default", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-test";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/providers`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      default: "deepgram",
      providers: [
        { id: "deepgram", label: "Deepgram Flux", available: true },
        { id: "inworld", label: "Inworld", available: false },
      ],
    });
  });

  it("reports the STT_LIVE_PROVIDER value as the default", async () => {
    process.env.STT_LIVE_PROVIDER = "inworld";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/providers`);

    expect((await res.json()).default).toBe("inworld");
  });
});
