import { DeepgramClient } from "@deepgram/sdk";
import type { DeepgramUtterance } from "@voxhelp/lecture";

export interface TranscribeBatchOptions {
  language: string;
  keyterms?: string[];
}

export async function transcribeAudioBatch(
  buffer: Buffer,
  options: TranscribeBatchOptions
): Promise<DeepgramUtterance[]> {
  const client = new DeepgramClient();

  const response = await client.listen.v1.media.transcribeFile(buffer, {
    model: "nova-3",
    language: options.language,
    utterances: true,
    punctuate: true,
    smart_format: true,
    ...(options.keyterms && options.keyterms.length > 0 ? { keyterm: options.keyterms } : {}),
  });

  if (!("results" in response)) {
    throw new Error("Deepgram returned an accepted (async) response instead of a synchronous transcription result");
  }

  return response.results.utterances ?? [];
}
