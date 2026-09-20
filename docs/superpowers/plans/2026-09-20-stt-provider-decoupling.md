# Découplage du STT et adapter Inworld — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le STT interchangeable derrière deux ports (live et batch) sélectionnés par variable d'env, puis ajouter Inworld STT comme deuxième fournisseur live.

**Architecture:** Interfaces `LiveStt` (streaming, callbacks + `start/sendAudio/close`) et `BatchStt` (`transcribe`) dans `apps/backend/src/stt/types.ts`. Un adapter par fournisseur dans `stt/providers/`. `stt/index.ts` expose `createLiveStt`, `getBatchStt`, `assertSttConfig` qui résolvent le fournisseur depuis l'env. `session.ts` et `routes.ts` ne connaissent plus que les ports.

**Tech Stack:** TypeScript strict (ESM, imports `.js`), Fastify 5, `ws` (déjà dépendance directe du backend), `@deepgram/sdk` 5, vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-20-stt-provider-decoupling-design.md`

## Global Constraints

- Node >= 22, TypeScript strict, **pas de `any`**, ESM avec imports en `.js` dans le backend.
- Nommage : camelCase variables/fonctions, PascalCase types/classes, **kebab-case fichiers**.
- Contrat audio commun : **PCM16 16 kHz mono** (`AUDIO_SAMPLE_RATE` de `@voxhelp/shared`, = 16000).
- Contrat `onTranscript` : un tour de parole terminé, texte final **non vide et trimé**.
- Après `close()`, un adapter n'émet plus aucun callback (drapeau `closed`).
- Variables d'env : `STT_LIVE_PROVIDER` (défaut `deepgram`), `STT_BATCH_PROVIDER` (défaut `deepgram`, seule valeur supportée), `INWORLD_API_KEY` (requise uniquement si `STT_LIVE_PROVIDER=inworld`).
- **Échec rapide** : une valeur inconnue d'un `STT_*_PROVIDER` lève une erreur claire, jamais de fallback silencieux.
- Flux : `eot_threshold: 0.85` reste inchangé.
- Inworld : URL `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`, en-tête `Authorization: Basic ${INWORLD_API_KEY}` (clé déjà en Base64, **non ré-encodée**), `modelId: "inworld/inworld-stt-1"`, valeurs de départ `endOfTurnConfidenceThreshold: 0.7`, `minEndOfTurnSilenceWhenConfident: 300`, `maxTurnSilence: 1200`. `zh` n'est pas supporté en streaming.
- Hors périmètre : reconnexion automatique, sélection du fournisseur par session/utilisateur, fournisseur batch autre que Deepgram.
- **Ne jamais committer une clé API.** `apps/backend/.env` est ignoré par git.
- Commandes de vérification (depuis la racine du repo) :
  - Backend : `cd apps/backend && npx tsc --noEmit && npx vitest run`
  - Lecture : `cd packages/lecture && npx tsc --noEmit && npx vitest run`
  - Web : `cd apps/web && npx tsc --noEmit`
- **État de base avant le plan** : backend 20 fichiers / 100 tests verts, lecture 14 fichiers / 74 tests verts, typechecks backend et lecture verts.
- Chaque message de commit se termine par ces deux lignes de trailer :
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
  ```

## Structure des fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `packages/lecture/src/stt/types.ts` | Modifier | `DeepgramUtterance` → `SttUtterance` |
| `packages/lecture/src/stt/map-utterances.ts` | Modifier | suit le renommage |
| `packages/lecture/src/__tests__/stt-map-utterances.test.ts` | Modifier | suit le renommage |
| `apps/backend/src/stt/types.ts` | Créer | Ports `LiveStt`, `BatchStt` et leurs options/callbacks |
| `apps/backend/src/stt/index.ts` | Créer | Fabrique + validation de l'env |
| `apps/backend/src/stt/providers/deepgram-flux.ts` | Déplacer depuis `src/deepgram-flux.ts` | Adapter live Deepgram |
| `apps/backend/src/stt/providers/deepgram-batch.ts` | Déplacer depuis `src/deepgram-batch.ts` | Adapter batch Deepgram |
| `apps/backend/src/stt/providers/inworld-live.ts` | Créer | Adapter live Inworld |
| `apps/backend/src/groq-stt.ts` | Supprimer | Code mort (importé nulle part) |
| `apps/backend/src/session.ts` | Modifier | Utilise `createLiveStt` / `LiveStt` |
| `apps/backend/src/routes.ts` | Modifier | Utilise `getBatchStt()` |
| `apps/backend/src/index.ts` | Modifier | Appelle `assertSttConfig()` au boot |
| `apps/backend/src/__tests__/stt-factory.test.ts` | Créer | Tests de la fabrique |
| `apps/backend/src/__tests__/inworld-live.test.ts` | Créer | Tests de l'adapter Inworld |
| 10 tests existants | Modifier | Mocks déplacés vers `stt/index.js` |
| `apps/backend/.env.example`, `CLAUDE.md` | Modifier | Documentation des variables et de l'architecture |
| `apps/backend/scripts/stt-compare.ts`, `apps/backend/package.json` | Créer / modifier | **Optionnel** (Task 5) |

---

### Task 1: Renommer `DeepgramUtterance` en `SttUtterance`

Le type est utilisé par le domaine `lecture`, il ne doit plus porter le nom d'un fournisseur. Attention : le type réel a **tous ses champs optionnels** et un champ `speaker` (le spec en listait 4 par simplification) — on conserve la forme telle quelle.

**Files:**
- Modify: `packages/lecture/src/stt/types.ts`
- Modify: `packages/lecture/src/stt/map-utterances.ts`
- Modify: `packages/lecture/src/__tests__/stt-map-utterances.test.ts`
- Modify: `apps/backend/src/deepgram-batch.ts` (import seulement, ce fichier est déplacé en Task 3)

**Interfaces:**
- Produces: `export interface SttUtterance { start?: number; end?: number; confidence?: number; transcript?: string; speaker?: number }` exporté par `@voxhelp/lecture` (via `export * from "./stt/index.js"`). Consommé par les Tasks 2 et 3.

- [ ] **Step 1: Renommer dans le test (le typecheck doit échouer)**

```bash
cd packages/lecture
perl -pi -e 's/DeepgramUtterance/SttUtterance/g' src/__tests__/stt-map-utterances.test.ts
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd packages/lecture && npx tsc --noEmit`
Expected: FAIL, `Module '"../stt/types.js"' has no exported member 'SttUtterance'`.

