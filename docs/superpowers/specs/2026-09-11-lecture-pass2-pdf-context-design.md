# Passe 2 (réécriture) + ingestion PDF de support — verticale Cours

## Contexte

`packages/lecture` implémente aujourd'hui la **passe 1** de la verticale "cours" (transcription et mise au propre de cours universitaires) : analyse d'un transcript brut en `plan` (sections), `glossary`, `references`, `uncertainZones`. Voir `voxhelp-verticale-cours-passe1.md` à la racine du repo pour le brief d'origine et `packages/lecture/src/{types,schemas,prompts,postprocess,windowing,analyze}.ts` pour l'implémentation.

Ce document spécifie la **passe 2** : la réécriture du transcript brut en document de cours structuré, ainsi que l'ingestion d'un PDF de support de cours (slides) comme contexte de cette réécriture.

**Scope confirmé** (voir mémoire `project-cours-verticale`) :
- Post-hoc uniquement — pas de mode live pour cette verticale à ce stade.
- Le PDF sert de **contexte de réécriture pour la passe 2**, pas de keyword boosting Deepgram (qui reste alimenté par le glossaire persistant du `Course`, mécanisme déjà couvert par la passe 1 — hors scope ici).

## Vue d'ensemble du pipeline

```
Transcript brut + Plan (passe 1) + Glossaire consolidé + Références + Zones incertaines
                              +
PDF support de cours (optionnel)
  → unpdf (extraction texte par page)
  → [PDF-ANALYSE] LLM : segmentation en blocs typés
    (titre / paragraphe / citation-référence / tableau / exercice)
    + ancrage approximatif sur les titres du plan
                              ↓
                    [PASSE 2] Réécriture
  Un seul appel LLM (generateFromPrompt, streaming Markdown) recevant
  l'ensemble des entrées ci-dessus
                              ↓
         Document Markdown final (corps structuré selon le plan
         + marqueurs [passage incertain] + annexes glossaire/références)
```

Le PDF est optionnel : un cours sans support fonctionne, la passe 2 s'appuie alors uniquement sur transcript + plan + glossaire + références.

## 1. Ingestion PDF

### 1.1 Extraction brute

Réutilise `unpdf` (déjà utilisé pour le parsing CV dans `packages/recruit/src/cv-parser.ts`) : extraction du texte par page, sans mise en forme.

### 1.2 Segmentation typée (nouveau)

Un appel LLM (`callClaudeJSON<PdfAnalysis>`, `temperature: 0`, retry unique sur erreur Zod — même politique que la passe 1) transforme le texte brut par page en blocs typés :

```ts
type PdfBlockType = "heading" | "paragraph" | "citation" | "table" | "exercise";

interface PdfBlock {
  page: number;
  type: PdfBlockType;
  anchorTitle?: string;   // titre de section le plus proche, seulement pour "heading"
  content: string;        // verbatim pour citation/table/exercise
  reference?: string;     // ex: "Romains 1,1-4" — seulement si type = "citation"
}

interface PdfAnalysis {
  sourceFilename: string;
  blocks: PdfBlock[];
}
```

Règles du prompt (même esprit que la passe 1 — voir §3.1 du brief passe 1) :
- Ne rien reformuler : un bloc `citation`/`table`/`exercise` est recopié verbatim, jamais paraphrasé.
- Un `heading` détecté devient une ancre potentielle, rapprochée des titres de section du plan par similarité de titre en passe 2 — signal, pas contrainte dure.
- Sortie validée par Zod, un seul retry sur échec de parsing, puis échec explicite du job (pas de retry en boucle).

Fichiers : `packages/lecture/src/pdf/analyze-pdf.ts`, `packages/lecture/src/pdf/schemas.ts`, `packages/lecture/src/pdf/prompts.ts` — module séparé du code de la passe 1 existante.

## 2. Passe 2 — réécriture

### 2.1 Entrées

```ts
interface Pass2Input {
  transcript: TranscriptSegment[];
  course: CourseContext;
  plan: LectureSection[];
  glossary: GlossaryEntry[];
  references: Reference[];
  uncertainZones: UncertainZone[];
  pdfAnalysis?: PdfAnalysis;
}
```

Traitement en **un seul appel LLM** pour tout le document (pas de découpage section par section) : le contexte (~25-30k tokens pour 90-120 min de cours + PDF) tient largement dans la fenêtre de Claude Sonnet, et ça garantit la cohérence globale nativement sans mécanisme de "contexte glissant" entre appels.

