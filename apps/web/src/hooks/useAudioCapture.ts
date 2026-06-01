import { useCallback, useEffect, useRef, useState } from "react";

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

const TARGET_SAMPLE_RATE = 16000;
const PROCESSOR_BUFFER_SIZE = 4096;
// RMS thresholds — used only for the isSpeaking UI indicator, NOT to gate audio
const SPEAKING_THRESHOLD = 0.003;
const SILENCE_DEBOUNCE_MS = 500;

function float32ToPcm16Base64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function getRMS(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function useAudioCapture(
  onAudioChunk: (base64: string) => void
): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processorRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChunkRef = useRef(onAudioChunk);
  onChunkRef.current = onAudioChunk;

  const startCapture = useCallback(async (stream: MediaStream, source: AudioSource) => {
    const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    await ctx.resume();
    console.log("[AudioCapture] sampleRate:", ctx.sampleRate, "source:", source);

    const src = ctx.createMediaStreamSource(stream);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const frame = e.inputBuffer.getChannelData(0);

      // Always send audio — GroqSTT accumulates and applies RMS-based VAD server-side
      onChunkRef.current(float32ToPcm16Base64(new Float32Array(frame)));

      // RMS used only to drive the isSpeaking UI indicator
      const rms = getRMS(frame);
      if (rms > SPEAKING_THRESHOLD) {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        setIsSpeaking(true);
      } else {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            setIsSpeaking(false);
            silenceTimerRef.current = null;
          }, SILENCE_DEBOUNCE_MS);
        }
      }
    };

    src.connect(processor);
    // ScriptProcessorNode must be connected to destination to fire
    processor.connect(ctx.destination);

    ctxRef.current = ctx;
    processorRef.current = processor;
    streamRef.current = stream;
    setAudioSource(source);
    setIsCapturing(true);
    setError(null);
  }, []);

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      await startCapture(stream, "microphone");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, [startCapture]);

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
          "Aucun audio détecté. Choisis l'onglet et coche 'Partager l'audio du système'."
        );
        return;
      }

      await startCapture(new MediaStream(audioTracks), "tab");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tab capture refusé ou annulé");
    }
  }, [startCapture]);

  const stop = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    processorRef.current?.disconnect();
    ctxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    setIsCapturing(false);
    setIsSpeaking(false);
    setAudioSource(null);
  }, []);

  useEffect(() => stop, [stop]);

  return { isCapturing, isSpeaking, audioSource, startMicrophone, startTabCapture, stop, error };
}
