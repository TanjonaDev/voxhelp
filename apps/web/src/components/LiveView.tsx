import { useEffect, useRef, useState } from "react";
import type {
  GeneratedQuestion,
  ScorecardCriterion,
  SessionConfig,
  TranscriptEntry,
  TechTranslation,
} from "@voxhelp/shared";
import { TechTranslationCard } from "./TechTranslationCard";
import { QuestionChecklist } from "./QuestionChecklist";
import { ScorecardPanel } from "./ScorecardPanel";

interface AssistMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface LiveViewProps {
  config: SessionConfig;
  transcripts: TranscriptEntry[];
  currentPartial: string;
  techTranslations: TechTranslation[];
  currentAssist: { text: string; isStreaming: boolean } | null;
  assists: AssistMessage[];
  questions: GeneratedQuestion[];
  scorecard: ScorecardCriterion[];
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onToggleQuestion: (id: string) => void;
  onScoreCriterion: (criterionId: string, score: number) => void;
  onStartAudio: () => Promise<void>;
  onEndCall: () => void;
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
  config,
  transcripts,
  currentPartial,
  techTranslations,
  currentAssist,
  assists,
  questions,
  scorecard,
  wsStatus,
  isCapturing,
  isSpeaking,
  onToggleQuestion,
  onScoreCriterion,
  onStartAudio,
  onEndCall,
}: LiveViewProps) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const assistEndRef = useRef<HTMLDivElement>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const elapsed = useElapsedTime(isCapturing);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, currentPartial]);

  useEffect(() => {
    assistEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [assists, currentAssist, techTranslations]);

  const handleStart = async () => {
    await onStartAudio();
    setAudioStarted(true);
  };

  return (
    <div className="h-screen bg-[#F6F7FB] flex flex-col">
      <header className="bg-white border-b border-[#DFE1EA] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#3D5AFE] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">VH</span>
          </div>
          <div>
            <span className="font-semibold text-[#1A1D26] text-sm" style={{ fontFamily: "'Outfit', sans-serif" }}>
              {config.candidateName}
            </span>
            <span className="text-[#5A5F72] text-xs ml-2">· Call en cours</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs ${wsStatus === "connected" ? "text-[#0FAA6C]" : "text-[#5A5F72]"}`}>
            <div className={`w-2 h-2 rounded-full ${wsStatus === "connected" ? "bg-[#0FAA6C]" : "bg-gray-300"}`} />
            {wsStatus === "connected" ? "Connecté" : wsStatus}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Transcript */}
        <div className="flex-1 flex flex-col border-r border-[#DFE1EA] overflow-hidden">
          <div className="px-4 py-2 bg-white border-b border-[#DFE1EA] flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#5A5F72]">Transcription</span>
            {!audioStarted && (
              <button
                onClick={handleStart}
                className="text-xs bg-[#3D5AFE] text-white px-3 py-1 rounded-lg hover:bg-[#3451e0] transition-colors"
              >
                Démarrer l'audio
              </button>
            )}
            {isCapturing && (
              <div className="flex items-center gap-1.5 text-xs">
                <div className={`w-2 h-2 rounded-full ${isSpeaking ? "bg-[#3D5AFE] animate-pulse" : "bg-[#0FAA6C]"}`} />
                <span className={isSpeaking ? "text-[#3D5AFE]" : "text-[#0FAA6C]"}>
                  {isSpeaking ? "Parole détectée" : "En écoute"}
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {transcripts.length === 0 && !currentPartial && (
              <div className="flex items-center justify-center h-full text-center text-[#5A5F72]">
                <div>
                  <div className="text-4xl mb-3">🎤</div>
                  <p className="text-sm">
                    {audioStarted ? "En écoute..." : "Démarrez l'audio pour commencer"}
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
            {currentPartial && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[#F6F7FB] border border-[#DFE1EA] flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                  🎤
                </div>
                <div className="bg-white border border-[#DFE1EA] rounded-xl px-4 py-2.5 text-sm text-[#5A5F72] italic opacity-70 shadow-sm max-w-[85%]">
                  {currentPartial}...
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* Right: AI Copilot + Checklist + Scorecard */}
        <div className="w-80 flex flex-col overflow-hidden bg-white">
          <div className="flex-1 overflow-y-auto">
            {/* AI Assist Panel */}
            <div className="p-4 border-b border-[#DFE1EA]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                Copilote IA
              </p>

              {techTranslations.length > 0 && (
                <div className="space-y-2 mb-3">
                  {techTranslations.slice(0, 2).map((t, i) => (
                    <TechTranslationCard key={`${t.term}-${i}`} translation={t} />
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {assists.slice(-3).map((a) => (
                  <div key={a.id} className="bg-[#F6F7FB] border border-[#DFE1EA] rounded-xl p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3D5AFE] mb-1">
                      💡 Assist
                    </p>
                    <p className="text-xs text-[#1A1D26] leading-relaxed whitespace-pre-wrap">{a.text}</p>
                  </div>
                ))}
                {currentAssist && (
                  <div className="bg-[#F6F7FB] border border-[#3D5AFE]/30 rounded-xl p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3D5AFE] mb-1">
                      💡 Assist
                    </p>
                    <p className="text-xs text-[#1A1D26] leading-relaxed whitespace-pre-wrap cursor-blink">
                      {currentAssist.text}
                    </p>
                  </div>
                )}
                {assists.length === 0 && !currentAssist && (
                  <div className="text-xs text-[#5A5F72] text-center py-4">
                    Les suggestions apparaîtront ici
                  </div>
                )}
              </div>
              <div ref={assistEndRef} />
            </div>

            {/* Questions */}
            {questions.length > 0 && (
              <div className="p-4 border-b border-[#DFE1EA]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                  Questions ({questions.filter((q) => q.isAsked).length}/{questions.length} posées)
                </p>
                <QuestionChecklist questions={questions} onToggle={onToggleQuestion} />
              </div>
            )}

            {/* Scorecard */}
            {scorecard.length > 0 && (
              <div className="p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-3">
                  Scorecard
                </p>
                <ScorecardPanel scorecard={scorecard} onScore={onScoreCriterion} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-white border-t border-[#DFE1EA] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[#1A1D26] font-medium">En cours · {elapsed}</span>
        </div>
        <button
          onClick={onEndCall}
          className="bg-red-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors flex items-center gap-2"
        >
          ⏹ Terminer le call
        </button>
      </div>
    </div>
  );
}
