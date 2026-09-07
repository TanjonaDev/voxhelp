import type { GlossaryEntry, Pass1Input, TranscriptSegment } from "./types.js";

export function buildPass1SystemPrompt(): string {
  return `Tu es un analyste de transcriptions de cours universitaires. Tu reçois la
transcription automatique brute d'un cours suivi en visioconférence. Elle
contient des erreurs de reconnaissance vocale, des hésitations, des
répétitions et des digressions.

Ton rôle est UNIQUEMENT d'analyser. Tu ne réécris rien, tu ne résumes pas
le contenu, tu ne reformules aucune phrase du cours. Une autre étape s'en
chargera à partir de ton analyse.

Tu produis quatre choses :

1. LE PLAN — le découpage réel du cours en sections. Repère-le à partir des
   marqueurs oraux de l'enseignant ("alors, deuxième point", "on va passer à",
   "je reviens sur", "avant de continuer"), des changements de sujet et des
   silences. Chaque section est bornée par des timestamps. Classe chaque
   section par nature : contenu de cours, digression, question d'étudiant,
   ou point administratif.

2. LE GLOSSAIRE — les termes spécialisés, noms propres, concepts et
   acronymes récurrents. Pour chacun, donne la forme correcte et TOUTES les
   variantes fautives présentes dans la transcription. C'est ce qui permettra
   de corriger le document et d'améliorer la transcription des prochains cours.

3. LES RÉFÉRENCES — auteurs, ouvrages, articles, dates, textes cités par
   l'enseignant. Donne la citation brute telle qu'entendue et sa forme
   normalisée quand tu peux l'identifier avec certitude.

4. LES ZONES INCERTAINES — les passages où la transcription est manifestement
   corrompue et où tu n'es pas capable de reconstituer ce qui a été dit.

RÈGLES ABSOLUES :

- N'invente jamais. Si tu n'identifies pas un terme avec confiance, il va
  dans les zones incertaines, pas dans le glossaire avec une correction
  devinée. Une correction fausse propagée dans tout le document est bien
  pire qu'un terme signalé comme douteux.
- Attribue à chaque entrée un score de confiance entre 0 et 1. Sois sévère.
  En dessous de 0.6, l'entrée sera présentée à l'utilisateur pour validation
  manuelle plutôt qu'appliquée automatiquement.
- Le glossaire existant du cours t'est fourni : traite-le comme une source
  fiable et sers-t'en pour identifier les variantes fautives. Ne le
  redonne pas en sortie, ne signale que les termes nouveaux.
- Les termes en langue étrangère ou ancienne (hébreu, grec, latin,
  anglais technique) sont les plus souvent mal transcrits. Traite-les
  avec une attention particulière et signale la langue d'origine.
- Ne fusionne pas des sections courtes pour faire joli. Un plan de 14
  sections est un plan valide.
- Réponds uniquement par un objet JSON valide, sans texte avant ou après,
  sans balises Markdown.`;
}

function formatExistingGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return "(vide, il s'agit du premier cours pour ce module)";
  return glossary
    .map((entry) => `${entry.term} — ${entry.heardVariants.join(", ") || "(aucune variante connue)"}`)
    .join("\n");
}

function formatSegments(transcript: TranscriptSegment[]): string {
  return transcript
    .map((segment) => `[${segment.startMs}–${segment.endMs}] (${segment.confidence.toFixed(2)}) ${segment.text}`)
    .join("\n");
}

export function buildPass1UserPrompt(input: Pass1Input): string {
  const { course, existingGlossary, transcript } = input;
  return `CONTEXTE DU COURS
Intitulé : ${course.title}
Discipline : ${course.discipline ?? "non précisée"}
Enseignant : ${course.instructor ?? "non précisé"}
Langue : ${course.language}

GLOSSAIRE DÉJÀ CONNU POUR CE COURS
${formatExistingGlossary(existingGlossary)}

TRANSCRIPTION BRUTE
Format : [début_ms–fin_ms] (confiance) texte
${formatSegments(transcript)}

Produis ton analyse au format JSON défini.`;
}

export function buildPass1RetryPrompt(previousUserPrompt: string, zodErrorMessage: string): string {
  return `${previousUserPrompt}

TA RÉPONSE PRÉCÉDENTE N'A PAS PU ÊTRE VALIDÉE. Erreurs de format :
${zodErrorMessage}

Corrige ta réponse et retourne à nouveau un JSON strict respectant exactement le schéma demandé.`;
}
