import type { FastifyInstance } from "fastify";
import type { SttProvidersResponse } from "@voxhelp/shared";
import { supabaseAdmin } from "./supabase.js";
import { callClaudeJSON, callClaudeJSONWithPdf, streamAssist } from "./llm.js";
import { extractTextFromCv, buildCvKeywordExtractionPrompt, type CvFormat } from "@voxhelp/recruit";
import {
  analyzePass1,
  extractPdfPages,
  analyzePdf,
  analyzePdfOcr,
  rewritePass2,
  condenseCourse,
  pdfAnalysisSchema,
  selectKeyterms,
  mapUtterancesToSegments,
  type Pass1Input,
  type Pass2Input,
  type CondenseMode,
  type LectureSection,
  type CourseContext,
  type GlossaryEntry,
} from "@voxhelp/lecture";
import {
  SttProviderError,
  defaultBatchProviderId,
  defaultLiveProviderId,
  getBatchStt,
  listBatchProviders,
  listLiveProviders,
} from "./stt/index.js";
import type { BatchStt } from "./stt/types.js";
import { startUploadSession, writeChunk, assembleUpload, cleanupUpload } from "./audio-upload-sessions.js";
import type { TranscriptSegment } from "@voxhelp/lecture";

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

/** Résout le modèle batch demandé (chaîne du client, non fiable). `undefined` = défaut du serveur. */
function resolveBatchStt(requested: unknown): { ok: true; batchStt: BatchStt } | { ok: false; error: string } {
  if (requested !== undefined && typeof requested !== "string") {
    return { ok: false, error: "Invalid sttProvider" };
  }
  try {
    return { ok: true, batchStt: getBatchStt(requested) };
  } catch (err) {
    if (err instanceof SttProviderError) return { ok: false, error: err.message };
    throw err;
  }
}

async function runTranscription(
  buffer: Buffer,
  language: string,
  existingGlossary: GlossaryEntry[],
  batchStt: BatchStt
): Promise<TranscriptSegment[]> {
  const utterances = await batchStt.transcribe(buffer, {
    language,
    keyterms: selectKeyterms(existingGlossary),
  });
  return mapUtterancesToSegments(utterances);
}

