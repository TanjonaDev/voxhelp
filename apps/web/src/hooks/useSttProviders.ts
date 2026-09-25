import { useCallback, useEffect, useState } from "react";
import type { SttProviderInfo, SttProvidersResponse } from "@voxhelp/shared";

/** `live` = modèle de l'entretien (en-tête), `batch` = modèle de transcription des fichiers (écran d'import des cours). */
export type SttKind = "live" | "batch";

const KINDS: Record<SttKind, { path: string; storageKey: string }> = {
  live: { path: "/api/stt/providers", storageKey: "voxhelp.sttProvider" },
  batch: { path: "/api/stt/batch-providers", storageKey: "voxhelp.batchSttProvider" },
};

function readSavedProvider(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function saveProvider(storageKey: string, id: string): void {
  try {
    window.localStorage.setItem(storageKey, id);
  } catch {
    // Stockage indisponible : le choix ne sera simplement pas mémorisé.
  }
}

/** Dernier choix mémorisé s'il est encore disponible, sinon le défaut du serveur, sinon le premier disponible. */
export function pickInitialProvider(data: SttProvidersResponse, saved: string | null): string | null {
  const isUsable = (id: string) => data.providers.some((p) => p.id === id && p.available);
  if (saved && isUsable(saved)) return saved;
  if (isUsable(data.default)) return data.default;
  return data.providers.find((p) => p.available)?.id ?? null;
}

interface UseSttProvidersReturn {
  providers: SttProviderInfo[];
  selected: string | null;
  select: (id: string) => void;
}

export function useSttProviders(token: string, kind: SttKind = "live"): UseSttProvidersReturn {
  const { path, storageKey } = KINDS[kind];
  const [providers, setProviders] = useState<SttProviderInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`http://${window.location.hostname}:3001${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const data = (await res.json()) as SttProvidersResponse;
        if (cancelled || !Array.isArray(data?.providers)) return;

        setProviders(data.providers);
        setSelected((prev) => pickInitialProvider(data, prev ?? readSavedProvider(storageKey)));
      } catch {
        // Liste indisponible : le menu reste masqué et le serveur applique son modèle par défaut.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, path, storageKey]);

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      saveProvider(storageKey, id);
    },
    [storageKey]
  );

  return { providers, selected, select };
}
