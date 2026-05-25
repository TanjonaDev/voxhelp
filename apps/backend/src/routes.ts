import type { FastifyInstance } from "fastify";
import type {
  JobAnalysis,
  GeneratedQuestion,
  InterviewReport,
  ScorecardCriterion,
} from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { callClaudeJSON } from "./llm.js";
import { buildJobAnalysisPrompt } from "./prompts/job-analysis.js";
import { buildReportPrompt } from "./prompts/report.js";

interface RawJobAnalysis {
  summary: string;
  criticalSkills: { name: string; why: string }[];
  niceToHave: string[];
  questions: {
    text: string;
    category: string;
    difficulty: string;
    expectedAnswer: string;
  }[];
  scorecard: {
    name: string;
    description: string;
    weight: number;
  }[];
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/analyze-job", async (request, reply) => {
    const { jobDescription, techStack } = request.body as {
      jobDescription: string;
      techStack?: string;
    };

    if (!jobDescription?.trim()) {
      return reply.status(400).send({ error: "jobDescription is required" });
    }

    try {
      const { system, user } = buildJobAnalysisPrompt(jobDescription, techStack);
      const raw = await callClaudeJSON<RawJobAnalysis>(system, user);

      const analysis: JobAnalysis = {
        summary: raw.summary,
        criticalSkills: raw.criticalSkills,
        niceToHave: raw.niceToHave,
        questions: raw.questions.map((q) => ({
          id: createId(),
          text: q.text,
          category: q.category as GeneratedQuestion["category"],
          difficulty: q.difficulty as GeneratedQuestion["difficulty"],
          expectedAnswer: q.expectedAnswer,
          isAsked: false,
        })),
        scorecard: raw.scorecard.map((c) => ({
          id: createId(),
          name: c.name,
          description: c.description,
          weight: c.weight,
          score: null,
          notes: null,
        })),
      };

      return analysis;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[routes] analyze-job error:", msg);
      return reply.status(500).send({ error: msg });
    }
  });

  app.post("/api/generate-report", async (request, reply) => {
    const { jobDescription, transcript, scorecard } = request.body as {
      jobDescription: string;
      transcript: { text: string; timestamp: number }[];
      scorecard: ScorecardCriterion[];
    };

    if (!jobDescription?.trim()) {
      return reply.status(400).send({ error: "jobDescription is required" });
    }

    try {
      const { system, user } = buildReportPrompt(jobDescription, transcript ?? [], scorecard ?? []);
      const report = await callClaudeJSON<InterviewReport>(system, user);
      return report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[routes] generate-report error:", msg);
      return reply.status(500).send({ error: msg });
    }
  });
}
