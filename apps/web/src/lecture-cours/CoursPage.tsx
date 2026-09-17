import { useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useCourseAnalysis } from "../hooks/useCourseAnalysis";
import { LoginPage } from "../components/LoginPage";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { PillButton, PillTabs, VoxHelpGlyph } from "../components/ui.js";
import { UploadScreen } from "./UploadScreen";
import { ReadScreen, type Version } from "./ReadScreen";

type Screen = "upload" | "read";

// Screen navigation is local state, not a route with an identified session:
// there is no backend persistence for a course/session beyond the current
// page load (no "GET session by id" endpoint), so a real router would have
// nothing to fetch from. Flagged in the handoff summary as a known gap.

function initials(name: string | undefined, email: string | undefined): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function CoursPage() {
  const { session, loading, user } = useAuth();
  const analysis = useCourseAnalysis();
  const [screen, setScreen] = useState<Screen>("upload");
  const [version, setVersion] = useState<Version>("clean");

  if (!isSupabaseConfigured) {
    return <div className="cours-theme p-[24px]">Configuration Supabase manquante (apps/web/.env).</div>;
  }
  if (loading) {
    return <div className="cours-theme p-[24px]">Chargement…</div>;
  }
  if (!session) {
    return <LoginPage />;
  }

  const canOpenReading = analysis.runState === "done" && analysis.finalDocument.length > 0 && Boolean(analysis.pass1);

  // "clean"/"raw" are always complete by the time the Lecture tab is
  // reachable (canOpenReading already requires runState === "done"); only
  // the pre-generated synthesis/revision sheet can still be empty (loading
  // or failed) when the reader picks that tab — exporting mid-generation
  // would print the placeholder text instead of the document.
  const isVersionReadyToExport =
    version === "synthesis" ? Boolean(analysis.synthesis) : version === "revision" ? Boolean(analysis.revisionSheet) : true;

  function handleExportPdf() {
    // The browser's "Save as PDF" print dialog suggests document.title as
    // the filename — set it to the course title (plus its date, if set) for
    // the duration of the print, then restore it once the dialog closes.
    const previousTitle = document.title;
    const exportTitle = [analysis.course.title, analysis.course.date].filter(Boolean).join(" - ");
    document.title = exportTitle || previousTitle;
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
  }

  return (
    <div className="cours-theme font-cours-body">
      <div data-print-hide className="mb-[24px] flex justify-center">
        <PillTabs
          value={screen}
          onChange={setScreen}
          options={[
            { value: "upload", label: "Nouveau cours" },
            { value: "read", label: "Lecture", disabled: !canOpenReading },
          ]}
        />
      </div>

      <div className="app-card">
        <header
          data-print-hide
          className="app-header sticky top-0 z-10 flex h-[58px] items-center gap-[16px] border-b border-cours-hairline bg-cours-surface px-[22px]"
        >
          <div className="flex items-center gap-[8px]">
            <div className="grid h-[24px] w-[24px] place-items-center rounded-[8px] bg-cours-accent">
              <VoxHelpGlyph size={14} className="text-white" />
            </div>
            <span className="font-cours-heading text-[19px] font-semibold">VoxHelp</span>
          </div>

          <div className="flex-1" />

          {screen === "read" && (
            <PillButton
              onClick={handleExportPdf}
              disabled={!isVersionReadyToExport}
              title={isVersionReadyToExport ? undefined : "Disponible une fois la génération terminée."}
            >
              <Download size={15} strokeWidth={1.5} /> Export PDF
            </PillButton>
          )}

          <div className="avatar h-[30px] w-[30px]">
            <span className="text-[12px] font-semibold text-cours-ink">
              {initials(user?.user_metadata?.full_name, user?.email)}
            </span>
          </div>
        </header>

        {screen === "upload" ? (
          <UploadScreen analysis={analysis} onOpenCourse={() => setScreen("read")} />
        ) : (
          <ReadScreen analysis={analysis} version={version} onVersionChange={setVersion} />
        )}
      </div>
    </div>
  );
}
