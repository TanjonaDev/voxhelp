import type { PdfAnalysis, PdfPage } from "./types.js";
import {
  buildPdfAnalysisSystemPrompt,
  buildPdfAnalysisUserPrompt,
  buildPdfOcrAnalysisUserPrompt,
  buildPdfAnalysisRetryPrompt,
} from "./prompts.js";
import { pdfAnalysisSchema } from "./schemas.js";
import { formatZodError } from "../schemas.js";

export type CallJSON = (system: string, user: string) => Promise<unknown>;

type ValidationOutcome = { success: true; data: PdfAnalysis } | { success: false; errorMessage: string };

/**
 * callJSON can throw instead of returning invalid data — e.g. a response
 * truncated at maxTokens breaks JSON.parse before schema validation even
 * runs (real run: a dense Word-exported PDF hit this). Without this, that
 * exception would skip the retry entirely and fail outright on the first
 * attempt. Treat a thrown parse error the same as a validation failure, and
 * nudge the retry toward brevity since truncation, not shape, was the cause.
 */
async function callAndValidate(system: string, prompt: string, callJSON: CallJSON): Promise<ValidationOutcome> {
  let raw: unknown;
  try {
    raw = await callJSON(system, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorMessage: `Réponse illisible (${message}) — probablement tronquée avant la fin du JSON. Sois plus concis (moins de blocs, contenu plus court par bloc) pour tenir dans la limite de tokens.`,
    };
  }
  const result = pdfAnalysisSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return { success: false, errorMessage: formatZodError(result.error) };
}

async function runAnalysisWithRetry(system: string, userPrompt: string, callJSON: CallJSON): Promise<PdfAnalysis> {
  const first = await callAndValidate(system, userPrompt, callJSON);
  if (first.success) return first.data;

  const retryPrompt = buildPdfAnalysisRetryPrompt(userPrompt, first.errorMessage);
  const second = await callAndValidate(system, retryPrompt, callJSON);
  if (second.success) return second.data;

  throw new Error(`PDF analysis failed after retry: ${second.errorMessage}`);
}

export async function analyzePdf(
  sourceFilename: string,
  pages: PdfPage[],
  callJSON: CallJSON
): Promise<PdfAnalysis> {
  const system = buildPdfAnalysisSystemPrompt();
  const userPrompt = buildPdfAnalysisUserPrompt(sourceFilename, pages);
  return runAnalysisWithRetry(system, userPrompt, callJSON);
}

/**
 * Same output schema as analyzePdf, but for scanned/image-only PDFs with no
 * extractable text layer: the caller must attach the raw PDF as a document
 * block on callJSON's request (Claude reads it visually, no OCR engine needed).
 */
export async function analyzePdfOcr(
  sourceFilename: string,
  pageCount: number,
  callJSON: CallJSON
): Promise<PdfAnalysis> {
  const system = buildPdfAnalysisSystemPrompt();
  const userPrompt = buildPdfOcrAnalysisUserPrompt(sourceFilename, pageCount);
  return runAnalysisWithRetry(system, userPrompt, callJSON);
}
