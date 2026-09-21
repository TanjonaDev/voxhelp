# Sélecteur de modèle STT et `prompts` Inworld — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choisir le modèle STT live depuis l'interface (liste déroulante en haut à droite, aujourd'hui Deepgram Flux et Inworld) et fiabiliser l'équivalent du `keyterm` pour Inworld (`prompts`).

**Architecture:** Le registre des fournisseurs live (`apps/backend/src/stt/index.ts`) devient la source de vérité (id, libellé, clé requise). Le front lit la liste via `GET /api/stt/providers` et envoie le choix dans `session:start` (`SessionConfig.sttProvider`). L'adapter Inworld nettoie les mots-clés avec une fonction pure avant de les envoyer en `prompts`.

**Tech Stack:** TypeScript strict (ESM, imports `.js` dans le backend), Fastify 5, `ws`, vitest 4, React 19 + Vite 6 (styles en ligne et variables CSS du thème dans `OverlayPanel`).

**Spec:** `docs/superpowers/specs/2026-09-21-stt-model-selector-design.md`

## Global Constraints

- Node >= 22, TypeScript strict, **pas de `any`**, ESM avec imports en `.js` dans le backend ; kebab-case fichiers, camelCase variables/fonctions, PascalCase types/composants. React : composants fonctionnels + hooks dans `hooks/`, pas de Redux / CSS modules / styled-components / classes React.
- **Défaut inchangé** : sans sélection, `STT_LIVE_PROVIDER` (défaut `deepgram`) s'applique. Aucune nouvelle variable d'env obligatoire.
- Identifiants de fournisseurs live : `deepgram` (libellé `Deepgram Flux`, clé `DEEPGRAM_API_KEY`) et `inworld` (libellé `Inworld`, clé `INWORLD_API_KEY`).
- Contrat partagé, noms exacts : `SessionConfig.sttProvider?: string` ; `SttProviderInfo { id: string; label: string; available: boolean }` ; `SttProvidersResponse { default: string; providers: SttProviderInfo[] }` ; route `GET /api/stt/providers` (contrôle Bearer identique aux autres routes).
- Identifiant inconnu : `SttProviderError` avec le message exact `Modèle STT inconnu : "<id>"`, remonté au client en `session:error`, sans `session:ready`. Un modèle connu mais sans clé n'est **pas** bloqué côté fabrique.
- `localStorage` : clé `voxhelp.sttProvider`. Le menu est verrouillé pendant une session live et masqué si la liste est vide.
- **Règles `prompts` Inworld (mesurées sur l'API réelle)** : caractères acceptés = lettres (tous alphabets), chiffres `0-9`, espace, `. , ; : ! ? ' ( ) -` ; tout le reste est refusé (`INVALID_ARGUMENT`) ; 100 prompts maximum ; 100 caractères maximum par prompt.
- Sécurité : **ne jamais écrire une clé API** dans un fichier, un test, un log ou un commit. `apps/backend/.env` contient de vraies clés et ne doit ni être lu, ni affiché, ni stagé. Les sous-agents **n'appellent aucune API réelle** ; les vérifications réelles sont faites par le contrôleur (Task 4).
- Le dépôt a 2 éléments non suivis sans rapport (`bilan-retours-voxhelp-tests.md`, `design_handoff_voxhelp_overlay/`) et un dossier ignoré `.superpowers/` : ne jamais les stager. Ne stager que les chemins nommés dans chaque tâche.
- Vérifications (depuis la racine) : backend `cd apps/backend && npx tsc --noEmit && npx vitest run` ; lecture `cd packages/lecture && npx tsc --noEmit && npx vitest run` ; web `cd apps/web && npx tsc --noEmit`.
- **État de base avant ce plan** : backend 22 fichiers / 123 tests verts ; lecture 14 fichiers / 74 tests ; typechecks backend, lecture et web verts. Branche `feat/stt-provider-decoupling`.
- Chaque message de commit se termine par ces deux lignes de trailer :
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
  ```

## Structure des fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `apps/backend/src/stt/providers/inworld-prompts.ts` | Créer | Nettoyage pur des mots-clés pour `prompts` |
| `apps/backend/src/stt/providers/inworld-live.ts` | Modifier | Utilise le nettoyage, erreur unique, gardes de type, en-tête |
| `apps/backend/src/__tests__/inworld-prompts.test.ts` | Créer | Tests du nettoyage |
| `apps/backend/src/__tests__/inworld-live.test.ts` | Modifier | +5 tests adapter |
| `packages/shared/src/index.ts` | Modifier | `sttProvider`, `SttProviderInfo`, `SttProvidersResponse` |
| `apps/backend/src/stt/index.ts` | Réécrire | Registre, `listLiveProviders`, `defaultLiveProviderId`, `SttProviderError`, `createLiveStt(…, providerId?)` |
| `apps/backend/src/session.ts` | Modifier | Création du STT avant la mutation d'état, `try/catch` |
| `apps/backend/src/routes.ts` | Modifier | `GET /api/stt/providers` |
| `apps/backend/src/__tests__/stt-factory.test.ts` | Modifier | +4 tests |
| `apps/backend/src/__tests__/stt-providers-route.test.ts` | Créer | 2 tests de route |
| `apps/backend/src/__tests__/session-stt-provider.test.ts` | Créer | 3 tests de session |
| `apps/web/src/hooks/useSttProviders.ts` | Créer | Lecture de la liste, sélection initiale, mémorisation |
| `apps/web/src/components/SttProviderSelect.tsx` | Créer | Menu déroulant |
| `apps/web/src/App.tsx` | Modifier | État du choix, passage à `startSession` |
| `apps/web/src/components/OverlayPanel.tsx` | Modifier | Props et affichage dans `HeaderBar` |
| `CLAUDE.md`, `apps/backend/.env.example` | Modifier | Documentation |

---

### Task 1: Nettoyage des `prompts` Inworld et erreur unique

**Files:**
- Create: `apps/backend/src/stt/providers/inworld-prompts.ts`
- Create: `apps/backend/src/__tests__/inworld-prompts.test.ts`
- Modify: `apps/backend/src/stt/providers/inworld-live.ts`
- Modify: `apps/backend/src/__tests__/inworld-live.test.ts`

**Interfaces:**
- Produces :
  ```ts
  // inworld-prompts.ts
  export const MAX_PROMPTS = 100;
  export const MAX_PROMPT_LENGTH = 100;
  export interface SanitizedPrompts { prompts: string[]; adjusted: number; dropped: number }
  export function sanitizeInworldPrompts(terms: readonly string[] | undefined): SanitizedPrompts
  ```
  `InworldSTT` garde son constructeur `(language: InterviewLanguage, keyterms: string[] | undefined, callbacks: LiveSttCallbacks)`.

- [ ] **Step 1: Écrire les tests du nettoyage (doivent échouer)**

Créer `apps/backend/src/__tests__/inworld-prompts.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { sanitizeInworldPrompts, MAX_PROMPTS, MAX_PROMPT_LENGTH } from "../stt/providers/inworld-prompts.js";

describe("sanitizeInworldPrompts", () => {
  it("leaves plain terms untouched and counts nothing", () => {
    const result = sanitizeInworldPrompts(["Kubernetes", "Spring Boot", "S3"]);

    expect(result).toEqual({ prompts: ["Kubernetes", "Spring Boot", "S3"], adjusted: 0, dropped: 0 });
  });

  it("speaks C#, F# and C++ instead of dropping the symbol", () => {
    const { prompts } = sanitizeInworldPrompts(["C#", "F#", "C++", "c++11"]);

    expect(prompts).toEqual(["C sharp", "F sharp", "C plus plus", "c plus plus 11"]);
  });

  it("turns characters Inworld rejects into spaces", () => {
    const { prompts } = sanitizeInworldPrompts(["CI/CD", "TCP/IP", "@angular/core", "snake_case", "R&D", "A/B testing"]);

    expect(prompts).toEqual(["CI CD", "TCP IP", "angular core", "snake case", "R D", "A B testing"]);
  });

  it("keeps every character Inworld accepts", () => {
    const accepted = ["Node.js", ".NET", "OAuth 2.0", "l'agilité", "e-commerce", "M.E.C.C.", "Genèse", "中文", "Qu'est-ce que c'est ? (oui), non; ok: fin !"];

    const { prompts, adjusted } = sanitizeInworldPrompts(accepted);

    expect(prompts).toEqual(accepted);
    expect(adjusted).toBe(0);
  });

  it("normalizes curly apostrophes to a straight one", () => {
    const { prompts } = sanitizeInworldPrompts(["l’agilité", "l‘Ancien Testament"]);

    expect(prompts).toEqual(["l'agilité", "l'Ancien Testament"]);
  });

  it("collapses whitespace and trims the edges", () => {
    const { prompts } = sanitizeInworldPrompts(["  spaced    out  ", "tab\tseparated"]);

    expect(prompts).toEqual(["spaced out", "tab separated"]);
  });

  it("drops empty and symbol-only terms", () => {
    const result = sanitizeInworldPrompts(["", "   ", "###", "@/|", "ok"]);

    expect(result.prompts).toEqual(["ok"]);
    expect(result.dropped).toBe(4);
  });

  it("drops case-insensitive duplicates and keeps the first spelling", () => {
    const result = sanitizeInworldPrompts(["Java", "java", "JAVA", "Go"]);

    expect(result.prompts).toEqual(["Java", "Go"]);
    expect(result.dropped).toBe(2);
  });

  it("drops terms longer than the limit but keeps a term of exactly the limit", () => {
    const atLimit = "a".repeat(MAX_PROMPT_LENGTH);
    const tooLong = "b".repeat(MAX_PROMPT_LENGTH + 1);

    const result = sanitizeInworldPrompts([atLimit, tooLong]);

    expect(result.prompts).toEqual([atLimit]);
    expect(result.dropped).toBe(1);
  });

  it("caps the list at the maximum number of prompts, in the order received", () => {
    const terms = Array.from({ length: MAX_PROMPTS + 50 }, (_, i) => `terme${i}`);

    const result = sanitizeInworldPrompts(terms);

    expect(result.prompts).toHaveLength(MAX_PROMPTS);
    expect(result.prompts[0]).toBe("terme0");
    expect(result.prompts[MAX_PROMPTS - 1]).toBe(`terme${MAX_PROMPTS - 1}`);
    expect(result.dropped).toBe(50);
  });

  it("counts adjusted terms separately from dropped ones", () => {
    const result = sanitizeInworldPrompts(["C#", "Kubernetes", "", "CI/CD"]);

    expect(result.prompts).toEqual(["C sharp", "Kubernetes", "CI CD"]);
    expect(result.adjusted).toBe(2);
    expect(result.dropped).toBe(1);
  });

  it("returns an empty result when there are no terms", () => {
    expect(sanitizeInworldPrompts(undefined)).toEqual({ prompts: [], adjusted: 0, dropped: 0 });
    expect(sanitizeInworldPrompts([])).toEqual({ prompts: [], adjusted: 0, dropped: 0 });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-prompts.test.ts`
Expected: FAIL, `Failed to resolve import "../stt/providers/inworld-prompts.js"`.

- [ ] **Step 3: Implémenter le nettoyage**

Créer `apps/backend/src/stt/providers/inworld-prompts.ts` :

```ts
// Règles de `prompts` de la passerelle Inworld STT, mesurées sur l'API réelle
// (2026-09-21) : la doc ne donne que les caractères, pas les limites.
// Toute violation fait échouer la config avec INVALID_ARGUMENT (code 3) et la
// session meurt : les mots-clés doivent donc être nettoyés avant envoi.
export const MAX_PROMPTS = 100;
export const MAX_PROMPT_LENGTH = 100;

export interface SanitizedPrompts {
  prompts: string[];
  /** Termes modifiés (symboles remplacés, apostrophes normalisées, espaces). */
  adjusted: number;
  /** Termes écartés (vides, trop longs, doublons, au-delà de MAX_PROMPTS). */
  dropped: number;
}

function cleanTerm(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[‘’′]/g, "'")
    // Formes parlées (C#, F#, C++) : uniquement collées à une lettre ou un chiffre.
    .replace(/(?<=[\p{L}\p{N}])\+\+/gu, " plus plus ")
    .replace(/(?<=[\p{L}\p{N}])#/gu, " sharp ")
    // Tout ce que la passerelle refuse devient une espace (CI/CD -> "CI CD").
    .replace(/[^\p{L}0-9 .,;:!?'()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeInworldPrompts(terms: readonly string[] | undefined): SanitizedPrompts {
  const prompts: string[] = [];
  const seen = new Set<string>();
  let adjusted = 0;
  let dropped = 0;

  for (const raw of terms ?? []) {
    const cleaned = cleanTerm(raw);
    const key = cleaned.toLowerCase();
    if (cleaned === "" || cleaned.length > MAX_PROMPT_LENGTH || seen.has(key) || prompts.length >= MAX_PROMPTS) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    if (cleaned !== raw.trim()) adjusted += 1;
    prompts.push(cleaned);
  }

  return { prompts, adjusted, dropped };
}
```

- [ ] **Step 4: Vérifier que le nettoyage passe**

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-prompts.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Écrire les tests de l'adapter (doivent échouer)**

Dans `apps/backend/src/__tests__/inworld-live.test.ts`, ajouter à la fin du `describe("InworldSTT", …)`, avant l'accolade fermante du `describe` (le fichier utilise les helpers `makeCallbacks`, `startConnected`, `serverSends`, `lastSocket`, `fake` déjà définis) :

```ts
  it("sends sanitized prompts so a keyword like C# cannot break the session", async () => {
    const stt = new InworldSTT("fr", ["C#", "CI/CD", "@angular/core", "l’agilité", "Genèse"], makeCallbacks());

    const socket = await startConnected(stt);

    expect(JSON.parse(socket.sent[0]).transcribeConfig.prompts).toEqual([
      "C sharp",
      "CI CD",
      "angular core",
      "l'agilité",
      "Genèse",
    ]);
  });

  it("omits prompts when every keyterm is dropped by the sanitizer", async () => {
    const stt = new InworldSTT("fr", ["###", "   "], makeCallbacks());

    const socket = await startConnected(stt);

    expect(JSON.parse(socket.sent[0]).transcribeConfig).not.toHaveProperty("prompts");
  });

  it("reports a server error once even when the socket then closes", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    serverSends(socket, { error: { code: 3, message: "invalid prompts", details: [] } });
    socket.emit("close", 1000);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith("invalid prompts");
  });

  it("ignores a final result whose transcript is not a string", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    expect(() =>
      serverSends(socket, { result: { transcription: { transcript: 5, isFinal: true } } })
    ).not.toThrow();

    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the server error message is not a string", async () => {
    const callbacks = makeCallbacks();
    const stt = new InworldSTT("fr", undefined, callbacks);
    const socket = await startConnected(stt);

    serverSends(socket, { error: { message: { nested: true } } });

    expect(callbacks.onError).toHaveBeenCalledWith("Inworld STT error");
  });
```

- [ ] **Step 6: Vérifier l'échec**

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-live.test.ts`
Expected: FAIL sur les 5 nouveaux tests, chacun pour la bonne raison : « sends sanitized prompts » (`prompts` envoyés bruts), « omits prompts when every keyterm is dropped » (`["###", "   "]` envoyés), « reports a server error once » (`onError` appelé 2 fois), « ignores a final result whose transcript is not a string » (`TypeError` sur `transcript.trim`), « falls back to a generic message » (objet transmis tel quel à `onError`). Les 17 tests existants passent toujours.

- [ ] **Step 7: Adapter `inworld-live.ts`**

Dans `apps/backend/src/stt/providers/inworld-live.ts` :

**(a)** Remplacer les 14 premières lignes de commentaire d'en-tête (de `// NON VÉRIFIÉ contre l'API Inworld réelle …` jusqu'à `// - Forme des messages d'erreur serveur (`error.message`)`) par :

```ts
// Vérifié contre l'API Inworld réelle (2026-09-20 / 2026-09-21), voir la spec
// docs/superpowers/specs/2026-09-20-stt-provider-decoupling-design.md,
// « Résultats du test réel », et docs/superpowers/specs/2026-09-21-stt-model-selector-design.md :
// - authentification `Authorization: Basic <clé>` (clé du portail déjà en Base64)
// - `language: "fr"` accepté ; config acceptée avec `endOfTurnConfidenceThreshold` à la
//   racine de transcribeConfig et les silences sous `inworldSttV1Config`
// - `isFinal` : un final par tour, texte complet du tour ; en parole continue les tours sont
//   coupés à ~30 s (plafond de durée) et les seuils de silence se déclenchent rarement
// - erreurs serveur : `{ "error": { "code": 3, "message": "..." } }` puis fermeture 1000
// - `prompts` : caractères, 100 termes, 100 caractères par terme (voir inworld-prompts.ts)
// Encore NON vérifié :
// - `language: "fr-FR"` et FR/EN mélangés (auto-détection ?)
// - réglage des seuils de fin de tour sur un vrai entretien (alternance de locuteurs)
// - `inactivityTimeoutSeconds` volontairement omis : une longue pause pourrait fermer le flux
// - support streaming de `es` et `pt` (seul `zh` est bloqué explicitement)
```

**(b)** Après `import type { LiveStt, LiveSttCallbacks } from "../types.js";`, ajouter :

```ts
import { sanitizeInworldPrompts } from "./inworld-prompts.js";
```

**(c)** Remplacer l'interface `InworldServerMessage` par :

```ts
interface InworldServerMessage {
  result?: { transcription?: { transcript?: string; isFinal?: boolean } };
  // Forme confirmée : { "error": { "code": 3, "message": "...", "details": [] } }
  error?: { message?: string };
}
```

**(d)** Dans la classe, remplacer le champ `private keyterms: string[] | undefined;` par :

```ts
  private keyterms: string[] | undefined;
  private prompts: string[] = [];
```

et le commentaire + champ `connectionErrorReported` par :

```ts
  // Un échec émet plusieurs signaux (message serveur `error`, événement socket `error`, puis
  // `close`) : un seul onError par connexion.
  private connectionErrorReported = false;
```

**(e)** Dans `start()`, remplacer :

```ts
    const hasKeyterms = Boolean(this.keyterms && this.keyterms.length > 0);
    console.log(
      `[InworldSTT] Connecting: language=${this.language} prompts=${hasKeyterms ? `[${this.keyterms!.join(", ")}]` : "none"}`
    );
```

par :

```ts
    const { prompts, adjusted, dropped } = sanitizeInworldPrompts(this.keyterms);
    this.prompts = prompts;
    console.log(
      `[InworldSTT] Connecting: language=${this.language} prompts=${prompts.length > 0 ? `[${prompts.join(", ")}]` : "none"}` +
        (adjusted > 0 || dropped > 0 ? ` (${adjusted} adapté(s), ${dropped} écarté(s))` : "")
    );
```

**(f)** Dans `start()`, remplacer les deux handlers `error` et `close` par (le reste de `start()` est inchangé) :

```ts
    socket.on("error", (err) => {
      this.reportConnectionError(err.message || "Inworld connection error");
    });

    // Un échec de connexion émet "error" puis "close" : seule une fermeture
    // survenue après l'établissement de la session est signalée ici.
    socket.on("close", (code) => {
      const wasConnected = this.configSent;
      this.configSent = false;
      if (wasConnected) {
        this.reportConnectionError(`Inworld STT connection closed unexpectedly (code ${code})`);
      }
    });
```

**(g)** Dans `sendConfig`, supprimer la ligne `const hasKeyterms = Boolean(this.keyterms && this.keyterms.length > 0);` et remplacer `...(hasKeyterms ? { prompts: this.keyterms } : {}),` par :

```ts
          ...(this.prompts.length > 0 ? { prompts: this.prompts } : {}),
```

**(h)** Dans `handleMessage`, remplacer :

```ts
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
```

par :

```ts
    if (message.error) {
      const detail = message.error.message;
      this.reportConnectionError(typeof detail === "string" && detail !== "" ? detail : "Inworld STT error");
      return;
    }

    const transcription = message.result?.transcription;
    if (!transcription?.isFinal) return;

    const text = typeof transcription.transcript === "string" ? transcription.transcript.trim() : "";
    if (text) {
      this.callbacks.onTranscript(text);
    }
  }

  private reportConnectionError(message: string): void {
    if (this.closed || this.connectionErrorReported) return;
    this.connectionErrorReported = true;
    this.callbacks.onError(message);
  }
```

- [ ] **Step 8: Vérifier**

Run: `cd apps/backend && npx vitest run src/__tests__/inworld-live.test.ts src/__tests__/inworld-prompts.test.ts`
Expected: PASS, 22 + 12 = 34 tests.

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 23 fichiers / 140 tests (123 + 12 + 5).

Run: `grep -n "hasKeyterms\|this.keyterms!" apps/backend/src/stt/providers/inworld-live.ts`
Expected: aucune ligne.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/stt/providers/inworld-prompts.ts apps/backend/src/stt/providers/inworld-live.ts apps/backend/src/__tests__/inworld-prompts.test.ts apps/backend/src/__tests__/inworld-live.test.ts
git commit -m "$(cat <<'EOF'
fix(stt): sanitize Inworld prompts and report a failure only once

La passerelle Inworld refuse les mots-clés contenant # / @ + & _ etc.
(INVALID_ARGUMENT) et la session meurt : C#, CI/CD ou TCP/IP dans un CV
suffisaient. Nettoyage pur avant envoi (formes parlées C sharp / C plus
plus, séparateurs en espaces, limites 100 termes / 100 caractères).
Erreur serveur + fermeture ne produisent plus deux session:error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 2: Registre, sélection par session, route et démarrage de session

**Files:**
- Modify: `packages/shared/src/index.ts`
- Rewrite: `apps/backend/src/stt/index.ts`
- Modify: `apps/backend/src/session.ts` (création du STT dans `startSession`)
- Modify: `apps/backend/src/routes.ts` (import + nouvelle route)
- Modify: `apps/backend/src/__tests__/stt-factory.test.ts`
- Create: `apps/backend/src/__tests__/stt-providers-route.test.ts`
- Create: `apps/backend/src/__tests__/session-stt-provider.test.ts`

**Interfaces:**
- Consumes: `InworldSTT`, `FluxSTT`, `deepgramBatchStt`, `LiveStt*` types (plans précédents).
- Produces (utilisés par la Task 3, côté front, pour les types partagés) :
  ```ts
  // @voxhelp/shared
  SessionConfig.sttProvider?: string
  export interface SttProviderInfo { id: string; label: string; available: boolean }
  export interface SttProvidersResponse { default: string; providers: SttProviderInfo[] }
  // stt/index.ts
  export class SttProviderError extends Error {}
  export function listLiveProviders(): SttProviderInfo[]
  export function defaultLiveProviderId(): string
  export function createLiveStt(options: LiveSttOptions, callbacks: LiveSttCallbacks, providerId?: string): LiveStt
  ```

- [ ] **Step 1: Écrire les tests de la fabrique (doivent échouer)**

Dans `apps/backend/src/__tests__/stt-factory.test.ts` :

1. Remplacer `const { createLiveStt, getBatchStt, assertSttConfig } = await import("../stt/index.js");` par :
   ```ts
   const { createLiveStt, getBatchStt, assertSttConfig, listLiveProviders, defaultLiveProviderId, SttProviderError } =
     await import("../stt/index.js");
   ```
2. Dans le `beforeEach` du haut de fichier, ajouter :
   ```ts
     delete process.env.DEEPGRAM_API_KEY;
     delete process.env.INWORLD_API_KEY;
   ```
3. Dans `describe("createLiveStt", …)`, ajouter avant son accolade fermante :
   ```ts
     it("uses an explicit provider id over STT_LIVE_PROVIDER", () => {
       process.env.STT_LIVE_PROVIDER = "deepgram";

       createLiveStt({ language: "en", keyterms: ["Cléo"] }, callbacks, "inworld");

       expect(inworld.ctorArgs).toEqual(["en", ["Cléo"], callbacks]);
       expect(flux.ctorArgs).toBeNull();
     });

     it("throws a SttProviderError for an unknown explicit provider id", () => {
       expect(() => createLiveStt({ language: "fr" }, callbacks, "whisper")).toThrow(SttProviderError);
       expect(() => createLiveStt({ language: "fr" }, callbacks, "whisper")).toThrow('Modèle STT inconnu : "whisper"');
     });
   ```
4. Ajouter à la fin du fichier :
   ```ts
   describe("listLiveProviders", () => {
     it("lists every live provider with its label and whether its API key is configured", () => {
       process.env.INWORLD_API_KEY = "test-key";

       expect(listLiveProviders()).toEqual([
         { id: "deepgram", label: "Deepgram Flux", available: false },
         { id: "inworld", label: "Inworld", available: true },
       ]);
     });
   });

   describe("defaultLiveProviderId", () => {
     it("is deepgram by default and follows STT_LIVE_PROVIDER", () => {
       expect(defaultLiveProviderId()).toBe("deepgram");

       process.env.STT_LIVE_PROVIDER = "inworld";

       expect(defaultLiveProviderId()).toBe("inworld");
     });
   });
   ```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts`
Expected: FAIL sur les 4 nouveaux tests, chacun pour la bonne raison (`listLiveProviders is not a function`, `defaultLiveProviderId is not a function`, identifiant explicite ignoré, aucune erreur levée pour `"whisper"`). Les 6 tests existants passent toujours.

- [ ] **Step 2: Étendre le contrat partagé**

Dans `packages/shared/src/index.ts`, remplacer :

```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
  candidateName?: string;
}
```

par :

```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
  candidateName?: string;
  /** Identifiant du modèle STT live choisi dans l'interface ; absent = défaut du serveur. */
  sttProvider?: string;
}

