import { z } from "zod";
import type { PdfAnalysis } from "./types.js";

const pdfBlockTypeSchema = z.enum(["heading", "paragraph", "citation", "table", "exercise"]);

const pdfBlockSchema = z.object({
  page: z.number().int().positive(),
  type: pdfBlockTypeSchema,
  anchorTitle: z.string().optional(),
  content: z.string().min(1),
  reference: z.string().optional(),
});

export const pdfAnalysisSchema = z.object({
  sourceFilename: z.string().min(1),
  blocks: z.array(pdfBlockSchema),
});

export function parsePdfAnalysis(raw: unknown): PdfAnalysis {
  return pdfAnalysisSchema.parse(raw) as PdfAnalysis;
}
