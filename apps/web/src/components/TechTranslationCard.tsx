import type { TechTranslation } from "@voxhelp/shared";

const CRITICALITY_STYLES = {
  HIGH: "bg-red-50 border-red-200 text-red-700",
  MEDIUM: "bg-orange-50 border-orange-200 text-orange-700",
  LOW: "bg-blue-50 border-blue-200 text-blue-600",
};

const CRITICALITY_LABELS = {
  HIGH: "Critique",
  MEDIUM: "Important",
  LOW: "Secondaire",
};

interface TechTranslationCardProps {
  translation: TechTranslation;
}

export function TechTranslationCard({ translation }: TechTranslationCardProps) {
  return (
    <div className="bg-white border border-[#DFE1EA] rounded-xl p-3 shadow-sm animate-fade-in">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-semibold text-[#1A1D26] text-sm">🔍 {translation.term}</span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${CRITICALITY_STYLES[translation.criticality]}`}
        >
          {CRITICALITY_LABELS[translation.criticality]}
        </span>
      </div>
      <p className="text-xs text-[#5A5F72] leading-relaxed">{translation.definition}</p>
      {translation.relatedTechs.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {translation.relatedTechs.map((t) => (
            <span
              key={t}
              className="text-[10px] bg-[#F6F7FB] border border-[#DFE1EA] text-[#5A5F72] rounded px-1.5 py-0.5"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