- [ ] **Step 3: Renommer dans le code**

```bash
cd packages/lecture
perl -pi -e 's/DeepgramUtterance/SttUtterance/g' src/stt/types.ts src/stt/map-utterances.ts
cd ../../apps/backend
perl -pi -e 's/DeepgramUtterance/SttUtterance/g' src/deepgram-batch.ts
```

`packages/lecture/src/stt/types.ts` doit devenir exactement :

```ts
export interface SttUtterance {
  start?: number;
  end?: number;
  confidence?: number;
  transcript?: string;
  speaker?: number;
}
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `cd packages/lecture && npx tsc --noEmit && npx vitest run`
Expected: PASS, 14 fichiers / 74 tests.

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 20 fichiers / 100 tests.

Run: `grep -rn "DeepgramUtterance" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v /dist/`
Expected: aucune ligne.

- [ ] **Step 5: Commit**

```bash
git add packages/lecture apps/backend/src/deepgram-batch.ts
git commit -m "$(cat <<'EOF'
refactor(lecture): rename DeepgramUtterance to SttUtterance

Le type du domaine ne doit plus porter le nom d'un fournisseur STT.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 2: Port live, adapter Flux déplacé, câblage de `session.ts`

**Files:**
- Create: `apps/backend/src/stt/types.ts`
- Create: `apps/backend/src/stt/index.ts`
- Move: `apps/backend/src/deepgram-flux.ts` → `apps/backend/src/stt/providers/deepgram-flux.ts`
- Delete: `apps/backend/src/groq-stt.ts`
- Modify: `apps/backend/src/session.ts` (lignes 7, 22, 142-155)
- Modify: `apps/backend/src/__tests__/deepgram-flux.test.ts` (chemin d'import)
- Modify: 8 tests de session (mocks) : `session.test.ts`, `session-max-buffer.test.ts`, `session-tech-matching.test.ts`, `session-debounce-min-words.test.ts`, `session-usage-limit.test.ts`, `session-theme-angle.test.ts`, `session-card-merge.test.ts`, `session-keywords.test.ts`
- Test: `apps/backend/src/__tests__/stt-factory.test.ts` (créer)

**Interfaces:**
- Consumes: `SttUtterance` (Task 1), `InterviewLanguage` de `@voxhelp/shared`.
- Produces (utilisés par les Tasks 3 et 4) :
  ```ts
  // stt/types.ts
  export interface LiveSttOptions { language: InterviewLanguage; keyterms?: string[] }
  export interface LiveSttCallbacks {
    onTranscript(text: string): void;
    onListening(): void;
    onError(message: string): void;
  }
  export interface LiveStt {
    start(): Promise<void>;
    sendAudio(pcm: Buffer): void;
    close(): void;
  }
  export interface BatchTranscribeOptions { language: string; keyterms?: string[] }
  export interface BatchStt {
    transcribe(audio: Buffer, options: BatchTranscribeOptions): Promise<SttUtterance[]>;
  }
  // stt/index.ts
  export function createLiveStt(options: LiveSttOptions, callbacks: LiveSttCallbacks): LiveStt
  ```
  `FluxSTT` garde son constructeur `(language: string, keywords: string[] | undefined, callbacks: LiveSttCallbacks)`.

- [ ] **Step 1: Écrire le test de la fabrique (doit échouer)**

Créer `apps/backend/src/__tests__/stt-factory.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const flux = vi.hoisted(() => ({ ctorArgs: null as unknown[] | null }));

vi.mock("../stt/providers/deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(...args: unknown[]) {
      flux.ctorArgs = args;
    }
  },
}));

const { createLiveStt } = await import("../stt/index.js");

const callbacks = { onTranscript: vi.fn(), onListening: vi.fn(), onError: vi.fn() };

beforeEach(() => {
  delete process.env.STT_LIVE_PROVIDER;
  delete process.env.STT_BATCH_PROVIDER;
  flux.ctorArgs = null;
});

describe("createLiveStt", () => {
  it("creates the Deepgram Flux adapter by default", () => {
    const stt = createLiveStt({ language: "fr", keyterms: ["Kubernetes"] }, callbacks);

    expect(stt).toBeDefined();
    expect(flux.ctorArgs).toEqual(["fr", ["Kubernetes"], callbacks]);
  });

  it("throws on an unknown STT_LIVE_PROVIDER, listing the valid values", () => {
    process.env.STT_LIVE_PROVIDER = "whisper";

    expect(() => createLiveStt({ language: "fr" }, callbacks)).toThrow(
      /STT_LIVE_PROVIDER "whisper".*deepgram/
    );
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts`
Expected: FAIL, `Failed to resolve import "../stt/index.js"`.

- [ ] **Step 3: Créer les ports**

Créer `apps/backend/src/stt/types.ts` :

```ts
import type { InterviewLanguage } from "@voxhelp/shared";
import type { SttUtterance } from "@voxhelp/lecture";

export interface LiveSttOptions {
  language: InterviewLanguage;
  keyterms?: string[];
}

export interface LiveSttCallbacks {
  /** Un tour de parole terminé : texte final, non vide, trimé. */
  onTranscript(text: string): void;
  onListening(): void;
  onError(message: string): void;
}

export interface LiveStt {
  start(): Promise<void>;
  /** Toujours du PCM16 16 kHz mono (AUDIO_SAMPLE_RATE). */
  sendAudio(pcm: Buffer): void;
  close(): void;
}

export interface BatchTranscribeOptions {
  language: string;
  keyterms?: string[];
}

export interface BatchStt {
  transcribe(audio: Buffer, options: BatchTranscribeOptions): Promise<SttUtterance[]>;
}
```

- [ ] **Step 4: Déplacer l'adapter Flux et le brancher sur le port**

```bash
cd apps/backend/src
mkdir -p stt/providers
git mv deepgram-flux.ts stt/providers/deepgram-flux.ts
git rm groq-stt.ts
```

Dans `stt/providers/deepgram-flux.ts`, remplacer :

```ts
import { DeepgramClient } from "@deepgram/sdk";

interface FluxSTTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}
```

par :

```ts
import { DeepgramClient } from "@deepgram/sdk";
import type { LiveStt, LiveSttCallbacks } from "../types.js";
```

Puis dans le même fichier :
- `export class FluxSTT {` → `export class FluxSTT implements LiveStt {`
- `private callbacks: FluxSTTCallbacks;` → `private callbacks: LiveSttCallbacks;`
- `constructor(language: string, keywords: string[] | undefined, callbacks: FluxSTTCallbacks) {` → `constructor(language: string, keywords: string[] | undefined, callbacks: LiveSttCallbacks) {`

Le reste du fichier est **inchangé** (dont `eot_threshold: 0.85`).

Dans `apps/backend/src/__tests__/deepgram-flux.test.ts`, remplacer `await import("../deepgram-flux.js")` par `await import("../stt/providers/deepgram-flux.js")`.

- [ ] **Step 5: Créer la fabrique**

Créer `apps/backend/src/stt/index.ts` :

```ts
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
```

- [ ] **Step 6: Vérifier fabrique et test Flux**

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts src/__tests__/deepgram-flux.test.ts`
Expected: PASS, 2 fichiers / 3 tests.

- [ ] **Step 7: Brancher `session.ts` sur le port**

Dans `apps/backend/src/session.ts` :

Ligne 7, remplacer `import { FluxSTT } from "./deepgram-flux.js";` par :

```ts
import { createLiveStt } from "./stt/index.js";
import type { LiveStt } from "./stt/types.js";
```

Ligne 22, remplacer `private stt: FluxSTT | null = null;` par `private stt: LiveStt | null = null;`.

Remplacer le bloc :

```ts
    this.stt = new FluxSTT(config.language, config.keywords, {
      onTranscript: (text) => void this.handleFinalTranscript(text),
      onListening: () => console.log("[Session] Deepgram Flux connected"),
      onError: (err) => this.send({ type: "session:error", error: err }),
    });
```

par :

```ts
    this.stt = createLiveStt(
      { language: config.language, keyterms: config.keywords },
      {
        onTranscript: (text) => void this.handleFinalTranscript(text),
        onListening: () => console.log("[Session] STT connected"),
        onError: (err) => this.send({ type: "session:error", error: err }),
      }
    );
```

Dans le `console.log` qui suit `void this.stt.start();` (message `Keywords for Deepgram keyterm boosting:`), remplacer `Keywords for Deepgram keyterm boosting:` par `Keyterms for STT boosting:`.

- [ ] **Step 8: Migrer les mocks des tests de session**

Ces 7 fichiers contiennent un bloc **identique** : `session.test.ts`, `session-max-buffer.test.ts`, `session-tech-matching.test.ts`, `session-debounce-min-words.test.ts`, `session-usage-limit.test.ts`, `session-theme-angle.test.ts`, `session-card-merge.test.ts`. Dans chacun, remplacer (Edit, `old_string` → `new_string`) :

Ancien :
```ts
vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, _keywords: string[] | undefined, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));
```

Nouveau :
```ts
vi.mock("../stt/index.js", () => ({
  createLiveStt: (_options: unknown, callbacks: STTCallbacks) => {
    stt.callbacks = callbacks;
    return {
      async start() { stt.callbacks?.onListening(); },
      sendAudio() {},
      close() {},
    };
  },
}));
```

Dans `session-keywords.test.ts`, remplacer :

```ts
vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, keywords: string[] | undefined, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
      stt.lastKeywords = keywords;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));
