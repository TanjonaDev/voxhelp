import type { GlossaryEntry, LectureSection, Reference, TranscriptSegment, UncertainZone } from "../types.js";
import type { PdfAnalysis } from "../pdf/types.js";
import type { Pass2Input } from "./types.js";

export function buildPass2SystemPrompt(): string {
  return `Tu es un rédacteur de cours universitaires. Tu reçois la transcription
automatique brute d'un cours, déjà analysée : un plan de sections, un
glossaire des termes spécialisés, les références citées, et les zones où
la transcription est incertaine. Tu reçois aussi, si disponible, le
contenu structuré d'un ou plusieurs supports PDF utilisés pendant le
cours (slides, polycopié), chacun identifié par son nom de fichier.

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
- Si un ou plusieurs supports PDF sont fournis : les blocs de type "citation", "table" et
  "exercise" dont le "anchorTitle" ou le contenu se rapproche du titre
  d'une section doivent être insérés dans cette section, sous forme de
  citation Markdown (précédée de ">"), verbatim, sans reformulation. Les
  blocs "heading" et "paragraph" ne servent QUE de contexte pour recaler
  le vocabulaire et la structure — ne les recopie jamais tels quels dans
  le document.
- Ne génère PAS d'annexe "Glossaire" ou "Références citées" : elles sont
  ajoutées séparément après ta réponse, à partir des données structurées.
  Rédige uniquement le corps du cours.
- Réponds uniquement par le corps du document Markdown, sans texte avant ou
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

function formatPdfBlocks(pdfAnalyses?: PdfAnalysis[]): string {
  const nonEmpty = (pdfAnalyses ?? []).filter((analysis) => analysis.blocks.length > 0);
  if (nonEmpty.length === 0) return "(aucun support PDF fourni)";
  return nonEmpty
    .map((analysis) =>
      analysis.blocks
        .map((block) => {
          const anchor = block.anchorTitle ? `, ancre : "${block.anchorTitle}"` : "";
          const reference = block.reference ? `, réf : ${block.reference}` : "";
          return `[${analysis.sourceFilename}, page ${block.page}] (${block.type}${anchor}${reference}) ${block.content}`;
        })
        .join("\n---\n")
    )
    .join("\n---\n");
}

function formatSegments(transcript: TranscriptSegment[]): string {
  return transcript.map((segment) => `[${segment.startMs}–${segment.endMs}] ${segment.text}`).join("\n");
}

/**
 * Deterministic replacement for the two annexes the LLM used to generate
 * itself: same content rules (one entry per glossary term with its short
 * definition when known, one entry per reference in its normalized form or
 * else the raw citation), produced straight from the structured data instead
 * of asking the model to restate it — cheaper and exactly reproducible.
 * A reference whose normalized form matches a PDF citation block already
 * quoted in the body (via `reference`) is skipped here, so it isn't listed
 * twice.
 */
export function buildAnnexesMarkdown(
  glossary: GlossaryEntry[],
  references: Reference[],
  pdfAnalyses?: PdfAnalysis[]
): string {
  const citedInBody = new Set(
    (pdfAnalyses ?? [])
      .flatMap((analysis) => analysis.blocks)
      .map((block) => block.reference)
      .filter((reference): reference is string => Boolean(reference))
  );

  const glossaryLines =
    glossary.length === 0
      ? ["(aucun terme)"]
      : glossary.map((entry) =>
          entry.shortDefinition ? `- **${entry.term}** — ${entry.shortDefinition}` : `- **${entry.term}**`
        );

  const keptReferences = references.filter((reference) => {
    const normalized = reference.normalized;
    return !normalized || !citedInBody.has(normalized);
  });
  const referenceLines =
    keptReferences.length === 0
      ? ["(aucune référence)"]
      : keptReferences.map((reference) => `- ${reference.normalized ?? reference.rawCitation}`);

  return ["\n\n## Glossaire\n", ...glossaryLines, "\n## Références citées\n", ...referenceLines].join("\n");
}

export function buildPass2UserPrompt(input: Pass2Input): string {
  const { course, transcript, plan, glossary, references, uncertainZones, pdfAnalyses } = input;
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

SUPPORT PDF (blocs structurés, un ou plusieurs documents)
${formatPdfBlocks(pdfAnalyses)}

TRANSCRIPTION BRUTE
Format : [début_ms–fin_ms] texte
${formatSegments(transcript)}

Rédige le document de cours final au format défini.`;
}
