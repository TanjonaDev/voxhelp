import { z } from "zod";
import type { Pass1Output } from "./types.js";

const glossaryCategorySchema = z.enum([
  "proper_noun",
  "technical_term",
  "concept",
  "acronym",
  "foreign_term",
]);

const sectionTypeSchema = z.enum(["content", "digression", "student_question", "administrative"]);

const referenceTypeSchema = z.enum(["author", "work", "article", "scripture", "date", "concept"]);

const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  heardVariants: z.array(z.string()),
  category: glossaryCategorySchema,
  sourceLanguage: z.string().optional(),
  shortDefinition: z.string().optional(),
  occurrences: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});

const lectureSectionSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  oneLineSummary: z.string().max(120),
  type: sectionTypeSchema,
  confidence: z.number().min(0).max(1),
});

const referenceSchema = z.object({
  type: referenceTypeSchema,
  rawCitation: z.string().min(1),
  normalized: z.string().optional(),
  contextMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});

const uncertainZoneSchema = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  excerpt: z.string(),
  reason: z.string().min(1),
});

export const pass1OutputSchema = z.object({
  detectedLanguage: z.string().min(1),
  transcriptQuality: z.number().min(0).max(1),
  plan: z.array(lectureSectionSchema),
  glossary: z.array(glossaryEntrySchema),
  references: z.array(referenceSchema),
  uncertainZones: z.array(uncertainZoneSchema),
});

export function parsePass1Output(raw: unknown): Pass1Output {
  return pass1OutputSchema.parse(raw) as Pass1Output;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`)
    .join("\n");
}