Pour les cours dépassant ~2h30 (déjà découpés en fenêtres par la passe 1, voir §3.5 du brief passe 1), la passe 2 reste également mono-appel : le plan fusionné et le glossaire consolidé produits par la passe 1 constituent l'entrée unique, indépendamment du découpage interne qu'a nécessité la passe 1.

### 2.2 Principes de réécriture (prompt système)

- Rôle : rédacteur, pas résumeur. **Nettoyage fidèle** : suppression des hésitations/répétitions/redites, restructuration en phrases complètes, conservation du vocabulaire, de l'ordre des idées et du ton du prof. Pas de réorganisation du déroulé, pas d'ajout de contenu non dit.
- Le plan de sections (passe 1) structure les titres du document : un `##` par `LectureSection`, dans l'ordre, y compris les sections `digression`/`student_question`/`administrative` (marquées comme telles, pas supprimées).
- Le glossaire corrige silencieusement les termes mal transcrits (remplace les `heardVariants` identifiées par la forme correcte `term` dans le texte final) — la correction fait partie du produit, elle n'est pas signalée inline.
- Zones incertaines → marqueur inline `[passage incertain — {reason}]` à l'endroit concerné. Jamais de texte deviné pour combler le trou.
- Blocs PDF `citation`/`table`/`exercise` ancrés sur une section → insérés **verbatim** dans cette section, sous forme de bloc cité Markdown (`>` ou bloc de code selon le type), jamais fondus dans la prose réécrite.
- Blocs PDF `paragraph`/`heading` → contexte silencieux uniquement (vocabulaire, structure), jamais recopiés tels quels dans la sortie.
- Références (passe 1) enrichissent l'annexe finale ; si une référence orale désigne la même chose qu'une citation PDF déjà insérée dans le corps, éviter le doublon en annexe (mentionner une fois, avec renvoi implicite).

### 2.3 Sortie

Markdown en streaming via `generateFromPrompt` (mécanisme existant, réutilisé tel quel — cohérent avec la nature "rédaction" de la tâche, par opposition à l'extraction structurée de la passe 1) :

```
# {course.title}

## {Section 1 title}
{texte réécrit...}
> {citation PDF verbatim si ancrée ici}

## {Section 2 title}
...

---
## Glossaire
- **{term}** — {shortDefinition si connue}

## Références citées
- {reference normalisée ou rawCitation}
```

### 2.4 Modèle et paramètres

- `claude-sonnet-4-6`.
- Température `0.3` : assez pour une reformulation naturelle, assez bas pour rester proche du contenu réel (contrairement à la passe 1 en `temperature: 0`, qui est une tâche d'extraction pure).
- Pas de retry automatique sur le texte streamé : en cas d'échec réseau ou d'erreur du provider, le job échoue explicitement (cohérente avec la politique "pas de retry en boucle" déjà appliquée en passe 1).

## 3. Intégration backend

Deux nouveaux endpoints, sur le modèle de `/api/lecture/analyze-pass1` (`apps/backend/src/routes.ts`) :

- `POST /api/lecture/analyze-pdf` — upload PDF (multipart, comme le parsing CV existant dans `packages/recruit`), retourne `PdfAnalysis` en JSON. Permet un affichage/validation éventuelle côté frontend avant de lancer la passe 2.
- `POST /api/lecture/rewrite-pass2` — reçoit `Pass2Input` (JSON), retourne le Markdown en streaming HTTP (SSE ou chunked, à trancher en plan d'implémentation selon ce que `generateFromPrompt` expose déjà pour le live-assist WebSocket vs un usage REST).

Toujours **stateless** : pas de persistance `Course`/`Lecture` en base — cohérent avec le principe actuel du projet ("demo track, tout en mémoire", voir CLAUDE.md).

## 4. Tests

Même approche que l'existant (`packages/lecture/src/__tests__/`) :
- `pdf/analyze-pdf.test.ts` : construction du prompt, parsing/validation Zod, gestion du retry unique.
- `pass2.test.ts` (ou `rewrite.test.ts`) : construction du prompt de réécriture (vérifier que plan/glossaire/zones incertaines/blocs PDF sont bien injectés et correctement discriminés selon leur type).
- Pas de vérité terrain automatisée sur le texte streamé généré (comme pour le live-assist existant) — à couvrir plus tard par les smoke tests réels (`test:smoke`) si besoin, sur le modèle de `project-llm-smoke-tests`.

## Hors périmètre

- Mode live pour cette verticale.
- Persistance `Course`/`Lecture`/`PdfAnalysis` en base de données.
- Export PDF du document final.
- Alignement strict PDF ↔ audio (l'ancrage par titre est un signal, pas un alignement garanti).
- Gestion de plusieurs PDF par cours (un seul support par cours dans cette itération).
