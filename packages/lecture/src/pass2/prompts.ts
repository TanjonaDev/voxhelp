import type { GlossaryEntry, LectureSection, Reference, TranscriptSegment, UncertainZone } from "../types.js";
import type { PdfAnalysis } from "../pdf/types.js";
import type { Pass2Input } from "./types.js";

export function buildPass2SystemPrompt(): string {
  return `Tu es un rédacteur de cours universitaires. Tu reçois la transcription
automatique brute d'un cours, déjà analysée : un plan de sections, un
glossaire des termes spécialisés, les références citées, et les zones où
la transcription est incertaine. Tu reçois aussi, si disponible, le
contenu structuré d'un support PDF utilisé pendant le cours.

Ton rôle est de RÉÉCRIRE le cours en un document de cours propre et
lisible, fidèle à ce qui a été dit.

RÈGLES DE RÉÉCRITURE :

- Nettoyage fidèle : supprime les hésitations, répétitions et fausses
  pistes, restructure en phrases complètes. Garde le vocabulaire, l'ordre
  des idées et le ton de l'enseignant. N'invente rien, ne réorganise pas
  le déroulé du cours, ne résume pas — réécris.
- Structure le document selon le plan fourni : un titre de niveau 2 (##)
  par section, dans l'ordre, avec le titre donné. Les sections de type
  "digression", "student_question" et "administrative" restent dans le
  document, à leur place, mais leur titre le signale explicitement
  (ex: "## Digression — {titre}").
- Corrige silencieusement dans le texte les termes du glossaire :
  remplace toute variante fautive ("heardVariants") par la forme
  correcte ("term"). Ne signale pas la correction, elle fait partie du
  texte final.
- Pour chaque zone incertaine ("uncertainZones") qui tombe dans une
  section, insère à l'endroit correspondant le marqueur littéral
  [passage incertain — {reason}]. N'invente jamais de texte pour combler
  le trou.
- Si un support PDF est fourni : les blocs de type "citation", "table" et
  "exercise" dont le "anchorTitle" ou le contenu se rapproche du titre
  d'une section doivent être insérés dans cette section, sous forme de
  citation Markdown (précédée de ">"), verbatim, sans reformulation. Les
  blocs "heading" et "paragraph" ne servent QUE de contexte pour recaler
  le vocabulaire et la structure — ne les recopie jamais tels quels dans
  le document.
- Termine le document par deux annexes, dans cet ordre :
  "## Glossaire" (une entrée par terme du glossaire, avec sa définition
  courte si connue) et "## Références citées" (une entrée par référence,
  sous sa forme normalisée si connue, sinon sa citation brute telle
  qu'entendue). Si une référence orale correspond à une citation PDF déjà
  insérée dans le corps du document, ne la liste qu'une fois dans les
  annexes.
- Réponds uniquement par le document Markdown final, sans texte avant ou
  après, sans balises de code englobantes.`;
}

function formatPlan(plan: LectureSection[]): string {
  return plan
    .map((section) => `${section.index}. [${section.type}] ${section.title} (${section.startMs}–${section.endMs}ms) — ${section.oneLineSummary}`)
    .join("\n");
}

function formatGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return "(vide)";
  return glossary
    .map((entry) => {
      const variants = entry.heardVariants.length > 0 ? entry.heardVariants.join(", ") : "aucune";
      const definition = entry.shortDefinition ? ` — ${entry.shortDefinition}` : "";
      return `${entry.term} (variantes entendues : ${variants})${definition}`;
    })
    .join("\n");
}

function formatReferences(references: Reference[]): string {
  if (references.length === 0) return "(vide)";
  return references.map((reference) => `${reference.type} — ${reference.normalized ?? reference.rawCitation}`).join("\n");
}

function formatUncertainZones(zones: UncertainZone[]): string {
  if (zones.length === 0) return "(vide)";
  return zones.map((zone) => `[${zone.startMs}–${zone.endMs}] ${zone.reason} — extrait : "${zone.excerpt}"`).join("\n");
}

function formatPdfBlocks(pdfAnalysis?: PdfAnalysis): string {
  if (!pdfAnalysis || pdfAnalysis.blocks.length === 0) return "(aucun support PDF fourni)";
  return pdfAnalysis.blocks
    .map((block) => {
      const anchor = block.anchorTitle ? `, ancre : "${block.anchorTitle}"` : "";
      const reference = block.reference ? `, réf : ${block.reference}` : "";
      return `[page ${block.page}] (${block.type}${anchor}${reference}) ${block.content}`;
    })
    .join("\n---\n");
}

function formatSegments(transcript: TranscriptSegment[]): string {
  return transcript.map((segment) => `[${segment.startMs}–${segment.endMs}] ${segment.text}`).join("\n");
}

export function buildPass2UserPrompt(input: Pass2Input): string {
  const { course, transcript, plan, glossary, references, uncertainZones, pdfAnalysis } = input;
  return `CONTEXTE DU COURS
Intitulé : ${course.title}
Discipline : ${course.discipline ?? "non précisée"}
Enseignant : ${course.instructor ?? "non précisé"}
Langue : ${course.language}

PLAN DU COURS
${formatPlan(plan)}

GLOSSAIRE
${formatGlossary(glossary)}

RÉFÉRENCES CITÉES
${formatReferences(references)}

ZONES INCERTAINES
${formatUncertainZones(uncertainZones)}

SUPPORT PDF (blocs structurés)
${formatPdfBlocks(pdfAnalysis)}

TRANSCRIPTION BRUTE
Format : [début_ms–fin_ms] texte
${formatSegments(transcript)}

Rédige le document de cours final au format défini.`;
}
