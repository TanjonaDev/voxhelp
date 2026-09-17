import type { CourseContext, LectureSection } from "../types.js";
import type { CondenseMode } from "./types.js";

function formatPlan(plan: LectureSection[]): string {
  return plan.map((section) => `${section.index}. ${section.title}`).join("\n");
}

export function buildCondenseSystemPrompt(mode: CondenseMode): string {
  if (mode === "synthesis") {
    return `Tu condenses un cours universitaire déjà réécrit en une synthèse fidèle et
courte, destinée à une relecture rapide avant un examen — sans perdre le fil du
raisonnement.

Pour chaque section du plan fourni, dans l'ordre, produis un titre de niveau 2
(##) reprenant EXACTEMENT le titre de la section, suivi d'un paragraphe court
(3 à 6 phrases) qui condense l'essentiel : la thèse défendue, les définitions
clés, l'articulation des idées. Préserve verbatim toute citation centrale à
l'argumentation (entre guillemets), mais ne recopie pas les exemples
secondaires ni les digressions.

RÈGLES ABSOLUES :

- Ne condense que ce qui est dans le document fourni. N'invente rien, ne
  déborde pas du contenu réel du cours.
- Une section administrative ou une digression peut être résumée en une
  seule phrase, voire omise si elle n'apporte rien au fond.
- Réponds uniquement par le document Markdown condensé, sans texte avant ou
  après, sans balises de code englobantes.`;
  }

  return `Tu transformes un cours universitaire déjà réécrit en fiche de révision
dense, pensée pour une relecture très rapide avant un examen — pas de prose,
du repère.

Pour chaque section du plan fourni, dans l'ordre, produis un titre de niveau
2 (##) reprenant EXACTEMENT le titre de la section, suivi d'une liste à
puces (une ligne par puce, préfixée par "- ") couvrant : définitions clés,
distinctions importantes, arguments principaux, citations essentielles
(entre guillemets, verbatim). Chaque puce est courte et autonome (une idée
par puce).

RÈGLES ABSOLUES :

- Ne couvre que ce qui est dans le document fourni. N'invente rien.
- Une section administrative ou une digression peut se réduire à une seule
  puce, voire être omise si elle n'apporte rien au fond.
- Réponds uniquement par le document Markdown (titres + puces), sans texte
  avant ou après, sans balises de code englobantes.`;
}

export function buildCondenseUserPrompt(course: CourseContext, plan: LectureSection[], document: string): string {
  return `COURS : ${course.title}${course.discipline ? ` — ${course.discipline}` : ""}

PLAN DU COURS
${formatPlan(plan)}

DOCUMENT RÉÉCRIT (source à condenser)
${document}

Produis le document condensé au format défini, dans l'ordre du plan.`;
}
