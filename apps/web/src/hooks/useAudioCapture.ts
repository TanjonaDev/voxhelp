import { useCallback, useRef, useState } from "react";
import { AUDIO_SAMPLE_RATE, AUDIO_CHUNK_MS } from "@voxhelp/shared";

type AudioSource = "microphone" | "tab";

interface UseAudioCaptureReturn {
  isCapturing: boolean;
  audioSource: AudioSource | null;
  startMicrophone: () => Promise<void>;
  startTabCapture: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

export function useAudioCapture(
  onAudioChunk: (base64: string) => void
): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const setupAudioPipeline = useCallback(
    (stream: MediaStream, source: AudioSource) => {
      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      const sourceNode = audioContext.createMediaStreamSource(stream);

      // ScriptProcessor for raw PCM access
      // (AudioWorklet would be cleaner but ScriptProcessor is simpler for MVP)
      const bufferSize = Math.round(
        (AUDIO_SAMPLE_RATE * AUDIO_CHUNK_MS) / 1000
      );
      // Round to nearest power of 2
      const roundedBufferSize = Math.pow(
        2,
        Math.ceil(Math.log2(bufferSize))
      );
      const processor = audioContext.createScriptProcessor(
        roundedBufferSize,
        1,
        1
      );

      processor.onaudioprocess = (event) => {
        const float32 = event.inputBuffer.getChannelData(0);

        // Convert Float32 → Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert to base64
        const uint8 = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        onAudioChunk(base64);
      };

      sourceNode.connect(processor);
      processor.connect(audioContext.destination);

      streamRef.current = stream;
      contextRef.current = audioContext;
      processorRef.current = processor;
      setAudioSource(source);
      setIsCapturing(true);
      setError(null);
    },
    [onAudioChunk]
  );

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      setupAudioPipeline(stream, "microphone");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(msg);
    }
  }, [setupAudioPipeline]);

  const startTabCapture = useCallback(async () => {
    try {
      // getDisplayMedia with audio captures the tab's audio output
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by the API, we ignore the video track
        audio: true, // this captures the tab's audio
      });

      // Stop video track immediately (we don't need it)
      stream.getVideoTracks().forEach((track) => track.stop());

      // Check if we actually got an audio track
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setError(
          "Aucun audio capturé. Assure-toi de cocher 'Partager l'audio' et de sélectionner l'onglet de ton appel."
        );
        return;
      }

      // Create a new stream with only audio
      const audioStream = new MediaStream(audioTracks);
      setupAudioPipeline(audioStream, "tab");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Tab audio capture denied";
      setError(msg);
    }
  }, [setupAudioPipeline]);

  const stop = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
    setAudioSource(null);
  }, []);

  return {
    isCapturing,
    audioSource,
    startMicrophone,
    startTabCapture,
    stop,
    error,
  };
}
