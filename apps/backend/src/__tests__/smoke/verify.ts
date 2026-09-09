import type { CandidateReport, Citation, TranscriptEntry } from "@voxhelp/shared";
import type { InterviewScenario, InterviewTurn } from "./fixtures/interview-scenarios.js";

// Vérifications déterministes anti-hallucination sur les sorties réelles de
// Claude — pas de LLM-juge : chaque check est un match de chaîne/regex/enum
// vérifiable sans ambiguïté. Le but n'est pas de tout couvrir (le ton, la
// pertinence restent à relire humainement via les logs imprimés par les
// tests) mais d'attraper les invariants qu'on ne veut JAMAIS voir violés :
// citation inventée, timestamp qui ne correspond à rien, compétence jamais
// abordée présentée comme démontrée, prénom halluciné.

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function ok(name: string): CheckResult {
  return { name, pass: true };
}

function fail(name: string, detail: string): CheckResult {
  return { name, pass: false, detail };
}

/**
 * Une citation doit être copiée mot pour mot depuis une ligne du transcript,
 * avec le "t" exact de cette ligne — c'est la règle absolue du prompt
 * final-analysis. On vérifie ici que Claude l'a bien respectée.
 */
export function verifyCitationVerbatim(
  label: string,
  citation: Citation,
  transcriptLog: TranscriptEntry[]
): CheckResult {
  const quote = normalizeWhitespace(citation.quote);
  const matchingEntry = transcriptLog.find((entry) => normalizeWhitespace(entry.text).includes(quote));

  if (!matchingEntry) {
    return fail(label, `citation introuvable mot pour mot dans le transcript : "${citation.quote}"`);
  }
  if (matchingEntry.t !== citation.t) {
    return fail(
      label,
      `timestamp incohérent : citation.t="${citation.t}" mais la ligne source a t="${matchingEntry.t}" ("${matchingEntry.text}")`
    );
  }
  return ok(label);
}

function collectCitations(report: CandidateReport): Array<{ label: string; citation: Citation }> {
  const out: Array<{ label: string; citation: Citation }> = [];
  report.strengths.forEach((s, i) => out.push({ label: `strengths[${i}]`, citation: s.citation }));
  report.attentionPoints.forEach((a, i) => {
    if (a.citation) out.push({ label: `attentionPoints[${i}]`, citation: a.citation });
  });
  report.techMatching.forEach((m, i) => {
    if (m.citation) out.push({ label: `techMatching[${i}] (${m.skill})`, citation: m.citation });
  });
  return out;
}

/**
 * Une compétence listée dans la stack visée mais jamais mentionnée par le
 * candidat (scenario.neverSpoken) doit rester "non-aborde", sans citation.
 * C'est le check qui attrape le biais le plus probable : broder sur la fiche
 * de poste plutôt que sur ce qui a réellement été dit.
 */
export function verifyNeverSpokenSkills(report: CandidateReport, neverSpoken: string[]): CheckResult[] {
  return neverSpoken.map((skillName) => {
    const label = `neverSpoken:${skillName}`;
    const match = report.techMatching.find((m) => m.skill.toLowerCase().includes(skillName.toLowerCase()));
    if (!match) {
      // Absent de techMatching = pas de status inventé, c'est acceptable.
      return ok(label);
    }
    if (match.status !== "non-aborde") {
      return fail(label, `status="${match.status}" alors que "${skillName}" n'a jamais été abordé — evidence: "${match.evidence}"`);
    }
    if (match.citation) {
      return fail(label, `citation présente pour un skill jamais abordé : "${match.citation.quote}"`);
    }
    return ok(label);
  });
}

export function verifyCandidateNameDefault(report: CandidateReport, candidateNameGiven?: string): CheckResult {
  const label = "candidateName:no-invented-name";
  if (candidateNameGiven) {
    return report.candidateName === candidateNameGiven
      ? ok(label)
      : fail(label, `candidateName="${report.candidateName}" attendu "${candidateNameGiven}"`);
  }
  return report.candidateName === "Candidat"
    ? ok(label)
    : fail(label, `aucun prénom fourni mais candidateName="${report.candidateName}" (prénom halluciné ?)`);
}

const VALID_VERDICTS = new Set(["presenter", "presenter-avec-reserve", "ne-pas-presenter"]);
const VALID_SKILL_STATUSES = new Set(["demontre", "mentionne", "non-aborde"]);

