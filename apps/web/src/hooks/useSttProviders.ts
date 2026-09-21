import { useCallback, useEffect, useState } from "react";
import type { SttProviderInfo, SttProvidersResponse } from "@voxhelp/shared";

const STORAGE_KEY = "voxhelp.sttProvider";

function readSavedProvider(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveProvider(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
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

export function useSttProviders(token: string): UseSttProvidersReturn {
  const [providers, setProviders] = useState<SttProviderInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`http://${window.location.hostname}:3001/api/stt/providers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const data = (await res.json()) as SttProvidersResponse;
        if (cancelled || !Array.isArray(data?.providers)) return;

        setProviders(data.providers);
        setSelected(pickInitialProvider(data, readSavedProvider()));
      } catch {
        // Liste indisponible : le menu reste masqué et le serveur applique son modèle par défaut.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const select = useCallback((id: string) => {
    setSelected(id);
    saveProvider(id);
  }, []);

  return { providers, selected, select };
}
