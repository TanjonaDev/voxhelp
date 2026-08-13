import type { CandidateReport, SkillMatchStatus, Verdict } from "@voxhelp/shared";

export const SKILL_STATUS_META: Record<SkillMatchStatus, { icon: string; color: string }> = {
  "demontre": { icon: "✓", color: "var(--good)" },
  "mentionne": { icon: "?", color: "var(--warn)" },
  "non-aborde": { icon: "✕", color: "var(--risk)" },
};

export const VERDICT_META: Record<Verdict, { label: string; colorVar: string }> = {
  "presenter": { label: "Présenter au client", colorVar: "var(--good)" },
  "presenter-avec-reserve": { label: "Présenter avec réserve", colorVar: "var(--warn)" },
  "ne-pas-presenter": { label: "Ne pas présenter", colorVar: "var(--risk)" },
};

export function techMatchingCounts(matches: CandidateReport["techMatching"]): Record<SkillMatchStatus, number> {
  return matches.reduce(
    (acc, m) => {
      acc[m.status] += 1;
      return acc;
    },
    { "demontre": 0, "mentionne": 0, "non-aborde": 0 } as Record<SkillMatchStatus, number>
  );
}

export function formatBilanLine(counts: Record<SkillMatchStatus, number>): string {
  return `${counts["demontre"]} démontré${counts["demontre"] !== 1 ? "s" : ""} · ${counts["mentionne"]} mentionné${counts["mentionne"] !== 1 ? "s" : ""} · ${counts["non-aborde"]} non abordé${counts["non-aborde"] !== 1 ? "s" : ""}`;
}

export function formatInterviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export function formatReportAsText(report: CandidateReport): string {
  const counts = techMatchingCounts(report.techMatching);
  const lines: string[] = [];

  lines.push(`${report.candidateName} — ${report.jobTitle}`);
  lines.push(`${formatInterviewDate(report.interviewDate)} · ${report.durationLabel}`);
  lines.push("");
  lines.push("RÉSUMÉ");
  lines.push(report.summary);

  if (report.techMatching.length > 0) {
    lines.push("");
    lines.push("MATCHING TECHNIQUE");
    for (const m of report.techMatching) {
      const icon = (SKILL_STATUS_META[m.status] ?? SKILL_STATUS_META["non-aborde"]).icon;
      lines.push(`${icon} ${m.skill} — ${m.evidence}`);
      if (m.citation) lines.push(`  "${m.citation.quote}" (${m.citation.t})`);
    }
    lines.push("");
    lines.push(formatBilanLine(counts));
  }

  if (report.strengths.length > 0) {
    lines.push("");
    lines.push("POINTS FORTS");
    for (const s of report.strengths) {
      lines.push(`+ ${s.text}`);
      lines.push(`  "${s.citation.quote}" (${s.citation.t})`);
    }
  }

  if (report.attentionPoints.length > 0) {
    lines.push("");
    lines.push("POINTS D'ATTENTION");
    for (const a of report.attentionPoints) {
      lines.push(`? ${a.text}`);
      if (a.citation) lines.push(`  "${a.citation.quote}" (${a.citation.t})`);
    }
  }

  if (report.keyProjects.length > 0) {
    lines.push("");
    lines.push("PROJETS CLÉS IDENTIFIÉS");
    for (const p of report.keyProjects) {
      lines.push(`${p.company} · ${p.period}`);
      lines.push(`${p.role} — ${p.stack}`);
      lines.push(p.impact);
    }
  }

  lines.push("");
  const verdictLabel = (VERDICT_META[report.verdict] ?? VERDICT_META["presenter-avec-reserve"]).label;
  lines.push(`RECOMMANDATION : ${verdictLabel}`);
  lines.push(report.verdictReason);

  if (report.verdictChecklist.length > 0) {
    lines.push("");
    lines.push("Vérifications :");
    for (const c of report.verdictChecklist) lines.push(`- ${c}`);
  }

  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Prochaines étapes :");
    for (const s of report.nextSteps) lines.push(`- ${s}`);
  }

  if (report.suggestedQuestions.length > 0) {
    lines.push("");
    lines.push("QUESTIONS NON POSÉES");
    for (const q of report.suggestedQuestions) lines.push(`- ${q}`);
  }

  return lines.join("\n");
}
