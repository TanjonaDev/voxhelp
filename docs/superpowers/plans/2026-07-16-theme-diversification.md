# Diversification forcée après 3 cards sur le même thème — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forcer la relance suggérée à changer de macro-sujet une fois que 3 cards consécutives ont porté sur le même thème, sans jamais supprimer ni fusionner de card (contrairement à la tentative précédente, annulée).

**Architecture:** Le LLM tague chaque card (hors `[skip]`) avec un 3ème bracket `[theme-slug]` sur la ligne d'en-tête existante. `Session` extrait ce tag après chaque card émise, compte les occurrences consécutives du même slug, et transmet `lastTheme`/`themeStreakCount` à `buildLiveAssistPrompt`, qui injecte une instruction de pivot forcé une fois le seuil (3) atteint. Aucun changement de `packages/shared`, aucun changement frontend, aucun nouveau message WebSocket.

**Tech Stack:** TypeScript strict, Vitest.

## Global Constraints

- TypeScript strict, pas de `any` (CLAUDE.md).
- ESM partout, imports avec extensions `.js` dans le backend (CLAUDE.md).
- Aucun changement de `packages/shared`, d'`apps/web`, ni de `parseAssistText`/`parseAssistCard` — leur regex d'extraction `[cat] [evidence]` n'est pas ancrée et tolère déjà un 3ème bracket à la suite sans modification.
- `THEME_STREAK_THRESHOLD = 3`, constante en dur dans `apps/backend/src/prompts/live-assist.ts` (seul endroit qui compare le compteur au seuil — voir note d'implémentation dans la Task 2 ci-dessous, qui simplifie légèrement le spec en évitant un champ dupliqué et inutilisé dans `Session`).
- Référence : `docs/superpowers/specs/2026-07-16-theme-diversification-design.md`.

---

### Task 1: Section de diversification par thème dans le prompt live-assist

**Files:**
- Modify: `apps/backend/src/prompts/live-assist.ts`
- Test: `apps/backend/src/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: `Insight` type from `@voxhelp/shared` (déjà importé).
- Produces: `buildLiveAssistPrompt(jobContext?: JobContext, history?: string[], previousRelances?: string[], previousCards?: Insight[], lastTheme?: string | null, themeStreakCount?: number): string` — deux nouveaux paramètres optionnels, consommés par la Task 2 (`session.ts`).

- [ ] **Step 1: Write the failing tests**

Dans `apps/backend/src/__tests__/prompts.test.ts`, ajouter ces quatre tests à l'intérieur du bloc `describe("buildLiveAssistPrompt", ...)`, juste après le test `"omits cards section when previousCards is undefined"` (ligne 59) :

```ts
  it("includes the theme-continuity instruction when lastTheme is provided", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", 1);
    expect(prompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(prompt).toContain("réutilise EXACTEMENT ce slug");
  });

  it("does not include the forced-pivot warning below the streak threshold", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", 2);
    expect(prompt).not.toContain("DOIT changer complètement de sujet");
  });

  it("includes the forced-pivot warning once the streak threshold is reached", () => {
    const prompt = buildLiveAssistPrompt(undefined, [], [], [], "aws-serverless", 3);
    expect(prompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(prompt).toContain("DOIT changer complètement de sujet");
  });

  it("omits the theme section entirely when lastTheme is null or undefined", () => {
    const promptNull = buildLiveAssistPrompt(undefined, [], [], [], null, 5);
    expect(promptNull).not.toContain("Thème de la dernière card");
    const promptUndefined = buildLiveAssistPrompt(undefined, [], [], []);
    expect(promptUndefined).not.toContain("Thème de la dernière card");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — les quatre nouveaux tests échouent (`buildLiveAssistPrompt` n'accepte pas encore les 5ème/6ème arguments et ne génère aucune section de thème).

- [ ] **Step 3: Implement the theme-streak section**

Dans `apps/backend/src/prompts/live-assist.ts`, remplacer tout le fichier par :

```ts
import type { JobContext, Insight } from "@voxhelp/shared";

const THEME_STREAK_THRESHOLD = 3;

function buildJobContext(ctx?: JobContext): string {
  if (!ctx) return "";
  const parts = [
    ctx.title,
    ctx.level ? `niveau ${ctx.level}` : "",
    ctx.stack ? `stack : ${ctx.stack}` : "",
  ].filter(Boolean);
  return `\nPoste : ${parts.join(" — ")}\n`;
}

function buildConversationHistory(transcripts: string[]): string {
  const recent = transcripts.slice(-10);
  if (recent.length === 0) return "";
  return `\nConversation récente :\n${recent.map((t) => `- ${t}`).join("\n")}\n`;
}

function buildPreviousCards(cards: Insight[]): string {
  const recent = cards.slice(-5);
  if (recent.length === 0) return "";
  return `\nSujets déjà analysés (diversifie les thèmes) :\n${recent.map((c) => `- [${c.cat}] ${c.title}`).join("\n")}\n`;
}

function buildThemeStreakSection(lastTheme?: string | null, streakCount = 0): string {
  if (!lastTheme) return "";
  let section = `\nThème de la dernière card : « ${lastTheme} ». Si le nouveau segment reste sur ce même sujet, réutilise EXACTEMENT ce slug pour le theme-tag ; sinon choisis un nouveau slug court (kebab-case).\n`;
  if (streakCount >= THEME_STREAK_THRESHOLD) {
    section += `ATTENTION — ce thème a déjà été couvert par ${streakCount} cards consécutives. Si le nouveau segment reste sur ce même sujet, ta relance DOIT changer complètement de sujet — pas un autre détail technique de « ${lastTheme} », mais un sujet vraiment différent : méthodologie de travail, parcours professionnel, soft skills, un autre projet, gestion d'équipe, préférences technologiques hors de ce sujet, etc.\n`;
  }
  return section;
}

export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[],
  lastTheme?: string | null,
  themeStreakCount?: number
): string {
  const jobCtx = buildJobContext(jobContext);
  const convHistory = buildConversationHistory(history ?? []);
  const prevCards = buildPreviousCards(previousCards ?? []);
  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions déjà posées (ne pas répéter) :\n${previousRelances.map((q) => `- ${q}`).join("\n")}\n`
      : "";
  const themeSection = buildThemeStreakSection(lastTheme, themeStreakCount ?? 0);

  return `Tu es VoxHelp, un copilote bienveillant qui aide un recruteur non-technique pendant un entretien développeur.${jobCtx}${convHistory}${prevCards}${relancesSection}${themeSection}
Rôle : traduire le jargon, repérer les points forts, aider à poser les bonnes questions.

PRIORITÉ ABSOLUE — DÉTECTION RECRUTEUR :
Si le texte transcrit est une question ou une invitation à parler typique d'un recruteur (ex : "Parlez-moi de...", "Comment gérez-vous...", "Pouvez-vous décrire...", "Tell me about...", "What is your experience with..."), réponds UNIQUEMENT avec :
[skip]
Ne génère rien d'autre. Un recruteur pose des questions courtes et n'explique pas de techno.
Un candidat répond : il raconte, explique, donne des exemples, cite des technos ou des chiffres.

Transcription possiblement incomplète. Ne le mentionne jamais. Analyse ce qui EST dit.
Réponds dans la même langue que le candidat.

Format de réponse OBLIGATOIRE — commence DIRECTEMENT par le marqueur, rien avant :
[catégorie] [evidence] [theme-slug]
# Titre court
Explication simple 1-2 phrases
>> Question de relance (optionnelle)

Catégories :
- jargon : terme technique → explique simplement au recruteur
- strength : expérience concrète ou résultat mesurable → valorise
- attention : contradiction ou point critique à creuser
- translation : contexte, rôle ou parcours → reformule en clair

Evidence : high (exemple concret fourni) | medium (mention sans détail) | low (vague)

theme-slug : court identifiant kebab-case (1 à 4 mots) du macro-sujet abordé (ex : aws-serverless, presentation, methodologie-travail).

Relance : naturelle et bienveillante, jamais accusatrice.
DIVERSIFICATION OBLIGATOIRE : si les 2 derniers sujets analysés portent sur le même thème ou la même techno, ta relance DOIT aborder un autre aspect (autre compétence, projet marquant, méthode de travail, challenge résolu, préférence technologique).
Pas de relance si cat = translation ou si le sujet est épuisé.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS — tous les tests du fichier passent, y compris les quatre nouveaux.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/prompts/live-assist.ts apps/backend/src/__tests__/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(live-assist): add theme-tag and forced-pivot instruction to the prompt

Cards now carry a 3rd header bracket with a short theme slug. Once 3
consecutive cards share the same theme, the prompt tells the LLM its
suggested relance must pivot to a genuinely different macro-topic,
not just a different technical detail of the same one.
EOF
)"
```

---

### Task 2: Suivi du streak de thème et branchement dans processTranscript

**Files:**
- Modify: `apps/backend/src/session.ts`
- Create: `apps/backend/src/__tests__/session-theme-streak.test.ts`

**Interfaces:**
- Consumes: `buildLiveAssistPrompt(..., lastTheme?: string | null, themeStreakCount?: number)` from Task 1.
- Produces: comportement observable — à partir de la 4ème card consécutive sur un même thème, le prompt envoyé au LLM contient l'instruction de pivot forcé.

Note d'implémentation (déviation mineure, volontaire, par rapport au texte du spec) : le spec proposait un champ `private readonly THEME_STREAK_THRESHOLD = 3;` sur `Session`. Ce champ ne serait lu nulle part dans `Session` — seule `buildThemeStreakSection` (Task 1, dans `live-assist.ts`) compare le compteur au seuil. Pour éviter une constante dupliquée et inutilisée (leçon tirée du nettoyage après l'annulation de la fonctionnalité de fusion), `Session` se contente de compter et de transmettre `themeStreakCount` tel quel ; le seuil vit uniquement dans `live-assist.ts`.

- [ ] **Step 1: Write the failing integration tests**

Créer `apps/backend/src/__tests__/session-theme-streak.test.ts` :

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

function awsCard(title: string): string {
  return [
    "[strength] [high] [aws-serverless]",
    `# ${title}`,
    "Détail technique sur ce sujet.",
  ].join("\n");
}

