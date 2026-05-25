import { useState } from "react";
import type {
  InterviewReport,
  SessionConfig,
  ScorecardCriterion,
  TranscriptEntry,
} from "@voxhelp/shared";
import { useApi } from "../hooks/useApi";

const RECOMMENDATION_CONFIG: Record<
  InterviewReport["recommendation"],
  { label: string; color: string; bg: string }
> = {
  STRONG_HIRE: { label: "STRONG HIRE", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  HIRE: { label: "HIRE", color: "text-[#0FAA6C]", bg: "bg-[#0FAA6C]/10 border-[#0FAA6C]/30" },
  LEAN_HIRE: { label: "LEAN HIRE", color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  LEAN_NO_HIRE: { label: "LEAN NO HIRE", color: "text-red-600", bg: "bg-red-50 border-red-200" },
  NO_HIRE: { label: "NO HIRE", color: "text-red-700", bg: "bg-red-100 border-red-300" },
};

interface ReportViewProps {
  config: SessionConfig;
  transcripts: TranscriptEntry[];
  scorecard: ScorecardCriterion[];
  callDuration: string;
  onNewInterview: () => void;
}

export function ReportView({
  config,
  transcripts,
  scorecard,
  callDuration,
  onNewInterview,
}: ReportViewProps) {
  const { generateReport, isLoading, error } = useApi();
  const [report, setReport] = useState<InterviewReport | null>(null);

  const handleGenerate = async () => {
    try {
      const result = await generateReport(config.jobDescription, transcripts, scorecard);
      setReport(result);
    } catch {
      // error displayed via hook
    }
  };

  const rec = report ? RECOMMENDATION_CONFIG[report.recommendation] : null;

  const date = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-[#F6F7FB]">
      <header className="bg-white border-b border-[#DFE1EA] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#3D5AFE] flex items-center justify-center">
            <span className="text-white text-xs font-bold">VH</span>
          </div>
          <h1
            className="font-semibold text-[#1A1D26] leading-none"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            VoxHelp Recruit · Rapport
          </h1>
        </div>
        <button
          onClick={onNewInterview}
          className="text-sm text-[#5A5F72] border border-[#DFE1EA] rounded-lg px-4 py-2 hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors"
        >
          🔄 Nouvel entretien
        </button>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[#5A5F72] text-xs">Candidat</span>
              <p className="font-semibold text-[#1A1D26]">{config.candidateName}</p>
            </div>
            <div>
              <span className="text-[#5A5F72] text-xs">Date</span>
              <p className="font-semibold text-[#1A1D26]">{date}</p>
            </div>
            <div>
              <span className="text-[#5A5F72] text-xs">Durée du call</span>
              <p className="font-semibold text-[#1A1D26]">{callDuration}</p>
            </div>
            <div>
              <span className="text-[#5A5F72] text-xs">Échanges transcrits</span>
              <p className="font-semibold text-[#1A1D26]">{transcripts.length}</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {!report && (
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="w-full bg-[#3D5AFE] text-white rounded-xl py-3.5 font-semibold hover:bg-[#3451e0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Génération du rapport...
              </>
            ) : (
              "Générer le rapport IA"
            )}
          </button>
        )}

        {report && rec && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                Résumé
              </h3>
              <p className="text-sm text-[#1A1D26] leading-relaxed">{report.summary}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#0FAA6C] mb-3">
                  ✅ Points forts
                </h3>
                <ul className="space-y-1.5">
                  {report.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-[#1A1D26] flex gap-2">
                      <span className="text-[#0FAA6C] flex-shrink-0">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-500 mb-3">
                  ⚠️ Points faibles
                </h3>
                <ul className="space-y-1.5">
                  {report.weaknesses.map((w, i) => (
                    <li key={i} className="text-sm text-[#1A1D26] flex gap-2">
                      <span className="text-orange-500 flex-shrink-0">△</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {report.redFlags.length > 0 && (
              <div className="bg-red-50 rounded-2xl border border-red-200 p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-red-600 mb-3">
                  🚩 Red flags
                </h3>
                <ul className="space-y-1.5">
                  {report.redFlags.map((f, i) => (
                    <li key={i} className="text-sm text-red-700 flex gap-2">
                      <span className="flex-shrink-0">🚩</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-4">
                Scorecard
              </h3>
              <div className="space-y-3">
                {report.scoredCriteria.map((c) => (
                  <div key={c.id} className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1A1D26]">{c.name}</span>
                        <span className="text-[10px] text-[#5A5F72]">poids {c.weight}</span>
                      </div>
                      {c.notes && <p className="text-xs text-[#5A5F72] mt-0.5">{c.notes}</p>}
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <span
                          key={star}
                          className={`text-base leading-none ${c.score !== null && star <= c.score ? "text-[#E8850A]" : "text-[#DFE1EA]"}`}
                        >
                          ★
                        </span>
                      ))}
                      <span className="text-xs text-[#5A5F72] ml-1 w-7">
                        {c.score !== null ? `${c.score}/5` : "-"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`rounded-2xl border p-6 flex items-center justify-between ${rec.bg}`}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-1">
                  Recommandation
                </p>
                <p
                  className={`text-2xl font-bold ${rec.color}`}
                  style={{ fontFamily: "'Outfit', sans-serif" }}
                >
                  {rec.label}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-1">
                  Score global
                </p>
                <p
                  className={`text-3xl font-bold ${rec.color}`}
                  style={{ fontFamily: "'Outfit', sans-serif" }}
                >
                  {typeof report.overallScore === "number"
                    ? report.overallScore.toFixed(1)
                    : report.overallScore}
                  <span className="text-lg">/5</span>
                </p>
              </div>
            </div>

            <button
              onClick={onNewInterview}
              className="w-full border-2 border-[#DFE1EA] text-[#5A5F72] rounded-xl py-3 font-semibold hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors"
            >
              🔄 Nouvel entretien
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
