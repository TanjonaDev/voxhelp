# Fiche de qualification client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer le bilan candidat interne (`CandidateReport`) en une fiche de qualification que le recruteur peut envoyer telle quelle à son client, avec matching technique par compétence, citations horodatées vérifiables, et verdict à 3 niveaux — sans score numérique.

**Architecture:** Nouveau type `CandidateReport` (8 sections) dans `packages/shared`. Le backend capture désormais un journal de transcript horodaté (`fullTranscriptLog`) en plus des cards d'analyse existantes, et le passe à un prompt réécrit qui doit citer mot pour mot depuis ce transcript. `generateFinalReport()` sépare 4 champs calculés côté serveur (nom, poste, date, durée — jamais générés par le LLM) des champs générés par Claude. Le frontend gagne un champ facultatif "nom du candidat" et une réécriture complète de `FinalReportView`.

**Tech Stack:** TypeScript strict, ESM, Fastify + `ws`, React 19, `@anthropic-ai/sdk` (`callClaudeJSON`), Vitest.

## Global Constraints

- TypeScript strict partout, pas de `any` (`CLAUDE.md`).
- Backend ESM : tous les imports internes utilisent l'extension `.js` (`CLAUDE.md`).
- Aucun score numérique nulle part dans le type, le prompt, ou l'affichage — uniquement le système ternaire `demontre`/`mentionne`/`non-aborde` (demande utilisateur explicite).
- Toute citation dans la sortie du LLM doit être copiée mot pour mot depuis le transcript fourni, jamais inventée (spec, section "Décision").
- Frontend : Tailwind utility classes uniquement pour du nouveau CSS — mais `OverlayPanel.tsx` existant utilise des objets de style inline (`style={{...}}`), pas Tailwind ; on suit le pattern déjà en place dans ce fichier plutôt que d'introduire un mélange (cohérence avec le fichier modifié, cf. "Working in existing codebases" du process de brainstorming).
- Pas de Redux, CSS modules, styled-components, classes React (`CLAUDE.md`).
- Aucune nouvelle dépendance npm requise pour ce plan.

---

## Task 1: Types partagés — nouveau `CandidateReport`

**Files:**
- Modify: `packages/shared/src/index.ts:9-39`

**Interfaces:**
- Produces: `SessionConfig.candidateName?: string`, `TranscriptEntry { t: string; text: string }`, `Citation { quote: string; t: string }`, `SkillMatchStatus = "demontre" | "mentionne" | "non-aborde"`, `SkillMatch { skill, status, evidence, citation?: Citation }`, `QuotedPoint { text, citation: Citation }`, `AttentionPoint { text, citation?: Citation }`, `KeyProject { company, period, stack, role, impact }`, `Verdict = "presenter" | "presenter-avec-reserve" | "ne-pas-presenter"`, `CandidateReport { candidateName, jobTitle, interviewDate, durationLabel, summary, techMatching: SkillMatch[], strengths: QuotedPoint[], attentionPoints: AttentionPoint[], keyProjects: KeyProject[], verdict: Verdict, verdictReason: string, verdictChecklist: string[], nextSteps: string[], suggestedQuestions: string[] }`.
- `ThemeStatus` is removed (no longer exported).

This task has no dedicated test file (pure type declarations). It is verified by `tsc --noEmit` in the shared package, and consumed by every later task — the repo will not typecheck end-to-end until Tasks 2, 3, 4, 5 land, which is expected mid-plan.

- [ ] **Step 1: Replace `SessionConfig`, `ThemeStatus`, and `CandidateReport`**

In `packages/shared/src/index.ts`, replace lines 9-39 (from `export interface SessionConfig {` through the closing `}` of the old `CandidateReport`) with:

```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
  candidateName?: string;
}

export interface Insight {
  id: string;
  cat: "translation" | "jargon" | "strength" | "attention";
  status: "acquis" | "a-creuser" | "pas-acquis";
  theme: string | null;
  t: string;
  title: string;
  body: string;
  relance?: string;
}

export interface TranscriptEntry {
  t: string;
  text: string;
}

export interface Citation {
  quote: string;
  t: string;
}

export type SkillMatchStatus = "demontre" | "mentionne" | "non-aborde";

export interface SkillMatch {
  skill: string;
  status: SkillMatchStatus;
  evidence: string;
  citation?: Citation;
}

export interface QuotedPoint {
  text: string;
  citation: Citation;
}

export interface AttentionPoint {
  text: string;
  citation?: Citation;
}

export interface KeyProject {
  company: string;
  period: string;
  stack: string;
  role: string;
  impact: string;
}

export type Verdict = "presenter" | "presenter-avec-reserve" | "ne-pas-presenter";

export interface CandidateReport {
  candidateName: string;
  jobTitle: string;
  interviewDate: string;
  durationLabel: string;
  summary: string;
  techMatching: SkillMatch[];
  strengths: QuotedPoint[];
  attentionPoints: AttentionPoint[];
  keyProjects: KeyProject[];
  verdict: Verdict;
  verdictReason: string;
  verdictChecklist: string[];
  nextSteps: string[];
  suggestedQuestions: string[];
}
```

