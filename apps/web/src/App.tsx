import { useRef, useState } from "react";
import type {
  DemoStep,
  JobAnalysis,
  GeneratedQuestion,
  ScorecardCriterion,
  SessionConfig,
} from "@voxhelp/shared";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { PrepView } from "./components/PrepView";
import { LiveView } from "./components/LiveView";
import { ReportView } from "./components/ReportView";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const [step, setStep] = useState<DemoStep>("prep");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardCriterion[]>([]);
  const callStartRef = useRef<number | null>(null);
  const [callDuration, setCallDuration] = useState("00:00");

  const ws = useWebSocket(WS_URL);
  const audio = useAudioCapture(ws.sendAudio);

  const handleStartCall = (cfg: SessionConfig, analysis: JobAnalysis) => {
    const questionsWithIds = analysis.questions;
    const scorecardWithIds = analysis.scorecard;

    setConfig({ ...cfg, questions: questionsWithIds, scorecard: scorecardWithIds });
    setQuestions([...questionsWithIds]);
    setScorecard([...scorecardWithIds]);

    ws.startSession({ ...cfg, questions: questionsWithIds, scorecard: scorecardWithIds });
    callStartRef.current = Date.now();
    setStep("live");
  };

  const handleStartAudio = async () => {
    await audio.startTabCapture().catch(async () => {
      await audio.startMicrophone();
    });
  };

  const handleToggleQuestion = (id: string) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, isAsked: !q.isAsked } : q))
    );
    ws.markQuestionAsked(id);
  };

  const handleScoreCriterion = (criterionId: string, score: number) => {
    setScorecard((prev) =>
      prev.map((c) => (c.id === criterionId ? { ...c, score } : c))
    );
    ws.scoreCriterion(criterionId, score);
  };

  const handleEndCall = () => {
    ws.stopSession();
    audio.stop();

    if (callStartRef.current) {
      const elapsed = Math.floor((Date.now() - callStartRef.current) / 1000);
      const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const ss = String(elapsed % 60).padStart(2, "0");
      setCallDuration(`${mm}:${ss}`);
    }

    setStep("report");
  };

  const handleNewInterview = () => {
    ws.resetState();
    setConfig(null);
    setQuestions([]);
    setScorecard([]);
    callStartRef.current = null;
    setCallDuration("00:00");
    setStep("prep");
  };

  if (step === "prep") {
    return <PrepView onStartCall={handleStartCall} />;
  }

  if (step === "live" && config) {
    return (
      <LiveView
        config={config}
        transcripts={ws.transcripts}
        currentPartial={ws.currentPartial}
        techTranslations={ws.techTranslations}
        currentAssist={ws.currentAssist}
        assists={ws.assists}
        questions={questions}
        scorecard={scorecard}
        wsStatus={ws.status}
        isCapturing={audio.isCapturing}
        isSpeaking={audio.isSpeaking}
        onToggleQuestion={handleToggleQuestion}
        onScoreCriterion={handleScoreCriterion}
        onStartAudio={handleStartAudio}
        onEndCall={handleEndCall}
      />
    );
  }

  if (step === "report" && config) {
    return (
      <ReportView
        config={config}
        transcripts={ws.transcripts}
        scorecard={scorecard}
        callDuration={callDuration}
        onNewInterview={handleNewInterview}
      />
    );
  }

  return <PrepView onStartCall={handleStartCall} />;
}
