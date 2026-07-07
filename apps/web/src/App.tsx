import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { OverlayPanel } from "./components/OverlayPanel";
import { LoginPage } from "./components/LoginPage";
import { VHMark } from "./components/ui.js";
import { isSupabaseConfigured } from "./lib/supabase.js";
import type { JobContext } from "@voxhelp/shared";

function buildWsUrl(token: string): string {
  return `ws://${window.location.hostname}:3001/ws?token=${encodeURIComponent(token)}`;
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <VHMark size={40} glow />
    </div>
  );
}

function ConfigMissingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 380 }}>
        <VHMark size={40} glow={false} />
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: "14px 0 6px" }}>Configuration Supabase manquante</h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans apps/web/.env, puis relance le serveur de dev.
        </p>
      </div>
    </div>
  );
}

interface SessionAppProps {
  token: string;
}

function SessionApp({ token }: SessionAppProps) {
  const [wsUrl] = useState(() => buildWsUrl(token));
  const ws = useWebSocket(wsUrl);
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
      streamingCard={ws.streamingCard}
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

export default function App() {
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured) return <ConfigMissingScreen />;
  if (loading) return <LoadingScreen />;
  if (!session) return <LoginPage />;

  return <SessionApp token={session.access_token} />;
}
