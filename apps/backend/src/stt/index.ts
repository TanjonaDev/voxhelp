import { FluxSTT } from "./providers/deepgram-flux.js";
import type { LiveStt, LiveSttCallbacks, LiveSttOptions } from "./types.js";

type LiveSttFactory = (options: LiveSttOptions, callbacks: LiveSttCallbacks) => LiveStt;

const DEFAULT_PROVIDER = "deepgram";

const LIVE_PROVIDERS: Record<string, LiveSttFactory> = {
  deepgram: (options, callbacks) => new FluxSTT(options.language, options.keyterms, callbacks),
};

function providerName(envVar: string): string {
  return process.env[envVar] || DEFAULT_PROVIDER;
}

function resolveProvider<T>(envVar: string, registry: Record<string, T>): T {
  const name = providerName(envVar);
  if (!Object.hasOwn(registry, name)) {
    throw new Error(`Unknown ${envVar} "${name}". Valid values: ${Object.keys(registry).join(", ")}`);
  }
  return registry[name];
}

export function createLiveStt(options: LiveSttOptions, callbacks: LiveSttCallbacks): LiveStt {
  return resolveProvider("STT_LIVE_PROVIDER", LIVE_PROVIDERS)(options, callbacks);
}