Note: the `Insight` interface is reproduced unchanged above only to show its position relative to the new `TranscriptEntry`/`Citation` block — do not modify its fields.

- [ ] **Step 2: Typecheck the shared package**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: PASS (no syntax errors — this package has no other files referencing the removed `ThemeStatus`).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): replace CandidateReport with client-facing qualification sheet schema"
```

---

## Task 2: Backend — réécriture du prompt `buildFinalAnalysisPrompt`

**Files:**
- Modify: `apps/backend/src/prompts/final-analysis.ts` (full rewrite)
- Modify: `apps/backend/src/__tests__/prompts.test.ts:165-185` (replace the `buildFinalAnalysisPrompt` describe block)

**Interfaces:**
- Consumes: `JobContext`, `Insight`, `TranscriptEntry` from `@voxhelp/shared` (Task 1).
- Produces: `buildFinalAnalysisPrompt(jobContext: JobContext | undefined, cards: Insight[], transcriptLog: TranscriptEntry[]): string` — new 3-argument signature (was 2-argument). Consumed by Task 3 (`session.ts`).

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/__tests__/prompts.test.ts`, replace lines 165-185 (the entire `describe("buildFinalAnalysisPrompt", ...)` block) with:

```ts
describe("buildFinalAnalysisPrompt", () => {
  it("includes job context when provided", () => {
    const prompt = buildFinalAnalysisPrompt({ title: "Backend Dev", level: "Junior", stack: "Node.js" }, [], []);
    expect(prompt).toContain("Backend Dev");
    expect(prompt).toContain("Junior");
    expect(prompt).toContain("Node.js");
  });

  it("mentions explicitly when no job context is provided", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("Aucun contexte de poste fourni");
  });

  it("includes all card titles and statuses as supporting signal, not as citation source", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [confirmedCard, vagueCard], []);
    expect(prompt).toContain("Expérience terrain solide en React");
    expect(prompt).toContain("Manque de concret");
    expect(prompt).toContain("ACQUIS");
    expect(prompt).toContain("PAS-ACQUIS");
    expect(prompt).toContain("jamais une source de citation");
  });

  it("mentions when no analysis is available", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("Aucune analyse en direct disponible");
  });

  it("includes the timestamped transcript, one line per entry", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], [
      { t: "04:12", text: "Le pipeline CI/CD tourne en production depuis six mois." },
    ]);
    expect(prompt).toContain('[04:12] "Le pipeline CI/CD tourne en production depuis six mois."');
  });

  it("mentions when no transcript is available", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("Aucun transcript disponible");
  });

  it("instructs the model to copy citations word-for-word from the transcript", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("copiée MOT POUR MOT");
    expect(prompt).toContain("N'invente jamais une citation");
  });

  it("forbids numeric scores and defines the ternary status system", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("AUCUN score numérique");
    expect(prompt).toContain("demontre | mentionne | non-aborde");
  });

  it("frames the report as a client-facing presentation", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("PRÉSENTE un candidat");
    expect(prompt).toContain("jamais de jugement sec");
  });

  it("requires a citation on every strength but allows attention points without one", () => {
    const prompt = buildFinalAnalysisPrompt(undefined, [], []);
    expect(prompt).toContain("chaque point DOIT avoir une citation");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && npx vitest run prompts.test.ts`
Expected: FAIL — `buildFinalAnalysisPrompt` still has the old 2-argument signature and none of the new strings exist yet.

- [ ] **Step 3: Rewrite `final-analysis.ts`**

Replace the entire contents of `apps/backend/src/prompts/final-analysis.ts` with:

```ts
import type { JobContext, Insight, TranscriptEntry } from "@voxhelp/shared";

function buildJobContextSection(ctx?: JobContext): string {
  if (!ctx) {
    return "\nAucun contexte de poste fourni — base le matching technique sur les compétences mentionnées spontanément pendant l'entretien.\n";
  }
  const parts = [ctx.title, ctx.level ? `niveau ${ctx.level}` : "", ctx.stack ? `stack attendue : ${ctx.stack}` : ""].filter(Boolean);
  return `\nPoste visé : ${parts.join(" — ")}\n`;
}

function buildTranscriptSection(transcriptLog: TranscriptEntry[]): string {
  if (transcriptLog.length === 0) {
    return "\nAucun transcript disponible.\n";
  }
  return `\nTranscript horodaté de l'entretien (mélange recruteur + candidat, sans étiquette de locuteur) :\n${transcriptLog
    .map((e) => `[${e.t}] "${e.text}"`)
    .join("\n")}\n`;
}

function buildCardsSection(cards: Insight[]): string {
  if (cards.length === 0) {
    return "\nAucune analyse en direct disponible.\n";
  }
  return `\nAnalyses réalisées pendant l'entretien (signal d'appui pour trancher un statut, jamais une source de citation) :\n${cards
    .map((c, i) => `[${i + 1}] ${c.status.toUpperCase()} [${c.cat}] — "${c.title}"\n     → ${c.body}`)
    .join("\n")}\n`;
}

export function buildFinalAnalysisPrompt(
  jobContext: JobContext | undefined,
  cards: Insight[],
  transcriptLog: TranscriptEntry[]
): string {
  const jobSection = buildJobContextSection(jobContext);
  const transcriptSection = buildTranscriptSection(transcriptLog);
  const cardsSection = buildCardsSection(cards);

  return `Tu es un assistant de recrutement. Un recruteur RH vient de terminer un entretien de qualification avec un candidat développeur. Ton rôle : produire une FICHE DE QUALIFICATION que le recruteur va envoyer telle quelle à son client (CTO, DRH) pour lui présenter le candidat.
