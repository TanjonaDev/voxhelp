import type { SttProviderInfo } from "@voxhelp/shared";
import { FluxSTT } from "./providers/deepgram-flux.js";
import { deepgramBatchStt } from "./providers/deepgram-batch.js";
import { InworldSTT } from "./providers/inworld-live.js";
import type { BatchStt, LiveStt, LiveSttCallbacks, LiveSttOptions } from "./types.js";

type LiveSttFactory = (options: LiveSttOptions, callbacks: LiveSttCallbacks) => LiveStt;

interface LiveProviderEntry {
  label: string;
  /** Variable d'env dont la présence rend le fournisseur utilisable (clé API). */
  requiredEnv: string;
  create: LiveSttFactory;
}

interface BatchProviderEntry {
  label: string;
  /** Variable d'env dont la présence rend le fournisseur utilisable (clé API). */
  requiredEnv: string;
  transcriber: BatchStt;
}

const DEFAULT_PROVIDER = "deepgram";

// Source de vérité des modèles STT live : ajouter un fournisseur = un adapter +
// une entrée ici, et le menu du front se met à jour tout seul
// (GET /api/stt/providers).
const LIVE_PROVIDERS: Record<string, LiveProviderEntry> = {
  deepgram: {
    label: "Deepgram Flux",
    requiredEnv: "DEEPGRAM_API_KEY",
    create: (options, callbacks) => new FluxSTT(options.language, options.keyterms, callbacks),
  },
  inworld: {
    label: "Inworld",
    requiredEnv: "INWORLD_API_KEY",
    create: (options, callbacks) => new InworldSTT(options.language, options.keyterms, callbacks),
  },
};

// Source de vérité des modèles STT batch (transcription de fichiers, cours) : même
// principe que LIVE_PROVIDERS (GET /api/stt/batch-providers alimente le menu).
const BATCH_PROVIDERS: Record<string, BatchProviderEntry> = {
  deepgram: {
    label: "Deepgram Nova-3",
    requiredEnv: "DEEPGRAM_API_KEY",
    transcriber: deepgramBatchStt,
  },
};

/** Identifiant de modèle STT inconnu, demandé par un client. */
export class SttProviderError extends Error {}

/** L'identifiant vient du client : borné et sans caractère de contrôle avant d'être renvoyé ou journalisé. */
function describeProviderId(providerId: unknown): string {
  return String(providerId).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 64);
}

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

export function defaultLiveProviderId(): string {
  return providerName("STT_LIVE_PROVIDER");
}

export function defaultBatchProviderId(): string {
  return providerName("STT_BATCH_PROVIDER");
}

function listProviders(registry: Record<string, { label: string; requiredEnv: string }>): SttProviderInfo[] {
  return Object.entries(registry).map(([id, entry]) => ({
    id,
    label: entry.label,
    available: Boolean(process.env[entry.requiredEnv]),
  }));
}

export function listLiveProviders(): SttProviderInfo[] {
  return listProviders(LIVE_PROVIDERS);
}

export function listBatchProviders(): SttProviderInfo[] {
  return listProviders(BATCH_PROVIDERS);
}

/**
 * `providerId` (choisi par le client) l'emporte sur STT_LIVE_PROVIDER. Un modèle connu mais
 * sans clé n'est pas bloqué ici : l'adapter le signale par onError.
 */
export function createLiveStt(options: LiveSttOptions, callbacks: LiveSttCallbacks, providerId?: string): LiveStt {
  if (providerId === undefined || providerId === "") {
    return resolveProvider("STT_LIVE_PROVIDER", LIVE_PROVIDERS).create(options, callbacks);
  }
  if (!Object.hasOwn(LIVE_PROVIDERS, providerId)) {
    throw new SttProviderError(`Modèle STT inconnu : "${describeProviderId(providerId)}"`);
  }
  return LIVE_PROVIDERS[providerId].create(options, callbacks);
}

/**
 * `providerId` (choisi par le client) l'emporte sur STT_BATCH_PROVIDER ; absent ou vide = défaut
 * du serveur. Un modèle connu mais sans clé n'est pas bloqué ici : l'adapter échoue clairement.
 */
export function getBatchStt(providerId?: string): BatchStt {
  if (providerId === undefined || providerId === "") {
    return resolveProvider("STT_BATCH_PROVIDER", BATCH_PROVIDERS).transcriber;
  }
  if (!Object.hasOwn(BATCH_PROVIDERS, providerId)) {
    throw new SttProviderError(`Modèle STT inconnu : "${describeProviderId(providerId)}"`);
  }
  return BATCH_PROVIDERS[providerId].transcriber;
}

/** À appeler au démarrage du serveur : échoue vite sur une valeur d'env invalide. */
export function assertSttConfig(): void {
  resolveProvider("STT_LIVE_PROVIDER", LIVE_PROVIDERS);
  resolveProvider("STT_BATCH_PROVIDER", BATCH_PROVIDERS);
  console.log(`[STT] live=${providerName("STT_LIVE_PROVIDER")} batch=${providerName("STT_BATCH_PROVIDER")}`);
}
