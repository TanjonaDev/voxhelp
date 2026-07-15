# Fusion des cards redondantes sur un même tour de parole — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire la sur-génération de cards redondantes sur un même monologue candidat (point 1 de `bilan-retours-voxhelp-tests.md`) en espaçant le debounce de pause et en laissant le LLM fusionner une nouvelle analyse avec la dernière card émise quand elle prolonge le même sous-thème.

**Architecture:** `DEBOUNCE_MS` passe de 1500ms à 2500ms. Avant chaque appel LLM, `Session` calcule un `mergeCandidate` (dernière card émise si elle date de moins de 90s) et le transmet au prompt live-assist. Si le LLM répond avec un marqueur `[merge]`, le backend redirige le streaming vers l'id de la card cible (au lieu d'un nouvel id) et remplace l'entrée correspondante dans `cardLog`. Aucun nouveau type de message WebSocket : le frontend gagne juste la capacité de remplacer une insight existante par id dans le handler `assist:done`.

**Tech Stack:** TypeScript strict, Fastify + `@fastify/websocket`, Vitest (backend uniquement — pas de suite de tests JS côté `apps/web`), Vite/React côté frontend.

## Global Constraints

- TypeScript strict, pas de `any` (CLAUDE.md).
- ESM partout, imports avec extensions `.js` dans le backend (CLAUDE.md).
- `MERGE_WINDOW_MS` et `DEBOUNCE_MS` restent des constantes en dur (pas de variable d'environnement), cohérent avec `MAX_BUFFER_MS` / `MAX_LOG_ENTRIES` existants (spec, section "Hors scope").
- Aucun nouveau type `ServerMessage` / `ClientMessage` dans `packages/shared` — la fusion réutilise `assist:start` / `assist:chunk` / `assist:cancel` / `assist:done` (spec).
- Référence : `docs/superpowers/specs/2026-07-16-card-merge-dedup-design.md`.

---

### Task 1: Section de fusion dans le prompt live-assist

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`
- Test: `apps/backend/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: `Insight` type from `@voxhelp/shared` (déjà importé dans le fichier).
- Produces: `buildLiveAssistPrompt(jobContext?: JobContext, history?: string[], previousRelances?: string[], previousCards?: Insight[], mergeCandidate?: Insight): string` — nouveau 5ème paramètre optionnel, consommé par la Task 3 (`session.ts`).

- [ ] **Step 1: Write the failing tests**

Dans `apps/backend/src/__tests__/prompts.test.ts`, ajouter ces deux tests à l'intérieur du bloc `describe("buildLiveAssistPrompt", ...)`, juste après le test `"omits cards section when previousCards is undefined"` (ligne 59) :

```ts
  it("includes a merge instruction when a mergeCandidate is provided", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], confirmedCard);
    expect(prompt).toContain("[merge]");
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("NE CRÉE PAS de nouvelle card");
  });

  it("omits the merge instruction when mergeCandidate is undefined", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], []);
    expect(prompt).not.toContain("[merge]");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — les deux nouveaux tests échouent (`buildLiveAssistPrompt` n'accepte pas encore de 5ème argument et ne génère aucune section `[merge]`).

- [ ] **Step 3: Implement the merge section**

Dans `apps/backend/src/prompts/live-assist.ts`, ajouter une nouvelle fonction juste après `buildPreviousCards` (après la ligne 23) :

```ts
function buildMergeCandidateSection(card?: Insight): string {
  if (!card) return "";
  return `\nDernière card émise à l'instant — [${card.cat}] ${card.title} : ${card.body}
Si ce qui vient d'être dit ne fait que continuer/préciser le MÊME sous-thème que cette card
(pas juste un thème proche), NE CRÉE PAS de nouvelle card. Réponds avec :
[merge]
[catégorie] [evidence]
# Titre (peut être mis à jour)
Corps fusionné qui remplace entièrement le précédent
>> Relance (optionnelle)
`;
}
```

Puis remplacer la signature et le corps de `buildLiveAssistPrompt` (lignes 25-68) par :

```ts
export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[],
  mergeCandidate?: Insight
): string {
  const jobCtx = buildJobContext(jobContext);
  const convHistory = buildConversationHistory(history ?? []);
  const prevCards = buildPreviousCards(previousCards ?? []);
  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions déjà posées (ne pas répéter) :\n${previousRelances.map((q) => `- ${q}`).join("\n")}\n`
      : "";
  const mergeSection = buildMergeCandidateSection(mergeCandidate);

  return `Tu es VoxHelp, un copilote bienveillant qui aide un recruteur non-technique pendant un entretien développeur.${jobCtx}${convHistory}${prevCards}${relancesSection}${mergeSection}
Rôle : traduire le jargon, repérer les points forts, aider à poser les bonnes questions.

PRIORITÉ ABSOLUE — DÉTECTION RECRUTEUR :
Si le texte transcrit est une question ou une invitation à parler typique d'un recruteur (ex : "Parlez-moi de...", "Comment gérez-vous...", "Pouvez-vous décrire...", "Tell me about...", "What is your experience with..."), réponds UNIQUEMENT avec :
[skip]
Ne génère rien d'autre. Un recruteur pose des questions courtes et n'explique pas de techno.
Un candidat répond : il raconte, explique, donne des exemples, cite des technos ou des chiffres.

Transcription possiblement incomplète. Ne le mentionne jamais. Analyse ce qui EST dit.
Réponds dans la même langue que le candidat.

Format de réponse OBLIGATOIRE — commence DIRECTEMENT par le marqueur, rien avant :
[catégorie] [evidence]
# Titre court
Explication simple 1-2 phrases
>> Question de relance (optionnelle)

Catégories :
- jargon : terme technique → explique simplement au recruteur
- strength : expérience concrète ou résultat mesurable → valorise
- attention : contradiction ou point critique à creuser
- translation : contexte, rôle ou parcours → reformule en clair

Evidence : high (exemple concret fourni) | medium (mention sans détail) | low (vague)

Relance : naturelle et bienveillante, jamais accusatrice.
DIVERSIFICATION OBLIGATOIRE : si les 2 derniers sujets analysés portent sur le même thème ou la même techno, ta relance DOIT aborder un autre aspect (autre compétence, projet marquant, méthode de travail, challenge résolu, préférence technologique).
Pas de relance si cat = translation ou si le sujet est épuisé.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS — tous les tests du fichier passent, y compris les deux nouveaux.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts apps/backend/src/__tests__/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(live-assist): add merge-candidate section to the prompt

Lets the LLM fold a new analysis into the last emitted card when it
continues the same sub-topic, instead of always producing a new one.
EOF
)"
```

---

### Task 2: État de session pour la fenêtre de fusion + debounce allongé

**Files:**
- Modify: `apps/backend/src/session.ts`
- Modify: `apps/backend/src/__tests__/helpers/server.ts`
- Modify: `apps/backend/src/__tests__/session-max-buffer.test.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: constructeur `Session(ws, userId?, maxBufferMs?, mergeWindowMs?)` ; champs privés `mergeWindowMs: number`, `lastCardEmittedAtMs: number` ; `DEBOUNCE_MS = 2500`. Helper `createTestServer(userId?, maxBufferMs?, mergeWindowMs?)`. Consommés par la Task 3.

