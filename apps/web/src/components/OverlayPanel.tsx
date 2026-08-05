import { useState, useEffect, useRef } from "react";
import type { Insight, CandidateReport, JobContext, SkillMatch, SkillMatchStatus, Verdict, Citation } from "@voxhelp/shared";
import { useCvKeywords } from "../hooks/useCvKeywords.js";
import { deriveStackKeywords, mergeKeywords } from "../lib/mergeKeywords.js";
import { VIcon, VHMark, LiveWave, StatusBadge, CategoryTag, GhostBtn } from "./ui.js";
import type { PartialCard } from "../lib/parseAssistStream.js";

type WsStatus = "disconnected" | "connecting" | "connected" | "error";
type CopilotStatus = "listening" | "speaking" | "analyzing";

// ---------------------------------------------------------------------------
// useElapsedTime
// ---------------------------------------------------------------------------
function useElapsedTime(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      setElapsed(0);
      startRef.current = null;
    }
  }, [active]);
  return elapsed;
}

// ---------------------------------------------------------------------------
// HeaderBar
// ---------------------------------------------------------------------------
interface HeaderBarProps {
  status: CopilotStatus;
  wsStatus: WsStatus;
  isLive: boolean;
  elapsed: number;
  isSpeaking: boolean;
  isAnalyzing: boolean;
  onStop: () => void;
  onSummarize: () => void;
  isSummarizing: boolean;
  canSummarize: boolean;
}

