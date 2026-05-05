import { useCallback, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";

type AudioSource = "microphone" | "tab";

interface UseAudioCaptureReturn {
  isCapturing: boolean;
  isSpeaking: boolean;
  audioSource: AudioSource | null;
  startMicrophone: () => Promise<void>;
  startTabCapture: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

function float32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const uint8 = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function useAudioCapture(
  onAudioChunk: (base64: string) => void
): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<Awaited<ReturnType<typeof MicVAD.new>> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startVAD = useCallback(
    async (stream: MediaStream, source: AudioSource) => {
      try {
        const vad = await MicVAD.new({
          getStream: async () => stream,
          baseAssetPath: "/",
          onnxWASMBasePath:
            "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/",
          model: "v5",
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          preSpeechPadMs: 200,
          redemptionMs: 400,
          onFrameProcessed: (probs, frame) => {
            if (probs.isSpeech > 0.5) {
              onAudioChunk(float32ToBase64(frame));
            }
          },
          onSpeechStart: () => setIsSpeaking(true),
          onSpeechEnd: (_audio: Float32Array) => setIsSpeaking(false),
          onVADMisfire: () => setIsSpeaking(false),
        });

        vadRef.current = vad;
        streamRef.current = stream;
        setAudioSource(source);
        setIsCapturing(true);
        setError(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "VAD initialization failed";
        setError(msg);
        stream.getTracks().forEach((t) => t.stop());
      }
    },
    [onAudioChunk]
  );

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      await startVAD(stream, "microphone");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Microphone access denied"
      );
    }
  }, [startVAD]);

  const startTabCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      stream.getVideoTracks().forEach((t) => t.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setError(
          "Aucun audio capturé. Assure-toi de cocher 'Partager l'audio' et de sélectionner l'onglet de ton appel."
        );
        return;
      }

      await startVAD(new MediaStream(audioTracks), "tab");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Tab audio capture denied"
      );
    }
  }, [startVAD]);

  const stop = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
    setIsSpeaking(false);
    setAudioSource(null);
  }, []);

  return {
    isCapturing,
    isSpeaking,
    audioSource,
    startMicrophone,
    startTabCapture,
    stop,
    error,
  };
}