- [ ] **Step 1: Update the debounce constant**

Dans `apps/backend/src/session.ts` ligne 36, remplacer :

```ts
  private readonly DEBOUNCE_MS = 1500;
```

par :

```ts
  private readonly DEBOUNCE_MS = 2500;
```

- [ ] **Step 2: Fix the regression guard in the existing max-buffer test**

Dans `apps/backend/src/__tests__/session-max-buffer.test.ts`, le test `"does not double-flush once the stale debounce timer's original deadline passes"` (lignes 99-121) attend une durée qui doit dépasser le débounce réel pour prouver que le timer périmé a bien été annulé. Remplacer les lignes 111-118 :

```ts
    // Confirms this particular flush was driven by maxBufferMs (100ms), not
    // the 1500ms debounce — otherwise the check below would be meaningless.
    expect(elapsed).toBeLessThan(500);

    // Wait past the original (1500ms) debounce deadline that was pending
    // when the buffer was flushed early. If flushBuffer() didn't clear it,
    // it would fire again here with an empty buffer.
    await wait(1700);
```

par :

```ts
    // Confirms this particular flush was driven by maxBufferMs (100ms), not
    // the 2500ms debounce — otherwise the check below would be meaningless.
    expect(elapsed).toBeLessThan(500);

    // Wait past the original (2500ms) debounce deadline that was pending
    // when the buffer was flushed early. If flushBuffer() didn't clear it,
    // it would fire again here with an empty buffer.
    await wait(2700);
```

