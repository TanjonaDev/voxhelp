import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

describe("GET /api/stt/batch-providers", () => {
  let server: TestHttpServer;

  beforeEach(async () => {
    delete process.env.STT_BATCH_PROVIDER;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.INWORLD_API_KEY;
    server = await createTestHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("lists the batch providers with their availability and the default", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-test";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/batch-providers`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      default: "deepgram",
      providers: [
        { id: "deepgram", label: "Deepgram Nova-3", available: true },
        { id: "inworld", label: "Inworld", available: false },
      ],
    });
  });

  it("reports the STT_BATCH_PROVIDER value as the default", async () => {
    process.env.STT_BATCH_PROVIDER = "inworld";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/batch-providers`);

    expect((await res.json()).default).toBe("inworld");
  });
});
