import { useState } from "react";
import type { InterviewLanguage, JobAnalysis, SessionConfig } from "@voxhelp/shared";
import { useApi } from "../hooks/useApi";

const LANGUAGES: { value: InterviewLanguage; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "zh", label: "中文" },
];

const CATEGORY_LABELS: Record<string, string> = {
  TECHNICAL: "Technique",
  SYSTEM_DESIGN: "System Design",
  BEHAVIORAL: "Comportemental",
  CULTURE_FIT: "Culture Fit",
};

interface PrepViewProps {
  onStartCall: (config: SessionConfig, analysis: JobAnalysis) => void;
}

export function PrepView({ onStartCall }: PrepViewProps) {
  const [candidateName, setCandidateName] = useState("");
  const [language, setLanguage] = useState<InterviewLanguage>("fr");
  const [jobDescription, setJobDescription] = useState("");
  const [techStack, setTechStack] = useState("");
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>("TECHNICAL");

  const { analyzeJob, isLoading, error } = useApi();

  const handleAnalyze = async () => {
    if (!jobDescription.trim()) return;
    try {
      const result = await analyzeJob(jobDescription, techStack || undefined);
      setAnalysis(result);
    } catch {
      // error displayed via hook
    }
  };

  const handleStartCall = () => {
    if (!analysis) return;
    const config: SessionConfig = {
      language,
      jobDescription,
      candidateName: candidateName || "Candidat",
      techStack: techStack || undefined,
      questions: analysis.questions,
      scorecard: analysis.scorecard,
    };
    onStartCall(config, analysis);
  };

  const byCategory = analysis?.questions.reduce(
    (acc, q) => {
      (acc[q.category] ??= []).push(q);
      return acc;
    },
    {} as Record<string, typeof analysis.questions>
  );

  return (
    <div className="min-h-screen bg-[#F6F7FB]">
      <header className="bg-white border-b border-[#DFE1EA] px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#3D5AFE] flex items-center justify-center">
          <span className="text-white text-xs font-bold">VH</span>
        </div>
        <div>
          <h1 className="font-semibold text-[#1A1D26] leading-none" style={{ fontFamily: "'Outfit', sans-serif" }}>
            VoxHelp Recruit
          </h1>
          <p className="text-[10px] text-[#5A5F72] mt-0.5">Copilote recruteur tech</p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-[#1A1D26]" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Préparer l'entretien
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[#5A5F72] mb-1.5 block">Nom du candidat</label>
              <input
                type="text"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Jean Dupont"
                className="w-full border border-[#DFE1EA] rounded-lg px-3 py-2 text-sm text-[#1A1D26] focus:outline-none focus:border-[#3D5AFE] bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[#5A5F72] mb-1.5 block">Langue</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as InterviewLanguage)}
                className="w-full border border-[#DFE1EA] rounded-lg px-3 py-2 text-sm text-[#1A1D26] focus:outline-none focus:border-[#3D5AFE] bg-white"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[#5A5F72] mb-1.5 block">Stack technique <span className="text-[#DFE1EA]">(optionnel)</span></label>
            <input
              type="text"
              value={techStack}
              onChange={(e) => setTechStack(e.target.value)}
              placeholder="Java, Spring Boot, Kafka, Kubernetes..."
              className="w-full border border-[#DFE1EA] rounded-lg px-3 py-2 text-sm text-[#1A1D26] focus:outline-none focus:border-[#3D5AFE] bg-white"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#5A5F72] mb-1.5 block">Fiche de poste</label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Collez la fiche de poste ici... (titre, missions, compétences requises)"
              rows={6}
              className="w-full border border-[#DFE1EA] rounded-lg px-3 py-2 text-sm text-[#1A1D26] focus:outline-none focus:border-[#3D5AFE] bg-white resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={isLoading || !jobDescription.trim()}
            className="w-full bg-[#3D5AFE] text-white rounded-xl py-3 font-semibold text-sm hover:bg-[#3451e0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyse en cours...
              </>
            ) : (
              "Analyser la fiche de poste"
            )}
          </button>
        </div>

        {analysis && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                📋 Résumé du poste
              </h3>
              <p className="text-sm text-[#1A1D26] leading-relaxed">{analysis.summary}</p>
            </div>

            <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6 space-y-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-3">
                  🔴 Compétences critiques
                </h3>
                <div className="space-y-3">
                  {analysis.criticalSkills.map((skill) => (
                    <div key={skill.name} className="flex gap-3">
                      <span className="font-semibold text-sm text-[#1A1D26] min-w-[120px]">{skill.name}</span>
                      <span className="text-sm text-[#5A5F72]">{skill.why}</span>
                    </div>
                  ))}
                </div>
              </div>

              {analysis.niceToHave.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-500 mb-3">
                    🟡 Nice to have
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {analysis.niceToHave.map((skill) => (
                      <span
                        key={skill}
                        className="text-xs bg-orange-50 border border-orange-200 text-orange-700 rounded-full px-3 py-1"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                ❓ Questions générées ({analysis.questions.length})
              </h3>
              <div className="space-y-2">
                {Object.entries(byCategory ?? {}).map(([cat, qs]) => (
                  <div key={cat} className="border border-[#DFE1EA] rounded-xl overflow-hidden">
                    <button
                      onClick={() => setOpenCategory(openCategory === cat ? null : cat)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-[#F6F7FB] hover:bg-[#eef0f8] transition-colors"
                    >
                      <span className="text-sm font-medium text-[#1A1D26]">
                        {CATEGORY_LABELS[cat] ?? cat} ({qs.length})
                      </span>
                      <span className="text-[#5A5F72]">{openCategory === cat ? "▲" : "▼"}</span>
                    </button>
                    {openCategory === cat && (
                      <div className="divide-y divide-[#F6F7FB]">
                        {qs.map((q) => (
                          <div key={q.id} className="px-4 py-3">
                            <p className="text-sm font-medium text-[#1A1D26] mb-1">{q.text}</p>
                            <p className="text-xs text-[#5A5F72] leading-relaxed">
                              💡 {q.expectedAnswer}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#DFE1EA] shadow-sm p-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                📊 Grille d'évaluation
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#5A5F72] border-b border-[#DFE1EA]">
                    <th className="pb-2 font-medium">Critère</th>
                    <th className="pb-2 font-medium text-center w-16">Poids</th>
                    <th className="pb-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F6F7FB]">
                  {analysis.scorecard.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 font-medium text-[#1A1D26]">{c.name}</td>
                      <td className="py-2.5 text-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#3D5AFE]/10 text-[#3D5AFE] text-xs font-semibold">
                          {c.weight}
                        </span>
                      </td>
                      <td className="py-2.5 text-[#5A5F72]">{c.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleStartCall}
              className="w-full bg-[#0FAA6C] text-white rounded-xl py-3.5 font-semibold hover:bg-[#0d9660] transition-colors flex items-center justify-center gap-2"
            >
              ▶ Démarrer le call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
