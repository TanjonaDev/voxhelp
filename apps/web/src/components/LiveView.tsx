import { useState, useEffect, useRef } from "react";
import type { InsightCard, JobContext } from "@voxhelp/shared";

interface LiveViewProps {
  insights: InsightCard[];
  isAnalyzing: boolean;
  wsStatus: string;
  isCapturing: boolean;
  isSpeaking: boolean;
  onStartAudio: (jobContext?: JobContext) => Promise<void>;
  onStop: () => void;
  onTriggerAnalysis: () => void;
}

const SIGNAL_STYLES = {
  positive: { border: "border-[#0FAA6C]/30", bg: "bg-[#0FAA6C]/5", dot: "bg-[#0FAA6C]", text: "text-[#0FAA6C]" },
  weak: { border: "border-[#FF6B35]/30", bg: "bg-[#FF6B35]/5", dot: "bg-[#FF6B35]", text: "text-[#FF6B35]" },
  dig: { border: "border-[#3D5AFE]/30", bg: "bg-[#3D5AFE]/5", dot: "bg-[#3D5AFE]", text: "text-[#3D5AFE]" },
};

const CONFIDENCE_LABELS = {
  confirmed: { label: "Confirmé", style: "text-[#0FAA6C] bg-[#0FAA6C]/10" },
  partial: { label: "Partiel", style: "text-[#FF6B35] bg-[#FF6B35]/10" },
  vague: { label: "Flou", style: "text-[#5A5F72] bg-[#5A5F72]/10" },
};

function InsightCardView({ card }: { card: InsightCard }) {
  const s = SIGNAL_STYLES[card.signal.type];
  const c = CONFIDENCE_LABELS[card.confidence];
  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} p-3 space-y-2`}>
      <div className={`flex items-center gap-1.5 ${s.text} font-medium text-xs`}>
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
        {card.signal.label}
      </div>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-0.5">Ce que ça veut dire</p>
        <p className="text-xs text-[#1A1D26] leading-snug">{card.meaning}</p>
      </div>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wider text-[#5A5F72] mb-0.5">Question de relance</p>
        <p className="text-xs text-[#1A1D26] italic leading-snug">{card.followUp}</p>
      </div>
      <div className="flex justify-end">
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${c.style}`}>{c.label}</span>
      </div>
    </div>
  );
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

