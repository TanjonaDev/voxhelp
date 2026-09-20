import { DeepgramClient } from "@deepgram/sdk";
import type { SttUtterance } from "@voxhelp/lecture";

export interface TranscribeBatchOptions {
  language: string;
  keyterms?: string[];
}

export async function transcribeAudioBatch(
  buffer: Buffer,
  options: TranscribeBatchOptions
): Promise<SttUtterance[]> {
  const client = new DeepgramClient();

  const response = await client.listen.v1.media.transcribeFile(
    buffer,
    {
      model: "nova-3",
      language: options.language,
      utterances: true,
      punctuate: true,
      smart_format: true,
      ...(options.keyterms && options.keyterms.length > 0 ? { keyterm: options.keyterms } : {}),
    },
    // The SDK defaults to a 60s client-side timeout, too short for a full
    // course recording processed synchronously — a real run at ~2h just
    // over 60s got cut off client-side even though Deepgram kept working.
    { timeoutInSeconds: 600 }
  );

  if (!("results" in response)) {
    throw new Error("Deepgram returned an accepted (async) response instead of a synchronous transcription result");
  }

  return response.results.utterances ?? [];
}