function HeaderBar({
  status,
  wsStatus,
  isLive,
  elapsed,
  isSpeaking,
  isAnalyzing,
  onStop,
  onSummarize,
  isSummarizing,
  canSummarize,
}: HeaderBarProps) {
  const statusLabel =
    status === "listening" ? "En écoute" : status === "speaking" ? "Candidat parle" : "Analyse…";
  const isThink = status === "analyzing";
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "var(--panel)",
        backdropFilter: "blur(34px) saturate(170%)",
        WebkitBackdropFilter: "blur(34px) saturate(170%)",
        borderBottom: "1px solid var(--stroke)",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <VHMark size={32} glow={isAnalyzing || isSpeaking} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em" }}>VoxHelp</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: wsStatus === "connected" ? "var(--good)" : "var(--text-3)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            Copilote d'entretien
          </span>
        </div>

        <span style={{ flex: 1 }} />

        {isLive && (
          <>
            {/* status pill */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 11px 5px 9px",
                borderRadius: 99,
                background: "var(--card)",
                boxShadow: "0 0 0 1px var(--stroke) inset",
              }}
            >
              {status === "speaking" ? (
                <span style={{ color: "var(--good)" }}>
                  <LiveWave active bars={9} h={13} w={2} color="currentColor" />
                </span>
              ) : isThink ? (
                <span style={{ width: 13, height: 13, display: "grid", placeItems: "center" }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: "conic-gradient(from 0deg, transparent, var(--accent))",
                      WebkitMask: "radial-gradient(circle 3.5px at center, transparent 96%, #000)",
                      mask: "radial-gradient(circle 3.5px at center, transparent 96%, #000)",
                      animation: "vh-spin 0.9s linear infinite",
                    }}
                  />
                </span>
              ) : (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: "var(--good)",
                    animation: "vh-pulse 1.8s infinite",
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: isThink ? "var(--accent)" : "var(--text-2)",
                }}
              >
                {statusLabel}
              </span>
            </div>

            {/* timer */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12,
                color: "var(--text-2)",
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: "var(--risk)",
                  animation: "vh-pulse 1.6s infinite",
                  boxShadow: "0 0 8px -1px var(--risk)",
                }}
              />
              <span style={{ fontFamily: "var(--mono)", color: "var(--text-3)" }}>
                {mm}:{ss}
              </span>
            </span>

            {/* stop */}
            <button
              onClick={onStop}
              style={{
                all: "unset" as "unset",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 9,
                background: "var(--risk-soft)",
                color: "var(--risk)",
                fontSize: 12.5,
                fontWeight: 600,
                boxShadow: "0 0 0 1px var(--risk-soft) inset",
              }}
            >
              <VIcon name="stop" size={11} fill /> Arrêter
            </button>
          </>
        )}

        {/* summarize — visible hors du bloc isLive pour rester accessible après arrêt */}
        {canSummarize && (
          <button
            onClick={onSummarize}
            disabled={isSummarizing}
            style={{
              all: "unset" as "unset",
              cursor: isSummarizing ? "default" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 9,
              background: "var(--card)",
              boxShadow: "0 0 0 1px var(--stroke) inset",
              color: "var(--text-2)",
              fontSize: 12.5,
              fontWeight: 600,
              opacity: isSummarizing ? 0.5 : 1,
            }}
          >
            <VIcon name="refresh" size={12} />
            {isSummarizing ? "Génération…" : "Bilan"}
          </button>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// LiveCaption
// ---------------------------------------------------------------------------
function LiveCaption({ caption, speaking }: { caption: string; speaking: boolean }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: "9px 12px",
        background: "var(--card)",
        boxShadow: "0 0 0 1px var(--stroke) inset",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 26,
          height: 26,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: "var(--card-hi)",
          color: speaking ? "var(--good)" : "var(--text-3)",
        }}
      >
        <VIcon name="mic" size={14} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-3)",
            }}
          >
            Transcription en direct
          </span>
          {speaking && (
            <span style={{ color: "var(--good)" }}>
              <LiveWave active bars={5} h={9} w={1.5} color="currentColor" />
            </span>
          )}
        </div>
        <p
          key={caption}
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.45,
            color: "var(--text-2)",
            fontStyle: "italic",
            animation: "vh-caption-in 0.4s both",
          }}
        >
          {caption ? `"${caption}"` : "En attente de transcription…"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamingCardView — carte en cours de génération
// ---------------------------------------------------------------------------
function StreamingCardView({ card }: { card: PartialCard }) {
  const catColorMap: Record<string, string> = {
    translation: "var(--indigo)",
    jargon: "var(--violet)",
    strength: "var(--good)",
    attention: "var(--risk)",
  };
  const colorVar = card.cat ? catColorMap[card.cat] ?? "var(--text-3)" : "var(--text-3)";

  return (
    <div
      style={{
        position: "relative",
        borderRadius: "var(--radius-card)",
        padding: "13px 14px",
        background: "var(--card)",
        boxShadow: "0 0 0 1px var(--stroke) inset, var(--shadow-card)",
        overflow: "hidden",
        animation: "vh-thought-in 0.55s cubic-bezier(.2,.8,.2,1) both",
      }}
    >
      {/* accent rail */}
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 12,
          bottom: 12,
          width: 3,
          borderRadius: 99,
          background: colorVar,
          opacity: 0.85,
          transition: "background 0.3s",
        }}
      />

      {/* top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        {card.cat ? (
          <CategoryTag cat={card.cat} />
        ) : (
          <div style={{ height: 22, width: 120, borderRadius: 6, background: "var(--stroke-2)" }} />
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-3)" }}>{card.t}</span>
      </div>

      {/* title */}
      {card.title ? (
        <h3
          style={{
            margin: "0 0 7px",
            fontSize: 14.5,
            fontWeight: 600,
            lineHeight: 1.32,
            letterSpacing: "-0.005em",
            color: "var(--text)",
          }}
        >
          {card.title}
        </h3>
      ) : (
        <div style={{ height: 16, width: "70%", borderRadius: 5, background: "var(--stroke-2)", marginBottom: 7 }} />
      )}

      {/* body */}
      <div>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "var(--text-3)",
            marginBottom: 4,
          }}
        >
          Ce que ça veut dire
        </div>
        {card.body ? (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
            {card.body}
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 13,
                background: "var(--accent)",
                marginLeft: 2,
                verticalAlign: "middle",
                animation: "vh-pulse 1s infinite",
              }}
            />
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ height: 10, borderRadius: 5, background: "var(--stroke)", width: "100%" }} />
            <div style={{ height: 10, borderRadius: 5, background: "var(--stroke)", width: "80%" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsightCardView
// ---------------------------------------------------------------------------
function InsightCardView({ insight, isNew }: { insight: Insight; isNew: boolean }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);

  const catColorMap: Record<Insight["cat"], string> = {
    translation: "var(--indigo)",
    jargon: "var(--violet)",
    strength: "var(--good)",
    attention: "var(--risk)",
  };
  const colorVar = catColorMap[insight.cat];

  function handleCopy() {
    const txt =
      insight.title + "\n" + insight.body + (insight.relance ? "\n→ " + insight.relance : "");
    navigator.clipboard?.writeText(txt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        borderRadius: "var(--radius-card)",
        padding: "13px 14px",
        background: hover ? "var(--card-hi)" : "var(--card)",
        boxShadow: hover
          ? "0 0 0 1px var(--stroke-2) inset, 0 10px 30px -12px hsl(230 40% 4% / 0.6)"
          : "0 0 0 1px var(--stroke) inset, var(--shadow-card)",
        transform: hover ? "translateY(-1px)" : "none",
        transition: "background .18s, box-shadow .18s, transform .18s",
        animation: isNew ? "vh-thought-in 0.55s cubic-bezier(.2,.8,.2,1) both" : "none",
        overflow: "hidden",
      }}
    >
      {/* accent rail */}
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 12,
          bottom: 12,
          width: 3,
          borderRadius: 99,
          background: colorVar,
          opacity: 0.85,
        }}
      />

      {isNew && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            boxShadow: `0 0 0 1px ${colorVar} inset`,
            opacity: 0.5,
            animation: "vh-glow-fade 2.4s ease forwards",
            pointerEvents: "none",
          }}
        />
      )}

      {/* top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <CategoryTag cat={insight.cat} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-3)" }}>
          {insight.t}
        </span>
        {insight.cat !== "jargon" && <StatusBadge level={insight.status} />}
      </div>

      {/* title */}
      <h3
        style={{
          margin: "0 0 7px",
          fontSize: 14.5,
          fontWeight: 600,
          lineHeight: 1.32,
          letterSpacing: "-0.005em",
          color: "var(--text)",
        }}
      >
        {insight.title}
      </h3>

      {/* body */}
      <div style={{ marginBottom: insight.relance ? 11 : 2 }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "var(--text-3)",
            marginBottom: 4,
          }}
        >
          Ce que ça veut dire
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
          {insight.body}
        </p>
      </div>

      {/* follow-up question */}
      {insight.relance && (
        <div
          style={{
            borderRadius: 12,
            padding: "9px 11px",
            background: "var(--accent-soft)",
            boxShadow: "0 0 0 1px var(--indigo-soft) inset",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <VIcon name="chat" size={12} style={{ color: "var(--indigo)" }} />
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "var(--indigo)",
              }}
            >
              Question de relance
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "var(--text)",
              fontWeight: 500,
            }}
          >
            {insight.relance}
          </p>
        </div>
      )}

      {/* hover actions */}
      <div
        style={{
          position: "absolute",
          top: 11,
          right: 12,
          display: "flex",
          gap: 4,
          opacity: hover ? 1 : 0,
          transform: hover ? "none" : "translateY(-3px)",
          transition: "opacity .15s, transform .15s",
          pointerEvents: hover ? "auto" : "none",
        }}
      >
        <GhostBtn
          icon={copied ? "check" : "copy"}
          label="Copier"
          onClick={handleCopy}
          size={26}
          iconSize={13}
          style={{ background: "var(--panel)" }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FinalReportView
// ---------------------------------------------------------------------------
const SKILL_STATUS_META: Record<SkillMatchStatus, { icon: string; color: string }> = {
  "demontre": { icon: "✓", color: "var(--good)" },
  "mentionne": { icon: "?", color: "var(--warn)" },
  "non-aborde": { icon: "✕", color: "var(--risk)" },
};

const VERDICT_META: Record<Verdict, { label: string; colorVar: string }> = {
  "presenter": { label: "Présenter au client", colorVar: "var(--good)" },
  "presenter-avec-reserve": { label: "Présenter avec réserve", colorVar: "var(--warn)" },
  "ne-pas-presenter": { label: "Ne pas présenter", colorVar: "var(--risk)" },
};

const sectionLabelStyle = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase" as const,
  color: "var(--text-3)",
  margin: "0 0 6px",
};

