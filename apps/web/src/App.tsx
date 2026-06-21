import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { OverlayPanel } from "./components/OverlayPanel";
import type { JobContext } from "@voxhelp/shared";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const ws = useWebSocket(WS_URL);
  const audio = useAudioCapture(ws.sendAudio);

  const handleStartAudio = async (jobContext?: JobContext) => {
    ws.startSession({ language: "fr", jobContext });
    try {
      await audio.startTabCapture();
    } catch {
      await audio.startMicrophone();
    }
  };

  const handleStop = () => {
    ws.stopSession();
    audio.stop();
  };

  return (
    <OverlayPanel
      insights={ws.insights}
      isAnalyzing={ws.isAnalyzing}
      isSummarizing={ws.isSummarizing}
      finalReport={ws.finalReport}
      wsStatus={ws.status}
      isCapturing={audio.isCapturing}
      isSpeaking={audio.isSpeaking}
      lastTranscript={ws.lastTranscript}
      onStartAudio={handleStartAudio}
      onStop={handleStop}
      onSummarize={ws.summarize}
      onAskQuestion={ws.askQuestion}
      lastError={ws.lastError}
      onClearError={ws.clearError}
    />
  );
}
