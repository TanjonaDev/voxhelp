import { useState } from "react";
import type {
  CourseContext,
  TranscriptSegment,
  Pass1Output,
  PdfAnalysis,
  GlossaryEntry,
} from "@voxhelp/lecture";

function formatSegments(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${s.startMs}–${s.endMs}] ${s.text}`).join("\n");
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function postFile<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function LectureTestPage() {
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

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfAnalysis, setPdfAnalysis] = useState<PdfAnalysis | null>(null);
  const [analyzingPdf, setAnalyzingPdf] = useState(false);

  const [document, setDocument] = useState("");
  const [rewriting, setRewriting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function handleTranscribe() {
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
        form
      );
      setTranscript(result.transcript);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleAnalyzePass1() {
    if (!transcript) return;
    setError(null);
    setAnalyzing(true);
    try {
      const result = await postJson<Pass1Output>("/api/lecture/analyze-pass1", {
        transcript,
        course,
        existingGlossary,
      });
      setPass1(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAnalyzePdf() {
    if (!pdfFile) return;
    setError(null);
    setAnalyzingPdf(true);
    try {
      const form = new FormData();
      form.append("file", pdfFile);
      const result = await postFile<PdfAnalysis>("/api/lecture/analyze-pdf", form);
      setPdfAnalysis(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzingPdf(false);
    }
  }

  async function handleRewritePass2() {
    if (!transcript || !pass1) return;
    setError(null);
    setRewriting(true);
    setDocument("");
    try {
      const res = await fetch("/api/lecture/rewrite-pass2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript,
          course,
          plan: pass1.plan,
          glossary: pass1.glossary,
          references: pass1.references,
          uncertainZones: pass1.uncertainZones,
          pdfAnalysis: pdfAnalysis ?? undefined,
        }),
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
        setDocument(acc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRewriting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-mono text-sm">
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
        </div>
        {transcript && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2">
            {formatSegments(transcript)}
          </pre>
        )}
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <h2 className="font-bold mb-2">2. Support PDF (optionnel)</h2>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="rounded bg-black text-white px-3 py-1 disabled:opacity-40"
            disabled={!pdfFile || analyzingPdf}
            onClick={handleAnalyzePdf}
          >
            {analyzingPdf ? "Analyse…" : "Analyser le PDF"}
          </button>
        </div>
        {pdfAnalysis && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2">
            {JSON.stringify(pdfAnalysis, null, 2)}
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
        {document && (
          <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-3">
            {document}
          </pre>
        )}
      </section>
    </div>
  );
}