${jobSection}${transcriptSection}${cardsSection}
RÈGLE ABSOLUE SUR LES CITATIONS — ne l'enfreins jamais :
Toute citation ("quote") dans ta réponse doit être copiée MOT POUR MOT depuis une ligne du transcript horodaté ci-dessus, et le "t" associé doit être EXACTEMENT le timestamp affiché entre crochets en face de cette ligne. N'invente jamais une citation, ne la reformule jamais, ne mélange jamais des bouts de deux lignes différentes. Si tu ne trouves aucune ligne du candidat qui appuie un point, n'ajoute pas de citation pour ce point plutôt que d'en inventer une.

DÉTECTION RECRUTEUR VS CANDIDAT — le transcript ne distingue pas les locuteurs :
Une ligne courte qui pose une question ou invite à parler ("Parlez-moi de...", "Comment gérez-vous...", "Pouvez-vous décrire...") est très probablement le recruteur — ne la cite jamais comme parole du candidat. Une ligne qui raconte, explique, donne un exemple ou un chiffre est très probablement le candidat.

TON — le recruteur PRÉSENTE un candidat à son client, il ne le juge pas sévèrement :
Valorisant, factuel, jamais de jugement sec. Des points d'attention à approfondir, jamais un verdict qui descend le candidat. AUCUN score numérique nulle part dans ta réponse — uniquement le système ternaire demontre/mentionne/non-aborde.

Génère la fiche en JSON strict (sans backticks, sans texte autour) :
{
  "summary": "Qui est le candidat, son expérience clé, impression générale factuelle — 3 à 4 phrases",
  "techMatching": [
    {
      "skill": "nom de la compétence/techno — une entrée par compétence distincte identifiée dans la stack attendue ci-dessus ; si aucune stack n'est fournie, utilise les technos mentionnées spontanément",
      "status": "demontre | mentionne | non-aborde",
      "evidence": "1 phrase expliquant pourquoi ce statut, en clair pour un client non-technique",
      "citation": { "quote": "extrait exact copié depuis le transcript", "t": "mm:ss" }
    }
  ],
  "strengths": [
    { "text": "point fort formulé positivement", "citation": { "quote": "extrait exact", "t": "mm:ss" } }
  ],
  "attentionPoints": [
    { "text": "point à approfondir en entretien client, jamais formulé comme un reproche", "citation": { "quote": "extrait exact (optionnel — omets le champ si tu n'as pas d'extrait pertinent)", "t": "mm:ss" } }
  ],
  "keyProjects": [
    { "company": "nom d'entreprise ou 'non précisé'", "period": "période ou 'non précisée'", "stack": "stack utilisée", "role": "rôle du candidat", "impact": "résultat concret obtenu" }
  ],
  "verdict": "presenter | presenter-avec-reserve | ne-pas-presenter",
  "verdictReason": "1-2 phrases argumentant le verdict",
  "verdictChecklist": ["ce que le client doit vérifier en entretien — uniquement si verdict = presenter-avec-reserve, sinon []"],
  "nextSteps": ["prochaine étape suggérée pour la suite du process"],
  "suggestedQuestions": ["question technique pertinente que le client pourrait poser en entretien, sur un point non couvert ou à approfondir"]
}

Règles complémentaires :
- techMatching : statut "demontre" seulement si le candidat a donné un exemple concret avec contexte projet ET résultat, avec citation obligatoire. "mentionne" si la techno est citée sans preuve concrète — cite ce qui a été dit. "non-aborde" si jamais mentionnée pendant l'entretien — pas de citation dans ce cas.
- strengths : chaque point DOIT avoir une citation — n'en propose pas si tu n'as pas d'extrait exact à citer.
- attentionPoints : le champ "citation" est optionnel — omets-le entièrement si tu n'as pas d'extrait exact pertinent, n'en invente jamais un pour remplir le champ. Inclus une analyse d'implication ("on" vs "j'ai") seulement si c'est un signal réel et récurrent dans le transcript, pas systématiquement.
- keyProjects : uniquement les projets réellement identifiables dans le transcript — liste vide si aucun projet clair n'a été décrit.
- verdictChecklist : tableau vide si verdict n'est pas "presenter-avec-reserve".
- Si le transcript est vide ou quasi vide, dis-le explicitement dans "summary", mets tous les statuts de techMatching à "non-aborde" sans citation, et verdict = "presenter-avec-reserve".`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && npx vitest run prompts.test.ts`
Expected: PASS — all `buildLiveAssistPrompt` tests (untouched) and the new `buildFinalAnalysisPrompt` tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/prompts/final-analysis.ts apps/backend/src/__tests__/prompts.test.ts
git commit -m "feat(backend): rewrite final-analysis prompt for client-facing qualification sheet"
```

---

## Task 3: Backend — journal de transcript horodaté + orchestration `generateFinalReport`

**Files:**
- Modify: `apps/backend/src/session.ts`
- Modify: `apps/backend/src/__tests__/session.test.ts`
- Delete: `apps/backend/src/__tests__/session-theme-rollup.test.ts`
- Create: `apps/backend/src/__tests__/session-tech-matching.test.ts`

**Interfaces:**
- Consumes: `buildFinalAnalysisPrompt(jobContext, cards, transcriptLog)` (Task 2), `CandidateReport`/`TranscriptEntry`/`SessionConfig.candidateName` (Task 1).
- Produces: `Session` sends `{ type: "analysis:final", report: CandidateReport }` where `report.candidateName`/`jobTitle`/`interviewDate`/`durationLabel` are computed server-side and every other field comes from the LLM. No other task depends on `Session`'s internals directly — Task 5 (frontend) only depends on the `CandidateReport` shape from Task 1.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/__tests__/session.test.ts`, replace lines 56-63 (the `sampleReport` constant) with:

```ts
const sampleReport: Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel"> = {
  summary: "Candidat solide avec une expérience React clairement démontrée.",
  techMatching: [
    {
      skill: "React",
      status: "demontre",
      evidence: "Expérience terrain confirmée avec exemple concret.",
      citation: { quote: "J'ai développé la plateforme e-commerce en React pendant deux ans.", t: "03:10" },
    },
  ],
  strengths: [
    {
      text: "Expérience terrain claire",
      citation: { quote: "J'ai développé la plateforme e-commerce en React pendant deux ans.", t: "03:10" },
    },
  ],
  attentionPoints: [{ text: "TypeScript avancé non confirmé" }],
  keyProjects: [],
  verdict: "presenter",
  verdictReason: "Profil directement applicable au poste visé.",
  verdictChecklist: [],
  nextSteps: ["Prévoir un entretien technique approfondi sur TypeScript."],
  suggestedQuestions: ["Pouvez-vous détailler votre usage des types avancés TypeScript ?"],
};
```

Then replace the two tests at lines 132-162 (`"sends analysis:final in response to session:summarize"` and `"includes accumulated cards in the final analysis prompt"`) with:

```ts
  it("sends analysis:final in response to session:summarize", async () => {
    mockStreamAssist(sampleAssistText);
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onTranscript("Le candidat présente son expérience");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:summarize" }));

    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.verdict).toBe("presenter");
    expect(msg.report.strengths).toHaveLength(1);
    expect(msg.report.attentionPoints).toHaveLength(1);
    expect(msg.report.summary).toContain("Candidat solide");
  });

  it("fills candidateName and jobTitle with defaults when the session was started without them", async () => {
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.candidateName).toBe("Candidat");
    expect(msg.report.jobTitle).toBe("Poste non précisé");
    expect(msg.report.durationLabel).toMatch(/^\d+ min$/);
    expect(msg.report.interviewDate).toBeTruthy();
  });

  it("uses the configured candidate name and job title when provided", async () => {
    ws.send(JSON.stringify({
      type: "session:start",
      config: {
        language: "fr",
        candidateName: "Awa Diallo",
        jobContext: { title: "Lead Backend", level: "Senior", stack: "Node.js" },
      },
    }));
    await waitForMessage(ws, "session:ready");

    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.candidateName).toBe("Awa Diallo");
    expect(msg.report.jobTitle).toBe("Lead Backend");
  });

  it("includes accumulated cards and the timestamped transcript in the final analysis prompt", async () => {
    mockStreamAssist(sampleAssistText);
    mockLlm.callClaudeJSON.mockResolvedValueOnce(sampleReport);

    stt.callbacks!.onTranscript("Premier transcript");
    await waitForMessage(ws, "assist:done");

    ws.send(JSON.stringify({ type: "session:summarize" }));
    await waitForMessage(ws, "analysis:final");

    const finalPrompt = mockLlm.callClaudeJSON.mock.calls[0][0] as string;
    expect(finalPrompt).toContain("Expérience terrain confirmée en React");
    expect(finalPrompt).toContain("FICHE DE QUALIFICATION");
    expect(finalPrompt).toContain('"Premier transcript"');
  });
```

