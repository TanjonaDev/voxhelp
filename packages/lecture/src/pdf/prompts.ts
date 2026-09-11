import type { PdfPage } from "./types.js";

export function buildPdfAnalysisSystemPrompt(): string {
  return `Tu es un analyste de supports de cours (PDF de slides ou de polycopié) utilisés
en complément d'un cours universitaire enregistré.

Ton rôle est UNIQUEMENT de segmenter et classer le contenu du PDF en blocs.
Tu ne résumes rien, tu ne reformules aucun passage, tu ne combles aucune lacune.

Pour chaque bloc de contenu identifiable dans le texte extrait, donne :
- la page où il se trouve
- son type :
  - "heading" : titre de section ou de diapositive
  - "paragraph" : texte explicatif courant
  - "citation" : citation de texte source (Écritures, œuvre citée verbatim),
    à préserver mot pour mot avec sa référence si identifiable
  - "table" : contenu tabulaire, à préserver tel quel
  - "exercise" : question(s) ou exercice destiné aux étudiants
- pour un bloc "heading" uniquement : le titre détecté verbatim dans
  "anchorTitle" (il servira d'ancre pour rapprocher ce point du plan du
  cours dans une étape ultérieure)
- pour un bloc "citation" uniquement, si identifiable avec certitude : la
  référence normalisée dans "reference" (ex: "Romains 1,1-4")
- le contenu du bloc verbatim dans "content" — pour "citation", "table" et
  "exercise", recopie fidèlement, sans reformuler ni résumer

RÈGLES ABSOLUES :

- Ne reformule jamais un bloc "citation", "table" ou "exercise". La fidélité
  du contenu source prime sur tout.
- N'invente jamais de "reference" si tu ne peux pas l'identifier avec
  certitude — omets le champ plutôt que de deviner.
- Un tableau complexe (comparatif, multi-colonnes) reste un seul bloc
  "table", même s'il est long : ne le découpe pas artificiellement en
  plusieurs blocs.
- Réponds uniquement par un objet JSON valide, sans texte avant ou après,
  sans balises Markdown, ayant EXACTEMENT cette forme :

{
  "sourceFilename": "nom du fichier",
  "blocks": [
    {
      "page": 1,
      "type": "heading | paragraph | citation | table | exercise",
      "anchorTitle": "titre détecté, uniquement si type = heading",
      "content": "contenu du bloc",
      "reference": "référence normalisée, uniquement si type = citation et identifiable"
    }
  ]
}

Les champs "anchorTitle" et "reference" sont à omettre entièrement (pas de
null, pas de chaîne vide) quand ils ne s'appliquent pas.`;
}

function formatPages(pages: PdfPage[]): string {
  return pages.map((page) => `[page ${page.page}] ${page.text}`).join("\n\n");
}

export function buildPdfAnalysisUserPrompt(sourceFilename: string, pages: PdfPage[]): string {
  return `FICHIER : ${sourceFilename}

CONTENU EXTRAIT PAR PAGE
${formatPages(pages)}

Produis ta segmentation au format JSON défini.`;
}

export function buildPdfAnalysisRetryPrompt(previousUserPrompt: string, zodErrorMessage: string): string {
  return `${previousUserPrompt}

TA RÉPONSE PRÉCÉDENTE N'A PAS PU ÊTRE VALIDÉE. Erreurs de format :
${zodErrorMessage}

Corrige ta réponse et retourne à nouveau un JSON strict respectant exactement le schéma demandé.`;
}
