import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockExtract = vi.hoisted(() => vi.fn());
const mockCallClaudeJSON = vi.hoisted(() => vi.fn());

vi.mock("../cv-parser.js", () => ({ extractTextFromCv: mockExtract }));
vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

function buildForm(mimetype: string, filename: string): FormData {
  const form = new FormData();
  form.append("cv", new Blob([Buffer.from("fake file content")], { type: mimetype }), filename);
  return form;
}

describe("POST /api/extract-cv-keywords", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockExtract.mockReset();
    mockCallClaudeJSON.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns extracted keywords for a valid PDF upload", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("Cléo, RMC BFM, TypeScript");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["Cléo", "RMC BFM", "TypeScript"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["Cléo", "RMC BFM", "TypeScript"]);
  });

  it("returns extracted keywords for a valid DOCX upload", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some docx text");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["AWS Lambda"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "cv.docx"
      ),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["AWS Lambda"]);
  });

  it("rejects unsupported file types with 400", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("text/plain", "cv.txt"),
    });

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("returns 400 when parsing the file content fails", async () => {
    server = await createTestHttpServer();
    mockExtract.mockRejectedValueOnce(new Error("corrupt file"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-multipart request instead of 406", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 502 when keyword extraction fails", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some cv text");
    mockCallClaudeJSON.mockRejectedValueOnce(new Error("LLM error"));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(502);
  });

  it("sanitizes a null keywords field from the LLM into an empty array", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some cv text");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: null });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual([]);
  });

  it("filters out non-string and empty entries from the LLM keywords array", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some cv text");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["ok", 123, "", "also-ok", null] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["ok", "also-ok"]);
  });

  it("accepts a .docx file whose mimetype is reported as application/octet-stream", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some docx text");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["AWS Lambda"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/octet-stream", "cv.docx"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["AWS Lambda"]);
    expect(mockExtract).toHaveBeenCalledWith(expect.anything(), "docx");
  });

  it("accepts a .pdf file whose mimetype is reported as application/octet-stream", async () => {
    server = await createTestHttpServer();
    mockExtract.mockResolvedValueOnce("some pdf text");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["Kubernetes"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/octet-stream", "cv.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["Kubernetes"]);
    expect(mockExtract).toHaveBeenCalledWith(expect.anything(), "pdf");
  });

  it("still rejects an unsupported extension even with a generic mimetype", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/octet-stream", "cv.txt"),
    });

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