Then delete `apps/backend/src/__tests__/session-theme-rollup.test.ts` entirely (its subject, `buildThemeRollup`/`themes`, no longer exists) and create `apps/backend/src/__tests__/session-tech-matching.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import type { CandidateReport, ServerMessage } from "@voxhelp/shared";
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
  callClaudeJSON: vi.fn(),
}));

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

vi.mock("../llm.js", () => ({
  streamAssist: mockLlm.streamAssist,
  callClaudeJSON: mockLlm.callClaudeJSON,
  correctTranscript: vi.fn((text: string) => Promise.resolve(text)),
}));

function connectAndStart(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => {
      ws.send(JSON.stringify({
        type: "session:start",
        config: { language: "fr", jobContext: { title: "Lead Backend", level: "Senior", stack: "Node.js, PostgreSQL" } },
      }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "session:ready") resolve(ws);
    });
  });
}

const generatedReport: Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel"> = {
  summary: "Candidat expérimenté sur la stack backend attendue.",
  techMatching: [
    {
      skill: "Node.js",
      status: "demontre",
      evidence: "Exemple concret d'API Node.js en production avec résultat chiffré.",
      citation: { quote: "J'ai construit l'API de paiement en Node.js, ça a réduit la latence de 30%.", t: "05:42" },
    },
    {
      skill: "PostgreSQL",
      status: "mentionne",
      evidence: "PostgreSQL cité sans exemple précis.",
      citation: { quote: "On utilisait PostgreSQL côté base de données.", t: "07:15" },
    },
    {
      skill: "Kubernetes",
      status: "non-aborde",
      evidence: "Jamais mentionné pendant l'entretien.",
    },
  ],
  strengths: [
    {
      text: "Impact chiffré sur la latence de l'API de paiement",
      citation: { quote: "J'ai construit l'API de paiement en Node.js, ça a réduit la latence de 30%.", t: "05:42" },
    },
  ],
  attentionPoints: [
    { text: "Le candidat utilise souvent « on » plutôt que « j'ai » — à clarifier son rôle exact dans l'équipe." },
  ],
  keyProjects: [
    {
      company: "Acme Corp",
      period: "2021-2023",
      stack: "Node.js, PostgreSQL",
      role: "Lead Backend",
      impact: "Réduction de 30% de la latence de l'API de paiement.",
    },
  ],
  verdict: "presenter",
  verdictReason: "Compétences backend clairement démontrées avec impact chiffré.",
  verdictChecklist: [],
  nextSteps: ["Approfondir l'expérience Kubernetes en entretien technique."],
  suggestedQuestions: ["Avez-vous déjà déployé sur Kubernetes ?"],
};

describe("Session final report — tech matching pass-through", () => {
  let server: TestServer;
  let ws: WebSocket;

  beforeEach(() => {
    mockLlm.streamAssist.mockReset();
    mockLlm.callClaudeJSON.mockReset();
    stt.callbacks = null;
  });

  afterEach(async () => {
    ws.close();
    await server.close();
  });

  it("passes through each skill's status and citation exactly as returned by the LLM", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockLlm.callClaudeJSON.mockResolvedValueOnce(generatedReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.techMatching).toEqual(generatedReport.techMatching);
  });

  it("omits citation for a non-aborde skill instead of fabricating one", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockLlm.callClaudeJSON.mockResolvedValueOnce(generatedReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    const kubernetes = msg.report.techMatching.find((m) => m.skill === "Kubernetes");
    expect(kubernetes?.status).toBe("non-aborde");
    expect(kubernetes?.citation).toBeUndefined();
  });

  it("merges the server-computed header fields with the LLM-generated content", async () => {
    server = await createTestServer();
    ws = await connectAndStart(server.port);

    mockLlm.callClaudeJSON.mockResolvedValueOnce(generatedReport);
    ws.send(JSON.stringify({ type: "session:summarize" }));
    const msg = (await waitForMessage(ws, "analysis:final")) as Extract<ServerMessage, { type: "analysis:final" }>;

    expect(msg.report.jobTitle).toBe("Lead Backend");
    expect(msg.report.candidateName).toBe("Candidat");
    expect(msg.report.verdict).toBe("presenter");
    expect(msg.report.keyProjects).toEqual(generatedReport.keyProjects);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/backend && npx vitest run session.test.ts session-tech-matching.test.ts`
Expected: FAIL — `session.ts` still calls `buildFinalAnalysisPrompt` with 2 arguments, still spreads `themes` from `buildThemeRollup`, and never reads `candidateName`/`jobTitle`/`durationLabel`/`interviewDate` onto the report.

- [ ] **Step 3: Implement the transcript log, candidate name, and orchestration changes in `session.ts`**

In `apps/backend/src/session.ts`:

3a. Update the type import (line 2-5) to drop `ThemeStatus` and add `TranscriptEntry`:

```ts
import type {
  ClientMessage, ServerMessage, SessionConfig,
  Insight, CandidateReport, JobContext, TranscriptEntry,
} from "@voxhelp/shared";
```

3b. Delete the `buildThemeRollup` function (lines 37-48) entirely. Keep `extractThemeAndAngle` and `normalizeStatus` — they are still used by `parseAssistText` for the live-assist cards.

3c. Add two class fields, right after `private jobContext: JobContext | undefined = undefined;` (line 55):

```ts
  private candidateName: string | undefined = undefined;
```

and right after `private cardLog: Insight[] = [];` (line 59):

```ts
  private fullTranscriptLog: TranscriptEntry[] = [];
  private readonly MAX_TRANSCRIPT_LOG = 600;
```

3d. In `startSession` (around line 150-159), reset the new state alongside the existing logs:

```ts
    this.config = config;
    this.jobContext = config.jobContext;
    this.candidateName = config.candidateName;
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.fullTranscriptLog = [];
    this.lastTheme = null;
```

(only the two new lines — `this.candidateName = ...` and `this.fullTranscriptLog = [];` — are additions; the rest is existing code shown for placement).

3e. In `handleFinalTranscript` (lines 211-232), append to the transcript log right after the `transcript:final` send:

```ts
    this.send({ type: "transcript:final", text });

    const transcriptT = this.sessionStartMs ? this.elapsedTime() : "00:00";
    this.fullTranscriptLog.push({ t: transcriptT, text });
    if (this.fullTranscriptLog.length > this.MAX_TRANSCRIPT_LOG) this.fullTranscriptLog.shift();

    if (this.transcriptBuffer.length === 0 && !this.maxBufferTimer) {
```

3f. Replace `generateFinalReport` (lines 439-459) entirely with:

```ts
  private async generateFinalReport(): Promise<void> {
    try {
      type GeneratedReportFields = Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel">;
      const generated = await callClaudeJSON<GeneratedReportFields>(
        buildFinalAnalysisPrompt(this.jobContext, this.cardLog, this.fullTranscriptLog),
        "Génère la fiche de qualification du candidat.",
        "claude-sonnet-4-6"
      );
      const durationLabel = this.sessionStartMs
        ? `${Math.max(1, Math.round((Date.now() - this.sessionStartMs) / 60000))} min`
        : "0 min";
      const report: CandidateReport = {
        candidateName: this.candidateName?.trim() || "Candidat",
        jobTitle: this.jobContext?.title?.trim() || "Poste non précisé",
        interviewDate: new Date().toISOString(),
        durationLabel,
        ...generated,
      };
      console.log(`[Session] Verdict: ${report.verdict} — ${report.verdictReason}`);
      this.send({ type: "analysis:final", report });
    } catch (err) {
      this.send({
        type: "session:error",
        error: err instanceof Error ? err.message : "Final analysis error",
      });
    }
  }
```

3g. In `cleanup()` (lines 467-500), reset the new state alongside the existing logs:

```ts
    this.transcriptBuffer = [];
    this.conversationLog = [];
    this.relanceLog = [];
    this.cardLog = [];
    this.fullTranscriptLog = [];
    this.lastTheme = null;
```

and, near the existing `this.jobContext = undefined;` at the end of `cleanup()`:

```ts
    this.config = null;
    this.jobContext = undefined;
    this.candidateName = undefined;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/backend && npx vitest run`
Expected: PASS — the full backend suite, including `session.test.ts`, `session-tech-matching.test.ts`, and every other untouched session test file (`session-jargon-dedup.test.ts`, `session-keywords.test.ts`, `session-max-buffer.test.ts`, `session-theme-angle.test.ts`, `session-usage-limit.test.ts`, `prompts.test.ts`, CV tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/session.ts apps/backend/src/__tests__/session.test.ts apps/backend/src/__tests__/session-tech-matching.test.ts
git rm apps/backend/src/__tests__/session-theme-rollup.test.ts
git commit -m "feat(backend): timestamped transcript log + qualification-sheet report orchestration"
```

---

## Task 4: Frontend — champ facultatif "nom du candidat"

**Files:**
- Modify: `apps/web/src/components/OverlayPanel.tsx`
- Modify: `apps/web/src/App.tsx:55-62`

**Interfaces:**
- Consumes: `SessionConfig.candidateName?: string` (Task 1).
- Produces: `OverlayPanelProps.onStartAudio: (jobContext?: JobContext, keywords?: string[], candidateName?: string) => Promise<void>` — new 3rd parameter, consumed by `App.tsx`'s `handleStartAudio`.

No automated test infrastructure exists in `apps/web` today (no `*.test.*`/`*.spec.*` files) — this task is verified by typecheck and a manual `pnpm dev` smoke check, consistent with the rest of this component.

- [ ] **Step 1: Add the `candidateName` field to the setup form in `OverlayPanel.tsx`**

Add state right after the existing `jobStack` state (line 786):

```ts
  const [jobStack, setJobStack] = useState("");
  const [candidateName, setCandidateName] = useState("");
```

Insert a new label + input as the first fields inside the setup card, right after the card's opening `<div style={{...}}>` (line 950) and before the existing `"Contexte du poste (optionnel)"` label (line 951-962):

```tsx
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                  }}
                >
                  Candidat (optionnel)
                </p>
                <input
                  type="text"
                  placeholder="Nom du candidat"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  style={{
                    all: "unset" as "unset",
                    fontSize: 13,
                    color: "var(--text)",
                    background: "var(--card-hi)",
                    borderRadius: 9,
                    padding: "8px 12px",
                    boxShadow: "0 0 0 1px var(--stroke) inset",
                    fontFamily: "var(--font)",
                  }}
                />
```

- [ ] **Step 2: Thread `candidateName` through `handleStart` and the component's props**

Update `handleStart` (lines 813-824):

```ts
  const handleStart = async () => {
    const jobContext =
      jobTitle || jobLevel || jobStack
        ? { title: jobTitle, level: jobLevel, stack: jobStack }
        : undefined;
    const keywords = mergeKeywords(cvKeywords.keywords, deriveStackKeywords(jobStack));
    console.log(
      `[Setup] cvKeywords=[${cvKeywords.keywords.join(", ")}] stackKeywords=[${deriveStackKeywords(jobStack).join(", ")}] merged=[${keywords.join(", ")}]`
    );
    await onStartAudio(jobContext, keywords.length > 0 ? keywords : undefined, candidateName.trim() || undefined);
    setAudioStarted(true);
  };
