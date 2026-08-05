# Fiche de qualification client (refonte du bilan final)

## Contexte

Le bilan candidat actuel (`CandidateReport`, généré par `buildFinalAnalysisPrompt` dans `apps/backend/src/prompts/final-analysis.ts`, affiché par `FinalReportView` dans `apps/web/src/components/OverlayPanel.tsx:611-740`) est un rapport d'évaluation interne : `overall` + `strengths`/`gaps` en puces libres + `recommendation: "hire"|"maybe"|"pass"` + un rollup de thèmes (`buildThemeRollup`, `session.ts:37-48`) calculé sur `cardLog`.

Le besoin produit change : cette fiche doit devenir un document que le recruteur envoie tel quel à **son client** (CTO, DRH) pour présenter le candidat. Elle doit être lisible en 2 minutes, factuelle, valorisante, et permettre au client de décider s'il veut rencontrer le candidat — sans jamais donner l'impression que VoxHelp "descend" le candidat.

Deux limites de l'existant conditionnent le design :

1. **`generateFinalReport()` (`session.ts:439-459`) n'utilise pas le transcript brut** — seulement `cardLog` (cards déjà reformulées/paraphrasées par le LLM du live-assist) et `jobContext`. Le nouveau format exige des citations **exactes** horodatées ; une paraphrase présentée comme citation exacte serait trompeuse pour le client final. Il faut donc donner au prompt du rapport final un accès au texte réellement prononcé, horodaté.
2. **Pas de diarisation locuteur** : Deepgram Flux transcrit tout l'audio de l'onglet (candidat + recruteur) en un seul flux, sans étiquette de locuteur. Le live-assist gère déjà ça heuristiquement (bloc "PRIORITÉ ABSOLUE — DÉTECTION RECRUTEUR" dans `live-assist.ts:81-84`). Le rapport final héritera de la même limite : le LLM doit inférer quelles lignes du transcript sont le candidat. C'est une limite de produit existante, pas quelque chose que cette refonte doit résoudre.

Autre écart constaté en explorant le code : `apps/web/src/hooks/useInterviews.ts` (tables Supabase `interviews`/`reports`/`transcripts`/`assist_cards`, avec un champ `candidate_name`) n'est importé nulle part dans l'app — code mort, indépendant du flux WebSocket réellement utilisé. Hors scope de cette refonte.

## Décision

Réécriture complète de `CandidateReport` (type partagé), du prompt de génération, et du composant d'affichage, structurée autour de 8 sections fixes (en-tête, résumé, matching technique, points forts, points d'attention, projets clés, recommandation, questions non posées), avec :