export interface SttProviderInfo {
  id: string;
  label: string;
  /** Vrai quand la clé API du fournisseur est configurée côté serveur. */
  available: boolean;
}

export interface SttProvidersResponse {
  /** Identifiant du modèle utilisé quand le client n'en choisit pas. */
  default: string;
  providers: SttProviderInfo[];
}
```

- [ ] **Step 3: Réécrire le registre**

Remplacer **tout** le contenu de `apps/backend/src/stt/index.ts` par :

```ts
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

const BATCH_PROVIDERS: Record<string, BatchStt> = {
  deepgram: deepgramBatchStt,
};

/** Identifiant de modèle STT inconnu, demandé par un client. */
export class SttProviderError extends Error {}

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

export function listLiveProviders(): SttProviderInfo[] {
  return Object.entries(LIVE_PROVIDERS).map(([id, entry]) => ({
    id,
    label: entry.label,
    available: Boolean(process.env[entry.requiredEnv]),
  }));
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
    throw new SttProviderError(`Modèle STT inconnu : "${providerId}"`);
  }
  return LIVE_PROVIDERS[providerId].create(options, callbacks);
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

Run: `cd apps/backend && npx vitest run src/__tests__/stt-factory.test.ts`
Expected: PASS, 10 tests (6 + 4).

