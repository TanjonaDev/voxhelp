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
