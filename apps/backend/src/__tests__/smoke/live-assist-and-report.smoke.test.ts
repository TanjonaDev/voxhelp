import { describe, it, expect } from "vitest";
import type { CandidateReport, Insight, TranscriptEntry } from "@voxhelp/shared";
import { createId } from "@voxhelp/shared";
import { buildLiveAssistPrompt, buildFinalAnalysisPrompt } from "@voxhelp/recruit";
import { streamAssist, callClaudeJSON, correctTranscript } from "../../llm.js";
import { extractThemeAndAngle, parseAssistText } from "../../insight-parsing.js";
import { normalizeSkillMatchStatus, normalizeVerdict } from "../../report-normalize.js";
import { interviewScenarios, type InterviewScenario } from "./fixtures/interview-scenarios.js";
import { verifyCardHeaderStrict, verifySkipExpectation, verifyReport, printResults, failuresOf } from "./verify.js";

// Smoke test opt-in : appelle le vrai Claude (correction STT en Haiku,
// live-assist en Haiku, bilan en Sonnet) sur des scénarios réalistes +
// adversariaux (transcript dégradé, stack visée jamais abordée à l'oral,
// questions recruteur seules, session vide), pour valider ce que Claude
// renvoie réellement — pas un mock. Voir
// README.md du dossier. Exclu de `pnpm test` (vitest.config.ts) ; lancé via
// `pnpm test:smoke`.
//
// La boucle par tour reproduit intentionnellement la logique de
// Session.processTranscript (merge par thème, tracking d'angle) — c'est de
// l'orchestration de test, pas le contrat d'interprétation du texte de
// Claude (parseAssistText/extractThemeAndAngle, eux, sont importés depuis la
// prod pour ne jamais diverger). Si Session.processTranscript change sa
// règle de merge, garder ce fichier synchronisé.

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("smoke: live-assist + final report (real Claude)", () => {
  it.each(interviewScenarios)("$name", async (scenario: InterviewScenario) => {
    const conversationLog: string[] = [];
    const relanceLog: string[] = [];
    const cardLog: Insight[] = [];
    const fullTranscriptLog: TranscriptEntry[] = [];
    let lastTheme: string | null = null;
    let coveredAngles = new Set<string>();
    let themeCardCount = 0;
    const allCardResults = [];

    for (const turn of scenario.turns) {
      // Mirrors Session.handleFinalTranscript : la correction Haiku tourne sur
      // TOUT ce qui arrive du STT, avant live-assist — un texte dégradé (fixture
      // "stt-garbled-transcription") ne devrait donc jamais atteindre live-assist
      // brut en production.
      const sttContext = scenario.jobContext
        ? `${scenario.jobContext.title || ""} ${scenario.jobContext.stack || ""}`.trim()
        : undefined;
      const correctedText = await correctTranscript(turn.text, sttContext);
      if (correctedText !== turn.text) {
        console.log(`  [correctTranscript] "${turn.text}" -> "${correctedText}"`);
      }

      fullTranscriptLog.push({ t: turn.t, text: correctedText });
      conversationLog.push(correctedText);

      const prompt = buildLiveAssistPrompt(
        scenario.jobContext,
        conversationLog,
        relanceLog,
        cardLog,
        lastTheme,
        Array.from(coveredAngles),
        themeCardCount,
        scenario.candidateName
      );
      const fullText = await streamAssist(prompt, `Ce qui vient d'être dit :\n"${correctedText}"`, () => {});

      allCardResults.push(verifySkipExpectation(fullText, turn));

      if (fullText.trim().toLowerCase().startsWith("[skip]")) {
        continue;
      }
      allCardResults.push(verifyCardHeaderStrict(fullText));

      const card = parseAssistText(fullText, createId(), turn.t);
      if (card.relance) relanceLog.push(card.relance);

      const lastCard = cardLog[cardLog.length - 1];
      const canMerge = !!lastCard && !!card.theme && card.theme === lastCard.theme && !lastCard.relance;
      if (canMerge) {
        cardLog[cardLog.length - 1] = { ...card, id: lastCard.id, t: lastCard.t };
      } else {
        cardLog.push(card);
      }

      const { theme, angle } = extractThemeAndAngle(fullText);
      if (theme && theme === lastTheme) {
        themeCardCount += 1;
        if (angle && angle !== "none") coveredAngles.add(angle);
      } else {
        lastTheme = theme;
        themeCardCount = theme ? 1 : 0;
        coveredAngles = new Set(angle && angle !== "none" ? [angle] : []);
      }
    }

    printResults(`${scenario.name} — cards`, allCardResults);
    console.log(cardLog.map((c) => `[${c.cat}] [${c.status}] [${c.theme}] "${c.title}" — ${c.body}`).join("\n"));

    type GeneratedReportFields = Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel">;
    const generated = await callClaudeJSON<GeneratedReportFields>(
      buildFinalAnalysisPrompt(scenario.jobContext, cardLog, fullTranscriptLog, scenario.candidateName),
      "Génère la fiche de qualification du candidat.",
      "claude-sonnet-4-6",
      8192
    );
    const report: CandidateReport = {
      ...generated,
      techMatching: (generated.techMatching ?? []).map((m) => ({ ...m, status: normalizeSkillMatchStatus(m.status) })),
      strengths: generated.strengths ?? [],
      attentionPoints: generated.attentionPoints ?? [],
      keyProjects: generated.keyProjects ?? [],
      verdict: normalizeVerdict(generated.verdict),
      verdictChecklist: generated.verdictChecklist ?? [],
      nextSteps: generated.nextSteps ?? [],
      suggestedQuestions: generated.suggestedQuestions ?? [],
      candidateName: scenario.candidateName?.trim() || "Candidat",
      jobTitle: scenario.jobContext?.title?.trim() || "Poste non précisé",
      interviewDate: new Date().toISOString(),
      durationLabel: "5 min",
    };

    console.log(`\n--- ${scenario.name} — bilan brut ---`);
    console.log(JSON.stringify(report, null, 2));

    const reportResults = verifyReport(report, fullTranscriptLog, scenario);
    printResults(`${scenario.name} — bilan (checks)`, reportResults);

    const allFailures = [...failuresOf(allCardResults), ...failuresOf(reportResults)];
    expect(
      allFailures,
      `${allFailures.length} check(s) échoué(s) pour "${scenario.name}" :\n${allFailures
        .map((f) => `- ${f.name}: ${f.detail}`)
        .join("\n")}`
    ).toEqual([]);
  });
});
