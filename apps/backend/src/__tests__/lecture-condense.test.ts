import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockStreamAssist = vi.hoisted(() => vi.fn());

vi.mock("../llm.js", () => ({ streamAssist: mockStreamAssist }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function validBody(mode: "synthesis" | "revision" = "synthesis") {
  return {
    course: { title: "Cours test", language: "fr" },
    plan: [
      { index: 0, title: "Introduction", startMs: 0, endMs: 4000, oneLineSummary: "Début", type: "content", confidence: 0.9 },
    ],
    document: "## Introduction\n\nTexte réécrit du cours.",
    mode,
  };
}

describe("POST /api/lecture/condense", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockStreamAssist.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("streams the condensed Markdown document for synthesis mode", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockImplementation(async (_system, _user, onChunk) => {
      onChunk("## Introduction\nCondensé.\n");
      return "## Introduction\nCondensé.\n";
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/condense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody("synthesis")),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("## Introduction\nCondensé.\n");
    expect(mockStreamAssist).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      "claude-sonnet-5",
      8192,
      undefined,
      true
    );
  });

  it("streams the condensed Markdown document for revision mode", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockImplementation(async (_system, _user, onChunk) => {
      onChunk("## Introduction\n- Point clé.\n");
      return "## Introduction\n- Point clé.\n";
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/condense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody("revision")),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("## Introduction\n- Point clé.\n");
  });

  it("returns 400 when the document is missing", async () => {
    server = await createTestHttpServer();
    const { document, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/condense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });

  it("returns 400 when the plan is missing", async () => {
    server = await createTestHttpServer();
    const { plan, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/condense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });

  it("returns 400 with an invalid mode", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/condense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody(), mode: "summary" }),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });

  it("returns 502 with a JSON error body when streamAssist rejects before any chunk", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockRejectedValueOnce(new Error("provider unavailable"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/condense`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "Lecture condense failed" });
  });
});
