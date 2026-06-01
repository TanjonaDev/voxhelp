import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { LiveView } from "./components/LiveView";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const ws = useWebSocket(WS_URL);
  const audio = useAudioCapture(ws.sendAudio);

  const handleStartAudio = async () => {
    ws.startSession({ language: "fr" });
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
    <LiveView
      transcripts={ws.transcripts}
      isBuffering={ws.isBuffering}
      techTranslations={ws.techTranslations}
      currentAssist={ws.currentAssist}
      assists={ws.assists}
      wsStatus={ws.status}
      isCapturing={audio.isCapturing}
      isSpeaking={audio.isSpeaking}
      onStartAudio={handleStartAudio}
      onStop={handleStop}
    />
  );
}