export function LiveView({ insights, isAnalyzing, wsStatus, isCapturing, isSpeaking, onStartAudio, onStop, onTriggerAnalysis }: LiveViewProps) {
  const feedEndRef = useRef<HTMLDivElement>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobLevel, setJobLevel] = useState("");
  const [jobStack, setJobStack] = useState("");
  const elapsed = useElapsedTime(isCapturing);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [insights, isAnalyzing]);

  const handleStart = async () => {
    const jobContext = jobTitle || jobLevel || jobStack
      ? { title: jobTitle, level: jobLevel, stack: jobStack }
      : undefined;
    await onStartAudio(jobContext);
    setAudioStarted(true);
  };

  return (
    <div className="h-screen bg-[#F6F7FB] flex flex-col">
      {/* Header compact */}
      <header className="bg-white border-b border-[#DFE1EA] px-3 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#3D5AFE] flex items-center justify-center">
            <span className="text-white text-[9px] font-bold">VH</span>
          </div>
          <span className="font-semibold text-[#1A1D26] text-xs">VoxHelp</span>
        </div>
        <div className={`flex items-center gap-1 text-[10px] ${wsStatus === "connected" ? "text-[#0FAA6C]" : "text-[#5A5F72]"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === "connected" ? "bg-[#0FAA6C]" : "bg-gray-300"}`} />
          {wsStatus === "connected" ? "Connecté" : wsStatus}
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sub-header */}
        <div className="px-3 py-1.5 bg-white border-b border-[#DFE1EA] flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5F72]">Analyse</span>
          {!audioStarted ? (
            <button onClick={handleStart} className="text-[10px] bg-[#3D5AFE] text-white px-2.5 py-1 rounded-md hover:bg-[#3451e0] transition-colors font-medium">
              Démarrer l'écoute
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[10px]">
                <div className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? "bg-[#3D5AFE] animate-pulse" : "bg-[#0FAA6C]"}`} />
                <span className={isSpeaking ? "text-[#3D5AFE]" : "text-[#0FAA6C]"}>{isSpeaking ? "Parole détectée" : "En écoute"}</span>
              </div>
              <button
                onClick={onTriggerAnalysis}
                className="text-[10px] bg-[#3D5AFE] text-white px-2.5 py-1 rounded-md hover:bg-[#3451e0] transition-colors font-medium"
              >
                Analyser ↵
              </button>
            </div>
          )}
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {/* Pre-session form */}
          {!audioStarted && (
            <div className="bg-white border border-[#DFE1EA] rounded-lg p-3 space-y-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#5A5F72]">Contexte du poste (optionnel)</p>
              <input
                type="text"
                placeholder="Titre — ex: Senior Frontend Dev"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full text-xs border border-[#DFE1EA] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#3D5AFE] bg-[#F6F7FB] text-[#1A1D26] placeholder-[#9BA3B2]"
              />
              <select
                value={jobLevel}
                onChange={(e) => setJobLevel(e.target.value)}
                className="w-full text-xs border border-[#DFE1EA] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#3D5AFE] bg-[#F6F7FB] text-[#1A1D26]"
              >
                <option value="">Niveau — non précisé</option>
                <option value="Junior">Junior</option>
                <option value="Intermédiaire">Intermédiaire</option>
                <option value="Senior">Senior</option>
                <option value="Lead">Lead</option>
              </select>
              <input
                type="text"
                placeholder="Stack — ex: React, TypeScript"
                value={jobStack}
                onChange={(e) => setJobStack(e.target.value)}
                className="w-full text-xs border border-[#DFE1EA] rounded-md px-2 py-1.5 focus:outline-none focus:border-[#3D5AFE] bg-[#F6F7FB] text-[#1A1D26] placeholder-[#9BA3B2]"
              />
            </div>
          )}

          {/* Empty state */}
          {audioStarted && insights.length === 0 && !isAnalyzing && (
            <div className="flex items-center justify-center h-full text-center text-[#5A5F72] py-8">
              <div>
                <div className="text-2xl mb-2">🎧</div>
                <p className="text-xs">En écoute...</p>
              </div>
            </div>
          )}

          {/* Cards */}
          {insights.map((card, i) => (
            <InsightCardView key={i} card={card} />
          ))}

          {/* Skeleton */}
          {isAnalyzing && (
            <div className="rounded-lg border border-[#DFE1EA] bg-white p-3 space-y-2 animate-pulse">
              <div className="h-3 bg-[#DFE1EA] rounded w-2/3" />
              <div className="space-y-1">
                <div className="h-2.5 bg-[#DFE1EA] rounded w-1/3" />
                <div className="h-2.5 bg-[#DFE1EA] rounded w-full" />
                <div className="h-2.5 bg-[#DFE1EA] rounded w-4/5" />
              </div>
              <div className="space-y-1">
                <div className="h-2.5 bg-[#DFE1EA] rounded w-1/3" />
                <div className="h-2.5 bg-[#DFE1EA] rounded w-3/4" />
              </div>
            </div>
          )}

          <div ref={feedEndRef} />
        </div>
      </div>

      {/* Bottom bar compact */}
      <div className="bg-white border-t border-[#DFE1EA] px-3 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          {isCapturing && <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-[#1A1D26] text-[10px] font-medium">{isCapturing ? `En cours · ${elapsed}` : "En attente"}</span>
        </div>
        <button onClick={onStop} className="bg-red-500 text-white px-3 py-1 rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-colors">
          ⏹ Arrêter
        </button>
      </div>
    </div>
  );
}
