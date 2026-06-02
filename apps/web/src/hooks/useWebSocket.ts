import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, TranscriptEntry, InsightCard } from "@voxhelp/shared";
import { createId, WS_PING_INTERVAL_MS } from "@voxhelp/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  transcripts: TranscriptEntry[];
  currentPartial: string;
  isBuffering: boolean;
  isAnalyzing: boolean;
  insights: InsightCard[];
  startSession: (config: SessionConfig) => void;
  stopSession: () => void;
  sendAudio: (base64: string) => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [currentPartial, setCurrentPartial] = useState("");
  const [isBuffering, setIsBuffering] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [insights, setInsights] = useState<InsightCard[]>([]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "session:ready":
        break;
      case "session:error":
        setIsBuffering(false);
        setIsAnalyzing(false);
        console.error("[WS] Session error:", msg.error);
        break;
      case "transcript:partial":
        setCurrentPartial(msg.text);
        break;
      case "transcript:buffering":
        setIsBuffering(true);
        setIsAnalyzing(true);
        break;
      case "transcript:idle":
        setIsBuffering(false);
        setIsAnalyzing(false);
        break;
      case "transcript:final":
        setIsBuffering(false);
        setCurrentPartial("");
        setTranscripts((prev) => [
          ...prev,
          { id: createId(), text: msg.text, timestamp: Date.now() },
        ]);
        break;
      case "tech:translation":
        break;
      case "assist:start":
        break;
      case "assist:chunk":
        break;
      case "assist:done":
        break;
      case "assist:card":
        setIsAnalyzing(false);
        setInsights((prev) => [...prev, msg.card]);
        break;
      case "assist:error":
        setIsAnalyzing(false);
        console.error("[WS] Assist error:", msg.error);
        break;
      case "pong":
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      pingRef.current = setInterval(() => {
        send({ type: "ping" });
      }, WS_PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      setIsBuffering(false);
      setIsAnalyzing(false);
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    ws.onerror = () => setStatus("error");
  }, [url, send, handleMessage]);

  const startSession = useCallback(
    (config: SessionConfig) => {
      setTranscripts([]);
      setCurrentPartial("");
      setIsBuffering(false);
      setIsAnalyzing(false);
      setInsights([]);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: "session:start", config });
        return;
      }

      connect();
      const check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          send({ type: "session:start", config });
        }
      }, 100);
    },
    [connect, send]
  );

  const stopSession = useCallback(() => {
    send({ type: "session:stop" });
  }, [send]);

  const sendAudio = useCallback(
    (base64: string) => {
      send({ type: "audio:chunk", data: base64 });
    },
    [send]
  );

  useEffect(() => {
    connect();
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    status,
    transcripts,
    currentPartial,
    isBuffering,
    isAnalyzing,
    insights,
    startSession,
    stopSession,
    sendAudio,
  };
}
