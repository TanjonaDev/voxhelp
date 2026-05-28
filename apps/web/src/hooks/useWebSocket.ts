import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SessionConfig, TranscriptEntry, TechTranslation } from "@voxhelp/shared";
import { createId, WS_PING_INTERVAL_MS } from "@voxhelp/shared";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface AssistMessage {
  id: string;
  text: string;
  timestamp: number;
}

interface UseWebSocketReturn {
  status: ConnectionStatus;
  transcripts: TranscriptEntry[];
  currentPartial: string;
  techTranslations: TechTranslation[];
  currentAssist: { text: string; isStreaming: boolean } | null;
  assists: AssistMessage[];
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
  const [techTranslations, setTechTranslations] = useState<TechTranslation[]>([]);
  const [currentAssist, setCurrentAssist] = useState<{ text: string; isStreaming: boolean } | null>(null);
  const [assists, setAssists] = useState<AssistMessage[]>([]);

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
        console.error("[WS] Session error:", msg.error);
        break;
      case "transcript:partial":
        setCurrentPartial(msg.text);
        break;
      case "transcript:final":
        setCurrentPartial("");
        setTranscripts((prev) => [
          ...prev,
          { id: createId(), text: msg.text, timestamp: Date.now() },
        ]);
        break;
      case "tech:translation":
        setTechTranslations((prev) => [msg.translation, ...prev].slice(0, 5));
        break;
      case "assist:start":
        setCurrentAssist({ text: "", isStreaming: true });
        break;
      case "assist:chunk":
        setCurrentAssist((prev) =>
          prev ? { ...prev, text: prev.text + msg.text } : null
        );
        break;
      case "assist:done":
        setCurrentAssist(null);
        setAssists((prev) => [
          ...prev,
          { id: createId(), text: msg.fullText, timestamp: Date.now() },
        ]);
        break;
      case "assist:error":
        setCurrentAssist(null);
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
      setTechTranslations([]);
      setCurrentAssist(null);
      setAssists([]);

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

  return { status, transcripts, currentPartial, techTranslations, currentAssist, assists, startSession, stopSession, sendAudio };
}