Aussi mettre à jour le commentaire ligne 88-89 (référence documentaire, pas une assertion) :

```ts
    // With only the 1500ms debounce (pre-implementation), this flush wouldn't
    // happen until ~1500ms after the last piece (~1620ms total). The 150ms
```

devient :

```ts
    // With only the 2500ms debounce (pre-implementation), this flush wouldn't
    // happen until ~2500ms after the last piece (~2620ms total). The 150ms
```

- [ ] **Step 3: Run the max-buffer test to verify it still passes**

Run: `cd apps/backend && npx vitest run src/__tests__/session-max-buffer.test.ts`
Expected: PASS (2 tests) — la deuxième vérification prend maintenant ~2.7s au lieu de ~1.7s, c'est attendu.

- [ ] **Step 4: Add mergeWindowMs and lastCardEmittedAtMs to Session**

Dans `apps/backend/src/session.ts`, remplacer les champs et le constructeur (lignes 31-43) :

```ts
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBufferMs: number;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 2500;

  constructor(ws: WebSocket, userId: string | null = null, maxBufferMs: number = 3 * 60 * 1000) {
    this.ws = ws;
    this.userId = userId;
    this.maxBufferMs = maxBufferMs;
    this.setupHandlers();
  }
```

par :

```ts
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBufferMs: number;
  private readonly mergeWindowMs: number;
  private lastCardEmittedAtMs = 0;
  private isProcessing = false;
  private pendingTranscript: string | null = null;
  private readonly DEBOUNCE_MS = 2500;

  constructor(
    ws: WebSocket,
    userId: string | null = null,
    maxBufferMs: number = 3 * 60 * 1000,
    mergeWindowMs: number = 90 * 1000
  ) {
    this.ws = ws;
    this.userId = userId;
    this.maxBufferMs = maxBufferMs;
    this.mergeWindowMs = mergeWindowMs;
    this.setupHandlers();
  }
```

- [ ] **Step 5: Reset lastCardEmittedAtMs on session start and cleanup**

Dans `startSession` (ligne 116-119), remplacer :

```ts
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
```

par :

```ts
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.lastCardEmittedAtMs = 0;
```

Dans `cleanup()` (lignes 401-405), remplacer :

```ts
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.sessionStartMs = 0;
```

par :

```ts
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.lastCardEmittedAtMs = 0;
    this.sessionStartMs = 0;
```

- [ ] **Step 6: Thread mergeWindowMs through the test server helper**

Dans `apps/backend/src/__tests__/helpers/server.ts`, remplacer tout le fichier par :

```ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { Session } from "../../session.js";

export interface TestServer {
  port: number;
  close: () => Promise<void>;
}

export async function createTestServer(
  userId: string | null = null,
  maxBufferMs: number = 3 * 60 * 1000,
  mergeWindowMs: number = 90 * 1000
): Promise<TestServer> {
  const app = Fastify({ logger: false });

  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    new Session(socket, userId, maxBufferMs, mergeWindowMs);
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };

  return {
    port: address.port,
    close: () => app.close(),
  };
}
```

- [ ] **Step 7: Run the full backend test suite to verify no regressions**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — tous les fichiers de test existants passent (`prompts.test.ts`, `session.test.ts`, `session-max-buffer.test.ts`, `session-usage-limit.test.ts`). `mergeWindowMs` et `lastCardEmittedAtMs` ne sont pas encore utilisés en dehors du constructeur/reset, donc aucun changement de comportement observable à ce stade.

