import type { PdfAnalysis, PdfPage } from "./types.js";
import { buildPdfAnalysisSystemPrompt, buildPdfAnalysisUserPrompt, buildPdfAnalysisRetryPrompt } from "./prompts.js";
import { pdfAnalysisSchema } from "./schemas.js";
import { formatZodError } from "../schemas.js";

export type CallJSON = (system: string, user: string) => Promise<unknown>;

export async function analyzePdf(
  sourceFilename: string,
  pages: PdfPage[],
  callJSON: CallJSON
): Promise<PdfAnalysis> {
  const system = buildPdfAnalysisSystemPrompt();
  const userPrompt = buildPdfAnalysisUserPrompt(sourceFilename, pages);

  const first = await callJSON(system, userPrompt);
  const firstResult = pdfAnalysisSchema.safeParse(first);
  if (firstResult.success) return firstResult.data;

  const retryPrompt = buildPdfAnalysisRetryPrompt(userPrompt, formatZodError(firstResult.error));
  const second = await callJSON(system, retryPrompt);
  const secondResult = pdfAnalysisSchema.safeParse(second);
  if (secondResult.success) return secondResult.data;

  throw new Error(`PDF analysis failed after retry: ${formatZodError(secondResult.error)}`);
}
