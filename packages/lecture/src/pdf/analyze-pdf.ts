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

async function runAnalysisWithRetry(system: string, userPrompt: string, callJSON: CallJSON): Promise<PdfAnalysis> {
  const first = await callJSON(system, userPrompt);
  const firstResult = pdfAnalysisSchema.safeParse(first);
  if (firstResult.success) return firstResult.data;

  const retryPrompt = buildPdfAnalysisRetryPrompt(userPrompt, formatZodError(firstResult.error));
  const second = await callJSON(system, retryPrompt);
  const secondResult = pdfAnalysisSchema.safeParse(second);
  if (secondResult.success) return secondResult.data;

  throw new Error(`PDF analysis failed after retry: ${formatZodError(secondResult.error)}`);
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