- [ ] **Step 8: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/helpers/server.ts apps/backend/src/__tests__/session-max-buffer.test.ts
git commit -m "$(cat <<'EOF'
feat(session): widen pause debounce and add merge-window state

DEBOUNCE_MS moves from 1500ms to 2500ms to reduce how often natural
speech micro-pauses trigger a flush. Adds mergeWindowMs and
lastCardEmittedAtMs, wired through the constructor and test helper,
in preparation for card-merge logic in processTranscript.
EOF
)"
```

---

### Task 3: Détection et application du marqueur `[merge]` dans processTranscript

**Files:**
- Modify: `apps/backend/src/session.ts`
- Create: `apps/backend/src/__tests__/session-merge.test.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt(..., mergeCandidate?: Insight)` (Task 1) ; `this.mergeWindowMs`, `this.lastCardEmittedAtMs` (Task 2) ; `createTestServer(userId?, maxBufferMs?, mergeWindowMs?)` (Task 2).
- Produces: comportement de fusion observable par le frontend — `assist:cancel` sur l'id spéculatif suivi d'un `assist:start`/`assist:done` réutilisant l'id de la card cible ; `cardLog` mis à jour en place (remplacement) plutôt qu'un `push`.

- [ ] **Step 1: Write the failing integration tests**

Créer `apps/backend/src/__tests__/session-merge.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";
import { createTestServer, type TestServer } from "./helpers/server.js";
import { waitForMessage } from "./helpers/ws.js";

interface STTCallbacks {
  onTranscript: (text: string) => void;
  onListening: () => void;
  onError: (error: string) => void;
}

const stt = vi.hoisted(() => ({ callbacks: null as STTCallbacks | null }));
const mockLlm = vi.hoisted(() => ({
  streamAssist: vi.fn(),
}));

vi.mock("../deepgram-flux.js", () => ({
  FluxSTT: class MockFluxSTT {
    constructor(_lang: string, callbacks: STTCallbacks) {
      stt.callbacks = callbacks;
    }
    async start() { stt.callbacks?.onListening(); }
    sendAudio() {}
    close() {}
  },
}));

