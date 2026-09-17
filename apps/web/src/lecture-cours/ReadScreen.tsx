import { useEffect, useMemo, useState } from "react";
import type { useCourseAnalysis } from "../hooks/useCourseAnalysis";
import { Segmented } from "../components/ui.js";
import {
  formatDurationLabel,
  formatTimestamp,
  groupRawSegmentsByChapter,
  splitCleanDocumentByChapter,
  type ChapterBlock,
} from "./deriveChapters";

export type Version = "clean" | "synthesis" | "revision" | "raw";

interface ReadScreenProps {
  analysis: ReturnType<typeof useCourseAnalysis>;
  version: Version;
  onVersionChange: (version: Version) => void;
}

const VERSION_NOTE: Record<Version, string> = {
  clean: "Texte réécrit à partir de la transcription.",
  synthesis: "Synthèse condensée, fidèle mais courte.",
  revision: "Fiche de révision — points clés pour réviser vite.",
  raw: "Transcription littérale, hésitations comprises.",
};

export function ReadScreen({ analysis, version, onVersionChange }: ReadScreenProps) {
  const {
    course,
    transcript,
    pass1,
    finalDocument,
    pdfFiles,
    synthesis,
    synthesisLoading,
    synthesisError,
    revisionSheet,
    revisionSheetLoading,
    revisionError,
    ensureCondensed,
  } = analysis;
  const [chapterFilter, setChapterFilter] = useState(-1);

  const plan = pass1?.plan ?? [];

  useEffect(() => {
    if (version === "synthesis" || version === "revision") {
      void ensureCondensed(version);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const cleanBlocks = useMemo(() => splitCleanDocumentByChapter(finalDocument, plan), [finalDocument, plan]);
  const synthesisBlocks = useMemo(() => splitCleanDocumentByChapter(synthesis, plan), [synthesis, plan]);
  const revisionBlocks = useMemo(() => splitCleanDocumentByChapter(revisionSheet, plan), [revisionSheet, plan]);
  const rawBlocks = useMemo(
    () => (transcript ? groupRawSegmentsByChapter(transcript, plan) : plan.map(() => [] as ChapterBlock[])),
    [transcript, plan]
  );

  const blocksByChapter =
    version === "clean" ? cleanBlocks : version === "synthesis" ? synthesisBlocks : version === "revision" ? revisionBlocks : rawBlocks;

  const isCondensedLoading = (version === "synthesis" && synthesisLoading) || (version === "revision" && revisionSheetLoading);
  const isCondensedEmpty =
    (version === "synthesis" && !synthesis) || (version === "revision" && !revisionSheet);
  const condenseError = version === "synthesis" ? synthesisError : version === "revision" ? revisionError : null;

  const durationMs = transcript && transcript.length > 0 ? Math.max(...transcript.map((s) => s.endMs)) : 0;

  const metaLine = [course.instructor, course.discipline].filter(Boolean).join(" · ");
  const notationSources = pdfFiles.map((f) => f.name).join(" et ");

  if (!pass1 || plan.length === 0) {
    return (
      <div className="app-upload-body px-[28px] py-[40px] text-center text-[15px] text-cours-text-secondary">
        Aucun cours analysé pour l'instant.
      </div>
    );
  }

  const chaptersToShow = chapterFilter === -1 ? plan.map((_, i) => i) : [chapterFilter];

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(180px, 258px) minmax(0, 1fr)", alignItems: "start" }}>
      {/* The <aside> stretches to the row's height but is NOT itself sticky —
          only its inner wrapper is. A stretched flex/grid item can never
          stick (no room to move within its own height), so the sticky
          positioning + scroll must live on an inner block instead. */}
      <aside
        data-print-hide
        className="app-rail border-r border-cours-hairline bg-cours-surface-soft"
        style={{ alignSelf: "stretch" }}
      >
        <div
          className="sticky overflow-y-auto"
          style={{ top: "58px", maxHeight: "calc(100vh - 58px)", padding: "22px 14px 24px 20px" }}
        >
          <p className="text-[11.5px] uppercase tracking-[0.1em] text-cours-text-faint">
            Séance · {formatDurationLabel(durationMs)}
          </p>
          <h2 className="mt-[8px] font-cours-heading text-[21px] font-semibold leading-[1.12]">
            {course.title || "Cours sans titre"}
          </h2>
          {metaLine && <p className="mt-[4px] text-[12.5px] text-cours-text-tertiary">{metaLine}</p>}

          <p className="mb-[8px] mt-[20px] text-[11.5px] uppercase tracking-[0.1em] text-cours-text-faint">
            Chronologie
          </p>
          <nav className="flex flex-col gap-[2px]">
            {plan.map((section, index) => {
              const active = chapterFilter === index;
              return (
                <button
                  key={section.index}
                  onClick={() => setChapterFilter(active ? -1 : index)}
                  className="chapter-btn"
                  data-active={active ? "true" : undefined}
                >
                  <span className="block tabular-nums text-[11.5px] text-cours-text-faint">
                    {formatTimestamp(section.startMs)}
                  </span>
                  <span className="mt-[2px] block leading-[1.32]">{section.title}</span>
                </button>
              );
            })}
          </nav>

          {notationSources && (
            <p className="mt-[20px] border-t border-cours-hairline pt-[12px] text-[12.5px] text-cours-text-tertiary">
              Notations alignées sur {notationSources}.
            </p>
          )}
        </div>
      </aside>

      <div className="app-text-column min-w-0 bg-cours-surface">
        <div
          data-print-hide
          className="sticky z-10 flex flex-wrap items-center gap-[12px] border-b border-cours-hairline bg-cours-surface px-[28px] py-[14px]"
          style={{ top: "58px" }}
        >
          <Segmented
            name="version"
            value={version}
            onChange={onVersionChange}
            options={[
              { value: "clean", label: "Réécrit complet" },
              { value: "synthesis", label: "Synthèse" },
              { value: "revision", label: "Fiche de révision" },
              { value: "raw", label: "Brut" },
            ]}
          />
          <span className="text-[12.5px] text-cours-text-tertiary">{VERSION_NOTE[version]}</span>
        </div>

        {condenseError && (
          <div className="mx-[28px] mt-[16px] flex items-center justify-between gap-[12px] rounded-cours-lg border border-red-300 bg-red-50 px-[16px] py-[12px] text-[13px] text-red-700">
            <span>{condenseError}</span>
            <button
              type="button"
              className="shrink-0 whitespace-nowrap font-medium underline underline-offset-2"
              onClick={() => void ensureCondensed(version as "synthesis" | "revision")}
            >
              Réessayer
            </button>
          </div>
        )}

        <div data-print-area className="mx-auto max-w-[680px] px-[28px] pb-[60px] pt-[30px]">
          {isCondensedEmpty ? (
            <p className="flex items-center gap-[8px] text-[15px] text-cours-text-tertiary">
              {isCondensedLoading && <span className="progress-dot pulsing" />}
              {isCondensedLoading ? "Génération en cours…" : condenseError ? "Échec de la génération." : "…"}
            </p>
          ) : (
            // Keyed on the version so switching tabs (and finishing a
            // background generation while a tab is open) both replay the
            // fade-in instead of the text just popping into place.
            <div key={version} className="cours-fade-in">
              {chaptersToShow.map((chapterIndex) => {
                const section = plan[chapterIndex];
                const blocks = blocksByChapter[chapterIndex] ?? [];
                return (
                  <section key={section.index}>
                    <h3 className="mt-[30px] border-b border-cours-hairline pb-[9px] font-cours-heading text-[25px] font-semibold leading-[1.1]">
                      {section.title}
                    </h3>
                    {blocks.length === 0 ? (
                      <p className="mb-[20px] text-[17px] leading-[1.66] text-cours-text-faint" style={{ textWrap: "pretty" }}>
                        (Aucun contenu pour cette section.)
                      </p>
                    ) : (
                      blocks.map((block, blockIndex) => (
                        <div
                          key={blockIndex}
                          className="mb-[20px] grid gap-[14px]"
                          style={{ gridTemplateColumns: "48px minmax(0, 1fr)", alignItems: "start" }}
                        >
                          <span className="text-right tabular-nums text-[11.5px] leading-[2.2] text-cours-text-faint-2">
                            {block.timestampMs !== null ? formatTimestamp(block.timestampMs) : ""}
                          </span>
                          <p
                            className={`text-[17px] leading-[1.66] ${
                              version === "raw" ? "text-cours-text-secondary" : "text-cours-ink"
                            }`}
                            style={{ textWrap: "pretty", whiteSpace: version === "revision" ? "pre-line" : "normal" }}
                          >
                            {block.text}
                          </p>
                        </div>
                      ))
                    )}
                  </section>
                );
              })}

              <div className="mt-[20px] border-t border-cours-hairline pt-[12px] text-[12.5px] text-cours-text-faint">
                Fin de la séance.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
