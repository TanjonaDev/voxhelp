# Choix du modèle de transcription pour les cours — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choisir le modèle de transcription (Deepgram Nova-3 ou Inworld) sur l'écran d'import d'un cours, avec un adapter Inworld capable de transcrire des cours entiers.

**Architecture:** Le registre batch (`apps/backend/src/stt/index.ts`) prend la forme du registre live (id, libellé, clé requise) et une route liste les modèles. Les deux routes de transcription des cours acceptent `sttProvider`. L'adapter Inworld convertit le fichier avec ffmpeg (une passe : WAV 16 kHz mono + silences), le découpe en morceaux ≤ 720 s aux silences, les envoie à l'API synchrone d'Inworld (3 en parallèle, avec reprises) et reconstruit des énoncés à partir du texte ponctué et des mots horodatés.

**Tech Stack:** TypeScript strict (ESM, imports `.js` dans le backend), Fastify 5, vitest 4, `ffmpeg-static`, React 19 + Vite 6 (thème « cours » : `Field` / `Select` de `components/ui.js`).

**Spec:** `docs/superpowers/specs/2026-09-21-course-stt-model-selector-design.md`

## Global Constraints

- Node >= 22, TypeScript strict, **pas de `any` explicite**, ESM avec imports en `.js` dans le backend ; kebab-case fichiers, camelCase, PascalCase. React : composants fonctionnels + hooks, pas de Redux / CSS modules / styled-components.
- **Défaut inchangé** : sans `sttProvider`, `STT_BATCH_PROVIDER` (défaut `deepgram`) s'applique ; aucune nouvelle variable obligatoire. Les routes existantes répondent comme avant.
- Identifiants batch : `deepgram` (libellé `Deepgram Nova-3`, clé `DEEPGRAM_API_KEY`) et `inworld` (libellé `Inworld`, clé `INWORLD_API_KEY`).
- Contrat, noms exacts : route `GET /api/stt/batch-providers` → `SttProvidersResponse` (type partagé existant `{ default, providers: { id, label, available }[] }`) ; champ `sttProvider` (champ de formulaire de `transcribe-audio`, propriété JSON de `audio-chunk/finalize`). `sttProvider` non textuel → `400 { error: "Invalid sttProvider" }` ; id inconnu → `400 { error: 'Modèle STT inconnu : "<id>"' }` (message de `SttProviderError`) ; `undefined` ou `""` = défaut serveur. Le modèle est résolu **avant** le travail lourd ; sur `finalize`, un rejet nettoie l'upload (`cleanupUpload`).
- `localStorage` : clé `voxhelp.batchSttProvider` (la clé du live `voxhelp.sttProvider` reste inchangée). Champ masqué si la liste est vide, verrouillé pendant l'analyse.
- **Inworld sync (mesuré)** : URL `https://api.inworld.ai/stt/v1/transcribe`, `Authorization: Basic ${INWORLD_API_KEY}` (clé déjà en Base64, non ré-encodée), corps en snake_case : `transcribe_config { model_id: "inworld/inworld-stt-1", language, audio_encoding: "LINEAR16", sample_rate_hertz: 16000, include_word_timestamps: true, prompts? }` et `audio_data { content: <base64 WAV> }`. Limite dure : **32 Mio d'audio par appel** ; formats `WAV, MP3, OGG, FLAC, M4A, WebM` (pas mp4/m4v). Réponse : `transcription { transcript, isFinal, wordTimestamps: [{ word, startTimeMs, endTimeMs, confidence: 0 }] }`. `prompts` : mêmes règles que le live (réutiliser `sanitizeInworldPrompts`).
- Paramètres de l'adapter : cible de découpe **600 s**, fenêtre **±60 s**, queue minimale **30 s** (donc morceaux ≤ 720 s ≈ 23 Mo) ; concurrence **3** ; reprises **2** (délais **1000 ms** puis **3000 ms**) sur erreur réseau, `429` et `5xx`, jamais sur `4xx` ; délai d'une requête 180 s ; confiance inconnue = `UNKNOWN_CONFIDENCE = 0.9`.
- ffmpeg : arguments `-hide_banner -nostdin -nostats -y -i <in> -vn -ac 1 -ar 16000 -af silencedetect=noise=-35dB:d=0.4 -c:a pcm_s16le <out>` ; binaire = `FFMPEG_PATH` sinon `ffmpeg-static`. Dépendance à autoriser dans `pnpm.onlyBuiltDependencies` du `package.json` racine (pnpm 10 bloque sinon son script d'installation).
- Sécurité : **ne jamais écrire une clé API** (fichier, test, log, commit). `apps/backend/.env` et `apps/web/.env` contiennent de vraies clés : ne pas les lire, afficher ni stager. Les sous-agents **n'appellent aucune API réelle** ; les vérifications réelles sont faites par le contrôleur (Task 4). Les messages d'erreur ne contiennent ni clé ni contenu utilisateur.
- Le dépôt a 2 éléments non suivis sans rapport (`bilan-retours-voxhelp-tests.md`, `design_handoff_voxhelp_overlay/`) et un dossier ignoré `.superpowers/` : ne jamais les stager. Ne stager que les chemins nommés dans chaque tâche.
- Vérifications (racine) : backend `cd apps/backend && npx tsc --noEmit && npx vitest run` ; lecture `cd packages/lecture && npx tsc --noEmit && npx vitest run` ; web `cd apps/web && npx tsc --noEmit` et `pnpm --filter @voxhelp/web build`.
- **État de base** (branche `feat/course-stt-model-selector`, issue de `main` `e007fdd`) : backend 27 fichiers / 210 tests ; lecture 14 fichiers / 74 tests ; typechecks verts.
- Chaque message de commit se termine par ces deux lignes de trailer :
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
  ```

## Structure des fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `apps/backend/src/stt/index.ts` | Modifier | Registre batch (entrées), `listBatchProviders`, `defaultBatchProviderId`, `getBatchStt(providerId?)` |
| `apps/backend/src/routes.ts` | Modifier | `resolveBatchStt`, `sttProvider` sur les 2 routes, `GET /api/stt/batch-providers` |
| `apps/backend/src/stt/providers/inworld-wav.ts` | Créer | En-tête WAV, recherche du chunk `data` |
| `apps/backend/src/stt/providers/inworld-batch-plan.ts` | Créer | `parseSilences`, `planCuts` (pures) |
| `apps/backend/src/stt/providers/inworld-utterances.ts` | Créer | `buildUtterances` (pure) |
| `apps/backend/src/stt/providers/ffmpeg.ts` | Créer | Chemin du binaire, arguments, conversion + silences |
| `apps/backend/src/stt/providers/inworld-batch.ts` | Créer | Adapter `BatchStt` Inworld (orchestrateur) |
| `apps/backend/src/__tests__/stt-factory.test.ts` | Modifier | Tests du registre batch |
| `apps/backend/src/__tests__/stt-batch-providers-route.test.ts` | Créer | Route de liste |
| `apps/backend/src/__tests__/lecture-stt-provider.test.ts` | Créer | `sttProvider` sur les 2 routes |
| `apps/backend/src/__tests__/inworld-*.test.ts`, `ffmpeg.test.ts` | Créer | Tests de l'adapter (5 fichiers) |
| `package.json`, `apps/backend/package.json`, `pnpm-lock.yaml` | Modifier | Dépendance `ffmpeg-static` |
| `apps/web/src/hooks/useSttProviders.ts` | Modifier | Généralisé (`kind`) |
| `apps/web/src/lib/chunkedAudioUpload.ts`, `hooks/useCourseAnalysis.ts`, `lecture-cours/UploadScreen.tsx` | Modifier | Choix du modèle dans l'écran d'import |
| `CLAUDE.md`, `apps/backend/.env.example` | Modifier | Documentation |

---

### Task 1: Registre batch, route de liste et `sttProvider` sur les routes des cours

**Files:**
- Modify: `apps/backend/src/stt/index.ts`
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/__tests__/stt-factory.test.ts`
- Create: `apps/backend/src/__tests__/stt-batch-providers-route.test.ts`
- Create: `apps/backend/src/__tests__/lecture-stt-provider.test.ts`

**Interfaces:**
- Produces (utilisés par les Tasks 2 et 3) :
  ```ts
  // stt/index.ts
  export function listBatchProviders(): SttProviderInfo[]
  export function defaultBatchProviderId(): string
  export function getBatchStt(providerId?: string): BatchStt   // id inconnu -> SttProviderError
  ```
  Registre : `Record<string, { label: string; requiredEnv: string; transcriber: BatchStt }>` avec seulement `deepgram` dans cette tâche.

- [ ] **Step 1: Écrire les tests du registre (doivent échouer)**

Dans `apps/backend/src/__tests__/stt-factory.test.ts` :

1. Remplacer la ligne de destructuration de l'import dynamique de `../stt/index.js` par (garder les mêmes noms existants, ajouter `listBatchProviders` et `defaultBatchProviderId`) :
   ```ts
   const {
     createLiveStt, getBatchStt, assertSttConfig, listLiveProviders, defaultLiveProviderId, SttProviderError,
     listBatchProviders, defaultBatchProviderId,
   } = await import("../stt/index.js");
   ```
2. Ajouter à la fin du fichier :
   ```ts
   describe("getBatchStt with an explicit provider id", () => {
     it("returns the requested batch adapter", () => {
       expect(getBatchStt("deepgram")).toBe(deepgramBatchStt);
     });

     it("throws a SttProviderError for an unknown id", () => {
       expect(() => getBatchStt("whisper")).toThrow(SttProviderError);
       expect(() => getBatchStt("whisper")).toThrow('Modèle STT inconnu : "whisper"');
     });
   });

   describe("listBatchProviders", () => {
     it("lists the batch providers with their label and whether their API key is configured", () => {
       process.env.DEEPGRAM_API_KEY = "dg-test";

       expect(listBatchProviders()).toEqual([{ id: "deepgram", label: "Deepgram Nova-3", available: true }]);
     });
   });

   describe("defaultBatchProviderId", () => {
     it("is deepgram by default and follows STT_BATCH_PROVIDER", () => {
       expect(defaultBatchProviderId()).toBe("deepgram");

       process.env.STT_BATCH_PROVIDER = "inworld";

       expect(defaultBatchProviderId()).toBe("inworld");
     });
   });
   ```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts`
Expected: FAIL sur les 4 nouveaux tests (`listBatchProviders is not a function`, `defaultBatchProviderId is not a function`, id explicite ignoré). Les tests existants passent toujours.

- [ ] **Step 2: Étendre le registre**

Dans `apps/backend/src/stt/index.ts` :

- Après l'interface `LiveProviderEntry`, ajouter :
  ```ts
  interface BatchProviderEntry {
    label: string;
    /** Variable d'env dont la présence rend le fournisseur utilisable (clé API). */
    requiredEnv: string;
    transcriber: BatchStt;
  }
  ```
- Remplacer :
  ```ts
  const BATCH_PROVIDERS: Record<string, BatchStt> = {
    deepgram: deepgramBatchStt,
  };
  ```
  par :
  ```ts
  // Source de vérité des modèles STT batch (transcription de fichiers, cours) : même
  // principe que LIVE_PROVIDERS (GET /api/stt/batch-providers alimente le menu).
  const BATCH_PROVIDERS: Record<string, BatchProviderEntry> = {
    deepgram: {
      label: "Deepgram Nova-3",
      requiredEnv: "DEEPGRAM_API_KEY",
      transcriber: deepgramBatchStt,
    },
  };
  ```
- Remplacer la fonction `listLiveProviders` par ces trois fonctions :
  ```ts
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
  ```
- Ajouter, juste après `defaultLiveProviderId` :
  ```ts
  export function defaultBatchProviderId(): string {
    return providerName("STT_BATCH_PROVIDER");
  }
  ```
- Remplacer :
  ```ts
  export function getBatchStt(): BatchStt {
    return resolveProvider("STT_BATCH_PROVIDER", BATCH_PROVIDERS);
  }
  ```
  par :
  ```ts
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
  ```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts`
Expected: PASS, 14 tests (10 + 4).

- [ ] **Step 3: Écrire le test de la route de liste (doit échouer)**

Créer `apps/backend/src/__tests__/stt-batch-providers-route.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

describe("GET /api/stt/batch-providers", () => {
  let server: TestHttpServer;

  beforeEach(async () => {
    delete process.env.STT_BATCH_PROVIDER;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.INWORLD_API_KEY;
    server = await createTestHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("lists the batch providers with their availability and the default", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-test";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/batch-providers`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      default: "deepgram",
      providers: [{ id: "deepgram", label: "Deepgram Nova-3", available: true }],
    });
  });

  it("reports the STT_BATCH_PROVIDER value as the default", async () => {
    process.env.STT_BATCH_PROVIDER = "inworld";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/batch-providers`);

    expect((await res.json()).default).toBe("inworld");
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-batch-providers-route.test.ts`
Expected: FAIL (la route répond 404).

- [ ] **Step 4: Écrire les tests des routes de transcription (doivent échouer)**

Créer `apps/backend/src/__tests__/lecture-stt-provider.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

const batch = vi.hoisted(() => ({ transcribe: vi.fn(), getBatchStt: vi.fn() }));

vi.mock("../stt/index.js", () => {
  class SttProviderError extends Error {}
  return {
    getBatchStt: batch.getBatchStt,
    SttProviderError,
    listBatchProviders: () => [],
    defaultBatchProviderId: () => "deepgram",
    listLiveProviders: () => [],
    defaultLiveProviderId: () => "deepgram",
  };
});
vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

const { SttProviderError } = await import("../stt/index.js");

/** Les champs sont ajoutés AVANT le fichier : la route les lit avant de consommer le fichier. */
function multipart(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", new Blob([Buffer.from("fake audio")], { type: "audio/mpeg" }), "cours.mp3");
  return form;
}

describe("sttProvider on the course transcription routes", () => {
  let server: TestHttpServer;
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;

  beforeEach(async () => {
    batch.transcribe.mockReset();
    batch.getBatchStt.mockReset();
    batch.transcribe.mockResolvedValue([{ start: 0, end: 1, confidence: 0.9, transcript: "Bonjour." }]);
    batch.getBatchStt.mockImplementation((id?: string) => {
      if (id === "whisper") throw new SttProviderError('Modèle STT inconnu : "whisper"');
      return { transcribe: batch.transcribe };
    });
    server = await createTestHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const postAudio = (form: FormData) =>
    fetch(url("/api/lecture/transcribe-audio"), { method: "POST", body: form });

  async function chunkedUpload(): Promise<string> {
    const start = await fetch(url("/api/lecture/audio-chunk/start"), { method: "POST" });
    const { uploadId } = (await start.json()) as { uploadId: string };
    await fetch(url("/api/lecture/audio-chunk"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-upload-id": uploadId, "x-chunk-index": "0" },
      body: Buffer.from("fake audio"),
    });
    return uploadId;
  }

  const finalize = (body: unknown) =>
    fetch(url("/api/lecture/audio-chunk/finalize"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("transcribe-audio passes the sttProvider form field to getBatchStt", async () => {
    const res = await postAudio(multipart({ sttProvider: "inworld" }));

    expect(res.status).toBe(200);
    expect(batch.getBatchStt).toHaveBeenCalledWith("inworld");
    expect(batch.transcribe).toHaveBeenCalledTimes(1);
  });

  it("transcribe-audio uses the server default when no sttProvider is sent", async () => {
    const res = await postAudio(multipart({}));

    expect(res.status).toBe(200);
    expect(batch.getBatchStt).toHaveBeenCalledWith(undefined);
  });

  it("transcribe-audio answers 400 for an unknown sttProvider and does not transcribe", async () => {
    const res = await postAudio(multipart({ sttProvider: "whisper" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Modèle STT inconnu : "whisper"' });
    expect(batch.transcribe).not.toHaveBeenCalled();
  });

  it("finalize passes sttProvider from the JSON body to getBatchStt", async () => {
    const uploadId = await chunkedUpload();

    const res = await finalize({ uploadId, totalChunks: 1, language: "fr", sttProvider: "inworld" });

    expect(res.status).toBe(200);
    expect(batch.getBatchStt).toHaveBeenCalledWith("inworld");
    expect(batch.transcribe).toHaveBeenCalledTimes(1);
  });

  it("finalize answers 400 for an unknown sttProvider and does not transcribe", async () => {
    const uploadId = await chunkedUpload();

    const res = await finalize({ uploadId, totalChunks: 1, sttProvider: "whisper" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Modèle STT inconnu : "whisper"' });
    expect(batch.transcribe).not.toHaveBeenCalled();
  });

  it("finalize answers 400 when sttProvider is not a string", async () => {
    const uploadId = await chunkedUpload();

    const res = await finalize({ uploadId, totalChunks: 1, sttProvider: 5 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid sttProvider" });
    expect(batch.getBatchStt).not.toHaveBeenCalled();
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/lecture-stt-provider.test.ts`
Expected: FAIL (le champ `sttProvider` est ignoré : `getBatchStt` n'est jamais appelé avec l'identifiant, pas de 400).

- [ ] **Step 5: Brancher `routes.ts`**

Dans `apps/backend/src/routes.ts` :

**(a) Imports.** Remplacer `import { defaultLiveProviderId, getBatchStt, listLiveProviders } from "./stt/index.js";` par :
```ts
import {
  SttProviderError,
  defaultBatchProviderId,
  defaultLiveProviderId,
  getBatchStt,
  listBatchProviders,
  listLiveProviders,
} from "./stt/index.js";
import type { BatchStt } from "./stt/types.js";
```

**(b) `runTranscription` reçoit l'adapter résolu.** Remplacer :
```ts
async function runTranscription(
  buffer: Buffer,
  language: string,
  existingGlossary: GlossaryEntry[]
): Promise<TranscriptSegment[]> {
  const utterances = await getBatchStt().transcribe(buffer, {
```
par :
```ts
/** Résout le modèle batch demandé (chaîne du client, non fiable). `undefined` = défaut du serveur. */
function resolveBatchStt(requested: unknown): { ok: true; batchStt: BatchStt } | { ok: false; error: string } {
  if (requested !== undefined && typeof requested !== "string") {
    return { ok: false, error: "Invalid sttProvider" };
  }
  try {
    return { ok: true, batchStt: getBatchStt(requested) };
  } catch (err) {
    if (err instanceof SttProviderError) return { ok: false, error: err.message };
    throw err;
  }
}

async function runTranscription(
  buffer: Buffer,
  language: string,
  existingGlossary: GlossaryEntry[],
  batchStt: BatchStt
): Promise<TranscriptSegment[]> {
  const utterances = await batchStt.transcribe(buffer, {
```

**(c) Route `transcribe-audio`.** Juste avant la ligne `let buffer: Buffer;` de cette route, insérer :
```ts
    const requestedProvider = (file.fields.sttProvider as { value?: string } | undefined)?.value;
    const resolved = resolveBatchStt(requestedProvider);
    if (!resolved.ok) {
      return reply.code(400).send({ error: resolved.error });
    }

```
et remplacer, dans cette même route, `const transcript = await runTranscription(buffer, language, existingGlossary);` par `const transcript = await runTranscription(buffer, language, existingGlossary, resolved.batchStt);`.

**(d) Route `audio-chunk/finalize`.** Dans le type de `body`, ajouter `sttProvider: unknown` à `Partial<{ uploadId: string; totalChunks: number; language: string; existingGlossary: GlossaryEntry[] }>` (il devient `Partial<{ …; sttProvider: unknown }>`). Juste après la ligne `const existingGlossary = Array.isArray(body?.existingGlossary) ? body.existingGlossary : [];`, insérer :
```ts
    const resolved = resolveBatchStt(body?.sttProvider);
    if (!resolved.ok) {
      await cleanupUpload(uploadId).catch(() => {});
      return reply.code(400).send({ error: resolved.error });
    }
```
et remplacer, dans cette route, `const transcript = await runTranscription(buffer, language, existingGlossary);` par `const transcript = await runTranscription(buffer, language, existingGlossary, resolved.batchStt);`.

**(e) Nouvelle route de liste.** Juste après la route `app.get("/api/stt/providers", …)`, ajouter (bloc de contrôle de jeton copié tel quel, comme les autres routes : ne pas le refactorer) :
```ts
  app.get("/api/stt/batch-providers", async (request, reply) => {
    if (supabaseAdmin) {
      const auth = request.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) {
        return reply.code(401).send({ error: "Missing token" });
      }
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        return reply.code(401).send({ error: "Invalid token" });
      }
    }

    const body: SttProvidersResponse = { default: defaultBatchProviderId(), providers: listBatchProviders() };
    return reply.send(body);
  });
```

- [ ] **Step 6: Vérifier**

Run: `cd apps/backend && npx vitest run src/__tests__/stt-batch-providers-route.test.ts src/__tests__/lecture-stt-provider.test.ts src/__tests__/stt-factory.test.ts`
Expected: PASS (2 + 6 + 14 tests).

Run: `cd apps/backend && npx tsc --npx tsc --noEmit` **non** : lancer `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 29 fichiers / 222 tests (210 + 4 fabrique + 2 route de liste + 6 routes de transcription). Les deux tests `lecture-transcribe` / `lecture-audio-chunk` passent **sans modification** (leur mock de `../stt/index.js` n'expose que `getBatchStt`, et `SttProviderError` n'est lue que dans le chemin d'erreur). S'ils échouent, ajouter `SttProviderError` à leur mock et le signaler.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/stt/index.ts apps/backend/src/routes.ts apps/backend/src/__tests__/stt-factory.test.ts apps/backend/src/__tests__/stt-batch-providers-route.test.ts apps/backend/src/__tests__/lecture-stt-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(stt): choose the batch STT model per course transcription

Le registre batch prend la forme du registre live (id, libellé, clé
requise). GET /api/stt/batch-providers liste les modèles ; les routes
transcribe-audio et audio-chunk/finalize acceptent sttProvider (défaut
serveur inchangé, id inconnu ou non textuel = 400).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 2: Adapter Inworld pour les fichiers (ffmpeg, découpage, énoncés)

**Files:**
- Create: `apps/backend/src/stt/providers/inworld-wav.ts`, `inworld-batch-plan.ts`, `inworld-utterances.ts`, `ffmpeg.ts`, `inworld-batch.ts`
- Create: `apps/backend/src/__tests__/inworld-wav.test.ts`, `inworld-batch-plan.test.ts`, `inworld-utterances.test.ts`, `ffmpeg.test.ts`, `inworld-batch.test.ts`
- Modify: `apps/backend/src/stt/index.ts` (entrée `inworld`)
- Modify: `apps/backend/src/__tests__/stt-factory.test.ts`, `apps/backend/src/__tests__/stt-batch-providers-route.test.ts`
- Modify: `package.json` (racine), `apps/backend/package.json`, `pnpm-lock.yaml`
- Modify: `apps/backend/.env.example`, `CLAUDE.md`

**Interfaces:**
- Consumes: `BatchStt`, `BatchTranscribeOptions` (`stt/types.ts`), `sanitizeInworldPrompts` (`inworld-prompts.ts`), `SttUtterance` (`@voxhelp/lecture`), `AUDIO_SAMPLE_RATE` (`@voxhelp/shared`), le registre de la Task 1.
- Produces :
  ```ts
  // inworld-wav.ts
  export const BYTES_PER_SECOND: number   // 32000
  export function wavFromPcm(pcm: Buffer): Buffer
  export function findDataChunk(head: Buffer): { offset: number; size: number } | null
  // inworld-batch-plan.ts
  export interface Silence { start: number; end: number }
  export interface PlanOptions { targetSec: number; windowSec: number; minTailSec: number }
  export const DEFAULT_PLAN: PlanOptions
  export function parseSilences(stderr: string): Silence[]
  export function planCuts(totalSec: number, silences: readonly Silence[], options?: PlanOptions): number[]
  // inworld-utterances.ts
  export interface InworldWord { word: string; startTimeMs: number; endTimeMs: number }
  export const UNKNOWN_CONFIDENCE: number  // 0.9
  export function buildUtterances(transcript: string, words: readonly InworldWord[], offsetSec: number, segmentDurationSec: number): SttUtterance[]
  // ffmpeg.ts
  export function resolveFfmpegPath(): string
  export function ffmpegArgs(input: string, output: string): string[]
  export function convertToWav16kMono(input: string, output: string): Promise<{ silences: Silence[] }>
  // inworld-batch.ts
  export interface InworldBatchDeps { fetchFn; convert; plan; sleep }
  export function createInworldBatchStt(overrides?: Partial<InworldBatchDeps>): BatchStt
  export const inworldBatchStt: BatchStt
  ```

- [ ] **Step 1: Installer la dépendance**

Dans `package.json` (racine), ajouter `"ffmpeg-static"` à la liste `pnpm.onlyBuiltDependencies` (elle devient `["@prisma/engines", "prisma", "@prisma/client", "esbuild", "protobufjs", "ffmpeg-static"]`). Puis :

Run: `pnpm --filter @voxhelp/backend add ffmpeg-static`
Expected: `ffmpeg-static` apparaît dans `apps/backend/package.json` et `pnpm-lock.yaml` ; le binaire est téléchargé.

Run: `cd apps/backend && node -e "const p=require('ffmpeg-static');console.log(p);require('fs').accessSync(p,require('fs').constants.X_OK);console.log('binaire exécutable OK')"`
Expected: un chemin sous `node_modules/.pnpm/ffmpeg-static…/ffmpeg` puis `binaire exécutable OK`. Si le binaire est absent (script d'installation bloqué), vérifier l'entrée `onlyBuiltDependencies` puis `pnpm rebuild ffmpeg-static`.

- [ ] **Step 2: Helpers WAV — tests puis code**

Créer `apps/backend/src/__tests__/inworld-wav.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { BYTES_PER_SECOND, findDataChunk, wavFromPcm } from "../stt/providers/inworld-wav.js";

describe("wavFromPcm", () => {
  it("wraps PCM16 mono 16 kHz data in a canonical 44-byte header", () => {
    const pcm = Buffer.alloc(3200, 1);

    const wav = wavFromPcm(pcm);

    expect(wav.length).toBe(44 + 3200);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 3200);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(BYTES_PER_SECOND);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(3200);
  });
});

describe("findDataChunk", () => {
  it("finds the data chunk after extra chunks such as the LIST chunk ffmpeg writes", () => {
    const riff = Buffer.alloc(12);
    riff.write("RIFF", 0);
    riff.write("WAVE", 8);
    const fmt = Buffer.alloc(24);
    fmt.write("fmt ", 0);
    fmt.writeUInt32LE(16, 4);
    const list = Buffer.alloc(14); // 8 d'en-tête + 5 de contenu + 1 de bourrage (taille impaire)
    list.write("LIST", 0);
    list.writeUInt32LE(5, 4);
    const data = Buffer.alloc(8);
    data.write("data", 0);
    data.writeUInt32LE(96000, 4);

    expect(findDataChunk(Buffer.concat([riff, fmt, list, data]))).toEqual({ offset: 12 + 24 + 14 + 8, size: 96000 });
  });

  it("returns null when the header is not a WAV or is truncated before the data chunk", () => {
    expect(findDataChunk(Buffer.from("not a wav file at all"))).toBeNull();
    expect(findDataChunk(wavFromPcm(Buffer.alloc(4)).subarray(0, 30))).toBeNull();
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-wav.test.ts` — Expected: FAIL (`Failed to resolve import`).

Créer `apps/backend/src/stt/providers/inworld-wav.ts` :

```ts
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";

/** PCM16 mono : 2 octets par échantillon. */
export const BYTES_PER_SECOND = AUDIO_SAMPLE_RATE * 2;

/** Enveloppe des données PCM16 mono 16 kHz dans un WAV canonique (en-tête de 44 octets). */
export function wavFromPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Position et taille déclarée du chunk `data` dans les premiers octets d'un WAV. ffmpeg écrit un
 * chunk `LIST` : l'en-tête n'a pas toujours 44 octets, il faut le parser.
 */
export function findDataChunk(head: Buffer): { offset: number; size: number } | null {
  if (head.length < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let position = 12;
  while (position + 8 <= head.length) {
    const id = head.toString("ascii", position, position + 4);
    const size = head.readUInt32LE(position + 4);
    if (id === "data") return { offset: position + 8, size };
    position += 8 + size + (size % 2);
  }
  return null;
}
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-wav.test.ts` — Expected: PASS, 3 tests.

- [ ] **Step 3: Silences et découpage — tests puis code**

Créer `apps/backend/src/__tests__/inworld-batch-plan.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { parseSilences, planCuts } from "../stt/providers/inworld-batch-plan.js";

const OPTIONS = { targetSec: 600, windowSec: 60, minTailSec: 30 };
const silence = (middle: number, length: number) => ({ start: middle - length / 2, end: middle + length / 2 });

describe("parseSilences", () => {
  it("pairs silence_start and silence_end lines, ignoring progress noise and clamping a negative start", () => {
    const stderr = [
      "size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x    [silencedetect @ 0x1] silence_start: -0.0023",
      "[silencedetect @ 0x1] silence_end: 1.3284 | silence_duration: 1.3307",
      "frame=  1 fps=0.0 q=-0.0 size=N/A time=00:00:11.00 bitrate=N/A",
      "[silencedetect @ 0x1] silence_start: 10.8467",
      "[silencedetect @ 0x1] silence_end: 11.3835 | silence_duration: 0.536854",
    ].join("\r\n");

    expect(parseSilences(stderr)).toEqual([
      { start: 0, end: 1.3284 },
      { start: 10.8467, end: 11.3835 },
    ]);
  });

  it("ignores a final silence that never ends (audio ending in silence)", () => {
    const stderr =
      "[silencedetect @ 0x1] silence_start: 5\n[silencedetect @ 0x1] silence_end: 6 | silence_duration: 1\n[silencedetect @ 0x1] silence_start: 90";

    expect(parseSilences(stderr)).toEqual([{ start: 5, end: 6 }]);
  });
});

describe("planCuts", () => {
  it("does not cut audio that fits in one segment", () => {
    expect(planCuts(500, [silence(300, 2)], OPTIONS)).toEqual([]);
    expect(planCuts(629, [], OPTIONS)).toEqual([]);
  });

  it("cuts in the middle of the silence closest to each multiple of the target", () => {
    const cuts = planCuts(1815, [silence(595, 3), silence(1215, 3)], OPTIONS);

    expect(cuts).toEqual([595, 1215]);
  });

  it("prefers the longest silence in the window, then the closest to the target", () => {
    expect(planCuts(1000, [silence(560, 1), silence(650, 4)], OPTIONS)).toEqual([650]);
    expect(planCuts(1000, [silence(630, 2), silence(590, 2)], OPTIONS)).toEqual([590]);
  });

  it("cuts exactly at the target when no silence is close enough", () => {
    expect(planCuts(1000, [silence(500, 5), silence(700, 5)], OPTIONS)).toEqual([600]);
  });

  it("keeps every segment within target + 2×window and never leaves a tiny tail", () => {
    const total = 7385;
    const silences = Array.from({ length: 12 }, (_, i) => silence(i * 600 + 45 + (i % 2) * 20, 1.5));

    const cuts = planCuts(total, silences, OPTIONS);

    const bounds = [0, ...cuts, total];
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i] - bounds[i - 1]).toBeGreaterThan(0);
      expect(bounds[i] - bounds[i - 1]).toBeLessThanOrEqual(OPTIONS.targetSec + 2 * OPTIONS.windowSec);
    }
    expect(total - cuts[cuts.length - 1]).toBeGreaterThanOrEqual(OPTIONS.minTailSec);
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-batch-plan.test.ts` — Expected: FAIL (`Failed to resolve import`).

Créer `apps/backend/src/stt/providers/inworld-batch-plan.ts` :

```ts
export interface Silence {
  start: number;
  end: number;
}

export interface PlanOptions {
  /** Durée visée d'un morceau (s). */
  targetSec: number;
  /** On cherche le silence à ±windowSec du multiple de targetSec (doit rester < targetSec / 2). */
  windowSec: number;
  /** Pas de coupe si le reste après elle serait plus court (s). */
  minTailSec: number;
}

// Morceaux <= targetSec + 2×windowSec = 720 s (~23 Mo en PCM16 16 kHz), sous la limite de 32 Mio
// d'audio par appel de l'API synchrone d'Inworld.
export const DEFAULT_PLAN: PlanOptions = { targetSec: 600, windowSec: 60, minTailSec: 30 };

const SILENCE_START = /silence_start: (-?\d+(?:\.\d+)?)/g;
const SILENCE_END = /silence_end: (-?\d+(?:\.\d+)?)/g;

/**
 * Silences détectés par le filtre `silencedetect` d'ffmpeg (sortie stderr). Un silence sans fin
 * (l'audio se termine en silence) est ignoré.
 */
export function parseSilences(stderr: string): Silence[] {
  const starts = [...stderr.matchAll(SILENCE_START)].map((match) => Math.max(0, Number(match[1])));
  const ends = [...stderr.matchAll(SILENCE_END)].map((match) => Number(match[1]));
  const silences: Silence[] = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    if (ends[i] > starts[i]) silences.push({ start: starts[i], end: ends[i] });
  }
  return silences;
}

/**
 * Instants (s) où couper l'audio : près de chaque multiple de targetSec, au milieu du plus long
 * silence dans ±windowSec (à égalité, le plus proche du multiple), sinon exactement au multiple.
 */
export function planCuts(totalSec: number, silences: readonly Silence[], options: PlanOptions = DEFAULT_PLAN): number[] {
  const { targetSec, windowSec, minTailSec } = options;
  const cuts: number[] = [];

  for (let k = 1; k * targetSec < totalSec - minTailSec; k++) {
    const target = k * targetSec;
    let best: { at: number; length: number; distance: number } | null = null;

    for (const silence of silences) {
      const at = (silence.start + silence.end) / 2;
      const distance = Math.abs(at - target);
      if (distance > windowSec) continue;
      const length = silence.end - silence.start;
      if (!best || length > best.length || (length === best.length && distance < best.distance)) {
        best = { at, length, distance };
      }
    }

    cuts.push(best ? best.at : target);
  }

  return cuts;
}
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-batch-plan.test.ts` — Expected: PASS, 7 tests.

- [ ] **Step 4: Énoncés à partir du texte et des mots — tests puis code**

Créer `apps/backend/src/__tests__/inworld-utterances.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { buildUtterances, UNKNOWN_CONFIDENCE, type InworldWord } from "../stt/providers/inworld-utterances.js";

/** Un mot toutes les 500 ms, chacun durant 400 ms (comme les mots horodatés d'Inworld : sans ponctuation). */
function timedWords(words: string[]): InworldWord[] {
  return words.map((word, i) => ({ word, startTimeMs: i * 500, endTimeMs: i * 500 + 400 }));
}

describe("buildUtterances", () => {
  it("splits on sentence punctuation and times each sentence from its first and last word", () => {
    const words = timedWords(["Bonjour", "tout", "le", "monde", "Ça", "va", "Très", "bien"]);

    const result = buildUtterances("Bonjour tout le monde. Ça va ? Très bien !", words, 0, 10);

    expect(result).toEqual([
      { start: 0, end: 1.9, transcript: "Bonjour tout le monde.", confidence: UNKNOWN_CONFIDENCE },
      { start: 2, end: 2.9, transcript: "Ça va ?", confidence: UNKNOWN_CONFIDENCE },
      { start: 3, end: 3.9, transcript: "Très bien !", confidence: UNKNOWN_CONFIDENCE },
    ]);
  });

  it("keeps a standalone French question mark out of the word alignment", () => {
    const words = timedWords(["Quelle", "forme", "Quelle", "durée"]);

    const result = buildUtterances("Quelle forme ? Quelle durée ?", words, 0, 10);

    expect(result.map((u) => u.transcript)).toEqual(["Quelle forme ?", "Quelle durée ?"]);
    expect(result.map((u) => [u.start, u.end])).toEqual([
      [0, 0.9],
      [1, 1.9],
    ]);
  });

  it("applies the segment offset to every timestamp", () => {
    const result = buildUtterances("Un deux. Trois.", timedWords(["Un", "deux", "Trois"]), 600, 10);

    expect(result.map((u) => u.start)).toEqual([600, 601]);
    expect(result[1].end).toBeCloseTo(601.4);
  });

  it("keeps hyphens and apostrophes inside a single word", () => {
    const result = buildUtterances("Peut-être qu'il vient.", timedWords(["Peut-être", "qu'il", "vient"]), 0, 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 1.4, transcript: "Peut-être qu'il vient." });
  });

  it("falls back to a proportional mapping when the word counts differ", () => {
    // 6 mots dans le texte, 5 mots horodatés (le modèle en a fusionné deux)
    const words = timedWords(["un", "deux", "trois", "quatre", "cinq"]);

    const result = buildUtterances("un deux trois quatre. cinq six.", words, 0, 10);

    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(0);
    expect(result[1].end).toBe(words[4].endTimeMs / 1000);
    expect(result[0].end).toBeLessThanOrEqual(result[1].start);
  });

  it("splits a very long sentence into chunks of at most 40 words", () => {
    const tokens = Array.from({ length: 100 }, (_, i) => `mot${i}`);
    const text = `${tokens.join(" ")}.`;

    const result = buildUtterances(text, timedWords(tokens), 0, 100);

    expect(result.map((u) => u.transcript.split(/\s+/).length)).toEqual([40, 40, 20]);
    expect(result.map((u) => u.transcript).join(" ")).toBe(text);
    expect(result[1].start).toBe(20);
  });

  it("returns a single utterance spanning the segment when there are no timed words", () => {
    const result = buildUtterances("Bonjour tout le monde.", [], 600, 42);

    expect(result).toEqual([{ start: 600, end: 642, transcript: "Bonjour tout le monde.", confidence: UNKNOWN_CONFIDENCE }]);
  });

  it("returns nothing for a blank transcript", () => {
    expect(buildUtterances("   ", timedWords(["a"]), 0, 10)).toEqual([]);
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-utterances.test.ts` — Expected: FAIL (`Failed to resolve import`).

Créer `apps/backend/src/stt/providers/inworld-utterances.ts` :

```ts
import type { SttUtterance } from "@voxhelp/lecture";

export interface InworldWord {
  word: string;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * Inworld renvoie une confiance de 0 pour chaque mot ; le pipeline cours affiche celle de chaque
 * segment au LLM (`(0.00)` partout serait trompeur) : valeur neutre.
 */
export const UNKNOWN_CONFIDENCE = 0.9;

const MAX_UTTERANCE_WORDS = 60;
const CHUNK_WORDS = 40;

// Un « mot » = lettres/chiffres avec apostrophes ou traits d'union internes : un `?` isolé
// (typographie française, « mot ? ») n'en est pas un, sinon l'alignement se décale d'un cran.
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const SENTENCE_END = /[.!?…]+(?=\s|$)/gu;

interface Token {
  start: number;
  end: number;
}

interface SentenceRange {
  from: number;
  to: number; // exclusif, en indices de mots
  charEnd: number;
}

/**
 * Énoncés d'un morceau : le texte ponctué est coupé après `. ! ? …`, chaque mot du texte est
 * aligné sur un mot horodaté (un pour un, sinon proportionnellement), les temps sont décalés de
 * `offsetSec` (début du morceau dans le cours).
 */
export function buildUtterances(
  transcript: string,
  words: readonly InworldWord[],
  offsetSec: number,
  segmentDurationSec: number
): SttUtterance[] {
  if (transcript.trim() === "") return [];

  const tokens: Token[] = [...transcript.matchAll(WORD)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

  if (tokens.length === 0 || words.length === 0) {
    return [
      { start: offsetSec, end: offsetSec + segmentDurationSec, transcript: transcript.trim(), confidence: UNKNOWN_CONFIDENCE },
    ];
  }

  const wordIndexOf = (tokenIndex: number): number =>
    tokens.length === words.length
      ? tokenIndex
      : Math.min(words.length - 1, Math.floor((tokenIndex * words.length) / tokens.length));

  const ranges: SentenceRange[] = [];
  let from = 0;
  for (const match of transcript.matchAll(SENTENCE_END)) {
    const charEnd = match.index + match[0].length;
    let to = from;
    while (to < tokens.length && tokens[to].end <= charEnd) to++;
    if (to > from) {
      ranges.push({ from, to, charEnd });
      from = to;
    }
  }
  if (from < tokens.length) ranges.push({ from, to: tokens.length, charEnd: transcript.length });

  const utterances: SttUtterance[] = [];
  let previousCharEnd = 0;
  for (const range of ranges) {
    const size = range.to - range.from;
    const step = size > MAX_UTTERANCE_WORDS ? CHUNK_WORDS : size;
    for (let a = range.from; a < range.to; a += step) {
      const b = Math.min(range.to, a + step);
      const text = transcript
        .slice(a === range.from ? previousCharEnd : tokens[a].start, b === range.to ? range.charEnd : tokens[b].start)
        .trim();
      const first = words[wordIndexOf(a)];
      const last = words[wordIndexOf(b - 1)];
      utterances.push({
        start: offsetSec + first.startTimeMs / 1000,
        end: offsetSec + last.endTimeMs / 1000,
        transcript: text,
        confidence: UNKNOWN_CONFIDENCE,
      });
    }
    previousCharEnd = range.charEnd;
  }
  return utterances;
}
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-utterances.test.ts` — Expected: PASS, 8 tests.

- [ ] **Step 5: ffmpeg — tests puis code**

Créer `apps/backend/src/__tests__/ffmpeg.test.ts` :

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { convertToWav16kMono, ffmpegArgs, resolveFfmpegPath } from "../stt/providers/ffmpeg.js";
import { findDataChunk } from "../stt/providers/inworld-wav.js";

/** WAV 44,1 kHz stéréo : ton de 440 Hz, silence numérique, puis ton de nouveau. */
function stereoWav(parts: { toneSec: number; silenceSec: number; toneAfterSec: number }): Buffer {
  const rate = 44100;
  const samples = (sec: number) => Math.round(sec * rate);
  const toneEnd = samples(parts.toneSec);
  const silenceEnd = toneEnd + samples(parts.silenceSec);
  const total = silenceEnd + samples(parts.toneAfterSec);
  const pcm = Buffer.alloc(total * 4); // 2 canaux × 2 octets
  for (let i = 0; i < total; i++) {
    const inSilence = i >= toneEnd && i < silenceEnd;
    const value = inSilence ? 0 : Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate));
    pcm.writeInt16LE(value, i * 4);
    pcm.writeInt16LE(value, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe("ffmpegArgs", () => {
  it("converts to 16 kHz mono PCM16 and detects silences in the same pass", () => {
    const args = ffmpegArgs("in.bin", "out.wav");

    expect(args).toEqual(expect.arrayContaining(["-nostdin", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]));
    expect(args).toContain("silencedetect=noise=-35dB:d=0.4");
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual(["-i", "in.bin"]);
    expect(args[args.length - 1]).toBe("out.wav");
  });
});

describe("resolveFfmpegPath", () => {
  afterEach(() => {
    delete process.env.FFMPEG_PATH;
  });

  it("prefers FFMPEG_PATH over the bundled ffmpeg-static binary", () => {
    process.env.FFMPEG_PATH = "/opt/custom/ffmpeg";

    expect(resolveFfmpegPath()).toBe("/opt/custom/ffmpeg");
  });
});

describe("convertToWav16kMono (real ffmpeg)", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("converts a 44.1 kHz stereo WAV to 16 kHz mono and reports the silence in the middle", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "voxhelp-ffmpeg-test-"));
    const input = path.join(dir, "in.wav");
    const output = path.join(dir, "out.wav");
    await writeFile(input, stereoWav({ toneSec: 1, silenceSec: 1.5, toneAfterSec: 1 }));

    const { silences } = await convertToWav16kMono(input, output);

    const written = await readFile(output);
    expect(written.readUInt16LE(22)).toBe(1); // mono
    expect(written.readUInt32LE(24)).toBe(16000); // 16 kHz
    const data = findDataChunk(written.subarray(0, 4096));
    expect(data).not.toBeNull();
    expect(data!.size / 32000).toBeCloseTo(3.5, 1);
    expect(silences).toHaveLength(1);
    expect(silences[0].start).toBeGreaterThan(0.9);
    expect(silences[0].end).toBeLessThan(2.7);
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/ffmpeg.test.ts` — Expected: FAIL (`Failed to resolve import "../stt/providers/ffmpeg.js"`).

Créer `apps/backend/src/stt/providers/ffmpeg.ts` :

```ts
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { parseSilences, type Silence } from "./inworld-batch-plan.js";

const MAX_STDERR_CHARS = 20_000_000;

/** `FFMPEG_PATH` (binaire du serveur) l'emporte sur le binaire fourni par `ffmpeg-static`. */
export function resolveFfmpegPath(): string {
  const binary = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!binary) throw new Error("ffmpeg introuvable : définir FFMPEG_PATH ou installer ffmpeg-static");
  return binary;
}

export function ffmpegArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-y",
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-af",
    "silencedetect=noise=-35dB:d=0.4",
    "-c:a",
    "pcm_s16le",
    output,
  ];
}

/** Convertit n'importe quel audio/vidéo en WAV 16 kHz mono et détecte les silences dans la même passe. */
export function convertToWav16kMono(input: string, output: string): Promise<{ silences: Silence[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ffmpegArgs(input, output), { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString();
    });
    child.on("error", (err) => reject(new Error(`ffmpeg n'a pas pu démarrer : ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve({ silences: parseSilences(stderr) });
      else reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.slice(-500).trim()}`));
    });
  });
}
```

Run: `cd apps/backend && npx vitest run src/__tests__/ffmpeg.test.ts` — Expected: PASS, 3 tests (le dernier exécute le vrai binaire).

- [ ] **Step 6: Orchestrateur Inworld — tests puis code**

Créer `apps/backend/src/__tests__/inworld-batch.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInworldBatchStt, type InworldBatchDeps } from "../stt/providers/inworld-batch.js";
import { BYTES_PER_SECOND, wavFromPcm } from "../stt/providers/inworld-wav.js";
import { UNKNOWN_CONFIDENCE } from "../stt/providers/inworld-utterances.js";

const PLAN = { targetSec: 10, windowSec: 2, minTailSec: 3 };
const HELLO = [{ word: "Bonjour", startTimeMs: 0, endTimeMs: 500 }];

/** Fausse conversion : écrit un WAV de `seconds` secondes de silence à l'emplacement demandé. */
function fakeConvert(seconds: number, silences: Array<{ start: number; end: number }> = []): InworldBatchDeps["convert"] {
  return async (_input, output) => {
    await writeFile(output, wavFromPcm(Buffer.alloc(Math.round(seconds * BYTES_PER_SECOND))));
    return { silences };
  };
}

function ok(transcript: string, words: Array<{ word: string; startTimeMs: number; endTimeMs: number }>): Response {
  return new Response(JSON.stringify({ transcription: { transcript, isFinal: true, wordTimestamps: words } }), { status: 200 });
}

/** Durée (s) de l'audio d'une requête Inworld, lue dans le WAV en base64. */
function requestSeconds(init: RequestInit): number {
  const body = JSON.parse(String(init.body)) as { audio_data: { content: string } };
  return (Buffer.from(body.audio_data.content, "base64").length - 44) / BYTES_PER_SECOND;
}

const noSleep = async (_ms: number): Promise<void> => {};

describe("inworldBatchStt.transcribe", () => {
  beforeEach(() => {
    process.env.INWORLD_API_KEY = "test-key";
  });

  it("sends one request for short audio, with the Inworld sync config and sanitized prompts", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Bonjour.", HELLO));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("fake input"), { language: "fr", keyterms: ["C#", "Genèse"] });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.inworld.ai/stt/v1/transcribe");
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic test-key");
    expect(JSON.parse(String(init.body)).transcribe_config).toEqual({
      model_id: "inworld/inworld-stt-1",
      language: "fr",
      audio_encoding: "LINEAR16",
      sample_rate_hertz: 16000,
      include_word_timestamps: true,
      prompts: ["C sharp", "Genèse"],
    });
    expect(requestSeconds(init)).toBe(5);
    expect(result).toEqual([{ start: 0, end: 0.5, transcript: "Bonjour.", confidence: UNKNOWN_CONFIDENCE }]);
  });

  it("omits prompts when there are no keyterms", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Hello.", HELLO));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    await stt.transcribe(Buffer.from("x"), { language: "en" });

    const config = JSON.parse(String(fetchFn.mock.calls[0][1].body)).transcribe_config;
    expect(config).not.toHaveProperty("prompts");
    expect(config.language).toBe("en");
  });

  it("cuts long audio at the planned silences and offsets the timestamps of each piece", async () => {
    const transcripts: Record<string, string> = { "8.5": "Premier.", "11.5": "Deuxième.", "5": "Troisième." };
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const text = transcripts[String(requestSeconds(init))];
      return ok(text, [{ word: text.replace(".", ""), startTimeMs: 0, endTimeMs: 500 }]);
    });
    const stt = createInworldBatchStt({
      fetchFn,
      convert: fakeConvert(25, [{ start: 8, end: 9 }]),
      plan: PLAN,
      sleep: noSleep,
    });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.map((u) => [u.transcript, u.start])).toEqual([
      ["Premier.", 0],
      ["Deuxième.", 8.5],
      ["Troisième.", 20],
    ]);
  });

  it("retries on 429 and then succeeds", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ code: 8, message: "rate limited" }), { status: 429 })
        : ok("Bonjour.", HELLO);
    });
    const sleep = vi.fn(noSleep);
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result).toHaveLength(1);
  });

  it("does not retry a client error and never leaks the API key", async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ code: 3, message: "invalid transcribe config" }), { status: 400 })
    );
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep: noSleep });

    const error = await stt.transcribe(Buffer.from("x"), { language: "fr" }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/HTTP 400/);
    expect((error as Error).message).not.toContain("test-key");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries on a persistent 5xx", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => new Response("boom", { status: 500 }));
    const sleep = vi.fn(noSleep);
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(5), plan: PLAN, sleep });

    await expect(stt.transcribe(Buffer.from("x"), { language: "fr" })).rejects.toThrow(/HTTP 500/);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 3000]);
  });

  it("fails fast without an API key, before converting anything", async () => {
    delete process.env.INWORLD_API_KEY;
    const convert = vi.fn(fakeConvert(5));
    const stt = createInworldBatchStt({ convert, plan: PLAN, sleep: noSleep });

    await expect(stt.transcribe(Buffer.from("x"), { language: "fr" })).rejects.toThrow("INWORLD_API_KEY not set");

    expect(convert).not.toHaveBeenCalled();
  });

  it("removes the temporary directory even when the conversion fails", async () => {
    let workDir = "";
    const convert: InworldBatchDeps["convert"] = async (input) => {
      workDir = path.dirname(input);
      throw new Error("ffmpeg a échoué");
    };
    const stt = createInworldBatchStt({ convert, plan: PLAN, sleep: noSleep });

    await expect(stt.transcribe(Buffer.from("x"), { language: "fr" })).rejects.toThrow("ffmpeg a échoué");

    expect(workDir).not.toBe("");
    expect(existsSync(workDir)).toBe(false);
  });

  it("runs at most three requests at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return ok("Bonjour.", HELLO);
    });
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(50), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(3);
    expect(result).toHaveLength(5);
  });

  it("returns nothing for empty audio without calling Inworld", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok("Bonjour.", HELLO));
    const stt = createInworldBatchStt({ fetchFn, convert: fakeConvert(0), plan: PLAN, sleep: noSleep });

    const result = await stt.transcribe(Buffer.from("x"), { language: "fr" });

    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-batch.test.ts` — Expected: FAIL (`Failed to resolve import "../stt/providers/inworld-batch.js"`).

Créer `apps/backend/src/stt/providers/inworld-batch.ts` :

```ts
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { SttUtterance } from "@voxhelp/lecture";
import type { BatchStt, BatchTranscribeOptions } from "../types.js";
import { convertToWav16kMono } from "./ffmpeg.js";
import { DEFAULT_PLAN, planCuts, type PlanOptions, type Silence } from "./inworld-batch-plan.js";
import { sanitizeInworldPrompts } from "./inworld-prompts.js";
import { buildUtterances, type InworldWord } from "./inworld-utterances.js";
import { BYTES_PER_SECOND, findDataChunk, wavFromPcm } from "./inworld-wav.js";

const INWORLD_STT_URL = "https://api.inworld.ai/stt/v1/transcribe";
const MODEL_ID = "inworld/inworld-stt-1";
const CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1000, 3000];
const REQUEST_TIMEOUT_MS = 180_000;
const HEADER_PROBE_BYTES = 4096;

export interface InworldBatchDeps {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  convert: (input: string, output: string) => Promise<{ silences: Silence[] }>;
  plan: PlanOptions;
  sleep: (ms: number) => Promise<void>;
}

interface SegmentResult {
  transcript: string;
  words: InworldWord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseResponse(raw: unknown): SegmentResult {
  const transcription = isRecord(raw) && isRecord(raw.transcription) ? raw.transcription : null;
  if (!transcription) throw new Error("Réponse Inworld STT invalide");

  const transcript = typeof transcription.transcript === "string" ? transcription.transcript : "";
  const words: InworldWord[] = [];
  if (Array.isArray(transcription.wordTimestamps)) {
    for (const item of transcription.wordTimestamps as unknown[]) {
      if (
        isRecord(item) &&
        typeof item.word === "string" &&
        typeof item.startTimeMs === "number" &&
        typeof item.endTimeMs === "number"
      ) {
        words.push({ word: item.word, startTimeMs: item.startTimeMs, endTimeMs: item.endTimeMs });
      }
    }
  }
  return { transcript, words };
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.message === "string") return parsed.message.slice(0, 200);
  } catch {
    // corps non JSON : on garde le texte brut, borné
  }
  return text.slice(0, 200);
}

async function transcribeSegment(
  wav: Buffer,
  language: string,
  prompts: string[],
  apiKey: string,
  deps: InworldBatchDeps
): Promise<SegmentResult> {
  const body = JSON.stringify({
    transcribe_config: {
      model_id: MODEL_ID,
      language,
      audio_encoding: "LINEAR16",
      sample_rate_hertz: AUDIO_SAMPLE_RATE,
      include_word_timestamps: true,
      ...(prompts.length > 0 ? { prompts } : {}),
    },
    audio_data: { content: wav.toString("base64") },
  });

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await deps.fetchFn(INWORLD_STT_URL, {
        method: "POST",
        headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await deps.sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(`Inworld STT injoignable : ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.ok) return parseResponse(await response.json());

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < RETRY_DELAYS_MS.length) {
      await deps.sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(`Inworld STT HTTP ${response.status} : ${await describeError(response)}`);
  }
}

/** Résultats dans l'ordre des éléments ; au premier échec, plus aucun élément n'est démarré. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function transcribeWav(
  wavPath: string,
  silences: Silence[],
  options: BatchTranscribeOptions,
  apiKey: string,
  deps: InworldBatchDeps
): Promise<SttUtterance[]> {
  const handle = await open(wavPath, "r");
  try {
    const head = Buffer.alloc(HEADER_PROBE_BYTES);
    await handle.read(head, 0, head.length, 0);
    const dataChunk = findDataChunk(head);
    if (!dataChunk) throw new Error("ffmpeg a produit un WAV illisible");

    const available = (await handle.stat()).size - dataChunk.offset;
    const declared = dataChunk.size > 0 && dataChunk.size <= available ? dataChunk.size : available;
    const pcmBytes = declared - (declared % 2);
    const totalSec = pcmBytes / BYTES_PER_SECOND;
    if (totalSec <= 0) return [];

    const bounds = [0, ...planCuts(totalSec, silences, deps.plan), totalSec];
    const segments = bounds.slice(0, -1).map((start, index) => ({ start, end: bounds[index + 1] }));
    const prompts = sanitizeInworldPrompts(options.keyterms).prompts;

    const perSegment = await mapWithConcurrency(segments, CONCURRENCY, async (segment) => {
      const from = Math.floor(segment.start * AUDIO_SAMPLE_RATE) * 2;
      const to = Math.min(pcmBytes, Math.floor(segment.end * AUDIO_SAMPLE_RATE) * 2);
      const pcm = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(pcm, 0, pcm.length, dataChunk.offset + from);
      if (bytesRead !== pcm.length) throw new Error("Lecture incomplète du WAV converti");

      const result = await transcribeSegment(wavFromPcm(pcm), options.language, prompts, apiKey, deps);
      return buildUtterances(result.transcript, result.words, segment.start, segment.end - segment.start);
    });
    return perSegment.flat();
  } finally {
    await handle.close();
  }
}

/** Adapter batch Inworld : ffmpeg (WAV 16 kHz mono + silences) -> morceaux <= 720 s -> API synchrone. */
export function createInworldBatchStt(overrides: Partial<InworldBatchDeps> = {}): BatchStt {
  const deps: InworldBatchDeps = {
    fetchFn: (url, init) => fetch(url, init),
    convert: convertToWav16kMono,
    plan: DEFAULT_PLAN,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };

  return {
    async transcribe(audio: Buffer, options: BatchTranscribeOptions): Promise<SttUtterance[]> {
      const apiKey = process.env.INWORLD_API_KEY;
      if (!apiKey) throw new Error("INWORLD_API_KEY not set");

      const workDir = await mkdtemp(path.join(tmpdir(), "voxhelp-inworld-batch-"));
      try {
        const inputPath = path.join(workDir, "input.bin");
        const wavPath = path.join(workDir, "audio.wav");
        await writeFile(inputPath, audio);
        const { silences } = await deps.convert(inputPath, wavPath);
        return await transcribeWav(wavPath, silences, options, apiKey, deps);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

export const inworldBatchStt: BatchStt = createInworldBatchStt();
```

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-batch.test.ts` — Expected: PASS, 10 tests.

- [ ] **Step 7: Enregistrer Inworld dans le registre batch**

Dans `apps/backend/src/stt/index.ts` :
- Ajouter l'import : `import { inworldBatchStt } from "./providers/inworld-batch.js";`
- Dans `BATCH_PROVIDERS`, ajouter après l'entrée `deepgram` :
  ```ts
    inworld: {
      label: "Inworld",
      requiredEnv: "INWORLD_API_KEY",
      transcriber: inworldBatchStt,
    },
  ```

Dans `apps/backend/src/__tests__/stt-factory.test.ts` :
1. Après le `vi.mock` de `../stt/providers/deepgram-batch.js`, ajouter :
   ```ts
   vi.mock("../stt/providers/inworld-batch.js", () => ({
     inworldBatchStt: { transcribe: vi.fn() },
   }));
   ```
   et, à côté de l'import dynamique de `deepgramBatchStt`, ajouter :
   `const { inworldBatchStt } = await import("../stt/providers/inworld-batch.js");`
2. Dans le test `throws on an unknown STT_BATCH_PROVIDER`, remplacer `"inworld"` par `"whisper"` (dans l'assignation de l'env et dans la regex : `/STT_BATCH_PROVIDER "whisper".*deepgram/`) : `inworld` est désormais valide.
3. Dans le test `lists the batch providers with their label and whether their API key is configured`, remplacer l'attendu par :
   ```ts
   [
     { id: "deepgram", label: "Deepgram Nova-3", available: true },
     { id: "inworld", label: "Inworld", available: false },
   ]
   ```
4. Dans `describe("getBatchStt with an explicit provider id", …)`, ajouter :
   ```ts
     it("returns the Inworld batch adapter for its id", () => {
       expect(getBatchStt("inworld")).toBe(inworldBatchStt);
     });
   ```

Dans `apps/backend/src/__tests__/stt-batch-providers-route.test.ts`, remplacer l'attendu du premier test par :
```ts
      providers: [
        { id: "deepgram", label: "Deepgram Nova-3", available: true },
        { id: "inworld", label: "Inworld", available: false },
      ],
```

- [ ] **Step 8: Documentation d'environnement**

`apps/backend/.env.example` : remplacer la ligne exacte `# STT_BATCH_PROVIDER=deepgram  # deepgram uniquement pour l'instant` par :
```
# STT_BATCH_PROVIDER=deepgram  # modèle par défaut des cours (deepgram | inworld) ; l'écran d'import permet d'en choisir un par cours
# FFMPEG_PATH=/usr/bin/ffmpeg  # optionnel : binaire ffmpeg pour Inworld (cours) ; sinon celui de ffmpeg-static
```

`CLAUDE.md` (racine) :
- Remplacer la ligne `- \`STT_BATCH_PROVIDER\` — …` par : `- \`STT_BATCH_PROVIDER\` — modèle de transcription **par défaut** des cours (fichiers) : \`deepgram\` (Nova-3, défaut) ou \`inworld\` (expérimental : conversion ffmpeg, découpage en morceaux ≤ 12 min). L'utilisateur peut en choisir un autre par cours sur l'écran d'import.`
- Ajouter juste après : `- \`FFMPEG_PATH\` — binaire ffmpeg utilisé par Inworld pour les cours (optionnel : sinon celui du paquet \`ffmpeg-static\`, sous licence GPL)`.
- Dans la ligne « STT » de la section Stack, remplacer `batch (cours) : Deepgram Nova-3` par `batch (cours) : Deepgram Nova-3 (défaut) ou Inworld (API synchrone via ffmpeg)`.

- [ ] **Step 9: Vérifier**

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 34 fichiers / 254 tests (222 + 3 wav + 7 plan + 8 énoncés + 3 ffmpeg + 10 orchestrateur + 1 registre).
Si `ffmpeg.test.ts` échoue parce que le binaire n'existe pas, revenir au Step 1 (`onlyBuiltDependencies`, `pnpm rebuild ffmpeg-static`).

Run: `cd packages/lecture && npx tsc --noEmit && cd ../../apps/web && npx tsc --noEmit`
Expected: PASS.

Run: `grep -rn "ffmpeg-static" package.json apps/backend/package.json | head`
Expected: l'entrée `onlyBuiltDependencies` et la dépendance du backend.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml apps/backend/package.json apps/backend/src/stt apps/backend/src/__tests__ apps/backend/.env.example CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(stt): Inworld batch transcription for course recordings

Adapter BatchStt Inworld : une passe ffmpeg (WAV 16 kHz mono + silences),
découpage aux silences en morceaux <= 12 min (limite 32 Mio de l'API
synchrone), requêtes parallèles avec reprises, énoncés reconstruits à
partir du texte ponctué et des mots horodatés. Dépendance ffmpeg-static
(FFMPEG_PATH pour le binaire du serveur).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 3: Choix du modèle sur l'écran d'import des cours

**Files:**
- Modify: `apps/web/src/hooks/useSttProviders.ts`
- Modify: `apps/web/src/lib/chunkedAudioUpload.ts`
- Modify: `apps/web/src/hooks/useCourseAnalysis.ts`
- Modify: `apps/web/src/lecture-cours/UploadScreen.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `SttProviderInfo`, `SttProvidersResponse` (`@voxhelp/shared`), routes de la Task 1.
- Produces :
  ```ts
  // hooks/useSttProviders.ts
  export type SttKind = "live" | "batch"
  export function useSttProviders(token: string, kind?: SttKind): { providers: SttProviderInfo[]; selected: string | null; select: (id: string) => void }
  // useCourseAnalysis() renvoie en plus : sttProviders, sttProvider, setSttProvider
  // lib/chunkedAudioUpload.ts : uploadAudioChunked(file, language, existingGlossary, token, signal, onProgress?, sttProvider?)
  ```

Le front n'a **aucun outil de test** : vérification = typecheck + build. Ne pas ajouter vitest ni testing-library.

- [ ] **Step 1: Généraliser le hook**

Remplacer **tout** le contenu de `apps/web/src/hooks/useSttProviders.ts` par :

```ts
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
```

Run: `cd apps/web && npx tsc --noEmit` — Expected: PASS (l'appel existant `useSttProviders(token)` dans `App.tsx` reste valide).

- [ ] **Step 2: Envoyer le choix avec l'upload**

Dans `apps/web/src/lib/chunkedAudioUpload.ts` :
- Ajouter un dernier paramètre optionnel à `uploadAudioChunked` : après `onProgress?: (fraction: number) => void`, ajouter `sttProvider?: string`.
- Remplacer le corps envoyé à `finalize` : `{ uploadId, totalChunks, language, existingGlossary }` devient `{ uploadId, totalChunks, language, existingGlossary, ...(sttProvider ? { sttProvider } : {}) }`.

- [ ] **Step 3: Exposer le choix dans `useCourseAnalysis`**

Dans `apps/web/src/hooks/useCourseAnalysis.ts` :
- Ajouter l'import `import { useSttProviders } from "./useSttProviders";` à côté de celui de `useAuth`.
- Juste après `const { session } = useAuth();`, ajouter :
  ```ts
  const stt = useSttProviders(session?.access_token ?? "", "batch");
  ```
- Dans l'appel à `uploadAudioChunked(...)` de la fonction d'analyse, ajouter en dernier argument (après la fonction de progression `(fraction) => setProgress(fraction * 25)`) : `stt.selected ?? undefined`.
- Dans l'objet retourné par le hook (liste qui contient `runState`, `analyze`, `abort`…), ajouter :
  ```ts
    sttProviders: stt.providers,
    sttProvider: stt.selected,
    setSttProvider: stt.select,
  ```

- [ ] **Step 4: Champ dans l'écran d'import**

Dans `apps/web/src/lecture-cours/UploadScreen.tsx` :
- Ajouter `sttProviders, sttProvider, setSttProvider,` à la déstructuration de `analysis` (avec `runState`, `analyze`…).
- Juste **après** le `<Field label="Langue">…</Field>`, ajouter (composants `Field` et `Select` déjà importés de `../components/ui.js`) :
  ```tsx
          {sttProviders.length > 0 && (
            <Field label="Modèle de transcription">
              <Select
                value={sttProvider ?? ""}
                disabled={runState === "running"}
                onChange={(e) => setSttProvider(e.target.value)}
              >
                {sttProviders.map((provider) => (
                  <option key={provider.id} value={provider.id} disabled={!provider.available}>
                    {provider.available ? provider.label : `${provider.label} (non configuré)`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
  ```
  Vérifier que la grille du formulaire (colonnes du conteneur des `Field`) absorbe un champ de plus sans casser la mise en page ; ajuster **uniquement** l'ordre ou l'emplacement du champ si nécessaire (pas de CSS global).

- [ ] **Step 5: Documentation**

`CLAUDE.md` (racine), section « Fichiers importants » : à la ligne de `apps/backend/src/routes.ts`, ajouter `GET /api/stt/batch-providers` à la liste des routes mentionnées (à côté de `GET /api/stt/providers`), et ajouter une ligne : `- \`apps/web/src/lecture-cours/UploadScreen.tsx\` — Écran d'import d'un cours (dont le choix du modèle de transcription, liste lue sur \`GET /api/stt/batch-providers\`)`.

- [ ] **Step 6: Vérifier**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @voxhelp/web build`
Expected: PASS (`tsc -b && vite build`).

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 34 fichiers / 254 tests (inchangé).

Run: `grep -n "sttProvider" apps/web/src/hooks/useCourseAnalysis.ts apps/web/src/lib/chunkedAudioUpload.ts apps/web/src/lecture-cours/UploadScreen.tsx`
Expected: le choix est lu dans le hook, envoyé dans `finalize` et affiché dans l'écran d'import.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useSttProviders.ts apps/web/src/lib/chunkedAudioUpload.ts apps/web/src/hooks/useCourseAnalysis.ts apps/web/src/lecture-cours/UploadScreen.tsx CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(web): choose the transcription model on the course import screen

useSttProviders est généralisé (live | batch, clés de mémorisation
distinctes). L'écran d'import affiche le champ « Modèle de
transcription » (grisé si la clé manque, verrouillé pendant l'analyse) et
le choix part avec l'audio à la finalisation de l'upload.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 4: Vérification réelle (contrôleur, avec la clé Inworld de l'utilisateur)

**Ne pas déléguer à un sous-agent** : cette tâche appelle l'API réelle avec la clé de `apps/backend/.env`, que le contrôleur ne lit ni n'affiche.

- [ ] **Step 1: Cours entier par l'adapter Inworld réel**

Fichier : `/Users/trakotoarisoa/Downloads/video-0 (4).m4v` (103 min, 275 Mo). Script jetable dans le scratchpad (extension `.mts`), lancé depuis `apps/backend` avec `npx tsx --env-file=.env` : lire le fichier, appeler `inworldBatchStt.transcribe(buffer, { language: "fr", keyterms: ["Genèse", "MECC", "C#"] })` (le `C#` vérifie que le nettoyage des `prompts` protège l'API), mesurer la durée, puis `deepgramBatchStt.transcribe` sur le même buffer.
Attendu : aucune erreur ; nombre de morceaux ≈ 11 ; durée totale de l'ordre de la minute ; dernier `end` ≈ 6 180 s ; temps **monotones** (aucun énoncé qui recule ni ne chevauche) ; nombre de mots proche de Nova-3 ; termes `Genèse` / `Testament` / `MECC` comparables. Ne journaliser que des **statistiques**, jamais le contenu du cours.

- [ ] **Step 2: Aucun mot perdu ou doublé aux coupures**

À chaque coupure de l'adapter (instants renvoyés par `planCuts`), comparer le texte de part et d'autre avec Nova-3 sur la même fenêtre : pas de mot doublé ni manquant. Compter les coupures qui tombent en plein mot.

- [ ] **Step 3: Contrôle visuel du champ**

Backend et front lancés : sur l'écran d'import d'un cours, le champ « Modèle de transcription » propose Deepgram Nova-3 et Inworld, grise un modèle sans clé serveur, survit à un rechargement, est verrouillé pendant l'analyse ; une analyse lancée avec Inworld journalise côté backend la transcription par morceaux sans erreur. La connexion (Supabase) est nécessaire : si le navigateur du contrôleur n'est pas connecté, demander ce contrôle à l'utilisateur.

- [ ] **Step 4: Suite complète**

Run : backend `npx tsc --noEmit && npx vitest run` (34 fichiers / 254 tests), lecture (14 / 74), web `npx tsc --noEmit` et `pnpm --filter @voxhelp/web build`.
Expected : tout vert.
