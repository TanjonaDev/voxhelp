import { useEffect, useState } from "react";
import type {
  CourseContext,
  TranscriptSegment,
  Pass1Output,
  PdfAnalysis,
  GlossaryEntry,
} from "@voxhelp/lecture";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./components/LoginPage";
import { isSupabaseConfigured } from "./lib/supabase.js";

const LOG = "[LectureTest]";

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    console.error(`${LOG} window error:`, e.error ?? e.message, e);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(`${LOG} unhandled promise rejection:`, e.reason);
  });
}

function formatSegments(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${s.startMs}–${s.endMs}] ${s.text}`).join("\n");
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function postJson<T>(url: string, body: unknown, token: string): Promise<T> {
  console.log(`${LOG} POST ${url}`, body);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  console.log(`${LOG} ${url} -> ${res.status}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`${LOG} ${url} error body:`, err);
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const json = await res.json();
  console.log(`${LOG} ${url} response:`, json);
  return json;
}

async function postFile<T>(url: string, form: FormData, token: string): Promise<T> {
  console.log(`${LOG} POST (multipart) ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  console.log(`${LOG} ${url} -> ${res.status}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`${LOG} ${url} error body:`, err);
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const json = await res.json();
  console.log(`${LOG} ${url} response:`, json);
  return json;
}