```

par :

```ts
vi.mock("../stt/index.js", () => ({
  createLiveStt: (options: { keyterms?: string[] }, callbacks: STTCallbacks) => {
    stt.callbacks = callbacks;
    stt.lastKeywords = options.keyterms;
    return {
      async start() { stt.callbacks?.onListening(); },
      sendAudio() {},
      close() {},
    };
  },
}));
```

et, dans le même fichier, renommer le titre du test `passes SessionConfig.keywords to the FluxSTT constructor` en `passes SessionConfig.keywords to createLiveStt as keyterms`.

- [ ] **Step 9: Vérifier toute la suite**

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 21 fichiers / 102 tests (base 100 + 2 tests de fabrique).

Run: `grep -rn "deepgram-flux" apps/backend/src`
Expected: uniquement `stt/index.ts` (import), `__tests__/deepgram-flux.test.ts` et `__tests__/stt-factory.test.ts` (chemins `../stt/providers/deepgram-flux.js`).

Run: `grep -rn "groq" apps/backend/src -i`
Expected: aucune ligne.

- [ ] **Step 10: Commit**

```bash
git add -A apps/backend/src
git commit -m "$(cat <<'EOF'
refactor(stt): extract LiveStt port and select the live provider by env

session.ts ne dépend plus de FluxSTT mais du port LiveStt. Deepgram reste
le défaut (STT_LIVE_PROVIDER), comportement inchangé. Supprime groq-stt.ts
(code mort).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 3: Port batch et validation de l'env au boot

**Files:**
- Move: `apps/backend/src/deepgram-batch.ts` → `apps/backend/src/stt/providers/deepgram-batch.ts`
- Modify: `apps/backend/src/stt/index.ts`
- Modify: `apps/backend/src/routes.ts` (lignes 22 et 56)
- Modify: `apps/backend/src/index.ts`
- Modify: `apps/backend/src/__tests__/deepgram-batch.test.ts`
- Modify: `apps/backend/src/__tests__/lecture-transcribe.test.ts`, `apps/backend/src/__tests__/lecture-audio-chunk.test.ts` (ligne 6, mocks)
- Modify: `apps/backend/src/__tests__/stt-factory.test.ts`

**Interfaces:**
- Consumes: `BatchStt`, `BatchTranscribeOptions` (Task 2), `SttUtterance` (Task 1), `stt/index.ts` de Task 2.
- Produces :
  ```ts
  // stt/providers/deepgram-batch.ts
  export const deepgramBatchStt: BatchStt
  // stt/index.ts
  export function getBatchStt(): BatchStt
  export function assertSttConfig(): void  // lève si un STT_*_PROVIDER est invalide, sinon log "[STT] live=… batch=…"
  ```

- [ ] **Step 1: Adapter les tests (ils doivent échouer)**

Dans `apps/backend/src/__tests__/deepgram-batch.test.ts` :

```bash
cd apps/backend/src/__tests__
perl -pi -e 's|const \{ transcribeAudioBatch \} = await import\("\.\./deepgram-batch\.js"\);|const { deepgramBatchStt } = await import("../stt/providers/deepgram-batch.js");|; s/transcribeAudioBatch\(/deepgramBatchStt.transcribe(/g; s/describe\("transcribeAudioBatch"/describe("deepgramBatchStt.transcribe"/' deepgram-batch.test.ts
```

Dans `lecture-transcribe.test.ts` **et** `lecture-audio-chunk.test.ts`, remplacer la ligne 6 :

```ts
vi.mock("../deepgram-batch.js", () => ({ transcribeAudioBatch: mockTranscribeAudioBatch }));
```

