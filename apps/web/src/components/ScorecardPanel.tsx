import type { ScorecardCriterion } from "@voxhelp/shared";

interface ScorecardPanelProps {
  scorecard: ScorecardCriterion[];
  onScore: (criterionId: string, score: number) => void;
  readonly?: boolean;
}

function StarRating({
  score,
  onChange,
  readonly,
}: {
  score: number | null;
  onChange?: (score: number) => void;
  readonly?: boolean;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => !readonly && onChange?.(star)}
          disabled={readonly}
          className={`text-base leading-none transition-colors ${
            readonly ? "cursor-default" : "cursor-pointer hover:scale-110"
          } ${score !== null && star <= score ? "text-[#E8850A]" : "text-[#DFE1EA]"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function ScorecardPanel({ scorecard, onScore, readonly }: ScorecardPanelProps) {
  return (
    <div className="space-y-2">
      {scorecard.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#1A1D26] truncate">{c.name}</p>
            <p className="text-[10px] text-[#5A5F72]">Poids {c.weight}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StarRating
              score={c.score}
              onChange={(score) => onScore(c.id, score)}
              readonly={readonly}
            />
            <span className="text-xs text-[#5A5F72] w-6 text-right">
              {c.score !== null ? `${c.score}/5` : "-"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