```

Update `OverlayPanelProps.onStartAudio` (line 757):

```ts
  onStartAudio: (jobContext?: JobContext, keywords?: string[], candidateName?: string) => Promise<void>;
```

- [ ] **Step 3: Update `App.tsx` to accept and forward `candidateName`**

In `apps/web/src/App.tsx`, replace `handleStartAudio` (lines 55-62):

```ts
  const handleStartAudio = async (jobContext?: JobContext, keywords?: string[], candidateName?: string) => {
    ws.startSession({ language: "fr", jobContext, keywords, candidateName });
    try {
      await audio.startTabCapture();
    } catch {
      await audio.startMicrophone();
    }
  };
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: FAIL at this point — `FinalReportView` (Task 5, not yet done) still references the old `CandidateReport` fields (`report.overall`, `report.themes`, etc.) that no longer exist on the Task 1 type. This is expected; Task 5 fixes it. Confirm the *only* errors reported are inside `FinalReportView`/`RECOMMENDATION_META`/`THEME_STATUS_META` in `OverlayPanel.tsx` — not in the setup-form code you just touched.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/OverlayPanel.tsx apps/web/src/App.tsx
git commit -m "feat(web): add optional candidate name field to the prep form"
```

---

## Task 5: Frontend — réécriture de `FinalReportView` (8 sections)

**Files:**
- Modify: `apps/web/src/components/OverlayPanel.tsx:1-2` (imports)
- Modify: `apps/web/src/components/OverlayPanel.tsx:593-740` (full replacement of the `FinalReportView` block)

**Interfaces:**
- Consumes: `CandidateReport`, `SkillMatch`, `SkillMatchStatus`, `Verdict`, `Citation` from `@voxhelp/shared` (Task 1). Consumes the merged report shape produced by Task 3's `generateFinalReport`.
- Produces: nothing consumed by a later task — this is the last content task.

No automated test infrastructure exists in `apps/web` — verified by typecheck and manual smoke check.

- [ ] **Step 1: Update the type import**

Replace line 2:

```ts
import type { Insight, CandidateReport, JobContext, ThemeStatus } from "@voxhelp/shared";
```

with:

```ts
import type { Insight, CandidateReport, JobContext, SkillMatch, SkillMatchStatus, Verdict, Citation } from "@voxhelp/shared";
```

- [ ] **Step 2: Replace the `FinalReportView` block**

Replace lines 593-740 (from the `// FinalReportView` comment header through the closing `}` of the `FinalReportView` function) with:

