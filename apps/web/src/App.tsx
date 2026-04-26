import { useState, useRef, useEffect } from "react";
import type { SessionMode, SessionConfig, TranslatorLanguage } from "@voxhelp/shared";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const [mode, setMode] = useState<SessionMode>("translator");
  const [isActive, setIsActive] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState<TranslatorLanguage>("mg");
  const [targetLanguage, setTargetLanguage] = useState<TranslatorLanguage>("fr");
  const [jobDescription, setJobDescription] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    status,
    transcripts,
    currentPartial,
    suggestion,
    startSession,
    stopSession,
    sendAudio,
  } = useWebSocket(WS_URL);

  const audio = useAudioCapture(sendAudio);

  // Auto-scroll transcripts
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, currentPartial, suggestion]);

  const handleStart = async () => {
    const config: SessionConfig = {
      mode,
      ...(mode === "translator"
        ? { sourceLanguage, targetLanguage }
        : { jobDescription: jobDescription || undefined }),
    };

    startSession(config);

    // Start audio capture — tab capture to hear the interlocutor
    await audio.startTabCapture();
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
      <header className="border-b border-surface-3 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-sm font-bold">
            VA
          </div>
          <h1 className="text-lg font-semibold tracking-tight">VoxHelp</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection status */}
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
            {status === "connected"
              ? "Connecté"
              : status === "connecting"
                ? "Connexion..."
                : "Déconnecté"}
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* ─── Sidebar: Config ─── */}
        <aside className="w-72 border-r border-surface-3 p-5 flex flex-col gap-6">
          {/* Mode selector */}
          <div>
            <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
              Mode
            </label>
            <div className="flex rounded-lg overflow-hidden border border-surface-3">
              <button
                onClick={() => setMode("translator")}
                disabled={isActive}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === "translator"
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-white/60 hover:text-white"
                }`}
              >
                Traducteur
              </button>
              <button
                onClick={() => setMode("interview")}
                disabled={isActive}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === "interview"
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-white/60 hover:text-white"
                }`}
              >
                Entretien
              </button>
            </div>
          </div>

          {/* Mode-specific config */}
          {mode === "translator" ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
                  Langue source (interlocuteur)
                </label>
                <select
                  value={sourceLanguage}
                  onChange={(e) =>
                    setSourceLanguage(e.target.value as TranslatorLanguage)
                  }
                  disabled={isActive}
                  className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="mg">Malgache (Malagasy)</option>
                  <option value="fr">Français</option>
                  <option value="en">Anglais</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
                  Traduire en
                </label>
                <select
                  value={targetLanguage}
                  onChange={(e) =>
                    setTargetLanguage(e.target.value as TranslatorLanguage)
                  }
                  disabled={isActive}
                  className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="fr">Français</option>
                  <option value="en">Anglais</option>
                  <option value="mg">Malgache (Malagasy)</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">
                Description du poste (optionnel)
              </label>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                disabled={isActive}
                placeholder="Colle la description du poste ici pour des réponses plus pertinentes..."
                className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm h-32 resize-none focus:outline-none focus:border-accent placeholder:text-white/20"
              />
            </div>
          )}

          {/* Start/Stop button */}
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

          {/* Audio source indicator */}
          {audio.isCapturing && (
            <div className="flex items-center gap-2 text-xs text-success">
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-success" />
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-pulse-ring" />
              </div>
              {audio.audioSource === "tab"
                ? "Capture audio onglet"
                : "Capture micro"}
            </div>
          )}

          {/* Instructions */}
          <div className="mt-auto text-xs text-white/30 leading-relaxed">
            <p className="font-medium text-white/50 mb-1">Comment ça marche :</p>
            <p>
              1. Ouvre ton appel (Meet, Teams) dans un onglet Chrome
            </p>
            <p>2. Clique "Démarrer la session"</p>
            <p>
              3. Sélectionne l'onglet de ton appel et coche "Partager l'audio"
            </p>
            <p>
              4. Les {mode === "translator" ? "traductions" : "suggestions"}{" "}
              apparaissent ici en temps réel
            </p>
          </div>
        </aside>

        {/* ─── Main content: Transcripts + Suggestions ─── */}
        <main className="flex-1 flex flex-col">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-6 space-y-4"
          >
            {/* Empty state */}
            {transcripts.length === 0 && !currentPartial && !isActive && (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center text-white/20">
                  <div className="text-5xl mb-4">
                    {mode === "translator" ? "🌍" : "💡"}
                  </div>
                  <p className="text-lg font-medium">
                    {mode === "translator"
                      ? "Traducteur temps réel"
                      : "Assistant d'entretien"}
                  </p>
                  <p className="text-sm mt-1">
                    Configure et démarre une session pour commencer
                  </p>
                </div>
              </div>
            )}

            {/* Waiting state */}
            {isActive && transcripts.length === 0 && !currentPartial && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-white/30">
                  <div className="text-4xl mb-3 animate-pulse">🎧</div>
                  <p className="text-sm">En écoute... en attente de parole</p>
                </div>
              </div>
            )}

            {/* Transcript entries */}
            {transcripts.map((entry) => (
              <TranscriptBubble key={entry.id} text={entry.text} />
            ))}

            {/* Partial transcript */}
            {currentPartial && (
              <div className="px-4 py-2 rounded-lg bg-surface-2/50 border border-surface-3/50 text-white/40 text-sm italic">
                {currentPartial}...
              </div>
            )}

            {/* Suggestion / Translation */}
            {suggestion && (
              <SuggestionCard
                text={suggestion.text}
                isStreaming={suggestion.isStreaming}
                mode={mode}
              />
            )}
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

function SuggestionCard({
  text,
  isStreaming,
  mode,
}: {
  text: string;
  isStreaming: boolean;
  mode: SessionMode;
}) {
  return (
    <div className="flex gap-3 justify-end">
      <div
        className={`rounded-lg px-4 py-3 max-w-[85%] border ${
          mode === "translator"
            ? "bg-success/10 border-success/20"
            : "bg-accent/10 border-accent/20"
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-white/40">
            {mode === "translator" ? "Traduction" : "Suggestion"}
          </span>
        </div>
        <p
          className={`text-sm leading-relaxed whitespace-pre-wrap ${
            mode === "translator" ? "text-success" : "text-accent-light"
          } ${isStreaming ? "cursor-blink" : ""}`}
        >
          {text}
        </p>
      </div>
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0 mt-0.5 ${
          mode === "translator" ? "bg-success/20" : "bg-accent/20"
        }`}
      >
        {mode === "translator" ? "🌍" : "💡"}
      </div>
    </div>
  );
}
