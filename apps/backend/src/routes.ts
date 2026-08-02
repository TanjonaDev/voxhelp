import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "./supabase.js";
import { extractTextFromCv } from "./cv-parser.js";
import { callClaudeJSON } from "./llm.js";
import { buildCvKeywordExtractionPrompt } from "./prompts/cv-keyword-extraction.js";

const SUPPORTED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

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

    const file = await request.file();
    if (!file || !SUPPORTED_MIMETYPES.has(file.mimetype)) {
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
      cvText = await extractTextFromCv(buffer, file.mimetype);
    } catch {
      return reply.code(400).send({ error: "Failed to parse file content" });
    }

    try {
      const result = await callClaudeJSON<{ keywords: string[] }>(
        buildCvKeywordExtractionPrompt(cvText),
        "Extrais les keywords."
      );
      return reply.send({ keywords: result.keywords });
    } catch {
      return reply.code(502).send({ error: "Keyword extraction failed" });
    }
  });
}