par :

```ts
vi.mock("../stt/index.js", () => ({
  getBatchStt: () => ({ transcribe: mockTranscribeAudioBatch }),
}));
```

(le nom `mockTranscribeAudioBatch` est conservé pour que les assertions existantes ne changent pas).

Dans `stt-factory.test.ts` :

1. Après le `vi.mock` de Flux, ajouter :
   ```ts
   vi.mock("../stt/providers/deepgram-batch.js", () => ({
     deepgramBatchStt: { transcribe: vi.fn() },
   }));
   ```
2. Remplacer `const { createLiveStt } = await import("../stt/index.js");` par :
   ```ts
   const { createLiveStt, getBatchStt, assertSttConfig } = await import("../stt/index.js");
   const { deepgramBatchStt } = await import("../stt/providers/deepgram-batch.js");
   ```
3. Ajouter à la fin du fichier :
   ```ts
   describe("getBatchStt", () => {
     it("returns the Deepgram batch adapter by default", () => {
       expect(getBatchStt()).toBe(deepgramBatchStt);
     });

     it("throws on an unknown STT_BATCH_PROVIDER", () => {
       process.env.STT_BATCH_PROVIDER = "inworld";

       expect(() => getBatchStt()).toThrow(/STT_BATCH_PROVIDER "inworld".*deepgram/);
     });
   });

   describe("assertSttConfig", () => {
     it("rejects an invalid provider so the server fails fast at boot", () => {
       process.env.STT_LIVE_PROVIDER = "whisper";

       expect(() => assertSttConfig()).toThrow(/STT_LIVE_PROVIDER/);
     });
   });
   ```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/deepgram-batch.test.ts src/__tests__/stt-factory.test.ts src/__tests__/lecture-transcribe.test.ts src/__tests__/lecture-audio-chunk.test.ts`
Expected: FAIL (module `stt/providers/deepgram-batch.js` introuvable, `getBatchStt` non exporté).

- [ ] **Step 3: Déplacer et adapter l'adapter batch**

```bash
cd apps/backend/src
git mv deepgram-batch.ts stt/providers/deepgram-batch.ts
```

Remplacer **tout** le contenu de `stt/providers/deepgram-batch.ts` par :

```ts
import { DeepgramClient } from "@deepgram/sdk";
import type { SttUtterance } from "@voxhelp/lecture";
import type { BatchStt, BatchTranscribeOptions } from "../types.js";

