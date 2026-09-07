import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockCallClaudeJSON = vi.hoisted(() => vi.fn());

vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function validPass1Output() {
  return {
    detectedLanguage: "fr",
    transcriptQuality: 0.8,
    plan: [],
    glossary: [],
    references: [],
    uncertainZones: [],
  };
}

function validBody() {
  return {
    transcript: [{ startMs: 0, endMs: 4000, text: "Alors on commence.", confidence: 0.9 }],
    course: { title: "Cours test", language: "fr" },
    existingGlossary: [],
  };
}

describe("POST /api/lecture/analyze-pass1", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockCallClaudeJSON.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the analysis for a valid request", async () => {
    server = await createTestHttpServer();
    mockCallClaudeJSON.mockResolvedValueOnce(validPass1Output());

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detectedLanguage).toBe("fr");
    expect(mockCallClaudeJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "claude-sonnet-4-6",
      8192,
      0
    );
  });

  it("returns 400 when the transcript is missing", async () => {
    server = await createTestHttpServer();
    const { transcript, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(mockCallClaudeJSON).not.toHaveBeenCalled();
  });

  it("returns 400 when the course context is missing", async () => {
    server = await createTestHttpServer();
    const { course, ...rest } = validBody();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when the analysis fails validation twice", async () => {
    server = await createTestHttpServer();
    mockCallClaudeJSON.mockResolvedValue({ bad: "shape" });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pass1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(502);
  });
});