- **Séparation stricte champs calculés / champs générés par le LLM.** Le nom du candidat, le poste visé, la date et la durée de l'entretien sont des faits connus côté serveur — ils sont calculés en code, jamais redemandés au LLM (élimine tout risque d'hallucination sur ces champs et le comptage "X démontrés · Y mentionnés · Z non abordés", dérivé côté frontend depuis `techMatching`).
- **Journal de transcript horodaté, non plafonné à la fenêtre du live-assist**, alimentant le prompt du rapport final avec des lignes `[mm:ss] "texte"` que le LLM doit citer mot pour mot — jamais reformuler quand il produit une citation.
- **Système ternaire partout** (`demontre` / `mentionne` / `non-aborde`), aucun score numérique nulle part dans le type ni le prompt.
- **Matching par compétence du poste**, pas par thème libre choisi par le LLM (remplace `ThemeStatus`/`buildThemeRollup`, qui n'avait pas de lien garanti avec les compétences réellement attendues sur le poste).
- Verdict à 3 valeurs (`presenter` / `presenter-avec-reserve` / `ne-pas-presenter`) avec checklist de vérification uniquement pour le cas "avec réserve".

Hors scope (tranché en discussion) : pas de bouton "copier la fiche" dans cette itération — uniquement l'affichage du nouveau format.

## Comportement

### 1. Types partagés — `packages/shared/src/index.ts`

Remplace `Insight["status"]`-style rollup et l'ancien `CandidateReport`. Nouveau schéma :

```ts
export interface Citation {
  quote: string; // extrait copié mot pour mot depuis le transcript
  t: string;     // mm:ss
}

export type SkillMatchStatus = "demontre" | "mentionne" | "non-aborde";

export interface SkillMatch {
  skill: string;
  status: SkillMatchStatus;
  evidence: string;      // ce qui justifie ce statut, en clair pour le client
  citation?: Citation;    // absent quand status = "non-aborde"
}

export interface QuotedPoint {
  text: string;
  citation: Citation; // obligatoire — un point fort doit toujours être appuyé
}

export interface AttentionPoint {
  text: string;
  citation?: Citation; // optionnelle — un point d'attention peut être un manque, pas toujours citable
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
  // calculés côté serveur — jamais générés par le LLM
  candidateName: string;
  jobTitle: string;
  interviewDate: string; // ISO 8601
  durationLabel: string; // ex. "32 min"
  // générés par le LLM (callClaudeJSON)
  summary: string;
  techMatching: SkillMatch[];
  strengths: QuotedPoint[];
  attentionPoints: AttentionPoint[];
  keyProjects: KeyProject[];
  verdict: Verdict;
  verdictReason: string;
  verdictChecklist: string[]; // rempli seulement si verdict === "presenter-avec-reserve"
  nextSteps: string[];
  suggestedQuestions: string[];
}
```

`ThemeStatus` et `buildThemeRollup` (`session.ts:26-48`) sont supprimés — `techMatching` les remplace intégralement.

`SessionConfig` gagne un champ optionnel :

```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
  candidateName?: string;
}
```

### 2. Backend — journal de transcript horodaté (`session.ts`)

Nouveau state, déclaré à côté de `conversationLog`/`cardLog` (`session.ts:56-59`) :

```ts
private fullTranscriptLog: { t: string; text: string }[] = [];
private readonly MAX_TRANSCRIPT_LOG = 600; // garde-fou mémoire, très au-dessus d'un entretien réel
```

Alimenté dans `handleFinalTranscript` (`session.ts:211-232`), juste après `correctTranscript`, donc à la granularité de chaque segment STT final — plus fin que le buffer débounce de `conversationLog` qui sert au live-assist :

```ts
const t = this.sessionStartMs ? this.elapsedTime() : "00:00";
this.fullTranscriptLog.push({ t, text });
if (this.fullTranscriptLog.length > this.MAX_TRANSCRIPT_LOG) this.fullTranscriptLog.shift();
```

Réinitialisé dans `startSession()` (`session.ts:150-156`), au même endroit que `conversationLog`/`cardLog`. Pas nettoyé avant `generateFinalReport()` — même pattern que `cardLog`, lu tel quel au moment de la génération.

Nouveau champ `candidateName` sur `Session`, peuplé depuis `config.candidateName` dans `startSession()`, au même endroit que `this.jobContext = config.jobContext`.

### 3. Backend — prompt (`prompts/final-analysis.ts`)

Nouvelle signature :

```ts
export function buildFinalAnalysisPrompt(
  jobContext: JobContext | undefined,
  cards: Insight[],
  transcriptLog: { t: string; text: string }[]
): string
```

Contenu du prompt :

- Transcript injecté formaté `[mm:ss] "texte"`, une ligne par segment, dans l'ordre chronologique. Instruction explicite : **toute citation dans la réponse JSON doit être copiée mot pour mot depuis une ligne de ce transcript, avec le timestamp exact affiché en face — jamais inventée ou reformulée.**
- `cardLog` fourni en signal d'appui (déjà qualifié acquis/à-creuser/pas-acquis par le live-assist) pour aider à trancher `demontre`/`mentionne`/`non-aborde`, mais la citation doit toujours venir du transcript brut, pas du `body` (déjà paraphrasé) d'une card.
- `jobContext.stack` (chaîne libre) transmis tel quel — pas de pré-découpage côté code. Le LLM identifie lui-même chaque compétence/techno distincte mentionnée dans la stack (gère nativement des cas type "AWS (Lambda, S3)" qu'un split par virgule casserait).
- Instruction de détection recruteur vs candidat réutilisant la même heuristique que `live-assist.ts:81-84` (questions courtes/invitations à parler = recruteur, réponses développées = candidat) — seules les lignes candidat sont citables.
- Ton imposé : présentation valorisante, factuelle, jamais "points faibles" mais "points d'attention", verdict argumenté et non sévère. Rappel explicite : aucun score numérique dans la sortie.
- Sortie JSON strict couvrant les champs générés listés dans le type `CandidateReport` (tout sauf les 4 champs calculés côté serveur).

### 4. Backend — orchestration (`generateFinalReport`, `session.ts:439-459`)

```ts
private async generateFinalReport(): Promise<void> {
  try {
    type GeneratedFields = Omit<CandidateReport, "candidateName" | "jobTitle" | "interviewDate" | "durationLabel">;
    const generated = await callClaudeJSON<GeneratedFields>(
      buildFinalAnalysisPrompt(this.jobContext, this.cardLog, this.fullTranscriptLog),
      "Génère la fiche de qualification du candidat.",
      "claude-sonnet-4-6"
    );
    const report: CandidateReport = {
      candidateName: this.candidateName?.trim() || "Candidat",
      jobTitle: this.jobContext?.title?.trim() || "Poste non précisé",
      interviewDate: new Date().toISOString(),
      durationLabel: `${Math.max(1, Math.round((Date.now() - this.sessionStartMs) / 60000))} min`,
      ...generated,
    };
    this.send({ type: "analysis:final", report });
  } catch (err) {
    this.send({
      type: "session:error",
      error: err instanceof Error ? err.message : "Final analysis error",
    });
  }
}
```

`buildThemeRollup(this.cardLog)` et son log associé disparaissent de cette méthode.

### 5. Frontend — champ nom du candidat (facultatif)

Dans le formulaire de prep de `OverlayPanel.tsx` (à côté des champs titre/niveau/stack, autour de `jobStack`/`jobTitle`/`jobLevel`), ajout d'un champ texte facultatif "Nom du candidat". Threadé :

`OverlayPanel` (state local) → `onStartAudio(jobContext, keywords, candidateName)` → `App.tsx: handleStartAudio` → `ws.startSession({ language, jobContext, keywords, candidateName })`.

`OverlayPanelProps.onStartAudio` et `handleStartAudio` (`App.tsx:55-62`) gagnent le paramètre `candidateName?: string`.

### 6. Frontend — `FinalReportView` (réécriture, `OverlayPanel.tsx:611-740`)

Nouvelle structure, un bloc par section :

1. **En-tête** : `candidateName`, `jobTitle`, date formatée (`interviewDate`), `durationLabel`.
2. **Résumé** : `summary`, paragraphe.
3. **Matching technique** : liste `techMatching`, icône par statut (✅/⚠️/❌ — mapping `SkillMatchStatus → {icon, color}` sur le même pattern que l'actuel `THEME_STATUS_META`), citation affichée en petit chip horodaté sous chaque ligne quand présente. Ligne de bilan `"{n démontrés} · {n mentionnés} · {n non abordés}"` calculée côté composant par comptage de `techMatching`.
4. **Points forts** : `strengths`, chaque item avec sa citation horodatée affichée.
5. **Points d'attention** : `attentionPoints`, citation affichée si présente, texte seul sinon. Cadrage visuel neutre (pas la couleur "risque" utilisée aujourd'hui pour `gaps`) — cohérent avec le ton "présentation" demandé.
6. **Projets clés** : `keyProjects`, une mini-carte par projet (entreprise, période, stack, rôle, impact).
7. **Recommandation** : badge à 3 états sur `verdict` (remplace `RECOMMENDATION_META` actuel indexé sur `hire`/`maybe`/`pass`), `verdictReason`, `verdictChecklist` affichée uniquement si non vide, `nextSteps` en liste.
8. **Questions non posées** : `suggestedQuestions` en liste.

Style : réutilise les tokens CSS existants (`var(--card)`, `var(--good)`, `var(--warn)`, `var(--risk)`, `var(--text-3)`, etc.) et la typographie déjà en place dans `FinalReportView` — pas de nouvelle dépendance visuelle.

## Hors scope

- Bouton "copier la fiche" / export PDF / envoi email — uniquement l'affichage web du nouveau format dans cette itération.
- Résolution de l'absence de diarisation locuteur — limite de produit existante, héritée telle quelle par le rapport final.
- Pré-découpage déterministe de `jobContext.stack` en liste de compétences côté code — laissé au LLM (cf. Décision).
- Wiring de `useInterviews.ts` / persistance Supabase du rapport — code mort non concerné par cette refonte.
- Validation programmatique post-génération que chaque `citation.quote` apparaît bien mot pour mot dans `fullTranscriptLog` — on s'appuie sur l'instruction de prompt (transcript fourni ligne par ligne avec timestamp à recopier) plutôt que sur une vérification de sous-chaîne après coup. Si des hallucinations de citation sont observées en usage réel, une passe de validation sera envisagée séparément.

## Tests

- **`prompts.test.ts` (ou équivalent pour `final-analysis.ts`)** : `buildFinalAnalysisPrompt` inclut le transcript formaté `[mm:ss] "texte"` ; inclut l'instruction anti-hallucination sur les citations ; gère `jobContext`/`cards`/`transcriptLog` vides sans planter.
- **`session.test.ts`** : adapter `sampleReport` et les assertions au nouveau shape de `CandidateReport` ; vérifier que `generateFinalReport` fusionne correctement les champs calculés (`candidateName` avec fallback "Candidat" si non fourni, `jobTitle` avec fallback, `durationLabel` cohérent avec le temps écoulé simulé) et les champs mockés via `callClaudeJSON`.
- **`session-theme-rollup.test.ts`** : remplacé — nouveau fichier (ou renommé) couvrant `techMatching` : le rapport contient bien une entrée par compétence retournée par le LLM mocké, avec `status`/`citation` bien propagés tels que retournés par le mock (le calcul de comptage n'étant pas testé côté backend puisqu'il est dérivé côté frontend).
- **Frontend** : aucun fichier de test n'existe aujourd'hui dans `apps/web` (vérifié — pas de `*.test.*`/`*.spec.*`) ; cohérent avec le reste du composant, la vérification du nouveau `FinalReportView` se fait manuellement via `pnpm dev`.
