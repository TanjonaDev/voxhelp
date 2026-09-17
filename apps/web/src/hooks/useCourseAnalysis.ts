import { useRef, useState } from "react";
import type {
  CondenseMode,
  CourseContext,
  GlossaryEntry,
  LectureSection,
  Pass1Output,
  PdfAnalysis,
  TranscriptSegment,
} from "@voxhelp/lecture";
import { useAuth } from "./useAuth";
import { uploadAudioChunked } from "../lib/chunkedAudioUpload";

// Same underlying calls as the /lecture-test debug page (transcribe-audio ->
// analyze-pdf* -> analyze-pass1 -> rewrite-pass2), merged into a single
// Analyser action for the student-facing screen. No pipeline step is exposed
// here — only the resulting course context, transcript, and rewritten
// document, plus a coarse (4-stage) progress derived from the real sequence
// of network calls completing. There is no backend progress channel
// (WebSocket/SSE) for this pipeline, so the bar cannot reflect finer-grained
// server-side progress than "which of the 4 calls is in flight" plus the
// byte count streamed back during rewrite-pass2.

export type RunState = "idle" | "running" | "done" | "error";

async function postFile<T>(url: string, form: FormData, token: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(url: string, body: unknown, token: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function useCourseAnalysis() {
  const { session } = useAuth();

  const [course, setCourse] = useState<CourseContext>({
    title: "",
    discipline: "",
    instructor: "",
    language: "fr",
    date: new Date().toISOString().slice(0, 10),
  });

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);

  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null);
  const [pass1, setPass1] = useState<Pass1Output | null>(null);
  const [pdfAnalyses, setPdfAnalyses] = useState<PdfAnalysis[]>([]);
  const [finalDocument, setFinalDocument] = useState("");

  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Synthèse/fiche de révision are pre-generated in the background as soon as
  // the rewrite finishes, so opening either tab shows a finished document.
  // Their Markdown is buffered until the stream ends and only then pushed to
  // state: a progressively growing document moves under the reader's scroll
  // position, which is what we want to avoid here. ensureCondensed() stays as
  // a fallback for the case where the pre-generation failed or never ran.
  const [synthesis, setSynthesis] = useState("");
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [revisionSheet, setRevisionSheet] = useState("");
  const [revisionSheetLoading, setRevisionSheetLoading] = useState(false);
  // Kept per-mode: synthesis and revision run independently (in parallel,
  // pre-generated in the background), so one failing must not paint an
  // error banner over the other one's already-successful tab.
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Condense runs have their own abort controller (they outlive analyze()'s
  // own controller, which is cleared as soon as the rewrite ends) and a run
  // counter: a condense still in flight when a new course starts must neither
  // write its text into the new course nor clear the new run's loading flag.
  const condenseAbortRef = useRef<AbortController | null>(null);
  const condenseRunRef = useRef(0);
  const existingGlossary: GlossaryEntry[] = [];

  /** Drops any condensed output (and cancels its request) so a new course starts clean. */
  function resetCondensed() {
    condenseAbortRef.current?.abort();
    condenseAbortRef.current = new AbortController();
    condenseRunRef.current += 1;
    setSynthesis("");
    setSynthesisLoading(false);
    setSynthesisError(null);
    setRevisionSheet("");
    setRevisionSheetLoading(false);
    setRevisionError(null);
  }

  function selectAudio(file: File | null) {
    setAudioFile(file);
    setRunState("idle");
    setProgress(0);
    setError(null);
    setTranscript(null);
    setPass1(null);
    setFinalDocument("");
    resetCondensed();
  }

  function addPdfFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPdfFiles((prev) => [...prev, ...Array.from(files)]);
    setPdfAnalyses([]);
  }

  function removePdfFile(index: number) {
    setPdfFiles((prev) => prev.filter((_, i) => i !== index));
    setPdfAnalyses([]);
  }

  async function analyze() {
    if (!audioFile || !session) return;
    setError(null);
    setRunState("running");
    setProgress(0);
    setPass1(null);
    setFinalDocument("");
    resetCondensed();
    const controller = new AbortController();
    abortRef.current = controller;
    const token = session.access_token;

    try {
      const transcribed = await uploadAudioChunked(
        audioFile,
        course.language,
        existingGlossary,
        token,
        controller.signal,
        (fraction) => setProgress(fraction * 25)
      );
      setTranscript(transcribed.transcript);
      setProgress(25);

      const analyses: PdfAnalysis[] = [];
      for (const pdfFile of pdfFiles) {
        const pdfForm = new FormData();
        pdfForm.append("file", pdfFile);
        analyses.push(await postFile<PdfAnalysis>("/api/lecture/analyze-pdf", pdfForm, token, controller.signal));
      }
      setPdfAnalyses(analyses);
      setProgress(50);

      const pass1Result = await postJson<Pass1Output>(
        "/api/lecture/analyze-pass1",
        { transcript: transcribed.transcript, course, existingGlossary },
        token,
        controller.signal
      );
      setPass1(pass1Result);
      setProgress(75);

      const res = await fetch("/api/lecture/rewrite-pass2", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          transcript: transcribed.transcript,
          course,
          plan: pass1Result.plan,
          glossary: pass1Result.glossary,
          references: pass1Result.references,
          uncertainZones: pass1Result.uncertainZones,
          pdfAnalyses: analyses.length > 0 ? analyses : undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setProgress(80);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setFinalDocument(acc);
        setProgress((p) => Math.min(95, Math.max(p, 80 + acc.length / 200)));
      }
      setFinalDocument(acc);
      setProgress(100);
      setRunState("done");

      // Fire-and-forget: the analysis itself is finished, and both condensed
      // versions fill in behind the upload screen. pass1Result/acc are passed
      // explicitly because the setPass1/setFinalDocument calls above are not
      // yet visible from this closure.
      void runCondense("synthesis", pass1Result.plan, acc);
      void runCondense("revision", pass1Result.plan, acc);
    } catch (e) {
      if (controller.signal.aborted) {
        setRunState("idle");
        setProgress(0);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setRunState("error");
    } finally {
      abortRef.current = null;
    }
  }

  function abort() {
    abortRef.current?.abort();
  }

  async function runCondense(mode: CondenseMode, plan: LectureSection[], sourceDocument: string) {
    if (!session) return;
    if (!condenseAbortRef.current) condenseAbortRef.current = new AbortController();
    const { signal } = condenseAbortRef.current;
    const runId = condenseRunRef.current;
    const isCurrent = () => condenseRunRef.current === runId;

    const setLoading = mode === "synthesis" ? setSynthesisLoading : setRevisionSheetLoading;
    const setText = mode === "synthesis" ? setSynthesis : setRevisionSheet;
    const setModeError = mode === "synthesis" ? setSynthesisError : setRevisionError;

    setLoading(true);
    setModeError(null);
    try {
      const res = await fetch("/api/lecture/condense", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ course, plan, document: sourceDocument, mode }),
        signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
      }
      if (isCurrent()) setText(acc);
    } catch (e) {
      if (signal.aborted || !isCurrent()) return;
      setModeError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  async function ensureCondensed(mode: CondenseMode) {
    if (!pass1 || !finalDocument) return;
    if (mode === "synthesis" && (synthesis || synthesisLoading)) return;
    if (mode === "revision" && (revisionSheet || revisionSheetLoading)) return;

    await runCondense(mode, pass1.plan, finalDocument);
  }

  return {
    course,
    setCourse,
    audioFile,
    selectAudio,
    pdfFiles,
    addPdfFiles,
    removePdfFile,
    transcript,
    pass1,
    pdfAnalyses,
    finalDocument,
    runState,
    progress,
    error,
    analyze,
    abort,
    synthesis,
    synthesisLoading,
    synthesisError,
    revisionSheet,
    revisionSheetLoading,
    revisionError,
    ensureCondensed,
  };
}
