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
      32000,
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

  it("returns 502 with a JSON error body when streamAssist rejects before any chunk", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockRejectedValueOnce(new Error("provider unavailable"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "Lecture pass2 rewrite failed" });
  });

  it("destroys the connection instead of returning a clean 200 when streamAssist fails mid-stream", async () => {
    server = await createTestHttpServer();
    mockStreamAssist.mockImplementation(async (_system, _user, onChunk) => {
      onChunk("# Partial\n");
      throw new Error("provider dropped mid-stream");
    });

    await expect(
      fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      }).then((res) => res.text())
    ).rejects.toThrow();
  });

  it("returns 400 with an invalid pdfAnalysis and never calls streamAssist", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody(), pdfAnalysis: { blocks: "not an array" } }),
    });

    expect(res.status).toBe(400);
    expect(mockStreamAssist).not.toHaveBeenCalled();
  });

  it("streams 200 successfully with a valid pdfAnalysis and forwards it to the prompt", async () => {
    server = await createTestHttpServer();
    let receivedUserPrompt = "";
    mockStreamAssist.mockImplementation(async (_system, user, onChunk) => {
      receivedUserPrompt = user;
      onChunk("# Cours test\n");
      return "# Cours test\n";
    });

    const pdfAnalysis = {
      sourceFilename: "slides.pdf",
      blocks: [{ page: 1, type: "heading", anchorTitle: "Intro", content: "Introduction aux slides" }],
    };

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/rewrite-pass2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody(), pdfAnalysis }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("# Cours test\n");
    expect(receivedUserPrompt).toContain("Introduction aux slides");
  });
});
