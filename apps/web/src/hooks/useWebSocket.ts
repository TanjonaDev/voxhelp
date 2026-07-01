import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, Insight, CandidateReport } from "@voxhelp/shared";
import { WS_PING_INTERVAL_MS } from "@voxhelp/shared";
import { parseAssistCard } from "../lib/parseAssistCard.js";
import { parsePartialAssist } from "../lib/parseAssistStream.js";
import type { PartialCard } from "../lib/parseAssistStream.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  isAnalyzing: boolean;
  isSummarizing: boolean;
  insights: Insight[];
  streamingCard: PartialCard | null;
  finalReport: CandidateReport | null;
  lastTranscript: string;
  lastError: string | null;
  startSession: (config: SessionConfig) => void;
  stopSession: () => void;
  sendAudio: (base64: string) => void;
  triggerAnalysis: () => void;
  summarize: () => void;
  askQuestion: (text: string) => void;
  clearError: () => void;
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingTextRef = useRef<string>("");
  const streamingTRef = useRef<string>("");

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [streamingCard, setStreamingCard] = useState<PartialCard | null>(null);
  const [finalReport, setFinalReport] = useState<CandidateReport | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);

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
        setLastError(msg.error);
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
        setLastTranscript(msg.text);
        break;
      case "assist:start":
        streamingTextRef.current = "";
        streamingTRef.current = msg.t;
        setStreamingCard({ id: msg.id, t: msg.t, cat: null, evidence: null, title: null, body: "", relance: null });
        setIsAnalyzing(true);
        break;
      case "assist:chunk":
        streamingTextRef.current += msg.text;
        setStreamingCard(parsePartialAssist(streamingTextRef.current, msg.id, streamingTRef.current));
        break;
      case "assist:done": {
        const parsed = parseAssistCard(msg.fullText);
        setStreamingCard(null);
        setIsAnalyzing(false);
        setInsights((prev) => [
          ...prev,
          {
            id: msg.id,
            t: streamingTRef.current,
            ...parsed,
            relance: parsed.relance ?? undefined,
          },
        ]);
        break;
      }
      case "assist:cancel":
        setStreamingCard(null);
        setIsAnalyzing(false);
        break;
      case "assist:error":
        setIsAnalyzing(false);
        setStreamingCard(null);
        setLastError(msg.error);
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
      setStreamingCard(null);
      setFinalReport(null);
      setLastTranscript("");

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

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  const askQuestion = useCallback(
    (text: string) => {
      send({ type: "ask:question", text });
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
    isAnalyzing,
    isSummarizing,
    insights,
    streamingCard,
    finalReport,
    lastTranscript,
    lastError,
    startSession,
    stopSession,
    sendAudio,
    triggerAnalysis,
    summarize,
    askQuestion,
    clearError,
  };
}
