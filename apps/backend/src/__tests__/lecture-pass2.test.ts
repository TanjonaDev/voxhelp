import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockStreamAssist = vi.hoisted(() => vi.fn());

vi.mock("../llm.js", () => ({ streamAssist: mockStreamAssist }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function validBody() {
  return {
    transcript: [{ startMs: 0, endMs: 4000, text: "Alors, on commence.", confidence: 0.9 }],
    course: { title: "Cours test", language: "fr" },
    plan: [
      { index: 0, title: "Introduction", startMs: 0, endMs: 4000, oneLineSummary: "Début", type: "content", confidence: 0.9 },
    ],
    glossary: [],
    references: [],
    uncertainZones: [],
  };
}

describe("POST /api/lecture/rewrite-pass2", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockStreamAssist.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("streams the rewritten Markdown document", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockImplementation(async (_system, _user, onChunk) => {
      onChunk("# Cours test\n\n");
      onChunk("## Introduction\nOn commence.\n");
      return "# Cours test\n\n## Introduction\nOn commence.\n";
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("# Cours test\n\n## Introduction\nOn commence.\n");
    expect(mockStreamAssist).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      "claude-sonnet-4-6",
      8192,
      0.3
    );
  });

  it("returns 400 when the transcript is missing", async () => {
    server = await createTestHttpServer();
    const { transcript, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
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

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });
});
