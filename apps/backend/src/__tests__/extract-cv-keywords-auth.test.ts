import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const mockExtract = vi.hoisted(() => vi.fn());
const mockCallClaudeJSON = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());

vi.mock("../cv-parser.js", () => ({ extractTextFromCv: mockExtract }));
vi.mock("../llm.js", () => ({ callClaudeJSON: mockCallClaudeJSON }));
// Unlike extract-cv-keywords.test.ts (supabaseAdmin: null, auth block skipped), this file
// mocks supabaseAdmin as truthy so the auth branch in routes.ts actually executes.
vi.mock("../supabase.js", () => ({
  supabaseAdmin: { auth: { getUser: mockGetUser } },
}));

function buildForm(mimetype: string, filename: string): FormData {
  const form = new FormData();
  form.append("cv", new Blob([Buffer.from("fake file content")], { type: mimetype }), filename);
  return form;
}

describe("POST /api/extract-cv-keywords — auth", () => {
  let server: TestHttpServer;

  beforeEach(() => {
    mockExtract.mockReset();
    mockCallClaudeJSON.mockReset();
    mockGetUser.mockReset();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns 401 when no Authorization header is present", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header has no Bearer token", async () => {
    server = await createTestHttpServer();

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      headers: { Authorization: "not-a-bearer-token" },
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("returns 401 when getUser errors out", async () => {
    server = await createTestHttpServer();
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("invalid token") });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      headers: { Authorization: "Bearer bad-token" },
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(401);
    expect(mockGetUser).toHaveBeenCalledWith("bad-token");
  });

  it("returns 401 when getUser succeeds without error but returns no user", async () => {
    server = await createTestHttpServer();
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      headers: { Authorization: "Bearer no-user-token" },
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(401);
  });

  it("returns 200 with keywords when the token is valid", async () => {
    server = await createTestHttpServer();
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    mockExtract.mockResolvedValueOnce("Cléo, TypeScript");
    mockCallClaudeJSON.mockResolvedValueOnce({ keywords: ["Cléo", "TypeScript"] });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/extract-cv-keywords`, {
      method: "POST",
      headers: { Authorization: "Bearer good-token" },
      body: buildForm("application/pdf", "cv.pdf"),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywords).toEqual(["Cléo", "TypeScript"]);
    expect(mockGetUser).toHaveBeenCalledWith("good-token");
  });
});
