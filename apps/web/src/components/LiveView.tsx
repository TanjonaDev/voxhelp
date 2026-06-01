import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry, TechTranslation } from "@voxhelp/shared";
import { TechTranslationCard } from "./TechTranslationCard";

interface AssistMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface LiveViewProps {
  transcripts: TranscriptEntry[];
  isBuffering: boolean;
  techTranslations: TechTranslation[];
  currentAssist: { text: string; isStreaming: boolean } | null;
  assists: AssistMessage[];
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: () => Promise<void>;
  onStop: () => void;
}

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

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function LiveView({
  transcripts,
  isBuffering,
  techTranslations,
  currentAssist,
  assists,
  wsStatus,
  isCapturing,
  isSpeaking,
  onStartAudio,
  onStop,
}: LiveViewProps) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const assistEndRef = useRef<HTMLDivElement>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const elapsed = useElapsedTime(isCapturing);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, isBuffering]);

  useEffect(() => {
    assistEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [assists, currentAssist, techTranslations]);

  const handleStart = async () => {
    await onStartAudio();
    setAudioStarted(true);
  };

  return (
    <div className="h-screen bg-[#F6F7FB] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#DFE1EA] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#3D5AFE] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VH</span>
          </div>
          <span className="font-semibold text-[#1A1D26] text-sm">VoxHelp</span>
        </div>
        <div className={`flex items-center gap-1.5 text-xs ${wsStatus === "connected" ? "text-[#0FAA6C]" : "text-[#5A5F72]"}`}>
          <div className={`w-2 h-2 rounded-full ${wsStatus === "connected" ? "bg-[#0FAA6C]" : "bg-gray-300"}`} />
          {wsStatus === "connected" ? "Connecté" : wsStatus}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Transcript */}
        <div className="flex-1 flex flex-col border-r border-[#DFE1EA] overflow-hidden">
          <div className="px-4 py-2 bg-white border-b border-[#DFE1EA] flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72]">Transcription</span>
            {!audioStarted ? (
              <button
                onClick={handleStart}
                className="text-xs bg-[#3D5AFE] text-white px-3 py-1 rounded-lg hover:bg-[#3451e0] transition-colors"
              >
                Démarrer l'écoute
              </button>
            ) : (
              <div className="flex items-center gap-1.5 text-xs">
                <div className={`w-2 h-2 rounded-full ${isSpeaking ? "bg-[#3D5AFE] animate-pulse" : "bg-[#0FAA6C]"}`} />
                <span className={isSpeaking ? "text-[#3D5AFE]" : "text-[#0FAA6C]"}>
                  {isSpeaking ? "Parole détectée" : "En écoute"}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {transcripts.length === 0 && !isBuffering && (
              <div className="flex items-center justify-center h-full text-center text-[#5A5F72]">
                <div>
                  <div className="text-4xl mb-3">🎤</div>
                  <p className="text-sm">
                    {audioStarted ? "En écoute..." : "Démarrez l'écoute pour commencer"}
                  </p>
                </div>
              </div>
            )}
            {transcripts.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[#F6F7FB] border border-[#DFE1EA] flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                  🎤
                </div>
                <div className="bg-white border border-[#DFE1EA] rounded-xl px-4 py-2.5 text-sm text-[#1A1D26] shadow-sm max-w-[85%]">
                  {entry.text}
                </div>
              </div>
            ))}
            {isBuffering && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[#F6F7FB] border border-[#DFE1EA] flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                  🎤
                </div>
                <div className="bg-white border border-[#DFE1EA] rounded-xl px-4 py-2.5 text-sm text-[#5A5F72] italic opacity-70 shadow-sm max-w-[85%] animate-pulse">
                  Transcription en cours...
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* Right: Explanations */}
        <div className="w-80 flex flex-col overflow-hidden bg-white">
          <div className="px-4 py-2 border-b border-[#DFE1EA] flex-shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72]">Explications IA</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {techTranslations.length === 0 && assists.length === 0 && !currentAssist && (
              <div className="text-xs text-[#5A5F72] text-center pt-8">
                Les explications des termes techniques apparaîtront ici
              </div>
            )}

            {techTranslations.map((t, i) => (
              <TechTranslationCard key={`${t.term}-${i}`} translation={t} />
            ))}

            {assists.slice(-5).map((a) => (
              <div key={a.id} className="bg-[#F6F7FB] border border-[#DFE1EA] rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3D5AFE] mb-1.5">Analyse</p>
                <p className="text-xs text-[#1A1D26] leading-relaxed whitespace-pre-wrap">{a.text}</p>
              </div>
            ))}

            {currentAssist && (
              <div className="bg-[#F6F7FB] border border-[#3D5AFE]/30 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3D5AFE] mb-1.5">Analyse</p>
                <p className="text-xs text-[#1A1D26] leading-relaxed whitespace-pre-wrap cursor-blink">
                  {currentAssist.text}
                </p>
              </div>
            )}

            <div ref={assistEndRef} />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-white border-t border-[#DFE1EA] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          {isCapturing && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-[#1A1D26] font-medium">
            {isCapturing ? `En cours · ${elapsed}` : "En attente"}
          </span>
        </div>
        <button
          onClick={onStop}
          className="bg-red-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors"
        >
          ⏹ Arrêter
        </button>
      </div>
    </div>
  );
}
