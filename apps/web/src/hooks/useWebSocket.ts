import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, Insight, CandidateReport } from "@voxhelp/shared";
import { WS_PING_INTERVAL_MS } from "@voxhelp/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  insights: Insight[];
  finalReport: CandidateReport | null;
  startSession: (config: SessionConfig) => void;
  stopSession: () => void;
  sendAudio: (base64: string) => void;
  triggerAnalysis: () => void;
  summarize: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [finalReport, setFinalReport] = useState<CandidateReport | null>(null);

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
        setIsAnalyzing(false);
        setIsSummarizing(false);
        console.error("[WS] Session error:", msg.error);
        break;
      case "transcript:partial":
        setIsAnalyzing(true);
        break;
      case "transcript:buffering":
        setIsAnalyzing(true);
        break;
      case "transcript:idle":
        setIsAnalyzing(false);
        break;
      case "transcript:final":
        break;
      case "assist:card":
        setIsAnalyzing(false);
        setInsights((prev) => [...prev, msg.card]);
        break;
      case "assist:error":
        setIsAnalyzing(false);
        console.error("[WS] Assist error:", msg.error);
        break;
      case "analysis:final":
        setIsSummarizing(false);
        setFinalReport(msg.report);
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
      setIsAnalyzing(false);
      setIsSummarizing(false);
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    ws.onerror = () => setStatus("error");
  }, [url, send, handleMessage]);

  const startSession = useCallback(
    (config: SessionConfig) => {
      setIsAnalyzing(false);
      setIsSummarizing(false);
      setInsights([]);
      setFinalReport(null);

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

  const triggerAnalysis = useCallback(() => {
    send({ type: "trigger:analyze" });
  }, [send]);

  const summarize = useCallback(() => {
    setIsSummarizing(true);
    send({ type: "session:summarize" });
  }, [send]);

  useEffect(() => {
    connect();
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    status,
    isAnalyzing,
    isSummarizing,
    insights,
    finalReport,
    startSession,
    stopSession,
    sendAudio,
    triggerAnalysis,
    summarize,
  };
}
