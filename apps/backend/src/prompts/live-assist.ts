import type { JobContext, Insight } from "@voxhelp/shared";

const ALL_ANGLES = ["contexte", "ownership", "impact"] as const;
const ANGLE_DEFINITIONS: Record<(typeof ALL_ANGLES)[number], string> = {
  contexte: "architecture ou projet global (\"Décrivez-moi l'architecture globale\")",
  ownership: "rôle personnel du candidat dans ce choix/projet (\"Quel était votre rôle ?\")",
  impact: "problème résolu ou résultat concret (\"Quel problème ça résolvait ?\")",
};
const THEME_CARD_COUNT_FALLBACK = 5;

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

function buildThemeAngleSection(
  lastTheme: string | null | undefined,
  coveredAngles: string[],
  themeCardCount: number
): string {
  if (!lastTheme) return "";

  const remaining = ALL_ANGLES.filter((a) => !coveredAngles.includes(a));
  const forcePivot = remaining.length === 0 || themeCardCount >= THEME_CARD_COUNT_FALLBACK;

  let section = `\nThème de la dernière card : « ${lastTheme} ». Si le nouveau segment reste sur ce thème, réutilise EXACTEMENT ce slug pour le theme-tag.\n`;

  if (forcePivot) {
    section += `\nATTENTION — ce thème a déjà été couvert par ${themeCardCount} cards consécutives. Si le nouveau segment reste sur ce même sujet, ta relance DOIT changer complètement de sujet — pas un autre détail technique de « ${lastTheme} », mais un sujet vraiment différent : méthodologie de travail, parcours professionnel, soft skills, un autre projet, gestion d'équipe, préférences technologiques hors de ce sujet, etc.\n`;
  } else {
    section += `\nAngles déjà couverts sur ce thème : ${coveredAngles.length > 0 ? coveredAngles.join(", ") : "aucun"}.\nAngles restants : ${remaining.join(", ")} — privilégie un de ces angles pour ta prochaine relance :\n${remaining.map((a) => `- ${a} : ${ANGLE_DEFINITIONS[a]}`).join("\n")}\n\nNe pose JAMAIS deux relances techniques de suite sur le même outil (ex : nombre de topics Kafka, puis throughput, puis consumer lag). Le but n'est pas de comprendre l'outil en détail, c'est de comprendre la personne — ses décisions, son rôle, son impact.\nTague ta relance avec le 4ème bracket [contexte|ownership|impact|none].\n`;
  }
  return section;
}

export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[],
  lastTheme?: string | null,
  coveredAngles?: string[],
  themeCardCount?: number
): string {
  const jobCtx = buildJobContext(jobContext);
  const convHistory = buildConversationHistory(history ?? []);
  const prevCards = buildPreviousCards(previousCards ?? []);
  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions déjà posées (ne pas répéter) :\n${previousRelances.map((q) => `- ${q}`).join("\n")}\n`
      : "";
  const themeSection = buildThemeAngleSection(lastTheme, coveredAngles ?? [], themeCardCount ?? 0);

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
[catégorie] [evidence] [theme-slug] [angle]
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

angle : contexte | ownership | impact | none — l'angle de TA relance suggérée. none si pas de relance (cat = translation) ou si la relance ne correspond à aucun des 3 angles.

Relance : naturelle et bienveillante, jamais accusatrice.
Pas de relance si cat = translation ou si le sujet est épuisé.`;
}
