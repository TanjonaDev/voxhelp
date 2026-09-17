import type { Pass1Input, Pass1Output } from "./types.js";
import { buildPass1SystemPrompt, buildPass1UserPrompt, buildPass1RetryPrompt } from "./prompts.js";
import { pass1OutputSchema, formatZodError } from "./schemas.js";
import { needsWindowing, splitIntoWindows, mergePlans } from "./windowing.js";
import { mergeGlossary, selectNewGlossaryEntries } from "./postprocess.js";

export type CallJSON = (system: string, user: string) => Promise<unknown>;

const ONE_LINE_SUMMARY_MAX = 120;

/**
 * The prompt asks for oneLineSummary <= 120 chars, but an LLM can't reliably
 * count characters — real run: it went over by a handful of chars, and the
 * schema rejected it on both the first attempt and the retry, burning ~4
 * minutes before failing outright for what is just a display truncation.
 * Clamp it defensively before validating instead of trusting the count.
 */
function clampOneLineSummaries(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).plan)) return raw;
  const plan = (raw as Record<string, unknown>).plan as unknown[];
  const clampedPlan = plan.map((section) => {
    if (!section || typeof section !== "object") return section;
    const summary = (section as Record<string, unknown>).oneLineSummary;
    if (typeof summary !== "string" || summary.length <= ONE_LINE_SUMMARY_MAX) return section;
    return { ...section, oneLineSummary: `${summary.slice(0, ONE_LINE_SUMMARY_MAX - 1)}…` };
  });
  return { ...raw, plan: clampedPlan };
}

async function analyzeSingleCall(input: Pass1Input, callJSON: CallJSON): Promise<Pass1Output> {
  const system = buildPass1SystemPrompt();
  const userPrompt = buildPass1UserPrompt(input);

  const first = await callJSON(system, userPrompt);
  const firstResult = pass1OutputSchema.safeParse(clampOneLineSummaries(first));
  if (firstResult.success) return firstResult.data;

  const retryPrompt = buildPass1RetryPrompt(userPrompt, formatZodError(firstResult.error));
  const second = await callJSON(system, retryPrompt);
  const secondResult = pass1OutputSchema.safeParse(clampOneLineSummaries(second));
  if (secondResult.success) return secondResult.data;

  throw new Error(`Pass 1 analysis failed after retry: ${formatZodError(secondResult.error)}`);
}

export async function analyzePass1(input: Pass1Input, callJSON: CallJSON): Promise<Pass1Output> {
  if (!needsWindowing(input.transcript)) {
    return analyzeSingleCall(input, callJSON);
  }

  const windows = splitIntoWindows(input.transcript);
  let consolidatedGlossary = input.existingGlossary;
  const plans: Pass1Output["plan"][] = [];
  const allReferences: Pass1Output["references"] = [];
  const allUncertainZones: Pass1Output["uncertainZones"] = [];
  const qualityScores: number[] = [];
  let detectedLanguage = input.course.language;

  for (const windowSegments of windows) {
    const windowOutput = await analyzeSingleCall(
      { ...input, transcript: windowSegments, existingGlossary: consolidatedGlossary },
      callJSON
    );
    consolidatedGlossary = mergeGlossary(consolidatedGlossary, windowOutput.glossary);
    plans.push(windowOutput.plan);
    allReferences.push(...windowOutput.references);
    allUncertainZones.push(...windowOutput.uncertainZones);
    qualityScores.push(windowOutput.transcriptQuality);
    detectedLanguage = windowOutput.detectedLanguage;
  }

  return {
    detectedLanguage,
    transcriptQuality: qualityScores.reduce((sum, quality) => sum + quality, 0) / qualityScores.length,
    plan: mergePlans(plans),
    glossary: selectNewGlossaryEntries(input.existingGlossary, consolidatedGlossary),
    references: allReferences,
    uncertainZones: allUncertainZones,
  };
}
