import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ServerMessage,
  ConnectionStatus,
  SessionConfig,
  TranscriptEntry,
  Suggestion,
} from "@voxhelp/shared";
import { createMessageId, WS_PING_INTERVAL_MS } from "@voxhelp/shared";

interface UseWebSocketReturn {
  status: ConnectionStatus;
  transcripts: TranscriptEntry[];
  currentPartial: string;
  suggestion: Suggestion | null;
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
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      // Start ping interval
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
      cleanup();
    };

    ws.onerror = () => {
      setStatus("error");
    };
  }, [url]);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "session:ready":
        break;

      case "transcript:partial":
        setCurrentPartial(msg.text);
        break;

      case "transcript:final":
        setCurrentPartial("");
        setTranscripts((prev) => [
          ...prev,
          {
            id: createMessageId(),
            text: msg.text,
            speaker: msg.speaker,
            timestamp: Date.now(),
            isFinal: true,
          },
        ]);
        break;

      case "suggestion:start":
        setSuggestion({
          id: createMessageId(),
          text: "",
          isStreaming: true,
          timestamp: Date.now(),
        });
        break;

      case "suggestion:chunk":
        setSuggestion((prev) =>
          prev ? { ...prev, text: prev.text + msg.text } : null
        );
        break;

      case "suggestion:done":
        setSuggestion((prev) =>
          prev ? { ...prev, text: msg.fullText, isStreaming: false } : null
        );
        break;

      case "suggestion:error":
        setSuggestion((prev) =>
          prev ? { ...prev, text: `Erreur: ${msg.error}`, isStreaming: false } : null
        );
        break;

      case "session:error":
        console.error("[WS] Session error:", msg.error);
        break;
    }
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendAudio = useCallback((base64: string) => {
    send({ type: "audio:chunk", data: base64 });
  }, [send]);

  const startSession = useCallback(
    (config: SessionConfig) => {
      if (status !== "connected") {
        connect();
        // Wait for connection then start
        const checkInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            send({ type: "session:start", config });
          }
        }, 100);
        return;
      }
      setTranscripts([]);
      setSuggestion(null);
      setCurrentPartial("");
      send({ type: "session:start", config });
    },
    [status, connect, send]
  );

  const stopSession = useCallback(() => {
    send({ type: "session:stop" });
  }, [send]);

  const cleanup = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      cleanup();
      wsRef.current?.close();
    };
  }, [connect, cleanup]);

  return {
    status,
    transcripts,
    currentPartial,
    suggestion,
    startSession,
    stopSession,
    sendAudio,
  };
}
