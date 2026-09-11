import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockExtractPdfPages = vi.hoisted(() => vi.fn());
const mockCallClaudeJSON = vi.hoisted(() => vi.fn());

vi.mock("@voxhelp/lecture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@voxhelp/lecture")>()),
  extractPdfPages: mockExtractPdfPages,
}));
vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function buildForm(mimetype: string, filename: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("fake pdf content")], { type: mimetype }), filename);
  return form;
}

function validPdfAnalysis() {
  return {
    sourceFilename: "cours.pdf",
    blocks: [{ page: 1, type: "heading", anchorTitle: "Introduction", content: "Introduction" }],
  };
}

describe("POST /api/lecture/analyze-pdf", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockExtractPdfPages.mockReset();
    mockCallClaudeJSON.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns the pdf analysis for a valid PDF upload", async () => {
    server = await createTestHttpServer();
    mockExtractPdfPages.mockResolvedValueOnce([{ page: 1, text: "Introduction" }]);
    mockCallClaudeJSON.mockResolvedValueOnce(validPdfAnalysis());

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("application/pdf", "cours.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blocks).toHaveLength(1);
    expect(mockCallClaudeJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "claude-sonnet-4-6",
      8192,
      0
    );
  });

  it("rejects a non-PDF upload with 400", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("text/plain", "notes.txt"),
    });

    expect(res.status).toBe(400);
    expect(mockExtractPdfPages).not.toHaveBeenCalled();
  });

  it("returns 400 when PDF text extraction fails", async () => {
    server = await createTestHttpServer();
    mockExtractPdfPages.mockRejectedValueOnce(new Error("corrupt pdf"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("application/pdf", "cours.pdf"),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when the analysis fails validation twice", async () => {
    server = await createTestHttpServer();
    mockExtractPdfPages.mockResolvedValueOnce([{ page: 1, text: "Introduction" }]);
    mockCallClaudeJSON.mockResolvedValue({ bad: "shape" });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/lecture/analyze-pdf`, {
      method: "POST",
      body: buildForm("application/pdf", "cours.pdf"),
    });

    expect(res.status).toBe(502);
  });
});