export function LectureTestPage() {
  console.log(`${LOG} render`);
  const { session, loading } = useAuth();

  useEffect(() => {
    console.log(`${LOG} auth state:`, { loading, hasSession: Boolean(session) });
  }, [loading, session]);

  const [course, setCourse] = useState<CourseContext>({
    title: "",
    discipline: "",
    instructor: "",
    language: "fr",
  });

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const [existingGlossary] = useState<GlossaryEntry[]>([]);
  const [pass1, setPass1] = useState<Pass1Output | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfAnalyses, setPdfAnalyses] = useState<PdfAnalysis[]>([]);
  const [analyzingPdf, setAnalyzingPdf] = useState(false);

  const [finalDocument, setFinalDocument] = useState("");
  const [rewriting, setRewriting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function handleTranscribe() {
    console.log(`${LOG} handleTranscribe`, { audioFile: audioFile && { name: audioFile.name, type: audioFile.type, size: audioFile.size } });
    if (!audioFile) return;
    setError(null);
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", audioFile);
      form.append("language", course.language);
      form.append("existingGlossary", JSON.stringify(existingGlossary));
      const result = await postFile<{ transcript: TranscriptSegment[] }>(
        "/api/lecture/transcribe-audio",
        form,
        session!.access_token
      );
      console.log(`${LOG} handleTranscribe success, segments:`, result.transcript.length);
      setTranscript(result.transcript);
    } catch (e) {
      console.error(`${LOG} handleTranscribe failed:`, e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }

  function handleDownloadTranscript() {
    if (!transcript) return;
    downloadJson(`transcript-${Date.now()}.json`, transcript);
  }

  async function handleImportTranscript(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Le fichier ne contient pas un tableau de segments");
      console.log(`${LOG} handleImportTranscript success, segments:`, parsed.length);
      setTranscript(parsed as TranscriptSegment[]);
    } catch (e) {
      console.error(`${LOG} handleImportTranscript failed:`, e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Re-analyzes the selected PDFs only if they haven't been analyzed yet
  // (i.e. the count still matches), so Pass 1 can be re-run freely without
  // re-hitting analyze-pdf every time.
  async function ensurePdfAnalyses(): Promise<PdfAnalysis[]> {
    if (pdfFiles.length === 0) return [];
    if (pdfAnalyses.length === pdfFiles.length) return pdfAnalyses;
    console.log(`${LOG} ensurePdfAnalyses`, { files: pdfFiles.map((f) => ({ name: f.name, size: f.size })) });
    setAnalyzingPdf(true);
    try {
      const results: PdfAnalysis[] = [];
      for (const pdfFile of pdfFiles) {
        const form = new FormData();
        form.append("file", pdfFile);
        const result = await postFile<PdfAnalysis>("/api/lecture/analyze-pdf", form, session!.access_token);
        console.log(`${LOG} ensurePdfAnalyses success for ${pdfFile.name}`, result);
        results.push(result);
      }
      setPdfAnalyses(results);
      return results;
    } finally {
      setAnalyzingPdf(false);
    }
  }

  async function handleAnalyzePass1() {
    console.log(`${LOG} handleAnalyzePass1`, { segments: transcript?.length, course });
    if (!transcript) return;
    setError(null);
    setAnalyzing(true);
    try {
      await ensurePdfAnalyses();
      const result = await postJson<Pass1Output>(
        "/api/lecture/analyze-pass1",
        { transcript, course, existingGlossary },
        session!.access_token
      );
      console.log(`${LOG} handleAnalyzePass1 success`, result);
      setPass1(result);
    } catch (e) {
      console.error(`${LOG} handleAnalyzePass1 failed:`, e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRewritePass2() {
    console.log(`${LOG} handleRewritePass2`, { pdfAnalysesCount: pdfAnalyses.length });
    if (!transcript || !pass1) return;
    setError(null);
    setRewriting(true);
    setFinalDocument("");
    try {
      const res = await fetch("/api/lecture/rewrite-pass2", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session!.access_token}` },
        body: JSON.stringify({
          transcript,
          course,
          plan: pass1.plan,
          glossary: pass1.glossary,
          references: pass1.references,
          uncertainZones: pass1.uncertainZones,
          pdfAnalyses: pdfAnalyses.length > 0 ? pdfAnalyses : undefined,
        }),
      });
      console.log(`${LOG} rewrite-pass2 -> ${res.status}`);
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        console.error(`${LOG} rewrite-pass2 error body:`, err);
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
        setFinalDocument(acc);
      }
      console.log(`${LOG} handleRewritePass2 done, ${acc.length} chars`);
    } catch (e) {
      console.error(`${LOG} handleRewritePass2 failed:`, e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRewriting(false);
    }
  }

  if (!isSupabaseConfigured) {
    return <div className="p-6 text-gray-900">Configuration Supabase manquante (apps/web/.env).</div>;
  }
  if (loading) {
    return <div className="p-6 text-gray-900">Chargement…</div>;
  }
  if (!session) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-mono text-sm text-gray-900">
      <h1 className="text-lg font-bold mb-4">VoxHelp — Lecture pipeline test</h1>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-red-700">{error}</div>
      )}

      <section className="mb-6 rounded border bg-white p-4">
        <h2 className="font-bold mb-2">Contexte du cours</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="border rounded px-2 py-1 flex-1 min-w-[200px]"
            placeholder="Intitulé du cours"
            value={course.title}
            onChange={(e) => setCourse({ ...course, title: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1 flex-1 min-w-[160px]"
            placeholder="Discipline"
            value={course.discipline}
            onChange={(e) => setCourse({ ...course, discipline: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1 flex-1 min-w-[160px]"
            placeholder="Enseignant"
            value={course.instructor}
            onChange={(e) => setCourse({ ...course, instructor: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1 w-20"
            placeholder="fr"
            value={course.language}
            onChange={(e) => setCourse({ ...course, language: e.target.value })}
          />
        </div>
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <h2 className="font-bold mb-2">1. Transcription (audio → texte)</h2>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="file"
            accept="audio/*,video/*"
            onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="rounded bg-black text-white px-3 py-1 disabled:opacity-40"
            disabled={!audioFile || transcribing}
            onClick={handleTranscribe}
          >
            {transcribing ? "Transcription…" : "Transcrire"}
          </button>
          {transcript && (
            <button
              className="rounded border border-black px-3 py-1"
              onClick={handleDownloadTranscript}
            >
              Télécharger le transcript (JSON)
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs text-gray-600">
            Ou réimporter un transcript déjà exporté (évite de retranscrire) :
          </label>
          <input
            type="file"
            accept="application/json"
            onChange={(e) => handleImportTranscript(e.target.files?.[0])}
          />
        </div>
        {transcript && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2">
            {formatSegments(transcript)}
          </pre>
        )}
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <h2 className="font-bold mb-2">2. Supports PDF (optionnel, un ou plusieurs)</h2>
        <p className="text-xs text-gray-600 mb-2">
          Analysés automatiquement au lancement du Pass 1 ci-dessous.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => {
              setPdfFiles(Array.from(e.target.files ?? []));
              setPdfAnalyses([]);
            }}
          />
          {analyzingPdf && <span className="text-xs text-gray-600">Analyse des PDF…</span>}
        </div>
        {pdfFiles.length > 0 && (
          <p className="text-xs text-gray-600 mb-2">{pdfFiles.map((f) => f.name).join(", ")}</p>
        )}
        {pdfAnalyses.length > 0 && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2">
            {JSON.stringify(pdfAnalyses, null, 2)}
          </pre>
        )}
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <h2 className="font-bold mb-2">3. Analyse (Pass 1)</h2>
        <button
          className="rounded bg-black text-white px-3 py-1 disabled:opacity-40"
          disabled={!transcript || analyzing}
          onClick={handleAnalyzePass1}
        >
          {analyzing ? "Analyse…" : "Analyser (Pass 1)"}
        </button>
        {pass1 && (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2">
            {JSON.stringify(pass1, null, 2)}
          </pre>
        )}
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <h2 className="font-bold mb-2">4. Réécriture (Pass 2)</h2>
        <button
          className="rounded bg-black text-white px-3 py-1 disabled:opacity-40"
          disabled={!pass1 || rewriting}
          onClick={handleRewritePass2}
        >
          {rewriting ? "Génération…" : "Réécrire"}
        </button>
        {finalDocument && (
          <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-3">
            {finalDocument}
          </pre>
        )}
      </section>
    </div>
  );
}