export function verifyEnumsValid(report: CandidateReport): CheckResult[] {
  const results: CheckResult[] = [];
  results.push(
    VALID_VERDICTS.has(report.verdict) ? ok("verdict:valid-enum") : fail("verdict:valid-enum", `verdict="${report.verdict}"`)
  );
  report.techMatching.forEach((m, i) => {
    results.push(
      VALID_SKILL_STATUSES.has(m.status)
        ? ok(`techMatching[${i}]:valid-status`)
        : fail(`techMatching[${i}]:valid-status`, `status="${m.status}"`)
    );
  });
  return results;
}

/** Règle explicite du prompt : transcript vide/quasi vide → tout non-aborde, verdict prudent, aucune citation. */
export function verifyEmptySessionRule(report: CandidateReport): CheckResult[] {
  const results: CheckResult[] = [];
  results.push(
    report.verdict === "presenter-avec-reserve"
      ? ok("empty-session:verdict-prudent")
      : fail("empty-session:verdict-prudent", `verdict="${report.verdict}" attendu "presenter-avec-reserve"`)
  );
  const nonAllNonAborde = report.techMatching.filter((m) => m.status !== "non-aborde");
  results.push(
    nonAllNonAborde.length === 0
      ? ok("empty-session:all-non-aborde")
      : fail("empty-session:all-non-aborde", `${nonAllNonAborde.length} skill(s) non "non-aborde" sur session vide`)
  );
  const anyCitation = collectCitations(report).length > 0 || report.strengths.length > 0;
  results.push(
    !anyCitation ? ok("empty-session:no-citations") : fail("empty-session:no-citations", "citation(s)/strength(s) inventée(s) sur session vide")
  );
  return results;
}

export function verifyReport(report: CandidateReport, transcriptLog: TranscriptEntry[], scenario: InterviewScenario): CheckResult[] {
  const results: CheckResult[] = [];

  for (const { label, citation } of collectCitations(report)) {
    results.push(verifyCitationVerbatim(label, citation, transcriptLog));
  }

  if (scenario.neverSpoken && scenario.neverSpoken.length > 0) {
    results.push(...verifyNeverSpokenSkills(report, scenario.neverSpoken));
  }

  results.push(verifyCandidateNameDefault(report, scenario.candidateName));
  results.push(...verifyEnumsValid(report));

  if (scenario.turns.length === 0) {
    results.push(...verifyEmptySessionRule(report));
  }

  return results;
}

const STRICT_CARD_HEADER = /^\[(strength|attention|translation)\]\s*\[(acquis|[aà][\s-]?creuser|pas[\s-]?acquis)\]\s*\[([a-z0-9-]+)\]\s*\[(contexte|ownership|impact|none)\]/i;

/**
 * Format le plus important à surveiller : si Claude dérive du format à 4
 * crochets, extractThemeAndAngle/parseAssistText retombent sur des defaults
 * silencieux (theme=null, cat="translation") — un vrai risque de régression
 * de prompt qui ne casserait jamais un test unitaire (les tests unitaires
 * mockent justement ce texte).
 */
export function verifyCardHeaderStrict(fullText: string): CheckResult {
  const headerLine = fullText.trim().split("\n")[0] ?? "";
  return STRICT_CARD_HEADER.test(headerLine)
    ? ok("card:header-format-strict")
    : fail("card:header-format-strict", `en-tête non conforme au format [cat] [statut] [theme] [angle] : "${headerLine}"`);
}

export function verifySkipExpectation(fullText: string, turn: InterviewTurn): CheckResult {
  const isSkip = fullText.trim().toLowerCase().startsWith("[skip]");
  const expected = turn.expectSkip ?? false;
  if (isSkip === expected) return ok("card:skip-matches-expectation");
  return fail(
    "card:skip-matches-expectation",
    expected
      ? `attendu [skip] pour "${turn.text}" mais une card a été générée : "${fullText.slice(0, 120)}"`
      : `[skip] inattendu pour "${turn.text}"`
  );
}

export function printResults(scopeName: string, results: CheckResult[]): void {
  console.log(`\n--- ${scopeName} ---`);
  for (const r of results) {
    console.log(`  ${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
}

export function failuresOf(results: CheckResult[]): CheckResult[] {
  return results.filter((r) => !r.pass);
}
