import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client.js";
import { verifyJwt } from "../middleware/auth.js";
import { buildQuestionGenPrompt } from "../services/prompts/question-gen.js";
import { buildScorecardGenPrompt } from "../services/prompts/scorecard-gen.js";
import { buildSummaryPrompt } from "../services/prompts/summary.js";
import { buildScoringPrompt } from "../services/prompts/scoring.js";
import { callLlmJson } from "../services/llm.js";

export async function interviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", verifyJwt);

  // GET /api/interviews
  app.get("/api/interviews", async (request) => {
    const { orgId } = request.user;
    const interviews = await prisma.interview.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      include: { scorecard: { select: { overallScore: true, recommendation: true } } },
    });
    return interviews.map((i) => ({
      id: i.id,
      title: i.title,
      candidateName: i.candidateName,
      status: i.status,
      scheduledAt: i.scheduledAt?.toISOString() ?? null,
      overallScore: i.scorecard?.overallScore ?? null,
      recommendation: i.scorecard?.recommendation ?? null,
      createdAt: i.createdAt.toISOString(),
    }));
  });

  // POST /api/interviews
  app.post("/api/interviews", async (request, reply) => {
    const { orgId, userId } = request.user;
    const body = request.body as {
      title: string;
      candidateName: string;
      candidateEmail?: string;
      language?: string;
      jobDescription?: string;
      techStack?: string;
      cvContent?: string;
      scheduledAt?: string;
    };

    const interview = await prisma.interview.create({
      data: {
        title: body.title,
        candidateName: body.candidateName,
        candidateEmail: body.candidateEmail,
        language: body.language ?? "fr",
        jobDescription: body.jobDescription,
        techStack: body.techStack,
        cvContent: body.cvContent,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        orgId,
        userId,
      },
    });

    return reply.code(201).send(interview);
  });

  // GET /api/interviews/:id
  app.get("/api/interviews/:id", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const interview = await prisma.interview.findFirst({
      where: { id, orgId },
      include: {
        questions: { orderBy: { order: "asc" }, include: { answer: true } },
        scorecard: { include: { criteria: true } },
        summary: true,
      },
    });

    if (!interview) return reply.code(404).send({ error: "Not found" });
    return interview;
  });

  // PUT /api/interviews/:id
  app.put("/api/interviews/:id", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const existing = await prisma.interview.findFirst({ where: { id, orgId } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const body = request.body as {
      title?: string;
      candidateName?: string;
      candidateEmail?: string;
      language?: string;
      jobDescription?: string;
      techStack?: string;
      cvContent?: string;
      scheduledAt?: string;
    };

    const updated = await prisma.interview.update({
      where: { id },
      data: {
        ...body,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      },
    });

    return updated;
  });

  // DELETE /api/interviews/:id
  app.delete("/api/interviews/:id", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const existing = await prisma.interview.findFirst({ where: { id, orgId } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    await prisma.interview.delete({ where: { id } });
    return reply.code(204).send();
  });

  // PATCH /api/interviews/:id/status
  app.patch("/api/interviews/:id/status", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const existing = await prisma.interview.findFirst({ where: { id, orgId } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const data: Record<string, unknown> = { status };
    if (status === "LIVE" && !existing.startedAt) data.startedAt = new Date();
    if ((status === "REVIEW" || status === "COMPLETED") && !existing.endedAt) data.endedAt = new Date();

    const updated = await prisma.interview.update({ where: { id }, data });
    return updated;
  });

  // POST /api/interviews/:id/generate-questions
  app.post("/api/interviews/:id/generate-questions", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const interview = await prisma.interview.findFirst({ where: { id, orgId } });
    if (!interview) return reply.code(404).send({ error: "Not found" });
    if (!interview.jobDescription) return reply.code(422).send({ error: "jobDescription required" });

    const prompt = buildQuestionGenPrompt(interview.jobDescription, interview.techStack, interview.cvContent);
    const result = await callLlmJson<{ questions: { text: string; category: string; difficulty: string; expectedAnswer?: string }[] }>(
      prompt.system,
      prompt.user
    );

    await prisma.question.deleteMany({ where: { interviewId: id } });
    await prisma.question.createMany({
      data: result.questions.map((q, idx) => ({
        text: q.text,
        category: q.category as never,
        difficulty: q.difficulty as never,
        expectedAnswer: q.expectedAnswer,
        order: idx + 1,
        interviewId: id,
      })),
    });

    const questions = await prisma.question.findMany({
      where: { interviewId: id },
      orderBy: { order: "asc" },
    });
    return questions;
  });

  // POST /api/interviews/:id/generate-scorecard
  app.post("/api/interviews/:id/generate-scorecard", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const interview = await prisma.interview.findFirst({ where: { id, orgId } });
    if (!interview) return reply.code(404).send({ error: "Not found" });
    if (!interview.jobDescription) return reply.code(422).send({ error: "jobDescription required" });

    const prompt = buildScorecardGenPrompt(interview.jobDescription, interview.techStack);
    const result = await callLlmJson<{ criteria: { name: string; description?: string; weight: number }[] }>(
      prompt.system,
      prompt.user
    );

    const existing = await prisma.scorecard.findUnique({ where: { interviewId: id } });
    if (existing) {
      await prisma.scorecard.delete({ where: { interviewId: id } });
    }

    const scorecard = await prisma.scorecard.create({
      data: {
        interviewId: id,
        criteria: {
          create: result.criteria.map((c) => ({
            name: c.name,
            description: c.description,
            weight: c.weight,
          })),
        },
      },
      include: { criteria: true },
    });

    return scorecard;
  });

  // POST /api/interviews/:id/generate-summary
  app.post("/api/interviews/:id/generate-summary", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const interview = await prisma.interview.findFirst({
      where: { id, orgId },
      include: { questions: true, transcript: { orderBy: { timestamp: "asc" } } },
    });
    if (!interview) return reply.code(404).send({ error: "Not found" });

    const prompt = buildSummaryPrompt(
      interview.transcript.map((t) => ({ text: t.text, speaker: t.speaker })),
      interview.jobDescription,
      interview.questions.map((q) => ({ text: q.text, expectedAnswer: q.expectedAnswer ?? null }))
    );
    const result = await callLlmJson<{
      summary: string;
      strengths: string[];
      weaknesses: string[];
      redFlags: string[];
      keyTopics: string[];
      followUpActions: string[];
    }>(prompt.system, prompt.user);

    const existing = await prisma.interviewSummary.findUnique({ where: { interviewId: id } });
    if (existing) await prisma.interviewSummary.delete({ where: { interviewId: id } });

    const summary = await prisma.interviewSummary.create({
      data: { interviewId: id, ...result },
    });
    return summary;
  });

  // POST /api/interviews/:id/generate-scoring
  app.post("/api/interviews/:id/generate-scoring", async (request, reply) => {
    const { orgId } = request.user;
    const { id } = request.params as { id: string };

    const interview = await prisma.interview.findFirst({
      where: { id, orgId },
      include: {
        questions: true,
        transcript: { orderBy: { timestamp: "asc" } },
        scorecard: { include: { criteria: true } },
      },
    });
    if (!interview) return reply.code(404).send({ error: "Not found" });
    if (!interview.scorecard) return reply.code(422).send({ error: "Generate scorecard first" });

    const prompt = buildScoringPrompt(
      interview.transcript.map((t) => ({ text: t.text, speaker: t.speaker })),
      interview.scorecard.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        weight: c.weight,
      })),
      interview.questions.map((q) => ({ text: q.text, expectedAnswer: q.expectedAnswer ?? null }))
    );
    const result = await callLlmJson<{
      scores: { criterionId: string; score: number; notes: string }[];
      overallScore: number;
      recommendation: string;
    }>(prompt.system, prompt.user);

    await Promise.all(
      result.scores.map((s) =>
        prisma.scorecardCriterion.update({
          where: { id: s.criterionId },
          data: { score: s.score, notes: s.notes },
        })
      )
    );

    const scorecard = await prisma.scorecard.update({
      where: { id: interview.scorecard.id },
      data: { overallScore: result.overallScore, recommendation: result.recommendation as never },
      include: { criteria: true },
    });
    return scorecard;
  });
}
