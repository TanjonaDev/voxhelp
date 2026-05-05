import { useState, useRef, useEffect } from "react";
import type { SessionConfig, InterviewLanguage, SuggestionSource } from "@voxhelp/shared";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [language, setLanguage] = useState<InterviewLanguage>("fr");
  const [techStack, setTechStack] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [cvContent, setCvContent] = useState("");
  const [audioSource, setAudioSource] = useState<"tab" | "microphone">("tab");

  const translationsEndRef = useRef<HTMLDivElement>(null);

  const {
    status,
    transcripts,
    currentPartial,
    suggestion,
    suggestions,
    startSession,
    stopSession,
    sendAudio,
    requestExpand,
  } = useWebSocket(WS_URL);

  const audio = useAudioCapture(sendAudio);

  useEffect(() => {
    translationsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [suggestions, suggestion]);

  const handleStart = async () => {
    const config: SessionConfig = {
      language,
      techStack: techStack || undefined,
      jobDescription: jobDescription || undefined,
      cvContent: cvContent || undefined,
    };

    startSession(config);

    if (audioSource === "tab") {
      await audio.startTabCapture();
    } else {
      await audio.startMicrophone();
    }
    setIsActive(true);
  };

  const handleStop = () => {
    stopSession();
    audio.stop();
    setIsActive(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── Header ─── */}
      <header className="border-b border-surface-3 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-sm font-bold">
            VH
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight leading-none">VoxHelp</h1>
            <p className="text-[10px] text-white/40 tracking-wider uppercase mt-0.5">Interview Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-white/50">
          <div
            className={`w-2 h-2 rounded-full ${
              status === "connected"
                ? "bg-success"
                : status === "connecting"
                  ? "bg-warning"
                  : "bg-danger"
            }`}
          />
          {status === "connected" ? "Connecté" : status === "connecting" ? "Connexion..." : "Déconnecté"}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* ─── Sidebar ─── */}
        <aside className="w-72 border-r border-surface-3 p-5 flex flex-col gap-5 overflow-y-auto">
          <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">Prépare ton entretien</p>

          {/* Language */}
          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
              Langue de l'entretien
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as InterviewLanguage)}
              disabled={isActive}
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
              <option value="es">Espagnol</option>
              <option value="pt">Portugais</option>
              <option value="zh">Chinois Mandarin</option>
            </select>
          </div>

          {/* Tech stack */}
          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
              Stack technique <span className="text-white/20 normal-case">(optionnel)</span>
            </label>
            <input
              type="text"
              value={techStack}
              onChange={(e) => setTechStack(e.target.value)}
              disabled={isActive}
              placeholder="React, Node.js, AWS, PostgreSQL..."
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent placeholder:text-white/20"
            />
          </div>

          {/* Job description */}
          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
              Job Description <span className="text-white/20 normal-case">(optionnel)</span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              disabled={isActive}
              placeholder="Colle la description du poste..."
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:border-accent placeholder:text-white/20"
            />
          </div>

          {/* CV */}
          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
              CV <span className="text-white/20 normal-case">(optionnel)</span>
            </label>
            <textarea
              value={cvContent}
              onChange={(e) => setCvContent(e.target.value)}
              disabled={isActive}
              placeholder="Colle le contenu de ton CV..."
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:border-accent placeholder:text-white/20"
            />
          </div>

          {/* Audio source */}
          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
              Source audio
            </label>
            <div className="flex rounded-lg overflow-hidden border border-surface-3">
              <button
                onClick={() => setAudioSource("tab")}
                disabled={isActive}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  audioSource === "tab" ? "bg-accent text-white" : "bg-surface-2 text-white/60 hover:text-white"
                }`}
              >
                🖥️ Onglet
              </button>
              <button
                onClick={() => setAudioSource("microphone")}
                disabled={isActive}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  audioSource === "microphone" ? "bg-accent text-white" : "bg-surface-2 text-white/60 hover:text-white"
                }`}
              >
                🎤 Micro
              </button>
            </div>
          </div>

          {/* Start/Stop */}
          <button
            onClick={isActive ? handleStop : handleStart}
            disabled={status !== "connected" && !isActive}
            className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
              isActive
                ? "bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30"
                : "bg-accent hover:bg-accent-dim text-white"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {isActive ? "⏹ Arrêter" : "▶ Démarrer la session"}
          </button>

          {/* Audio error */}
          {audio.error && (
            <div className="text-xs text-danger bg-danger/10 rounded-lg p-3 border border-danger/20">
              {audio.error}
            </div>
          )}

          {/* Capture indicator */}
          {audio.isCapturing && (
            <div className="flex items-center gap-2 text-xs">
              <div className="relative">
                <div
                  className={`w-2 h-2 rounded-full ${
                    audio.isSpeaking ? "bg-accent" : "bg-success"
                  }`}
                />
                {audio.isSpeaking && (
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-accent animate-pulse-ring" />
                )}
              </div>
              <span className={audio.isSpeaking ? "text-accent" : "text-success"}>
                {audio.isSpeaking
                  ? "Parole détectée"
                  : audio.audioSource === "tab"
                    ? "Capture audio onglet"
                    : "Capture micro"}
              </span>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-auto text-xs text-white/30 leading-relaxed">
            <p className="font-medium text-white/50 mb-1">Comment ça marche :</p>
            {audioSource === "tab" ? (
              <>
                <p>1. Ouvre ton appel (Meet, Teams) dans <strong className="text-white/50">Chrome</strong></p>
                <p>2. Clique "Démarrer la session"</p>
                <p>3. Sélectionne l'onglet et coche "Partager l'audio"</p>
                <p>4. Les suggestions apparaissent en temps réel</p>
              </>
            ) : (
              <>
                <p>1. Clique "Démarrer la session"</p>
                <p>2. Autorise l'accès au microphone</p>
                <p>3. Parle — les suggestions apparaissent en temps réel</p>
              </>
            )}
          </div>
        </aside>

        {/* ─── Main: deux colonnes ─── */}
        <main className="flex-1 flex overflow-hidden">
          {/* Gauche : transcriptions */}
          <div className="flex-1 flex flex-col border-r border-surface-3 overflow-hidden">
            <div className="px-4 py-2 border-b border-surface-3 text-xs uppercase tracking-wider text-white/30">
              Transcription
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!isActive && transcripts.length === 0 && (
                <div className="flex items-center justify-center h-full text-center text-white/20">
                  <div>
                    <div className="text-4xl mb-3">🎤</div>
                    <p className="text-sm">Ce que dit l'interviewer</p>
                  </div>
                </div>
              )}
              {isActive && transcripts.length === 0 && !currentPartial && (
                <div className="flex items-center justify-center h-full text-center text-white/30">
                  <div>
                    <div className="text-3xl mb-2 animate-pulse">🎧</div>
                    <p className="text-sm">En écoute... en attente de l'interviewer</p>
                  </div>
                </div>
              )}
              {transcripts.map((entry) => (
                <TranscriptBubble key={entry.id} text={entry.text} />
              ))}
              {currentPartial && (
                <div className="px-4 py-2 rounded-lg bg-surface-2/50 border border-surface-3/50 text-white/40 text-sm italic">
                  {currentPartial}...
                </div>
              )}
            </div>
          </div>

          {/* Droite : suggestions */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-surface-3 text-xs uppercase tracking-wider text-white/30">
              Suggestion
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!isActive && suggestions.length === 0 && !suggestion && (
                <div className="flex items-center justify-center h-full text-center text-white/20">
                  <div>
                    <div className="text-4xl mb-3">💡</div>
                    <p className="text-sm">Les suggestions apparaissent ici</p>
                  </div>
                </div>
              )}
              {suggestions.map((s) => (
                <SuggestionCard key={s.id} text={s.text} isStreaming={false} source={s.source} onExpand={requestExpand} />
              ))}
              {suggestion && (
                <SuggestionCard text={suggestion.text} isStreaming={suggestion.isStreaming} source={suggestion.source} onExpand={requestExpand} />
              )}
              <div ref={translationsEndRef} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function TranscriptBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-[10px] text-white/50 shrink-0 mt-0.5">
        🎤
      </div>
      <div className="bg-surface-2 border border-surface-3 rounded-lg px-4 py-2.5 text-sm text-white/80 max-w-[80%]">
        {text}
      </div>
    </div>
  );
}

const SUGGESTION_LABELS: Record<SuggestionSource, string> = {
  assist: "💡 Suggestion",
  expand: "📖 Détail",
};

function SuggestionCard({
  text,
  isStreaming,
  source,
  onExpand,
}: {
  text: string;
  isStreaming: boolean;
  source: SuggestionSource;
  onExpand?: () => void;
}) {
  return (
    <div className="flex gap-3 justify-end">
      <div className="rounded-lg px-4 py-3 max-w-[85%] border bg-accent/10 border-accent/20">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-white/40">
            {SUGGESTION_LABELS[source]}
          </span>
        </div>
        <p className={`text-sm leading-relaxed whitespace-pre-wrap text-accent-light ${isStreaming ? "cursor-blink" : ""}`}>
          {text}
        </p>
        {!isStreaming && source === "assist" && onExpand && (
          <button
            onClick={onExpand}
            className="mt-2 text-xs text-accent/60 hover:text-accent transition-colors"
          >
            ↕ Développer
          </button>
        )}
      </div>
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0 mt-0.5 bg-accent/20">
        💡
      </div>
    </div>
  );
}