function CitationChip({ citation }: { citation: Citation }) {
  return (
    <span
      style={{
        display: "block",
        fontSize: 11.5,
        color: "var(--text-3)",
        fontStyle: "italic",
        marginTop: 3,
      }}
    >
      <span style={{ fontFamily: "var(--mono)", fontStyle: "normal", marginRight: 5 }}>{citation.t}</span>
      « {citation.quote} »
    </span>
  );
}

function techMatchingCounts(matches: SkillMatch[]): Record<SkillMatchStatus, number> {
  return matches.reduce(
    (acc, m) => {
      acc[m.status] += 1;
      return acc;
    },
    { "demontre": 0, "mentionne": 0, "non-aborde": 0 } as Record<SkillMatchStatus, number>
  );
}

function formatInterviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function FinalReportView({ report }: { report: CandidateReport }) {
  const verdict = VERDICT_META[report.verdict];
  const counts = techMatchingCounts(report.techMatching);
  const bilanLine = `${counts["demontre"]} démontré${counts["demontre"] !== 1 ? "s" : ""} · ${counts["mentionne"]} mentionné${counts["mentionne"] !== 1 ? "s" : ""} · ${counts["non-aborde"]} non abordé${counts["non-aborde"] !== 1 ? "s" : ""}`;

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderRadius: "var(--radius-card)",
        padding: "16px",
        background: "var(--card)",
        boxShadow: "0 0 0 1px var(--stroke) inset, var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* 1. En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {report.candidateName}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>
            {report.jobTitle} · {formatInterviewDate(report.interviewDate)} · {report.durationLabel}
          </p>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 9px",
            borderRadius: 99,
            background: "var(--card-hi)",
            color: verdict.colorVar,
            whiteSpace: "nowrap",
          }}
        >
          {verdict.label}
        </span>
      </div>

      {/* 2. Résumé */}
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{report.summary}</p>

      {/* 3. Matching technique */}
      {report.techMatching.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Matching technique</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {report.techMatching.map((m) => {
              const meta = SKILL_STATUS_META[m.status];
              return (
                <li key={m.skill} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                  <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{m.skill}</span> — {m.evidence}
                    {m.citation && <CitationChip citation={m.citation} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>{bilanLine}</p>
        </div>
      )}

      {/* 4. Points forts */}
      {report.strengths.length > 0 && (
        <div>
          <p style={{ ...sectionLabelStyle, color: "var(--good)" }}>Points forts</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {report.strengths.map((s, i) => (
              <li key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                <span style={{ color: "var(--good)", flexShrink: 0 }}>+</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {s.text}
                  <CitationChip citation={s.citation} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Points d'attention */}
      {report.attentionPoints.length > 0 && (
        <div>
          <p style={{ ...sectionLabelStyle, color: "var(--warn)" }}>Points d'attention</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {report.attentionPoints.map((a, i) => (
              <li key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                <span style={{ color: "var(--warn)", flexShrink: 0 }}>?</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {a.text}
                  {a.citation && <CitationChip citation={a.citation} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 6. Projets clés identifiés */}
      {report.keyProjects.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Projets clés identifiés</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {report.keyProjects.map((p, i) => (
              <div
                key={i}
                style={{
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "var(--card-hi)",
                  boxShadow: "0 0 0 1px var(--stroke) inset",
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.5,
                }}
              >
                <p style={{ margin: "0 0 3px", fontWeight: 700, color: "var(--text)" }}>
                  {p.company} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· {p.period}</span>
                </p>
                <p style={{ margin: 0 }}>{p.role} — {p.stack}</p>
                <p style={{ margin: "3px 0 0", color: "var(--text-3)" }}>{p.impact}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. Recommandation */}
      <div
        style={{
          borderRadius: 10,
          padding: "10px 12px",
          background: "var(--card-hi)",
          boxShadow: "0 0 0 1px var(--stroke) inset",
        }}
      >
        <p style={sectionLabelStyle}>Recommandation</p>
        <p style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{report.verdictReason}</p>
        {report.verdictChecklist.length > 0 && (
          <ul style={{ margin: "0 0 6px", padding: "0 0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            {report.verdictChecklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
        {report.nextSteps.length > 0 && (
          <>
            <p style={{ margin: "6px 0 3px", fontSize: 10.5, fontWeight: 700, color: "var(--text-3)" }}>
              Prochaines étapes
            </p>
            <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              {report.nextSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 8. Questions non posées */}
      {report.suggestedQuestions.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Questions non posées</p>
          <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            {report.suggestedQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverlayPanel — full-page layout
// ---------------------------------------------------------------------------
export interface OverlayPanelProps {
  token: string;
  insights: Insight[];
  streamingCard: PartialCard | null;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  finalReport: CandidateReport | null;
  wsStatus: WsStatus;
  isCapturing: boolean;
  isSpeaking: boolean;
  lastTranscript: string;
  lastError: string | null;
  onStartAudio: (jobContext?: JobContext, keywords?: string[], candidateName?: string) => Promise<void>;
  onStop: () => void;
  onSummarize: () => void;
  onAskQuestion: (text: string) => void;
  onClearError: () => void;
}

export function OverlayPanel({
  token,
  insights,
  streamingCard,
  isAnalyzing,
  isSummarizing,
  finalReport,
  wsStatus,
  isCapturing,
  isSpeaking,
  lastTranscript,
  lastError,
  onStartAudio,
  onStop,
  onSummarize,
  onAskQuestion,
  onClearError,
}: OverlayPanelProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobLevel, setJobLevel] = useState("");
  const [jobStack, setJobStack] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const cvKeywords = useCvKeywords(token);
  const [askValue, setAskValue] = useState("");
  const [newId, setNewId] = useState<string | null>(null);
  const elapsed = useElapsedTime(isCapturing);

  const copilotStatus: CopilotStatus = isAnalyzing
    ? "analyzing"
    : isSpeaking
    ? "speaking"
    : "listening";

  const prevCountRef = useRef(0);
  useEffect(() => {
    if (insights.length > prevCountRef.current) {
      const newest = insights[insights.length - 1];
      setNewId(newest.id);
      prevCountRef.current = insights.length;
    }
  }, [insights]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [insights.length, isAnalyzing]);

  const handleStart = async () => {
    const jobContext =
      jobTitle || jobLevel || jobStack
        ? { title: jobTitle, level: jobLevel, stack: jobStack }
        : undefined;
    const keywords = mergeKeywords(cvKeywords.keywords, deriveStackKeywords(jobStack));
    console.log(
      `[Setup] cvKeywords=[${cvKeywords.keywords.join(", ")}] stackKeywords=[${deriveStackKeywords(jobStack).join(", ")}] merged=[${keywords.join(", ")}]`
    );
    await onStartAudio(jobContext, keywords.length > 0 ? keywords : undefined, candidateName.trim() || undefined);
    setAudioStarted(true);
  };

  const handleStop = () => {
    onStop();
    setAudioStarted(false);
    cvKeywords.reset();
  };

  const handleAsk = () => {
    const q = askValue.trim();
    if (!q) return;
    onAskQuestion(q);
    setAskValue("");
  };

  const handleAskKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <HeaderBar
        status={copilotStatus}
        wsStatus={wsStatus}
        isLive={audioStarted}
        elapsed={elapsed}
        isSpeaking={isSpeaking}
        isAnalyzing={isAnalyzing}
        onStop={handleStop}
        onSummarize={onSummarize}
        isSummarizing={isSummarizing}
        canSummarize={insights.length > 0 && !finalReport}
      />

      {/* Error banner */}
      {lastError && (
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            width: "100%",
            padding: "0 24px",
          }}
        >
          <div
            style={{
              margin: "12px 0 0",
              padding: "10px 14px",
              borderRadius: 12,
              background: "var(--risk-soft)",
              boxShadow: "0 0 0 1px var(--risk-soft) inset",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "var(--risk)",
            }}
          >
            <VIcon name="risk" size={16} />
            <span style={{ flex: 1, minWidth: 0 }}>{lastError}</span>
            <GhostBtn icon="x" label="Fermer" onClick={onClearError} size={24} iconSize={12} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main
        style={{
          flex: 1,
          maxWidth: 960,
          width: "100%",
          margin: "0 auto",
          padding: audioStarted ? "20px 24px 100px" : "0 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {!audioStarted ? (
          /* ---- Setup form centered ---- */
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "calc(100vh - 80px)",
            }}
          >
            <div style={{ maxWidth: 420, width: "100%" }}>
              <div
                style={{
                  textAlign: "center",
                  marginBottom: 28,
                }}
              >
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                  <VHMark size={48} glow={false} />
                </div>
                <h1
                  style={{
                    margin: "0 0 6px",
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                  }}
                >
                  VoxHelp
                </h1>
                <p style={{ margin: 0, fontSize: 14, color: "var(--text-3)" }}>
                  Copilote d'entretien technique en temps réel
                </p>
              </div>
              <div
                style={{
                  borderRadius: 18,
                  padding: "16px",
                  background: "var(--card)",
                  boxShadow: "0 0 0 1px var(--stroke) inset, var(--shadow-card)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                  }}
                >
                  Candidat (optionnel)
                </p>
                <input
                  type="text"
                  placeholder="Nom du candidat"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  style={{
                    all: "unset" as "unset",
                    fontSize: 13,
                    color: "var(--text)",
                    background: "var(--card-hi)",
                    borderRadius: 9,
                    padding: "8px 12px",
                    boxShadow: "0 0 0 1px var(--stroke) inset",
                    fontFamily: "var(--font)",
                  }}
                />
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                  }}
                >
                  Contexte du poste (optionnel)
                </p>
                <input
                  type="text"
                  placeholder="Titre — ex: Senior Frontend Dev"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  style={{
                    all: "unset" as "unset",
                    fontSize: 13,
                    color: "var(--text)",
                    background: "var(--card-hi)",
                    borderRadius: 9,
                    padding: "8px 12px",
                    boxShadow: "0 0 0 1px var(--stroke) inset",
                    fontFamily: "var(--font)",
                  }}
                />
                <select
                  value={jobLevel}
                  onChange={(e) => setJobLevel(e.target.value)}
                  style={{
                    fontSize: 13,
                    color: "var(--text)",
                    background: "var(--card-hi)",
                    borderRadius: 9,
                    padding: "8px 12px",
                    boxShadow: "0 0 0 1px var(--stroke) inset",
                    border: "none",
                    outline: "none",
                    fontFamily: "var(--font)",
                  }}
                >
                  <option value="" style={{ background: "#1a1d26" }}>Niveau — non précisé</option>
                  <option value="Junior" style={{ background: "#1a1d26" }}>Junior</option>
                  <option value="Intermédiaire" style={{ background: "#1a1d26" }}>Intermédiaire</option>
                  <option value="Senior" style={{ background: "#1a1d26" }}>Senior</option>
                  <option value="Lead" style={{ background: "#1a1d26" }}>Lead</option>
                </select>
                <input
                  type="text"
                  placeholder="Stack — ex: React, TypeScript"
                  value={jobStack}
                  onChange={(e) => setJobStack(e.target.value)}
                  style={{
                    all: "unset" as "unset",
                    fontSize: 13,
                    color: "var(--text)",
                    background: "var(--card-hi)",
                    borderRadius: 9,
                    padding: "8px 12px",
                    boxShadow: "0 0 0 1px var(--stroke) inset",
                    fontFamily: "var(--font)",
                  }}
                />
                <div>
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void cvKeywords.upload(file);
                    }}
                    style={{
                      fontSize: 12,
                      color: "var(--text-3)",
                      width: "100%",
                    }}
                  />
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-3)" }}>
                    CV du candidat (PDF ou DOCX) — recommandé, améliore la reconnaissance vocale des noms propres
                  </p>
                  {cvKeywords.status === "error" && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--risk)" }}>
                      CV non pris en compte — la session démarrera sans ces mots-clés
                    </p>
                  )}
                </div>
                <button
                  onClick={handleStart}
                  disabled={cvKeywords.status === "extracting"}
                  style={{
                    all: "unset" as "unset",
                    cursor: cvKeywords.status === "extracting" ? "default" : "pointer",
                    opacity: cvKeywords.status === "extracting" ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: "10px 14px",
                    borderRadius: 11,
                    background: "var(--accent)",
                    color: "white",
                    fontSize: 13.5,
                    fontWeight: 600,
                    marginTop: 4,
                    fontFamily: "var(--font)",
                  }}
                >
                  <VIcon name="mic" size={15} />
                  {cvKeywords.status === "extracting" ? "Analyse du CV..." : "Démarrer l'écoute"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ---- Live session ---- */
          <>
            <LiveCaption caption={lastTranscript} speaking={isSpeaking} />

            {/* section label */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  whiteSpace: "nowrap",
                }}
              >
                Analyse en direct
              </span>
              <span style={{ flex: 1, height: 1, background: "var(--stroke)" }} />
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  fontFamily: "var(--mono)",
                }}
              >
                {insights.length}
              </span>
            </div>

            {/* insights grid */}
            <div
              ref={feedRef}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                gap: 12,
                alignContent: "start",
              }}
            >
              {insights.length === 0 && !isAnalyzing && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    color: "var(--text-3)",
                    padding: "40px 0",
                  }}
                >
                  <LiveWave active={isSpeaking} bars={16} h={24} w={3} color="currentColor" />
                  <p style={{ margin: 0, fontSize: 13 }}>En écoute…</p>
                </div>
              )}

              {insights.map((card) => (
                <InsightCardView key={card.id} insight={card} isNew={card.id === newId} />
              ))}

              {streamingCard && <StreamingCardView card={streamingCard} />}

              {finalReport && <FinalReportView report={finalReport} />}
            </div>
          </>
        )}
      </main>

      {/* Footer: ask VoxHelp input */}
      {audioStarted && (
        <footer
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            background: "var(--panel)",
            backdropFilter: "blur(34px) saturate(170%)",
            WebkitBackdropFilter: "blur(34px) saturate(170%)",
            borderTop: "1px solid var(--stroke)",
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              padding: "12px 24px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px 6px 13px",
                borderRadius: 13,
                background: "var(--card)",
                boxShadow: "0 0 0 1px var(--stroke) inset",
              }}
            >
              <VIcon name="sparkle" size={15} style={{ color: "var(--accent)" }} fill />
              <input
                value={askValue}
                onChange={(e) => setAskValue(e.target.value)}
                onKeyDown={handleAskKeyDown}
                placeholder="Demandez à VoxHelp…"
                style={{
                  all: "unset" as "unset",
                  flex: 1,
                  fontFamily: "var(--font)",
                  fontSize: 13,
                  color: "var(--text)",
                  minWidth: 0,
                }}
              />
              <button
                onClick={handleAsk}
                disabled={!askValue.trim()}
                style={{
                  all: "unset" as "unset",
                  cursor: askValue.trim() ? "pointer" : "default",
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  background: askValue.trim() ? "var(--accent)" : "var(--card-hi)",
                  color: "white",
                  transition: "background .15s",
                }}
              >
                <VIcon name="send" size={14} />
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