vi.mock("../llm.js", () => ({
  streamAssist: mockLlm.streamAssist,
  callClaudeJSON: vi.fn(),
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

function connectAndStart(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "session:start", config: { language: "fr" } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const firstCardText = [
  "[strength] [high]",
  "# Stack technique maîtrisée",
  "Le candidat maîtrise la stack backend Node.js.",
].join("\n");

const mergeCardText = [
  "[merge]",
  "[strength] [high]",
  "# Stack technique et portefeuille de projets",
  "Le candidat maîtrise la stack backend Node.js et a un portefeuille de projets data concrets.",
].join("\n");

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session card merge", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("merges into the previous card's id when the LLM responds with [merge] inside the merge window", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(firstCardText);
    stt.callbacks!.onTranscript("Premier segment du monologue.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    const firstDone = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    mockStreamAssistOnce(mergeCardText);
    stt.callbacks!.onTranscript("Deuxième segment, même sous-thème.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));

    const cancelMsg = (await waitForMessage(ws, "assist:cancel")) as Extract<ServerMessage, { type: "assist:cancel" }>;
    const secondDone = (await waitForMessage(ws, "assist:done")) as Extract<ServerMessage, { type: "assist:done" }>;

    expect(cancelMsg.id).not.toBe(firstDone.id);
    expect(secondDone.id).toBe(firstDone.id);
    expect(secondDone.fullText).not.toContain("[merge]");
    expect(secondDone.fullText).toContain("portefeuille de projets data concrets");
  });

  it("does not offer a merge candidate once the merge window has elapsed", async () => {
    server = await createTestServer(null, 3 * 60 * 1000, 100);
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(firstCardText);
    stt.callbacks!.onTranscript("Premier segment du monologue.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    await wait(150);

    mockStreamAssistOnce(firstCardText);
    stt.callbacks!.onTranscript("Deuxième segment, sujet différent.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const secondPrompt = mockLlm.streamAssist.mock.calls[1][0] as string;
    expect(secondPrompt).not.toContain("Dernière card émise");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/__tests__/session-merge.test.ts`
Expected: FAIL — `processTranscript` ne détecte pas encore `[merge]` ; le deuxième `assist:done` arrive avec un nouvel id différent de `firstDone.id`, et son `fullText` contient encore le préfixe `[merge]`.

- [ ] **Step 3: Implement merge detection in processTranscript**

Dans `apps/backend/src/session.ts`, remplacer toute la méthode `processTranscript` (lignes 219-285) par :

```ts
  private async processTranscript(transcript: string): Promise<void> {
    this.isProcessing = true;
    this.send({ type: "transcript:buffering" });

    this.conversationLog.push(transcript);
    if (this.conversationLog.length > this.MAX_LOG_ENTRIES) this.conversationLog.shift();

    const speculativeId = createId();
    const cardT = this.elapsedTime();
    this.send({ type: "assist:start", id: speculativeId, t: cardT });

    const mergeCandidate =
      this.cardLog.length > 0 && Date.now() - this.lastCardEmittedAtMs <= this.mergeWindowMs
        ? this.cardLog[this.cardLog.length - 1]
        : undefined;

    let accumulated = "";
    let cancelled = false;
    let activeId = speculativeId;
    let isMerge = false;

    try {
      const fullText = await streamAssist(
        buildLiveAssistPrompt(this.jobContext, this.conversationLog, this.relanceLog, this.cardLog, mergeCandidate),
        `Ce qui vient d'être dit :\n"${transcript}"`,
        (chunk) => {
          if (cancelled) return;
          accumulated += chunk;
          const trimmed = accumulated.trimStart();

          if (trimmed.startsWith("[skip]")) {
            cancelled = true;
            this.send({ type: "assist:cancel", id: activeId });
            return;
          }

          if (!isMerge && mergeCandidate && trimmed.startsWith("[merge]")) {
            isMerge = true;
            this.send({ type: "assist:cancel", id: activeId });
            activeId = mergeCandidate.id;
            this.send({ type: "assist:start", id: activeId, t: mergeCandidate.t });
            return;
          }

          this.send({ type: "assist:chunk", id: activeId, text: chunk });
        }
      );

      if (cancelled) {
        this.isProcessing = false;
        this.send({ type: "transcript:idle" });
        if (this.pendingTranscript) {
          const pending = this.pendingTranscript;
          this.pendingTranscript = null;
          this.processTranscript(pending);
        }
        return;
      }

      const cardText = isMerge ? fullText.trim().replace(/^\[merge\]\s*/, "") : fullText;
      this.send({ type: "assist:done", id: activeId, fullText: cardText });

      const card = this.parseAssistText(cardText, activeId, isMerge ? mergeCandidate!.t : cardT);
      if (card.relance) {
        this.relanceLog.push(card.relance);
        if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
      }

      if (isMerge) {
        const idx = this.cardLog.findIndex((c) => c.id === mergeCandidate!.id);
        if (idx !== -1) this.cardLog[idx] = card;
        else this.cardLog.push(card);
      } else {
        this.cardLog.push(card);
        if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();
      }
      this.lastCardEmittedAtMs = Date.now();

    } catch (err) {
      this.send({
        type: "assist:error",
        error: err instanceof Error ? err.message : "Analysis error",
      });
    }

    this.isProcessing = false;
    this.send({ type: "transcript:idle" });

    if (this.pendingTranscript) {
      const pending = this.pendingTranscript;
      this.pendingTranscript = null;
      this.processTranscript(pending);
    }
  }
```

Note d'implémentation : le préfixe `[merge]` est retiré une seule fois ici (`cardText`), avant l'envoi WebSocket ET avant `parseAssistText` — le frontend fait son propre parsing indépendant de `fullText` (voir `apps/web/src/lib/parseAssistCard.ts`) et ne doit jamais recevoir le marqueur brut, sous peine de mal interpréter la première ligne comme titre.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/__tests__/session-merge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — tous les fichiers de test passent, y compris `session.test.ts` (le chemin non-merge, `mergeCandidate` undefined dès la première card de chaque test puisque `cardLog` y est vide au premier appel, reste inchangé) et `session-max-buffer.test.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/session-merge.test.ts
git commit -m "$(cat <<'EOF'
feat(session): merge redundant cards via [merge] marker

When the LLM judges a new segment continues the same sub-topic as the
last emitted card (within a 90s window), the backend redirects the
stream to the existing card's id and replaces it in cardLog instead of
appending a new, duplicate card.
EOF
)"
```

---

### Task 4: Remplacement d'insight par id côté frontend

**Files:**
- Modify: `apps/web/src/hooks/useWebSocket.ts`

**Interfaces:**
- Consumes: `assist:done` avec un `id` pouvant désormais correspondre à une insight déjà présente dans `insights` (Task 3).
- Produces: `insights` sans doublon d'id après une fusion — comportement observable dans l'app, pas de nouvelle fonction exportée.

- [ ] **Step 1: Update the assist:done handler**

Dans `apps/web/src/hooks/useWebSocket.ts`, remplacer le bloc `case "assist:done"` (lignes 81-95) :

```ts
      case "assist:done": {
        const parsed = parseAssistCard(msg.fullText);
        setStreamingCard(null);
        setIsAnalyzing(false);
        setInsights((prev) => [
          ...prev,
          {
            id: msg.id,
            t: streamingTRef.current,
            ...parsed,
            relance: parsed.relance ?? undefined,
          },
        ]);
        break;
      }
```

par :

```ts
      case "assist:done": {
        const parsed = parseAssistCard(msg.fullText);
        setStreamingCard(null);
        setIsAnalyzing(false);
        const updated = {
          id: msg.id,
          t: streamingTRef.current,
          ...parsed,
          relance: parsed.relance ?? undefined,
        };
        setInsights((prev) => {
          const idx = prev.findIndex((c) => c.id === msg.id);
          if (idx === -1) return [...prev, updated];
          const next = [...prev];
          next[idx] = { ...next[idx], ...updated, t: next[idx].t };
          return next;
        });
        break;
      }
```

Le `t: next[idx].t` en fin de fusion garde le timestamp d'apparition d'origine de la card — même si le backend envoie déjà `mergeCandidate.t` via le nouveau `assist:start`, cette ligne rend le comportement explicite et robuste indépendamment de l'ordre des événements.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Manual verification**

Il n'existe pas de suite de tests JS/component dans `apps/web`. Lancer l'app (`pnpm dev`) et vérifier manuellement le flux Live avec un monologue continu comportant plusieurs micro-pauses sur le même sujet : au lieu de voir plusieurs cards quasi identiques s'empiler, la card existante doit se mettre à jour en place. Documenter dans le message de commit que la vérification est manuelle (pas de test automatisé frontend pour ce changement, cohérent avec la section "Tests" du spec).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useWebSocket.ts
git commit -m "$(cat <<'EOF'
fix(web): replace an existing insight in place when assist:done reuses its id

Supports the backend's new card-merge behavior: a merged analysis
reuses the target card's id instead of a fresh one, so the frontend
must update it in place rather than always appending. No automated
frontend test exists for this hook; verified manually via pnpm dev.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** déclenchement (Task 2) ; logique de fusion prompt+backend (Tasks 1 et 3) ; contrat WebSocket/frontend (Task 4) ; edge cases `[skip]` prioritaire et catch d'erreur (couverts nativement par la structure de Task 3, aucun code additionnel requis) ; tests (chaque tâche inclut les siens, y compris la correction de la regression guard existante).
- **Placeholder scan:** aucun "TBD"/"TODO" ; toutes les étapes de code contiennent le code complet à écrire.
- **Type consistency:** `mergeWindowMs` / `lastCardEmittedAtMs` / `DEBOUNCE_MS` nommés de façon cohérente entre Task 2 (déclaration) et Task 3 (usage) ; `createTestServer(userId?, maxBufferMs?, mergeWindowMs?)` a la même signature dans Task 2 (définition) et Task 3 (usage dans les tests) ; `buildLiveAssistPrompt(..., mergeCandidate?)` cohérent entre Task 1 (définition) et Task 3 (appel dans `processTranscript`).
- **Scope:** une seule sous-fonctionnalité cohérente (fusion de cards), livrable et testable de bout en bout après la Task 4.
