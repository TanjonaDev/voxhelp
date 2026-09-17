import { FileText, Mic, Plus, Upload, X } from "lucide-react";
import type { useCourseAnalysis } from "../hooks/useCourseAnalysis";
import { PillButton, Card, Field, Input, Select, FileChip, ProgressCard } from "../components/ui.js";
import { formatFileSize } from "./deriveChapters";

interface UploadScreenProps {
  analysis: ReturnType<typeof useCourseAnalysis>;
  onOpenCourse: () => void;
}

export function UploadScreen({ analysis, onOpenCourse }: UploadScreenProps) {
  const {
    course,
    setCourse,
    audioFile,
    selectAudio,
    pdfFiles,
    addPdfFiles,
    removePdfFile,
    runState,
    progress,
    error,
    analyze,
    abort,
  } = analysis;

  function handleActionClick() {
    if (runState === "running") {
      abort();
    } else if (runState === "done") {
      onOpenCourse();
    } else {
      void analyze();
    }
  }

  const actionLabel = runState === "running" ? "Interrompre" : runState === "done" ? "Ouvrir le cours" : "Analyser";

  const actionNote = !audioFile
    ? "Déposez d'abord un enregistrement."
    : runState === "running"
      ? "Vous pouvez fermer la page, nous vous prévenons."
      : runState === "done"
        ? "Transcript prêt, chapitré et réécrit."
        : "Environ 10 min pour un cours d'une heure.";

  return (
    <div className="app-upload-body mx-auto max-w-[660px] px-[28px] pb-[44px] pt-[40px]">
      <h1 className="text-center font-cours-heading text-[36px] font-semibold leading-[1.06]">
        Déposer un cours à analyser
      </h1>
      <p className="mx-auto mt-[8px] max-w-[46ch] text-center text-[15px] leading-[1.55] text-cours-text-secondary">
        L'audio de la séance est transcrit puis réécrit. Les supports PDF servent à respecter les notations du
        cours.
      </p>

      {error && (
        <div className="mt-[20px] rounded-cours-lg border border-red-300 bg-red-50 px-[16px] py-[12px] text-[13px] text-red-700">
          {error}
        </div>
      )}

      <label className="dropzone relative mt-[26px] block" data-attached={audioFile ? "true" : undefined}>
        <input
          type="file"
          accept="audio/*,video/*"
          className="absolute h-0 w-0 opacity-0"
          onChange={(e) => selectAudio(e.target.files?.[0] ?? null)}
        />
        <Upload size={28} strokeWidth={1.5} className="mx-auto mb-[12px] text-cours-accent" />
        <div className="font-cours-heading text-[21px] font-semibold">
          {audioFile ? "Remplacer l'enregistrement" : "Déposer l'enregistrement du cours"}
        </div>
        <div className="mt-[4px] text-[13px] text-cours-text-tertiary">
          {audioFile ? "Un seul fichier audio ou vidéo par séance." : "mp3, m4a, wav, mp4 — jusqu'à 3 h"}
        </div>
      </label>

      {audioFile && (
        <div className="audio-row mt-[12px]">
          <Mic size={17} strokeWidth={1.5} className="shrink-0 text-cours-accent" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{audioFile.name}</span>
          <span className="shrink-0 text-[12.5px] text-cours-text-tertiary">
            {formatFileSize(audioFile.size)} · audio de séance
          </span>
          <button type="button" className="audio-row-remove" onClick={() => selectAudio(null)} aria-label="Retirer le fichier">
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <Card className="mt-[26px]">
        <div className="flex items-start justify-between gap-[16px]">
          <div>
            <h2 className="card-title">Supports PDF</h2>
            <p className="mt-[4px] text-[13px] text-cours-text-tertiary">
              Diapos, polycopié, énoncés de TD — facultatif.
            </p>
          </div>
          <label className="pill-btn relative shrink-0">
            <Plus size={15} strokeWidth={1.5} />
            Ajouter des fichiers
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="absolute h-0 w-0 opacity-0"
              onChange={(e) => addPdfFiles(e.target.files)}
            />
          </label>
        </div>

        <div className="mt-[16px] flex flex-col gap-[7px]">
          {pdfFiles.length === 0 ? (
            <p className="text-[13px] text-cours-text-faint">Aucun support ajouté.</p>
          ) : (
            pdfFiles.map((file, index) => (
              <FileChip
                key={`${file.name}-${index}`}
                icon={<FileText size={15} strokeWidth={1.5} className="shrink-0 text-cours-text-tertiary" />}
                name={file.name}
                onRemove={() => removePdfFile(index)}
                removeIcon={<X size={14} strokeWidth={1.5} />}
                removeLabel="Retirer ce support"
              />
            ))
          )}
        </div>
      </Card>

      <Card className="mt-[16px]">
        <h2 className="card-title">Contexte du cours</h2>
        <p className="mt-[4px] text-[13px] text-cours-text-tertiary">
          Améliore nettement la restitution des termes techniques.
        </p>
        <div className="mt-[16px] grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Field label="Intitulé de la séance">
            <Input
              value={course.title}
              placeholder="Second principe de la thermodynamique"
              onChange={(e) => setCourse({ ...course, title: e.target.value })}
            />
          </Field>
          <Field label="Discipline">
            <Input
              value={course.discipline ?? ""}
              placeholder="Physique"
              onChange={(e) => setCourse({ ...course, discipline: e.target.value })}
            />
          </Field>
          <Field label="Enseignant">
            <Input
              value={course.instructor ?? ""}
              placeholder="C. Ferrand"
              onChange={(e) => setCourse({ ...course, instructor: e.target.value })}
            />
          </Field>
          <Field label="Langue">
            <Select value={course.language} onChange={(e) => setCourse({ ...course, language: e.target.value })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Date du cours">
            <Input
              type="date"
              value={course.date ?? ""}
              onChange={(e) => setCourse({ ...course, date: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <div className="mt-[28px] flex flex-col items-center gap-[10px]">
        <PillButton
          variant="primary"
          running={runState === "running"}
          disabled={!audioFile && runState === "idle"}
          onClick={handleActionClick}
        >
          {actionLabel}
        </PillButton>
        <span className="text-center text-[13px] text-cours-text-tertiary">{actionNote}</span>
      </div>

      {(runState === "running" || runState === "done") && (
        <ProgressCard
          className="mt-[22px]"
          title={runState === "done" ? "Analyse terminée" : "Analyse en cours"}
          percent={progress}
          running={runState === "running"}
          statusText={
            runState === "done"
              ? "Chapitrage, réécriture et alignement des notations effectués."
              : "Transcription, lecture des supports et réécriture d'un seul tenant."
          }
        />
      )}
    </div>
  );
}