```tsx
// ---------------------------------------------------------------------------
// FinalReportView
// ---------------------------------------------------------------------------
const SKILL_STATUS_META: Record<SkillMatchStatus, { icon: string; color: string }> = {
  "demontre": { icon: "✓", color: "var(--good)" },
  "mentionne": { icon: "?", color: "var(--warn)" },
  "non-aborde": { icon: "✕", color: "var(--risk)" },
};

const VERDICT_META: Record<Verdict, { label: string; colorVar: string }> = {
  "presenter": { label: "Présenter au client", colorVar: "var(--good)" },
  "presenter-avec-reserve": { label: "Présenter avec réserve", colorVar: "var(--warn)" },
  "ne-pas-presenter": { label: "Ne pas présenter", colorVar: "var(--risk)" },
};

const sectionLabelStyle = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase" as const,
  color: "var(--text-3)",
  margin: "0 0 6px",
};

function CitationChip({ citation }: { citation: Citation }) {
  return (
    <span
      style={{
        display: "block",
        fontSize: 11.5,
        color: "var(--text-3)",
        fontStyle: "italic",
        marginTop: 3,
      }}
    >
      <span style={{ fontFamily: "var(--mono)", fontStyle: "normal", marginRight: 5 }}>{citation.t}</span>
      « {citation.quote} »
    </span>
  );
}

function techMatchingCounts(matches: SkillMatch[]): Record<SkillMatchStatus, number> {
  return matches.reduce(
    (acc, m) => {
      acc[m.status] += 1;
      return acc;
    },
    { "demontre": 0, "mentionne": 0, "non-aborde": 0 } as Record<SkillMatchStatus, number>
  );
}

function formatInterviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function FinalReportView({ report }: { report: CandidateReport }) {
  const verdict = VERDICT_META[report.verdict];
  const counts = techMatchingCounts(report.techMatching);
  const bilanLine = `${counts["demontre"]} démontré${counts["demontre"] !== 1 ? "s" : ""} · ${counts["mentionne"]} mentionné${counts["mentionne"] !== 1 ? "s" : ""} · ${counts["non-aborde"]} non abordé${counts["non-aborde"] !== 1 ? "s" : ""}`;

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        borderRadius: "var(--radius-card)",
        padding: "16px",
        background: "var(--card)",
        boxShadow: "0 0 0 1px var(--stroke) inset, var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* 1. En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {report.candidateName}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>
            {report.jobTitle} · {formatInterviewDate(report.interviewDate)} · {report.durationLabel}
          </p>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 9px",
            borderRadius: 99,
            background: "var(--card-hi)",
            color: verdict.colorVar,
            whiteSpace: "nowrap",
          }}
        >
          {verdict.label}
        </span>
      </div>

      {/* 2. Résumé */}
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{report.summary}</p>

      {/* 3. Matching technique */}
      {report.techMatching.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Matching technique</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {report.techMatching.map((m) => {
              const meta = SKILL_STATUS_META[m.status];
              return (
                <li key={m.skill} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                  <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{m.skill}</span> — {m.evidence}
                    {m.citation && <CitationChip citation={m.citation} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>{bilanLine}</p>
        </div>
      )}

      {/* 4. Points forts */}
      {report.strengths.length > 0 && (
        <div>
          <p style={{ ...sectionLabelStyle, color: "var(--good)" }}>Points forts</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {report.strengths.map((s, i) => (
              <li key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                <span style={{ color: "var(--good)", flexShrink: 0 }}>+</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {s.text}
                  <CitationChip citation={s.citation} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Points d'attention */}
      {report.attentionPoints.length > 0 && (
        <div>
          <p style={{ ...sectionLabelStyle, color: "var(--warn)" }}>Points d'attention</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {report.attentionPoints.map((a, i) => (
              <li key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                <span style={{ color: "var(--warn)", flexShrink: 0 }}>?</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {a.text}
                  {a.citation && <CitationChip citation={a.citation} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 6. Projets clés identifiés */}
      {report.keyProjects.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Projets clés identifiés</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {report.keyProjects.map((p, i) => (
              <div
                key={i}
                style={{
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "var(--card-hi)",
                  boxShadow: "0 0 0 1px var(--stroke) inset",
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.5,
                }}
              >
                <p style={{ margin: "0 0 3px", fontWeight: 700, color: "var(--text)" }}>
                  {p.company} <span style={{ fontWeight: 400, color: "var(--text-3)" }}>· {p.period}</span>
                </p>
                <p style={{ margin: 0 }}>{p.role} — {p.stack}</p>
                <p style={{ margin: "3px 0 0", color: "var(--text-3)" }}>{p.impact}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. Recommandation */}
      <div
        style={{
          borderRadius: 10,
          padding: "10px 12px",
          background: "var(--card-hi)",
          boxShadow: "0 0 0 1px var(--stroke) inset",
        }}
      >
        <p style={sectionLabelStyle}>Recommandation</p>
        <p style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>{report.verdictReason}</p>
        {report.verdictChecklist.length > 0 && (
          <ul style={{ margin: "0 0 6px", padding: "0 0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            {report.verdictChecklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
        {report.nextSteps.length > 0 && (
          <>
            <p style={{ margin: "6px 0 3px", fontSize: 10.5, fontWeight: 700, color: "var(--text-3)" }}>
              Prochaines étapes
            </p>
            <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              {report.nextSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 8. Questions non posées */}
      {report.suggestedQuestions.length > 0 && (
        <div>
          <p style={sectionLabelStyle}>Questions non posées</p>
          <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            {report.suggestedQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS — no remaining references to `report.overall`, `report.gaps`, `report.themes`, `ThemeStatus`, or the old `RECOMMENDATION_META`/`THEME_STATUS_META`.

- [ ] **Step 4: Manual smoke check**

Run: `pnpm dev` from the repo root, open the app, fill the setup form (including the new "Nom du candidat" field), start a session, speak a few sentences mentioning a technology from the stack field, click "Résumer" (or the summarize action in `HeaderBar`), and confirm the report renders all 8 sections without runtime errors in the browser console. Since this exercises a real Claude call, expect the LLM's output shape to already match `CandidateReport` (Task 2's prompt defines the exact JSON schema) — if a field renders as `undefined`, re-check the prompt's JSON schema against the type from Task 1 before assuming a frontend bug.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/OverlayPanel.tsx
git commit -m "feat(web): render the 8-section client-facing qualification sheet"
```

---

## Task 6: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck both apps**

Run:
```bash
cd apps/backend && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```
Expected: PASS for both, no leftover references to the old `CandidateReport` shape or `ThemeStatus` anywhere in the repo.

- [ ] **Step 2: Run the full backend test suite**

Run: `pnpm --filter @voxhelp/backend test`
Expected: PASS — every test file in `apps/backend/src/__tests__/` passes, including the ones untouched by this plan (`extract-cv-keywords*.test.ts`, `cv-keyword-extraction.test.ts`, `session-jargon-dedup.test.ts`, `session-keywords.test.ts`, `session-max-buffer.test.ts`, `session-theme-angle.test.ts`, `session-usage-limit.test.ts`).

- [ ] **Step 3: Grep for leftover references to the old report shape**

Run: `grep -rn "\.overall\b\|\.gaps\b\|ThemeStatus\|buildThemeRollup\|recommendationReason" apps/ packages/ --include="*.ts" --include="*.tsx"`
Expected: no output (empty). If anything matches, it is a leftover from the old `CandidateReport`/theme-rollup design that this plan missed — fix it before considering the feature done.

- [ ] **Step 4: Final commit (only if Steps 1-3 required fixes)**

If Steps 1-3 were clean, there is nothing to commit here — the feature is complete as of Task 5's commit. If a fix was needed, commit it:

```bash
git add -A
git commit -m "fix: address full-repo verification findings for qualification sheet"
```
