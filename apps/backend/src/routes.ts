import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "./supabase.js";
import { extractTextFromCv, type CvFormat } from "./cv-parser.js";
import { callClaudeJSON } from "./llm.js";
import { buildCvKeywordExtractionPrompt } from "./prompts/cv-keyword-extraction.js";

const MIMETYPE_TO_FORMAT: Record<string, CvFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const EXTENSION_TO_FORMAT: Record<string, CvFormat> = {
  ".pdf": "pdf",
  ".docx": "docx",
};

/**
 * Resolves the CV format from the reported mimetype, falling back to the
 * filename extension when the browser reports a generic/incorrect mimetype
 * (e.g. "application/octet-stream" for .docx on machines without Office).
 */
function resolveCvFormat(mimetype: string, filename: string): CvFormat | null {
  if (MIMETYPE_TO_FORMAT[mimetype]) {
    return MIMETYPE_TO_FORMAT[mimetype];
  }
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const extension = filename.slice(dotIndex).toLowerCase();
  return EXTENSION_TO_FORMAT[extension] ?? null;
}

export function registerRoutes(app: FastifyInstance): void {
  app.post("/api/extract-cv-keywords", async (request, reply) => {
    if (supabaseAdmin) {
      const auth = request.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) {
        return reply.code(401).send({ error: "Missing token" });
      }
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        return reply.code(401).send({ error: "Invalid token" });
      }
    }

    let file: Awaited<ReturnType<typeof request.file>>;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({ error: "Unsupported or missing file (PDF or DOCX only)" });
    }
    const format = file ? resolveCvFormat(file.mimetype, file.filename) : null;
    if (!file || !format) {
      return reply.code(400).send({ error: "Unsupported or missing file (PDF or DOCX only)" });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(400).send({ error: "Failed to read uploaded file" });
    }

    let cvText: string;
    try {
      cvText = await extractTextFromCv(buffer, format);
    } catch {
      return reply.code(400).send({ error: "Failed to parse file content" });
    }

    try {
      const result = await callClaudeJSON<{ keywords: unknown }>(
        buildCvKeywordExtractionPrompt(cvText),
        "Extrais les keywords."
      );
      const keywords = Array.isArray(result?.keywords)
        ? result.keywords.filter((k): k is string => typeof k === "string" && k.length > 0)
        : [];
      return reply.send({ keywords });
    } catch {
      return reply.code(502).send({ error: "Keyword extraction failed" });
    }
  });
}