export const deepgramBatchStt: BatchStt = {
  async transcribe(audio: Buffer, options: BatchTranscribeOptions): Promise<SttUtterance[]> {
    const client = new DeepgramClient();

    const response = await client.listen.v1.media.transcribeFile(
      audio,
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
  },
};
```

- [ ] **Step 4: Étendre la fabrique**

Remplacer **tout** le contenu de `apps/backend/src/stt/index.ts` par :

```ts
import { FluxSTT } from "./providers/deepgram-flux.js";
import { deepgramBatchStt } from "./providers/deepgram-batch.js";
import type { BatchStt, LiveStt, LiveSttCallbacks, LiveSttOptions } from "./types.js";

type LiveSttFactory = (options: LiveSttOptions, callbacks: LiveSttCallbacks) => LiveStt;

const DEFAULT_PROVIDER = "deepgram";

const LIVE_PROVIDERS: Record<string, LiveSttFactory> = {
  deepgram: (options, callbacks) => new FluxSTT(options.language, options.keyterms, callbacks),
};

const BATCH_PROVIDERS: Record<string, BatchStt> = {
  deepgram: deepgramBatchStt,
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

export function getBatchStt(): BatchStt {
  return resolveProvider("STT_BATCH_PROVIDER", BATCH_PROVIDERS);
}

/** À appeler au démarrage du serveur : échoue vite sur une valeur d'env invalide. */
export function assertSttConfig(): void {
  resolveProvider("STT_LIVE_PROVIDER", LIVE_PROVIDERS);
  resolveProvider("STT_BATCH_PROVIDER", BATCH_PROVIDERS);
  console.log(`[STT] live=${providerName("STT_LIVE_PROVIDER")} batch=${providerName("STT_BATCH_PROVIDER")}`);
}
```

- [ ] **Step 5: Brancher `routes.ts` et le boot**

Dans `apps/backend/src/routes.ts` :
- Ligne 22 : `import { transcribeAudioBatch } from "./deepgram-batch.js";` → `import { getBatchStt } from "./stt/index.js";`
- Ligne 56 : `const utterances = await transcribeAudioBatch(buffer, {` → `const utterances = await getBatchStt().transcribe(buffer, {`

Dans `apps/backend/src/index.ts` :
- Ajouter l'import après `import { registerRoutes } from "./routes.js";` :
  ```ts
  import { assertSttConfig } from "./stt/index.js";
  ```
- Ajouter comme **première instruction** de `main()`, avant `const app = Fastify(...)` :
  ```ts
    assertSttConfig();
  ```

- [ ] **Step 6: Vérifier**

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 21 fichiers / 105 tests (102 + 3 nouveaux tests dans `stt-factory.test.ts`).

Run: `grep -rn "deepgram-batch\|transcribeAudioBatch" apps/backend/src | grep -v mockTranscribeAudioBatch`
Expected: uniquement l'import dans `stt/index.ts`, `__tests__/deepgram-batch.test.ts` et le `vi.mock("../stt/providers/deepgram-batch.js"…)` de `stt-factory.test.ts`.

Vérification du boot en échec rapide :

Run: `cd apps/backend && STT_LIVE_PROVIDER=whisper npx tsx src/index.ts 2>&1 | head -5`
Expected: erreur `Unknown STT_LIVE_PROVIDER "whisper". Valid values: deepgram`, processus terminé (pas de `🚀 VoxHelp backend`).

- [ ] **Step 7: Commit**

```bash
git add -A apps/backend/src
git commit -m "$(cat <<'EOF'
refactor(stt): extract BatchStt port and validate STT env at boot

routes.ts passe par getBatchStt(). Une valeur invalide de STT_LIVE_PROVIDER
ou STT_BATCH_PROVIDER fait échouer le démarrage du serveur.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 4: Adapter Inworld live, enregistrement et documentation

**Files:**
- Create: `apps/backend/src/stt/providers/inworld-live.ts`
- Create: `apps/backend/src/__tests__/inworld-live.test.ts`
- Modify: `apps/backend/src/stt/index.ts`
- Modify: `apps/backend/src/__tests__/stt-factory.test.ts`
- Modify: `apps/backend/.env.example`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `LiveStt`, `LiveSttCallbacks` (Task 2), `AUDIO_SAMPLE_RATE` et `InterviewLanguage` de `@voxhelp/shared`, la fabrique de Task 3.
- Produces : `export class InworldSTT implements LiveStt` avec le constructeur `(language: InterviewLanguage, keyterms: string[] | undefined, callbacks: LiveSttCallbacks)`, enregistré sous la clé `inworld` de `LIVE_PROVIDERS`.

- [ ] **Step 1: Écrire les tests de l'adapter (doivent échouer)**

Créer `apps/backend/src/__tests__/inworld-live.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeSocket {
  url: string;
  options: { headers: Record<string, string> };
  readyState: number;
  sent: string[];
  closeCalled: boolean;
  emit(event: string, ...args: unknown[]): boolean;
}

const fake = vi.hoisted(() => ({ sockets: [] as FakeSocket[] }));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    closeCalled = false;
    constructor(
      public url: string,
      public options: { headers: Record<string, string> }
    ) {
      super();
      fake.sockets.push(this as unknown as FakeSocket);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.closeCalled = true;
      this.readyState = 3;
    }
  }
  return { default: FakeWebSocket };
});

const { InworldSTT } = await import("../stt/providers/inworld-live.js");

function makeCallbacks() {
  return { onTranscript: vi.fn(), onListening: vi.fn(), onError: vi.fn() };
}

function lastSocket(): FakeSocket {
  return fake.sockets[fake.sockets.length - 1];
}

function openSocket(socket: FakeSocket): void {
  socket.readyState = 1;
  socket.emit("open");
}

function serverSends(socket: FakeSocket, payload: unknown): void {
  socket.emit("message", Buffer.from(JSON.stringify(payload)));
}

async function startConnected(stt: InstanceType<typeof InworldSTT>): Promise<FakeSocket> {
  const started = stt.start();
  const socket = lastSocket();
  openSocket(socket);
  await started;
  return socket;
}

describe("InworldSTT", () => {
  beforeEach(() => {
    fake.sockets.length = 0;
    process.env.INWORLD_API_KEY = "test-key";
  });

  it("authenticates with Basic <key> against the streaming endpoint", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());

    const socket = await startConnected(stt);

    expect(socket.url).toBe("wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional");
    expect(socket.options.headers.Authorization).toBe("Basic test-key");
  });

  it("sends transcribeConfig first, with model, LINEAR16 16 kHz, language, prompts and turn detection", async () => {
    const stt = new InworldSTT("fr", ["Kubernetes", "Cléo"], makeCallbacks());

    const socket = await startConnected(stt);

    expect(JSON.parse(socket.sent[0])).toEqual({
      transcribeConfig: {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "LINEAR16",
        sampleRateHertz: 16000,
        language: "fr",
        prompts: ["Kubernetes", "Cléo"],
        endOfTurnConfidenceThreshold: 0.7,
        inworldSttV1Config: {
          minEndOfTurnSilenceWhenConfident: 300,
          maxTurnSilence: 1200,
        },
      },
    });
  });

  it("omits prompts when there are no keyterms", async () => {
    for (const keyterms of [undefined, []]) {
      fake.sockets.length = 0;
      const stt = new InworldSTT("en", keyterms, makeCallbacks());

      const socket = await startConnected(stt);

      expect(JSON.parse(socket.sent[0]).transcribeConfig).not.toHaveProperty("prompts");
    }
  });

  it("calls onListening only once the config has been sent", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);

    const started = stt.start();
    const socket = lastSocket();
    expect(callbacks.onListening).not.toHaveBeenCalled();

    openSocket(socket);
    await started;

    expect(callbacks.onListening).toHaveBeenCalledTimes(1);
  });

  it("ignores audio until the config has been sent", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());

    const started = stt.start();
    const socket = lastSocket();
    stt.sendAudio(Buffer.from([1, 2, 3]));
    expect(socket.sent).toHaveLength(0);

    openSocket(socket);
    await started;

    expect(socket.sent).toHaveLength(1); // uniquement la config
  });

  it("wraps audio in base64 audioChunk messages", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());
    const socket = await startConnected(stt);

    stt.sendAudio(Buffer.from([1, 2, 3]));

    expect(JSON.parse(socket.sent[1])).toEqual({ audioChunk: { content: "AQID" } });
  });

  it("emits onTranscript only for non-empty final results, trimmed", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    serverSends(socket, { result: { speechStarted: { startTimeMs: 0, confidence: 0 } } });
    serverSends(socket, { result: { transcription: { transcript: "Bon", isFinal: false } } });
    serverSends(socket, { result: { transcription: { transcript: "   ", isFinal: true } } });
    socket.emit("message", Buffer.from("not json"));
    expect(callbacks.onTranscript).not.toHaveBeenCalled();

    serverSends(socket, { result: { transcription: { transcript: "  Bonjour tout le monde.  ", isFinal: true } } });

    expect(callbacks.onTranscript).toHaveBeenCalledTimes(1);
    expect(callbacks.onTranscript).toHaveBeenCalledWith("Bonjour tout le monde.");
  });

  it("sends closeStream and closes the socket on close()", async () => {
    const stt = new InworldSTT("fr", undefined, makeCallbacks());
    const socket = await startConnected(stt);

    stt.close();

    expect(JSON.parse(socket.sent[socket.sent.length - 1])).toEqual({ closeStream: {} });
    expect(socket.closeCalled).toBe(true);
  });

  it("ignores server messages after close()", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    stt.close();
    serverSends(socket, { result: { transcription: { transcript: "Trop tard.", isFinal: true } } });

    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it("reports a missing API key without opening a socket", async () => {
    delete process.env.INWORLD_API_KEY;
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);

    await stt.start();

    expect(callbacks.onError).toHaveBeenCalledWith("INWORLD_API_KEY not set");
    expect(fake.sockets).toHaveLength(0);
  });

  it("reports an explicit error for unsupported languages without opening a socket", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("zh", undefined, callbacks);

    await stt.start();

    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("zh"));
    expect(fake.sockets).toHaveLength(0);
  });

  it("reports a socket error that happens before the connection opens, once", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);

    const started = stt.start();
    const socket = lastSocket();
    socket.emit("error", new Error("ECONNREFUSED"));
    socket.emit("close", 1006);
    await started;

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith("ECONNREFUSED");
    expect(callbacks.onListening).not.toHaveBeenCalled();
  });

  it("reports an unexpected close once connected", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    socket.emit("close", 1006);

    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("1006"));
  });

  it("stays silent when the socket closes after close()", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    stt.close();
    socket.emit("close", 1000);

    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("forwards server error messages to onError", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    serverSends(socket, { error: { message: "quota exceeded" } });

    expect(callbacks.onError).toHaveBeenCalledWith("quota exceeded");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-live.test.ts`
Expected: FAIL, `Failed to resolve import "../stt/providers/inworld-live.js"`.

- [ ] **Step 3: Implémenter l'adapter**

Créer `apps/backend/src/stt/providers/inworld-live.ts` :

```ts
import WebSocket from "ws";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { InterviewLanguage } from "@voxhelp/shared";
import type { LiveStt, LiveSttCallbacks } from "../types.js";

const INWORLD_STT_URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional";
const MODEL_ID = "inworld/inworld-stt-1";

// Détection de fin de tour. Les défauts Inworld (maxTurnSilence 300 ms,
// confiance 0.4) sont trop agressifs pour un entretien : une hésitation
// couperait le tour. Valeurs de départ = exemple de la doc Inworld, à
// ajuster au test réel (cf. eot_threshold 0.85 côté Flux).
const END_OF_TURN_CONFIDENCE_THRESHOLD = 0.7;
const MIN_END_OF_TURN_SILENCE_MS = 300;
const MAX_TURN_SILENCE_MS = 1200;

// Langues absentes du streaming Inworld (InterviewLanguage = fr|en|es|pt|zh).
const UNSUPPORTED_LANGUAGES: ReadonlySet<string> = new Set(["zh"]);

interface InworldServerMessage {
  result?: { transcription?: { transcript?: string; isFinal?: boolean } };
  // Forme non documentée : à confirmer au test réel.
  error?: { message?: string };
}

export class InworldSTT implements LiveStt {
  private socket: WebSocket | null = null;
  private callbacks: LiveSttCallbacks;
  private language: InterviewLanguage;
  private keyterms: string[] | undefined;
  private configSent = false;
  private closed = false;

  constructor(language: InterviewLanguage, keyterms: string[] | undefined, callbacks: LiveSttCallbacks) {
    this.language = language;
    this.keyterms = keyterms;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
      this.callbacks.onError("INWORLD_API_KEY not set");
      return;
    }
    if (UNSUPPORTED_LANGUAGES.has(this.language)) {
      this.callbacks.onError(`Inworld STT streaming does not support language "${this.language}"`);
      return;
    }

    const hasKeyterms = Boolean(this.keyterms && this.keyterms.length > 0);
    console.log(
      `[InworldSTT] Connecting: language=${this.language} prompts=${hasKeyterms ? `[${this.keyterms!.join(", ")}]` : "none"}`
    );

    // La clé du portail est déjà en Base64 : on ne la ré-encode pas.
    const socket = new WebSocket(INWORLD_STT_URL, {
      headers: { Authorization: `Basic ${apiKey}` },
    });
    this.socket = socket;

    socket.on("message", (data) => this.handleMessage(data.toString()));

    socket.on("error", (err) => {
      if (!this.closed) {
        this.callbacks.onError(err.message || "Inworld connection error");
      }
    });

    // Un échec de connexion émet "error" puis "close" : seule une fermeture
    // survenue après l'établissement de la session est signalée ici.
    socket.on("close", (code) => {
      const wasConnected = this.configSent;
      this.configSent = false;
      if (wasConnected && !this.closed) {
        this.callbacks.onError(`Inworld STT connection closed unexpectedly (code ${code})`);
      }
    });

    await new Promise<void>((resolve) => {
      socket.once("open", () => {
        this.sendConfig(socket);
        resolve();
      });
      socket.once("close", () => resolve());
    });

    if (this.configSent && !this.closed) {
      this.callbacks.onListening();
    }
  }

  sendAudio(buf: Buffer): void {
    if (this.closed || !this.configSent || !this.socket) return;
    if (this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify({ audioChunk: { content: buf.toString("base64") } }));
    } catch {
      // socket may have closed between check and send
    }
  }

  close(): void {
    this.closed = true;
    this.configSent = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ closeStream: {} }));
      }
      socket.close();
    } catch {
      // ignore cleanup errors
    }
  }

  private sendConfig(socket: WebSocket): void {
    const hasKeyterms = Boolean(this.keyterms && this.keyterms.length > 0);
    socket.send(
      JSON.stringify({
        transcribeConfig: {
          modelId: MODEL_ID,
          audioEncoding: "LINEAR16",
          sampleRateHertz: AUDIO_SAMPLE_RATE,
          language: this.language,
          ...(hasKeyterms ? { prompts: this.keyterms } : {}),
          endOfTurnConfidenceThreshold: END_OF_TURN_CONFIDENCE_THRESHOLD,
          inworldSttV1Config: {
            minEndOfTurnSilenceWhenConfident: MIN_END_OF_TURN_SILENCE_MS,
            maxTurnSilence: MAX_TURN_SILENCE_MS,
          },
        },
      })
    );
    this.configSent = true;
  }

  private handleMessage(raw: string): void {
    if (this.closed) return;

    let message: InworldServerMessage;
    try {
      message = JSON.parse(raw) as InworldServerMessage;
    } catch {
      return;
    }

    if (message.error) {
      this.callbacks.onError(message.error.message ?? "Inworld STT error");
      return;
    }

    const transcription = message.result?.transcription;
    if (!transcription?.isFinal) return;

    const text = transcription.transcript?.trim();
    if (text) {
      this.callbacks.onTranscript(text);
    }
  }
}
```

- [ ] **Step 4: Vérifier les tests de l'adapter**

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-live.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Test d'enregistrement dans la fabrique (doit échouer)**

Dans `apps/backend/src/__tests__/stt-factory.test.ts` :

1. Après le `vi.hoisted` de `flux`, ajouter :
   ```ts
   const inworld = vi.hoisted(() => ({ ctorArgs: null as unknown[] | null }));
   ```
2. Après le `vi.mock` de Flux, ajouter :
   ```ts
   vi.mock("../stt/providers/inworld-live.js", () => ({
     InworldSTT: class MockInworldSTT {
       constructor(...args: unknown[]) {
         inworld.ctorArgs = args;
       }
     },
   }));
   ```
3. Dans le `beforeEach`, ajouter `inworld.ctorArgs = null;`.
4. Dans `describe("createLiveStt", …)`, ajouter :
   ```ts
     it("creates the Inworld adapter when STT_LIVE_PROVIDER=inworld", () => {
       process.env.STT_LIVE_PROVIDER = "inworld";

       const stt = createLiveStt({ language: "en", keyterms: ["Cléo"] }, callbacks);

       expect(stt).toBeDefined();
       expect(inworld.ctorArgs).toEqual(["en", ["Cléo"], callbacks]);
       expect(flux.ctorArgs).toBeNull();
     });
   ```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts`
Expected: FAIL sur le nouveau test (`Unknown STT_LIVE_PROVIDER "inworld"`).

- [ ] **Step 6: Enregistrer Inworld**

Dans `apps/backend/src/stt/index.ts` :
- Ajouter l'import après celui de `deepgram-batch.js` : `import { InworldSTT } from "./providers/inworld-live.js";`
- Dans `LIVE_PROVIDERS`, ajouter après l'entrée `deepgram` :
  ```ts
  inworld: (options, callbacks) => new InworldSTT(options.language, options.keyterms, callbacks),
  ```

- [ ] **Step 7: Documenter la configuration**

`apps/backend/.env.example` : remplacer

```
# STT - Deepgram Flux
DEEPGRAM_API_KEY=your_deepgram_api_key
```

par

```
# STT - Deepgram (live Flux + batch Nova-3)
DEEPGRAM_API_KEY=your_deepgram_api_key

# STT - choix du fournisseur (défaut : deepgram)
# STT_LIVE_PROVIDER=deepgram   # deepgram | inworld
# STT_BATCH_PROVIDER=deepgram  # deepgram uniquement pour l'instant

# STT - Inworld (requis uniquement si STT_LIVE_PROVIDER=inworld)
# Clé "Basic (Base64)" de https://platform.inworld.ai/api-keys
INWORLD_API_KEY=your_inworld_basic_base64_key
```

`CLAUDE.md` (racine) :
- Remplacer `- **STT** : Deepgram Flux Multilingual streaming v2 (PCM 16kHz mono) + correction Haiku` par :
  `- **STT** : ports \`LiveStt\` / \`BatchStt\` (\`apps/backend/src/stt/\`), fournisseur choisi par env — live : Deepgram Flux Multilingual streaming v2 (défaut) ou Inworld STT (PCM 16kHz mono) + correction Haiku ; batch (cours) : Deepgram Nova-3`
- Dans « Variables d'environnement », remplacer `- \`DEEPGRAM_API_KEY\` — STT streaming` par :
  ```
  - `DEEPGRAM_API_KEY` — STT live (Flux) et batch (Nova-3)
  - `STT_LIVE_PROVIDER` — `deepgram` (défaut) ou `inworld`
  - `STT_BATCH_PROVIDER` — `deepgram` (seule valeur pour l'instant)
  - `INWORLD_API_KEY` — clé « Basic (Base64) » du portail Inworld (uniquement si `STT_LIVE_PROVIDER=inworld`)
  ```
- Dans « Architecture clé » (Live, étape 2), remplacer `→ Deepgram Flux v2 streaming STT (end-of-turn detection intégré)` par `→ STT streaming via \`createLiveStt\` (Deepgram Flux v2 par défaut, détection de fin de tour intégrée)`.
- Dans « Fichiers importants », ajouter après la ligne `apps/backend/src/session.ts` :
  `- \`apps/backend/src/stt/\` — Ports STT (\`types.ts\`), sélection par env (\`index.ts\`), adapters (\`providers/\`)`

- [ ] **Step 8: Vérifier toute la suite**

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 22 fichiers / 121 tests (105 + 15 Inworld + 1 fabrique).

Run: `cd packages/lecture && npx tsc --noEmit && npx vitest run && cd ../../apps/web && npx tsc --noEmit`
Expected: PASS (lecture 14 fichiers / 74 tests, web sans erreur).

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src apps/backend/.env.example CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(stt): add Inworld STT as a live provider (STT_LIVE_PROVIDER=inworld)

Adapter WebSocket streaming Inworld derrière le port LiveStt. Seuils de
fin de tour de départ à valider au test réel. Deepgram reste le défaut.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 5 (OPTIONNELLE — seulement si l'utilisateur confirme) : script de comparaison `stt-compare`

Envoie un fichier WAV en temps réel à un fournisseur live et affiche les tours détectés. Sert à comparer Flux et Inworld sur un entretien enregistré, sans passer par Google Meet.

**Files:**
- Create: `apps/backend/scripts/stt-compare.ts`
- Modify: `apps/backend/package.json` (script `stt:compare`)

**Interfaces:**
- Consumes: `createLiveStt` (Task 2), `AUDIO_SAMPLE_RATE` / `InterviewLanguage` de `@voxhelp/shared`.
- Produces: commande `pnpm --filter @voxhelp/backend stt:compare <chemin-absolu.wav> [langue]`. `apps/backend/scripts/` est hors de `rootDir: ./src` : le `tsc` du backend l'ignore.

- [ ] **Step 1: Créer le script**

Créer `apps/backend/scripts/stt-compare.ts` :

```ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { AUDIO_SAMPLE_RATE } from "@voxhelp/shared";
import type { InterviewLanguage } from "@voxhelp/shared";
import { createLiveStt } from "../src/stt/index.js";

const CHUNK_MS = 100;
const BYTES_PER_CHUNK = (AUDIO_SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
const TAIL_MS = 4000; // laisse les derniers tours se finaliser

function extractPcm(wav: Buffer): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      const channels = wav.readUInt16LE(offset + 10);
      const rate = wav.readUInt32LE(offset + 12);
      const bits = wav.readUInt16LE(offset + 22);
      if (channels !== 1 || rate !== AUDIO_SAMPLE_RATE || bits !== 16) {
        throw new Error(`Expected 16 kHz mono 16-bit PCM, got ${rate} Hz / ${channels} ch / ${bits} bit`);
      }
    }
    if (id === "data") return wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk found");
}

const [file, language = "fr"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: STT_LIVE_PROVIDER=<deepgram|inworld> tsx scripts/stt-compare.ts <audio.wav> [language]");
  process.exit(1);
}

const keyterms = process.env.STT_COMPARE_KEYTERMS?.split(",").map((term) => term.trim()).filter(Boolean);
const pcm = extractPcm(await readFile(file));

const startedAt = Date.now();
const stamp = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
let turns = 0;

const stt = createLiveStt(
  { language: language as InterviewLanguage, keyterms },
  {
    onTranscript: (text) => {
      turns += 1;
      console.log(`[${stamp()}] TURN ${turns}: ${text}`);
    },
    onListening: () => console.log(`[${stamp()}] listening (provider=${process.env.STT_LIVE_PROVIDER || "deepgram"})`),
    onError: (message) => console.error(`[${stamp()}] ERROR: ${message}`),
  }
);

await stt.start();
for (let i = 0; i < pcm.length; i += BYTES_PER_CHUNK) {
  stt.sendAudio(pcm.subarray(i, i + BYTES_PER_CHUNK));
  await sleep(CHUNK_MS);
}
await sleep(TAIL_MS);
stt.close();
console.log(`--- ${turns} tour(s) en ${stamp()}`);
process.exit(0);
```

- [ ] **Step 2: Ajouter le script npm**

Dans `apps/backend/package.json`, ajouter dans `"scripts"`, après `"test:smoke"` (sans oublier la virgule sur la ligne précédente) :

```json
    "stt:compare": "tsx scripts/stt-compare.ts"
```

- [ ] **Step 3: Vérifier avec Deepgram**

Préparer un WAV (nécessite `ffmpeg`, à partir d'un enregistrement d'entretien) :

```bash
ffmpeg -i /chemin/entretien.m4a -ar 16000 -ac 1 -c:a pcm_s16le /chemin/entretien.wav
```

Run: `pnpm --filter @voxhelp/backend stt:compare /chemin/entretien.wav fr`
Expected: `listening (provider=deepgram)`, puis des lignes `TURN n: …` au fil de l'audio, puis `--- N tour(s) en …s`. Sans `DEEPGRAM_API_KEY` : `ERROR: DEEPGRAM_API_KEY not set`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/scripts apps/backend/package.json
git commit -m "$(cat <<'EOF'
chore(stt): add stt-compare script to replay a WAV through a live provider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 6: Validation réelle avec Inworld et réglages

**Nécessite la clé Inworld de l'utilisateur** (l'exécuteur doit la lui demander ; elle ne doit apparaître ni dans un commit, ni dans le plan, ni dans un log partagé). Sans clé, s'arrêter ici et le signaler.

**Files:**
- Modify (selon résultats) : `apps/backend/src/stt/providers/inworld-live.ts`, `apps/backend/src/__tests__/inworld-live.test.ts`
- Modify : `docs/superpowers/specs/2026-09-20-stt-provider-decoupling-design.md` (section « Questions ouvertes » → réponses)

- [ ] **Step 1: Configurer la clé**

Ajouter `INWORLD_API_KEY=<clé Base64 « Basic »>` et `STT_LIVE_PROVIDER=inworld` dans `apps/backend/.env`.
Vérifier qu'il est ignoré : `git check-ignore apps/backend/.env` → doit afficher le chemin.
Clé : portail https://platform.inworld.ai/api-keys (« Generate new key », copier « Basic (Base64) »), ou `npm install -g @inworld/cli && inworld auth login && inworld auth print-api-key`.

- [ ] **Step 2: Test de connexion et d'auth**

Avec le script (Task 5) : `STT_LIVE_PROVIDER=inworld pnpm --filter @voxhelp/backend stt:compare /chemin/entretien.wav fr`.
Sans le script : `pnpm dev:backend`, ouvrir le frontend et lancer une session Live.
Expected : `[InworldSTT] Connecting…`, `listening`, puis des `TURN`.
Si `ERROR` avec 401/403 : l'auth n'est pas `Basic <clé>` telle quelle. Lire le message d'erreur et la page https://docs.inworld.ai/node/authentication, ajuster `Authorization` dans `inworld-live.ts`, et adapter l'assertion du test « authenticates with Basic <key> ».

- [ ] **Step 3: Trancher les questions ouvertes du spec** (noter chaque réponse)

1. **Format de `language`** : si les tours sont vides ou si une erreur apparaît avec `fr`, essayer `fr-FR` (adapter `language: this.language` dans `sendConfig`, ex. via une petite table `fr → fr-FR`).
2. **Emplacement des seuils** : si le comportement de fin de tour ne réagit pas aux constantes (changer `MAX_TURN_SILENCE_MS` à 5000 doit visiblement allonger les tours), déplacer les champs entre la racine de `transcribeConfig` et `inworldSttV1Config`.
3. **Sens de `isFinal`** : comparer le nombre de `TURN` avec Flux sur le même WAV. Si Inworld émet beaucoup plus de tours courts (phrases au lieu de tours), ajouter dans l'adapter un regroupement des finals jusqu'au `speechStopped`, avec un test dédié.
4. **FR/EN mélangé** : faire 2 runs sur un extrait mêlant termes techniques anglais et phrases françaises, l'un avec `language: "fr"`, l'autre avec `language` omis (auto-détection). Garder le meilleur.
5. **Chinois** : si possible, essayer `zh` ; si le streaming l'accepte, retirer `zh` de `UNSUPPORTED_LANGUAGES` et adapter le test « unsupported languages ».
6. **Forme des erreurs serveur** : provoquer une erreur (ex. clé volontairement fausse) et vérifier qu'elle remonte bien par `onError` ; corriger `InworldServerMessage.error` sinon.
7. **Longs silences** : laisser un silence de 60 s au milieu d'un run ; si le flux se ferme, ajouter `inactivityTimeoutSeconds` (valeur haute) dans `sendConfig` et l'ajouter à l'assertion du test « sends transcribeConfig first… ».

- [ ] **Step 4: Régler les seuils de fin de tour**

Sur un enregistrement d'entretien réel, ajuster `END_OF_TURN_CONFIDENCE_THRESHOLD` / `MAX_TURN_SILENCE_MS` jusqu'à ce que le nombre de tours et leur découpage soient comparables à Flux (pas de coupure sur une hésitation, pas de tours trop longs). Mettre à jour les valeurs attendues dans le test « sends transcribeConfig first… ».

- [ ] **Step 5: Vérifier en session réelle** (facultatif mais recommandé)

`STT_LIVE_PROVIDER=inworld pnpm dev`, session Live sur un vrai entretien (ou Google Meet) : les transcripts arrivent, les cartes live-assist se déclenchent, aucun `session:error`.

- [ ] **Step 6: Consigner et vérifier**

Mettre à jour la section « Questions ouvertes » du spec avec les réponses observées (remplacer chaque question par « Résolu : … »).

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 0 échec.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src docs/superpowers/specs/2026-09-20-stt-provider-decoupling-design.md
git commit -m "$(cat <<'EOF'
fix(stt): tune Inworld live adapter after real-world validation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```