function mockStreamAssistOnce(text: string) {
  mockLlm.streamAssist.mockImplementationOnce(
    async (_sys: string, _user: string, onChunk: (t: string) => void) => {
      onChunk(text);
      return text;
    }
  );
}

describe("Session theme streak", () => {
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

  it("adds the forced-pivot instruction once 3 consecutive cards share the same theme", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a un pipeline ETL derrière.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("Gestion de microservices"));
    stt.callbacks!.onTranscript("On gère une dizaine de microservices.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("SQS vs SNS"));
    stt.callbacks!.onTranscript("On utilise SQS plutôt que SNS.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const fourthPrompt = mockLlm.streamAssist.mock.calls[3][0] as string;
    expect(fourthPrompt).toContain("Thème de la dernière card : « aws-serverless »");
    expect(fourthPrompt).toContain("ATTENTION — ce thème a déjà été couvert par 3 cards consécutives");
    expect(fourthPrompt).toContain("DOIT changer complètement de sujet");
  });

  it("resets the streak and does not warn when the theme changes", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockStreamAssistOnce(awsCard("Fullstack serverless"));
    stt.callbacks!.onTranscript("On fait du serverless avec Lambda.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(
      [
        "[translation] [medium] [methodologie-travail]",
        "# Méthode de travail en équipe",
        "Le candidat décrit sa méthode agile.",
      ].join("\n")
    );
    stt.callbacks!.onTranscript("On travaille en méthode agile avec des sprints.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    mockStreamAssistOnce(awsCard("ETL et data pipeline"));
    stt.callbacks!.onTranscript("On a aussi un pipeline ETL.");
    ws.send(JSON.stringify({ type: "trigger:analyze" }));
    await waitForMessage(ws, "assist:done");

    const thirdPrompt = mockLlm.streamAssist.mock.calls[2][0] as string;
    expect(thirdPrompt).toContain("Thème de la dernière card : « methodologie-travail »");
    expect(thirdPrompt).not.toContain("ATTENTION — ce thème a déjà été couvert");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd apps/backend && npx vitest run src/__tests__/session-theme-streak.test.ts`
Expected: FAIL — `Session` ne calcule ni ne transmet encore `lastTheme`/`themeStreakCount`, donc aucune des deux instructions attendues n'apparaît dans les prompts capturés.

- [ ] **Step 3: Implement theme extraction and streak tracking**

Dans `apps/backend/src/session.ts`, ajouter la fonction d'extraction juste après l'interface `ProfileUsage` (après la ligne 16, avant `export class Session`) :

```ts
function extractTheme(text: string): string | null {
  const headerLine = text.trim().split("\n")[0] ?? "";
  const match = headerLine.match(
    /\[(?:jargon|strength|attention|translation)\]\s*\[(?:high|medium|low)\]\s*\[([a-z0-9-]+)\]/i
  );
  return match?.[1]?.toLowerCase() ?? null;
}
```

Ajouter les deux nouveaux champs, juste après `private readonly DEBOUNCE_MS = 2500;` :

```ts
  private readonly DEBOUNCE_MS = 2500;
  private lastTheme: string | null = null;
  private themeStreakCount = 0;
```

Dans `startSession`, remplacer :

```ts
    this.cardLog = [];
    this.sessionStartMs = Date.now();
```

par :

```ts
    this.cardLog = [];
    this.lastTheme = null;
    this.themeStreakCount = 0;
    this.sessionStartMs = Date.now();
```

Dans `cleanup()`, remplacer :

```ts
    this.cardLog = [];
    this.sessionStartMs = 0;
```

par :

```ts
    this.cardLog = [];
    this.lastTheme = null;
    this.themeStreakCount = 0;
    this.sessionStartMs = 0;
```

Dans `processTranscript`, remplacer l'appel à `buildLiveAssistPrompt` :

```ts
        buildLiveAssistPrompt(this.jobContext, this.conversationLog, this.relanceLog, this.cardLog),
```

par :

```ts
        buildLiveAssistPrompt(
          this.jobContext,
          this.conversationLog,
          this.relanceLog,
          this.cardLog,
          this.lastTheme,
          this.themeStreakCount
        ),
```

Toujours dans `processTranscript`, remplacer :

```ts
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

    } catch (err) {
      this.send({
        type: "assist:error",
        error: err instanceof Error ? err.message : "Analysis error",
      });
    }
```

par :

```ts
      this.cardLog.push(card);
      if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();

      const theme = extractTheme(fullText);
      if (theme && theme === this.lastTheme) {
        this.themeStreakCount += 1;
      } else {
        this.lastTheme = theme;
        this.themeStreakCount = theme ? 1 : 0;
      }

    } catch (err) {
      this.send({
        type: "assist:error",
        error: err instanceof Error ? err.message : "Analysis error",
      });
    }
```

Note : `parseAssistText` (utilisée juste avant ce bloc) n'est pas modifiée — `extractTheme` est une fonction séparée qui relit `fullText` indépendamment, exactement comme prévu dans le spec.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd apps/backend && npx vitest run src/__tests__/session-theme-streak.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — tous les fichiers de test passent, y compris `session.test.ts` et `session-max-buffer.test.ts` (aucun des deux ne dépend du thème, donc `lastTheme` reste `null`/`themeStreakCount` reste `0` pour eux, ce qui correspond au comportement actuel inchangé de `buildLiveAssistPrompt` sans ces arguments).

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/session-theme-streak.test.ts
git commit -m "$(cat <<'EOF'
feat(session): track consecutive same-theme cards and feed the prompt

extractTheme() reads the theme tag off each emitted card's raw text
(independent of parseAssistText) and Session keeps a running streak;
once 3 consecutive cards share a theme, the next prompt call carries
the forced-pivot instruction added in the live-assist prompt.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage :** format de réponse LLM + section prompt (Task 1) ; extraction, suivi du streak, reset, branchement dans `processTranscript` (Task 2) ; cas limites `[skip]`/erreur (couverts nativement — le bloc de mise à jour du streak est placé après le `try` réussi, jamais atteint sur le chemin `cancelled` qui retourne plus tôt, ni sur le chemin `catch`) ; `handleAskQuestion` non touché (hors scope, confirmé) ; tests pour les deux tâches.
- **Placeholder scan :** aucun "TBD"/"TODO" ; code complet à chaque étape.
- **Type consistency :** `lastTheme?: string | null` et `themeStreakCount?: number` identiques entre la signature Task 1 et l'appel Task 2 ; `extractTheme` retourne `string | null`, cohérent avec le champ `lastTheme: string | null` de `Session`.
- **Scope :** une seule sous-fonctionnalité cohérente, livrable et testable de bout en bout après la Task 2 ; aucune dépendance à la fonctionnalité de fusion annulée.
