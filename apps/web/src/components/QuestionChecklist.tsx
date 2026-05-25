import type { GeneratedQuestion } from "@voxhelp/shared";

const CATEGORY_LABELS: Record<GeneratedQuestion["category"], string> = {
  TECHNICAL: "Technique",
  SYSTEM_DESIGN: "System Design",
  BEHAVIORAL: "Comportemental",
  CULTURE_FIT: "Culture",
};

const DIFFICULTY_COLORS: Record<GeneratedQuestion["difficulty"], string> = {
  EASY: "text-green-600",
  MEDIUM: "text-orange-500",
  HARD: "text-red-500",
};

interface QuestionChecklistProps {
  questions: GeneratedQuestion[];
  onToggle: (id: string) => void;
}

export function QuestionChecklist({ questions, onToggle }: QuestionChecklistProps) {
  const byCategory = questions.reduce(
    (acc, q) => {
      (acc[q.category] ??= []).push(q);
      return acc;
    },
    {} as Record<GeneratedQuestion["category"], GeneratedQuestion[]>
  );

  return (
    <div className="space-y-3">
      {(Object.entries(byCategory) as [GeneratedQuestion["category"], GeneratedQuestion[]][]).map(
        ([cat, qs]) => (
          <div key={cat}>
            <p className="text-[10px] uppercase tracking-wider text-[#5A5F72] font-semibold mb-1.5">
              {CATEGORY_LABELS[cat]}
            </p>
            <div className="space-y-1">
              {qs.map((q) => (
                <button
                  key={q.id}
                  onClick={() => onToggle(q.id)}
                  className="w-full flex items-start gap-2 text-left group"
                >
                  <div
                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      q.isAsked
                        ? "bg-[#0FAA6C] border-[#0FAA6C]"
                        : "border-[#DFE1EA] group-hover:border-[#3D5AFE]"
                    }`}
                  >
                    {q.isAsked && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-xs leading-relaxed transition-colors ${
                      q.isAsked ? "line-through text-[#5A5F72]" : "text-[#1A1D26] group-hover:text-[#3D5AFE]"
                    }`}
                  >
                    {q.text}
                  </span>
                  <span className={`text-[10px] ml-auto flex-shrink-0 ${DIFFICULTY_COLORS[q.difficulty]}`}>
                    {q.difficulty === "EASY" ? "●" : q.difficulty === "MEDIUM" ? "●●" : "●●●"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