- [ ] **Step 4: Écrire le test de route (doit échouer)**

Créer `apps/backend/src/__tests__/stt-providers-route.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./helpers/http-server.js";

vi.mock("../supabase.js", () => ({ supabaseAdmin: null }));

describe("GET /api/stt/providers", () => {
  let server: TestHttpServer;

  beforeEach(async () => {
    delete process.env.STT_LIVE_PROVIDER;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.INWORLD_API_KEY;
    server = await createTestHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("lists the live providers with their availability and the default", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-test";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/providers`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      default: "deepgram",
      providers: [
        { id: "deepgram", label: "Deepgram Flux", available: true },
        { id: "inworld", label: "Inworld", available: false },
      ],
    });
  });

  it("reports the STT_LIVE_PROVIDER value as the default", async () => {
    process.env.STT_LIVE_PROVIDER = "inworld";

    const res = await fetch(`http://127.0.0.1:${server.port}/api/stt/providers`);

    expect((await res.json()).default).toBe("inworld");
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-providers-route.test.ts`
Expected: FAIL, la route répond 404.

- [ ] **Step 5: Ajouter la route**

Dans `apps/backend/src/routes.ts` :

- Remplacer l'import `import { getBatchStt } from "./stt/index.js";` par :
  ```ts
  import { defaultLiveProviderId, getBatchStt, listLiveProviders } from "./stt/index.js";
  ```
- Ajouter, dans `registerRoutes`, juste avant `app.post("/api/extract-cv-keywords", …)` (copier le bloc de contrôle de jeton tel quel, comme les autres routes : ne pas le refactorer ici) :
  ```ts
  app.get("/api/stt/providers", async (request, reply) => {
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

    const body: SttProvidersResponse = { default: defaultLiveProviderId(), providers: listLiveProviders() };
    return reply.send(body);
  });
  ```
- Ajouter l'import de type en tête de fichier, avec les autres imports de `@voxhelp/shared` s'il y en a, sinon comme ligne dédiée :
  ```ts
  import type { SttProvidersResponse } from "@voxhelp/shared";
  ```

Run: `cd apps/backend && npx vitest run src/__tests__/stt-providers-route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Écrire les tests de session (doivent échouer)**

Créer `apps/backend/src/__tests__/session-stt-provider.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({
  lastProviderId: undefined as string | undefined,
  throwWith: null as string | null,
}));

vi.mock("../stt/index.js", () => ({
  createLiveStt: (_options: unknown, callbacks: STTCallbacks, providerId?: string) => {
    if (stt.throwWith) throw new Error(stt.throwWith);
    stt.lastProviderId = providerId;
    return {
      async start() { callbacks.onListening(); },
      sendAudio() {},
      close() {},
    };
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: vi.fn(),
  callClaudeJSON: vi.fn(),
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

interface FirstReply {
  ws: WebSocket;
  reply: ServerMessage;
  received: ServerMessage[];
}

function startSession(port: number, sttProvider?: string): Promise<FirstReply> {
  return new Promise((resolve) => {
    const received: ServerMessage[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr", sttProvider } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      received.push(msg);
      if (msg.type === "session:ready" || msg.type === "session:error") resolve({ ws, reply: msg, received });
    });
  });
}

describe("Session STT provider selection", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    stt.lastProviderId = undefined;
    stt.throwWith = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("passes SessionConfig.sttProvider to createLiveStt", async () => {
    server = await createTestServer();

    const started = await startSession(server.port, "inworld");
    ws = started.ws;

    expect(started.reply.type).toBe("session:ready");
    expect(stt.lastProviderId).toBe("inworld");
  });

  it("passes undefined when the client does not choose a provider", async () => {
    server = await createTestServer();

    const started = await startSession(server.port);
    ws = started.ws;

    expect(started.reply.type).toBe("session:ready");
    expect(stt.lastProviderId).toBeUndefined();
  });

  it("answers session:error and never session:ready when the STT provider is rejected", async () => {
    stt.throwWith = 'Modèle STT inconnu : "whisper"';
    server = await createTestServer();

    const started = await startSession(server.port, "whisper");
    ws = started.ws;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(started.reply).toEqual({ type: "session:error", error: 'Modèle STT inconnu : "whisper"' });
    expect(started.received.some((m) => m.type === "session:ready")).toBe(false);
  });
});
```

Run: `cd apps/backend && npx vitest run src/__tests__/session-stt-provider.test.ts`
Expected: FAIL (`stt.lastProviderId` reste `undefined` pour `"inworld"` ; le 3e test reçoit `session:ready` ou une rejection non gérée).

- [ ] **Step 7: Brancher `session.ts`**

Dans `apps/backend/src/session.ts`, méthode `startSession` :

**(a)** Juste avant la ligne `this.config = config;` (après le bloc de vérification de quota), insérer :

```ts
    // Créé avant de toucher à l'état de la session : un modèle STT inconnu doit
    // échouer proprement, sans session à moitié démarrée.
    let stt: LiveStt;
    try {
      stt = createLiveStt(
        { language: config.language, keyterms: config.keywords },
        {
          onTranscript: (text) => void this.handleFinalTranscript(text),
          onListening: () => console.log("[Session] STT connected"),
          onError: (err) => this.send({ type: "session:error", error: err }),
        },
        config.sttProvider
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : "Modèle STT indisponible";
      console.error(`[Session] STT provider rejected: ${error}`);
      this.send({ type: "session:error", error });
      return;
    }

```

**(b)** Remplacer le bloc :

```ts
    this.stt?.close();
    this.stt = createLiveStt(
      { language: config.language, keyterms: config.keywords },
      {
        onTranscript: (text) => void this.handleFinalTranscript(text),
        onListening: () => console.log("[Session] STT connected"),
        onError: (err) => this.send({ type: "session:error", error: err }),
      }
    );

    void this.stt.start();
```

par :

```ts
    this.stt?.close();
    this.stt = stt;
    void this.stt.start();
```

**(c)** Dans le `console.log` `[Session] Started: …`, ajouter le modèle : remplacer `Started: language=${config.language}, jobContext=` par `Started: language=${config.language}, stt=${config.sttProvider ?? "défaut"}, jobContext=`.

Le type `LiveStt` est déjà importé (`import type { LiveStt } from "./stt/types.js";`).

- [ ] **Step 8: Vérifier toute la suite**

Run: `cd apps/backend && npx vitest run src/__tests__/session-stt-provider.test.ts`
Expected: PASS, 3 tests.

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 25 fichiers / 149 tests (140 + 4 fabrique + 2 route + 3 session). Les 8 tests de session existants et les 2 tests `lecture-*` passent **sans modification** (leurs mocks de `../stt/index.js` ne sont utilisés que pour `createLiveStt` / `getBatchStt`). S'il échoue parce qu'un mock de `../stt/index.js` n'expose pas `listLiveProviders` / `defaultLiveProviderId`, ajouter ces deux clés au mock concerné et le signaler dans le rapport.

Run: `cd packages/lecture && npx tsc --noEmit && cd ../../apps/web && npx tsc --noEmit`
Expected: PASS (le type partagé étendu ne casse pas le front).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/index.ts apps/backend/src/stt/index.ts apps/backend/src/session.ts apps/backend/src/routes.ts apps/backend/src/__tests__/stt-factory.test.ts apps/backend/src/__tests__/stt-providers-route.test.ts apps/backend/src/__tests__/session-stt-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(stt): choose the live STT model per session

Le registre des fournisseurs live devient la source de vérité (id, libellé,
clé requise). SessionConfig.sttProvider l'emporte sur STT_LIVE_PROVIDER ;
un identifiant inconnu échoue en session:error sans session à moitié
démarrée. GET /api/stt/providers expose la liste et la disponibilité.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 3: Menu déroulant du modèle STT dans l'interface

**Files:**
- Create: `apps/web/src/hooks/useSttProviders.ts`
- Create: `apps/web/src/components/SttProviderSelect.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/OverlayPanel.tsx`
- Modify: `CLAUDE.md`, `apps/backend/.env.example`

**Interfaces:**
- Consumes: `SttProviderInfo`, `SttProvidersResponse`, `SessionConfig.sttProvider` de `@voxhelp/shared` (Task 2) ; `Select` de `apps/web/src/components/ui.tsx`.
- Produces :
  ```ts
  // hooks/useSttProviders.ts
  export function pickInitialProvider(data: SttProvidersResponse, saved: string | null): string | null
  export function useSttProviders(token: string): { providers: SttProviderInfo[]; selected: string | null; select: (id: string) => void }
  // components/SttProviderSelect.tsx
  export function SttProviderSelect(props: { providers: SttProviderInfo[]; value: string | null; onChange: (id: string) => void; disabled: boolean }): JSX.Element | null
  ```

Le front n'a **aucun outil de test** : la vérification est le typecheck, le build et un contrôle visuel. Ne pas ajouter vitest ni testing-library.

- [ ] **Step 1: Créer le hook**

Créer `apps/web/src/hooks/useSttProviders.ts` :

```ts
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
```

- [ ] **Step 2: Créer le composant**

Lire d'abord la règle CSS `.input` (chercher dans `apps/web/src`, par ex. `grep -rn "\.input" apps/web/src --include=*.css`) et la façon dont `OverlayPanel.tsx` importe `ui` (`from "./ui"` ou `"./ui.js"`), et **suivre la même convention d'import**.

Créer `apps/web/src/components/SttProviderSelect.tsx` :

```tsx
import type { SttProviderInfo } from "@voxhelp/shared";
import { Select } from "./ui";

interface SttProviderSelectProps {
  providers: SttProviderInfo[];
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
}

export function SttProviderSelect({ providers, value, onChange, disabled }: SttProviderSelectProps) {
  if (providers.length === 0) return null;

  return (
    <Select
      aria-label="Modèle de transcription"
      title={disabled ? "Arrêtez la session pour changer de modèle" : "Modèle de transcription"}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "auto", minWidth: 150, height: 32, fontSize: 12.5 }}
    >
      {providers.map((p) => (
        <option key={p.id} value={p.id} disabled={!p.available}>
          {p.available ? p.label : `${p.label} (non configuré)`}
        </option>
      ))}
    </Select>
  );
}
```

Si la règle `.input` impose une largeur ou une hauteur qui déborde dans la barre du haut, ajuster **uniquement** le `style` en ligne ci-dessus (pas de CSS global).

- [ ] **Step 3: Brancher `HeaderBar` et `OverlayPanel`**

Dans `apps/web/src/components/OverlayPanel.tsx` :

- Ajouter l'import (même convention que les autres imports de composants du fichier) :
  ```tsx
  import { SttProviderSelect } from "./SttProviderSelect";
  ```
  et, dans les imports de types de `@voxhelp/shared` du fichier, ajouter `SttProviderInfo` (ou une ligne dédiée `import type { SttProviderInfo } from "@voxhelp/shared";`).
- Dans `interface HeaderBarProps`, ajouter :
  ```ts
  sttProviders: SttProviderInfo[];
  sttProvider: string | null;
  onSttProviderChange: (id: string) => void;
  ```
- Dans la déstructuration des paramètres de `HeaderBar`, ajouter `sttProviders, sttProvider, onSttProviderChange,`.
- Dans le JSX de `HeaderBar`, juste après `<span style={{ flex: 1 }} />` et **avant** `{isLive && (`, ajouter :
  ```tsx
        <SttProviderSelect
          providers={sttProviders}
          value={sttProvider}
          onChange={onSttProviderChange}
          disabled={isLive}
        />
  ```
- Dans `interface OverlayPanelProps` (juste avant `onStartAudio: …`), ajouter :
  ```ts
  sttProviders: SttProviderInfo[];
  sttProvider: string | null;
  onSttProviderChange: (id: string) => void;
  ```
- Dans la déstructuration de `OverlayPanel({ … })`, ajouter `sttProviders, sttProvider, onSttProviderChange,`.
- Dans le JSX `<HeaderBar … />` de `OverlayPanel`, ajouter :
  ```tsx
        sttProviders={sttProviders}
        sttProvider={sttProvider}
        onSttProviderChange={onSttProviderChange}
  ```

- [ ] **Step 4: Brancher `App.tsx`**

Dans `apps/web/src/App.tsx` :

- Ajouter l'import : `import { useSttProviders } from "./hooks/useSttProviders";`
- Dans `SessionApp`, après `const audio = useAudioCapture(ws.sendAudio);`, ajouter :
  ```tsx
  const stt = useSttProviders(token);
  ```
- Remplacer l'appel `ws.startSession({ language: "fr", jobContext, keywords, candidateName });` par :
  ```tsx
  ws.startSession({ language: "fr", jobContext, keywords, candidateName, sttProvider: stt.selected ?? undefined });
  ```
- Dans le JSX `<OverlayPanel … />`, ajouter :
  ```tsx
      sttProviders={stt.providers}
      sttProvider={stt.selected}
      onSttProviderChange={stt.select}
  ```

- [ ] **Step 5: Documentation**

`CLAUDE.md` (racine) :
- Dans « Variables d'environnement », remplacer la ligne `- \`STT_LIVE_PROVIDER\` — …` (celle qui décrit `deepgram` (défaut) ou `inworld`, avec la mention expérimentale) par :
  `- \`STT_LIVE_PROVIDER\` — modèle STT live **par défaut** : \`deepgram\` (défaut) ou \`inworld\` (expérimental : non validé contre l'API réelle sur un entretien, \`zh\` non supporté). L'utilisateur peut en choisir un autre par session via le menu en haut à droite.`
- Dans « Fichiers importants », après la ligne `apps/backend/src/stt/`, ajouter :
  `- \`apps/web/src/hooks/useSttProviders.ts\` + \`components/SttProviderSelect.tsx\` — Menu de choix du modèle STT (liste lue sur \`GET /api/stt/providers\`)`

`apps/backend/.env.example` : remplacer la ligne exacte `# STT_LIVE_PROVIDER=deepgram   # deepgram | inworld` par :
`# STT_LIVE_PROVIDER=deepgram   # modèle par défaut (deepgram | inworld) ; l'interface permet d'en choisir un par session`
(les autres lignes du fichier, dont le bloc Inworld et sa mention « EXPERIMENTAL », restent inchangées).

- [ ] **Step 6: Vérifier**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS, aucune erreur.

Run: `pnpm --filter @voxhelp/web build`
Expected: PASS (`tsc -b && vite build` réussit).

Run: `cd apps/backend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 25 fichiers / 149 tests (inchangé : cette tâche ne touche pas au backend).

Run: `grep -n "sttProvider" apps/web/src/App.tsx apps/web/src/components/OverlayPanel.tsx`
Expected: `App.tsx` passe `sttProvider` à `startSession` et à `OverlayPanel` ; `OverlayPanel.tsx` le déclare en props et le transmet à `HeaderBar`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useSttProviders.ts apps/web/src/components/SttProviderSelect.tsx apps/web/src/App.tsx apps/web/src/components/OverlayPanel.tsx CLAUDE.md apps/backend/.env.example
git commit -m "$(cat <<'EOF'
feat(web): STT model dropdown in the header

Menu en haut à droite alimenté par GET /api/stt/providers : modèles non
configurés grisés, verrouillé pendant une session live, dernier choix
mémorisé. Le choix part dans session:start (sttProvider).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019HWc71JU4nhWShUzCFvDux
EOF
)"
```

---

### Task 4: Vérification réelle (contrôleur, avec la clé Inworld de l'utilisateur)

**Ne pas déléguer à un sous-agent** : cette tâche appelle l'API réelle avec la clé de `apps/backend/.env`. Le contrôleur ne lit ni n'affiche le contenu de `.env`.

**Files:** aucun changement de code attendu ; corrections éventuelles via un correctif dispatché comme pour les autres tâches.

- [ ] **Step 1: Liste piégée après correction**

Extrait déjà prêt : `<scratchpad>/video0-200-262s.wav` (62 s). Avant correction, la même commande a donné : `ERROR: invalid transcribe config: invalid prompts: prompt[0] contains disallowed character "#"`, puis `connection closed unexpectedly (code 1000)` (double erreur) et `0 tour(s)`.

Run : `cd apps/backend && STT_LIVE_PROVIDER=inworld STT_COMPARE_KEYTERMS='C#,CI/CD,TCP/IP,@angular/core,l’agilité,Genèse' npx tsx scripts/stt-compare.ts <scratchpad>/video0-200-262s.wav fr`
Expected : ligne `[InworldSTT] Connecting: … prompts=[C sharp, CI CD, TCP IP, angular core, l'agilité, Genèse] (5 adapté(s), 0 écarté(s))` (5 termes modifiés : `C#`, `CI/CD`, `TCP/IP`, `@angular/core` et l'apostrophe courbe de `l’agilité` ; `Genèse` est intact), `listening`, **aucun** `ERROR`, des lignes `TURN …`.

- [ ] **Step 2: Effet du boosting conservé**

Run : même commande avec `STT_COMPARE_KEYTERMS='MECC,Genèse'`.
Expected : pas d'erreur, tours produits, « MECC » plutôt que « MECCE » dans le texte (le décodage varie : un écart isolé n'est pas un échec).

- [ ] **Step 3: Contrôle visuel du menu**

Backend et front lancés (`pnpm dev`), page ouverte dans un navigateur connecté : le menu « Modèle de transcription » apparaît en haut à droite avec « Deepgram Flux » et « Inworld » ; un modèle sans clé serveur est grisé « (non configuré) » ; le choix survit à un rechargement ; il est verrouillé pendant une session live ; démarrer une session avec Inworld journalise `[Session] Started: language=fr, stt=inworld` côté backend. La connexion (Supabase) est nécessaire : si le navigateur du contrôleur n'est pas connecté, demander à l'utilisateur de faire ce contrôle.

- [ ] **Step 4: Suite complète**

Run : backend `npx tsc --noEmit && npx vitest run` (25 fichiers / 149 tests), lecture (14 / 74), web `npx tsc --noEmit`.
Expected : tout vert.