export function registerRoutes(app: FastifyInstance): void {
  app.get("/api/stt/providers", async (request, reply) => {
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

    const body: SttProvidersResponse = { default: defaultLiveProviderId(), providers: listLiveProviders() };
    return reply.send(body);
  });

  app.get("/api/stt/batch-providers", async (request, reply) => {
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

    const body: SttProvidersResponse = { default: defaultBatchProviderId(), providers: listBatchProviders() };
    return reply.send(body);
  });

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
    console.log(`[Routes] CV parsed (${format}): ${cvText.length} caractères extraits`);

    try {
      const result = await callClaudeJSON<{ keywords: unknown }>(
        buildCvKeywordExtractionPrompt(cvText),
        "Extrais les keywords."
      );
      const keywords = Array.isArray(result?.keywords)
        ? result.keywords.filter((k): k is string => typeof k === "string" && k.length > 0)
        : [];
      console.log(`[Routes] CV keywords extraits (${keywords.length}): [${keywords.join(", ")}]`);
      return reply.send({ keywords });
    } catch (err) {
      console.error("[Routes] Keyword extraction failed:", err instanceof Error ? err.message : err);
      return reply.code(502).send({ error: "Keyword extraction failed" });
    }
  });

  app.post("/api/lecture/analyze-pass1", async (request, reply) => {
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

    const body = request.body as Partial<Pass1Input> | undefined;
    if (!body || !Array.isArray(body.transcript) || body.transcript.length === 0 || !body.course) {
      return reply.code(400).send({ error: "Missing transcript or course context" });
    }

    const input: Pass1Input = {
      transcript: body.transcript,
      course: body.course,
      existingGlossary: Array.isArray(body.existingGlossary) ? body.existingGlossary : [],
    };

    try {
      const output = await analyzePass1(input, (system, user) =>
        callClaudeJSON(system, user, "claude-sonnet-5", 16000, undefined, true)
      );
      return reply.send(output);
    } catch (err) {
      console.error("[Routes] Lecture pass1 analysis failed:", err instanceof Error ? err.message : err);
      return reply.code(502).send({ error: "Lecture analysis failed" });
    }
  });

  app.post("/api/lecture/transcribe-audio", async (request, reply) => {
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
      return reply.code(400).send({ error: "Unsupported or missing file (audio only)" });
    }
    const isMedia = file && (file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/"));
    if (!file || !isMedia) {
      return reply.code(400).send({ error: "Unsupported or missing file (audio or video only)" });
    }

    const language = (file.fields.language as { value?: string } | undefined)?.value ?? "fr";

    const existingGlossaryRaw = (file.fields.existingGlossary as { value?: string } | undefined)?.value;
    let existingGlossary: GlossaryEntry[] = [];
    if (existingGlossaryRaw !== undefined) {
      try {
        const parsed = JSON.parse(existingGlossaryRaw);
        if (!Array.isArray(parsed)) throw new Error("existingGlossary must be an array");
        existingGlossary = parsed;
      } catch {
        return reply.code(400).send({ error: "Invalid existingGlossary JSON" });
      }
    }

    const requestedProvider = (file.fields.sttProvider as { value?: string } | undefined)?.value;
    const resolved = resolveBatchStt(requestedProvider);
    if (!resolved.ok) {
      return reply.code(400).send({ error: resolved.error });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(400).send({ error: "Failed to read uploaded file" });
    }

    try {
      const transcript = await runTranscription(buffer, language, existingGlossary, resolved.batchStt);
      return reply.send({ transcript });
    } catch (err) {
      console.error("[Routes] Audio transcription failed:", err instanceof Error ? err.message : err);
      return reply.code(502).send({ error: "Audio transcription failed" });
    }
  });

  // Chunked upload: the browser was crashing (renderer OOM) building a
  // single multipart request body for a full course recording (900MB+).
  // The frontend splits the file into small chunks instead — each an
  // independent small request — and only asks the backend to assemble and
  // transcribe once every chunk has landed.
  app.post("/api/lecture/audio-chunk/start", async (request, reply) => {
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
    const uploadId = await startUploadSession();
    return reply.send({ uploadId });
  });

  app.post("/api/lecture/audio-chunk", async (request, reply) => {
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

    const uploadId = request.headers["x-upload-id"];
    const chunkIndex = Number(request.headers["x-chunk-index"]);
    if (typeof uploadId !== "string" || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return reply.code(400).send({ error: "Missing or invalid x-upload-id / x-chunk-index" });
    }

    const buffer = request.body as Buffer;
    if (!buffer || buffer.length === 0) {
      return reply.code(400).send({ error: "Empty chunk" });
    }

    try {
      await writeChunk(uploadId, chunkIndex, buffer);
      return reply.send({ ok: true });
    } catch (err) {
      console.error("[Routes] Failed to write audio chunk:", err instanceof Error ? err.message : err);
      return reply.code(400).send({ error: "Failed to write chunk" });
    }
  });

  app.post("/api/lecture/audio-chunk/finalize", async (request, reply) => {
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

    const body = request.body as
      | Partial<{
          uploadId: string;
          totalChunks: number;
          language: string;
          existingGlossary: GlossaryEntry[];
          sttProvider: unknown;
        }>
      | undefined;
    const uploadId = body?.uploadId;
    const totalChunks = body?.totalChunks;
    if (typeof uploadId !== "string" || typeof totalChunks !== "number" || !Number.isInteger(totalChunks) || totalChunks <= 0) {
      return reply.code(400).send({ error: "Missing uploadId or totalChunks" });
    }
    const language = body?.language ?? "fr";
    const existingGlossary = Array.isArray(body?.existingGlossary) ? body.existingGlossary : [];
    const resolved = resolveBatchStt(body?.sttProvider);
    if (!resolved.ok) {
      await cleanupUpload(uploadId).catch(() => {});
      return reply.code(400).send({ error: resolved.error });
    }

    try {
      const buffer = await assembleUpload(uploadId, totalChunks);
      try {
        const transcript = await runTranscription(buffer, language, existingGlossary, resolved.batchStt);
        return reply.send({ transcript });
      } catch (err) {
        console.error("[Routes] Audio transcription failed:", err instanceof Error ? err.message : err);
        return reply.code(502).send({ error: "Audio transcription failed" });
      }
    } catch (err) {
      console.error("[Routes] Failed to assemble chunked upload:", err instanceof Error ? err.message : err);
      return reply.code(400).send({ error: "Failed to assemble upload" });
    } finally {
      await cleanupUpload(uploadId).catch(() => {});
    }
  });

  app.post("/api/lecture/analyze-pdf", async (request, reply) => {
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
      return reply.code(400).send({ error: "Unsupported or missing file (PDF only)" });
    }
    const isPdf = file && (file.mimetype === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf"));
    if (!file || !isPdf) {
      return reply.code(400).send({ error: "Unsupported or missing file (PDF only)" });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(400).send({ error: "Failed to read uploaded file" });
    }

    let pages: Awaited<ReturnType<typeof extractPdfPages>>;
    try {
      pages = await extractPdfPages(buffer);
    } catch {
      return reply.code(400).send({ error: "Failed to parse PDF content" });
    }

    const hasExtractableText = pages.some((page) => page.text.trim().length > 0);

    try {
      const analysis = hasExtractableText
        ? await analyzePdf(file.filename, pages, (system, user) =>
            callClaudeJSON(system, user, "claude-sonnet-5", 32000, undefined, true)
          )
        : await analyzePdfOcr(file.filename, Math.max(pages.length, 1), (system, user) =>
            callClaudeJSONWithPdf(system, user, buffer.toString("base64"), "claude-sonnet-5", 32000, undefined, true)
          );
      return reply.send(analysis);
    } catch (err) {
      console.error("[Routes] PDF analysis failed:", err instanceof Error ? err.message : err);
      return reply.code(502).send({ error: "PDF analysis failed" });
    }
  });

  app.post("/api/lecture/rewrite-pass2", async (request, reply) => {
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

    const body = request.body as Partial<Pass2Input> | undefined;
    if (!body || !Array.isArray(body.transcript) || body.transcript.length === 0 || !body.course || !Array.isArray(body.plan)) {
      return reply.code(400).send({ error: "Missing transcript, course context, or plan" });
    }

    if (body.pdfAnalyses !== undefined) {
      if (!Array.isArray(body.pdfAnalyses)) {
        return reply.code(400).send({ error: "Invalid pdfAnalyses" });
      }
      for (const entry of body.pdfAnalyses) {
        if (!pdfAnalysisSchema.safeParse(entry).success) {
          return reply.code(400).send({ error: "Invalid pdfAnalyses" });
        }
      }
    }

    const input: Pass2Input = {
      transcript: body.transcript,
      course: body.course,
      plan: body.plan,
      glossary: Array.isArray(body.glossary) ? body.glossary : [],
      references: Array.isArray(body.references) ? body.references : [],
      uncertainZones: Array.isArray(body.uncertainZones) ? body.uncertainZones : [],
      pdfAnalyses: body.pdfAnalyses,
    };

    let hijacked = false;
    function ensureHijacked() {
      if (!hijacked) {
        hijacked = true;
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        });
      }
    }

    try {
      await rewritePass2(
        input,
        (system, user, onChunk) => streamAssist(system, user, onChunk, "claude-sonnet-5", 32000, undefined, true),
        (chunk) => {
          ensureHijacked();
          reply.raw.write(chunk);
        }
      );
      if (hijacked) {
        reply.raw.end();
      } else {
        reply.send("");
      }
    } catch (err) {
      console.error("[Routes] Lecture pass2 rewrite failed:", err instanceof Error ? err.message : err);
      if (hijacked) {
        reply.raw.destroy();
      } else {
        reply.code(502).send({ error: "Lecture pass2 rewrite failed" });
      }
    }
  });

  app.post("/api/lecture/condense", async (request, reply) => {
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

    const body = request.body as
      | Partial<{ course: CourseContext; plan: LectureSection[]; document: string; mode: CondenseMode }>
      | undefined;
    if (
      !body ||
      !body.course ||
      !Array.isArray(body.plan) ||
      typeof body.document !== "string" ||
      body.document.length === 0
    ) {
      return reply.code(400).send({ error: "Missing course context, plan, or document" });
    }
    if (body.mode !== "synthesis" && body.mode !== "revision") {
      return reply.code(400).send({ error: "Invalid mode (expected synthesis or revision)" });
    }

    let hijacked = false;
    function ensureHijacked() {
      if (!hijacked) {
        hijacked = true;
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        });
      }
    }

    try {
      await condenseCourse(
        body.mode,
        { course: body.course, plan: body.plan, document: body.document },
        (system, user, onChunk) => streamAssist(system, user, onChunk, "claude-sonnet-5", 8192, undefined, true),
        (chunk) => {
          ensureHijacked();
          reply.raw.write(chunk);
        }
      );
      if (hijacked) {
        reply.raw.end();
      } else {
        reply.send("");
      }
    } catch (err) {
      console.error("[Routes] Lecture condense failed:", err instanceof Error ? err.message : err);
      if (hijacked) {
        reply.raw.destroy();
      } else {
        reply.code(502).send({ error: "Lecture condense failed" });
      }
    }
  });
}
