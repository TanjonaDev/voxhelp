import type { JobContext, Insight } from "@voxhelp/shared";

export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousRelances?: string[],
  previousCards?: Insight[]
): string {
  const contextSection = jobContext
    ? `\nContexte du poste : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\nCalibre la catégorie et le niveau de confiance en tenant compte de ces attentes.\n`
    : "";

  const historySection =
    history && history.length > 0
      ? `\nCe qui a été dit avant dans cette session :\n${history.map((t, i) => `[${i + 1}] "${t}"`).join("\n")}\n`
      : "";

  const relancesSection =
    previousRelances && previousRelances.length > 0
      ? `\nQuestions de relance déjà suggérées (NE PAS répéter ni reformuler) :\n${previousRelances.map((q, i) => `[${i + 1}] ${q}`).join("\n")}\n`
      : "";

  const recentCards = previousCards?.slice(-5);
  const cardsSection =
    recentCards && recentCards.length > 0
      ? `\nAnalyses déjà effectuées dans cette session (construis sur ces observations) :\n${recentCards.map((c, i) => `[${i + 1}] ${c.confidence.toUpperCase()} [${c.cat}] — "${c.title}" — ${c.body}`).join("\n")}\n`
      : "";

  return `Tu assistes un recruteur RH (non-technique) pendant un entretien avec un candidat développeur.${contextSection}${historySection}${cardsSection}${relancesSection}
Ton rôle : aider le recruteur à vérifier si le candidat a une vraie expérience pratique, pas juste des connaissances théoriques.

Produis une analyse en JSON strict (sans backticks, sans texte autour) :
{
  "cat": "translation|jargon|strength|risk|level",
  "confidence": "confirmed|partial|low",
  "title": "Titre court de l'insight, max 80 caractères",
  "body": "Explication en langage clair pour un recruteur non-technique, 1-3 phrases.",
  "relance": "Une question courte que le recruteur peut poser mot pour mot, ou null si non pertinent",
  "level": 0.0,
  "levelLabel": "Junior|Intermédiaire|Senior|Lead"
}

Règles catégories :
- translation = le candidat résume son profil ou son contexte → traduis en clair pour le recruteur
- jargon = terme technique utilisé → explique ce que ça veut dire concrètement
- strength = point fort démontré par une action ou un résultat concret
- risk = réponse vague, incohérente, ou lacune à creuser
- level = évaluation du niveau technique global observable sur cet extrait

Règles level et levelLabel : uniquement si cat = "level". level = 0.0 à 1.0 (0=Junior, 0.5=Intermédiaire, 0.75=Senior, 1.0=Lead). Omets ces champs si cat ≠ "level".

Règles confidence :
- confirmed = expérience terrain évidente et cohérente
- partial = a utilisé la techno mais de façon limitée ou ancienne
- low = impossible de juger (réponse trop courte, coupée, ou trop générale)

Règles relance :
- Viser à confirmer l'expérience réelle (durée, projet, rôle, résultat, architecture)
- Rester au niveau architecture ou organisation du code — pas descendre dans les détails d'implémentation
- Être courte et naturelle, posable mot pour mot
- null si cat = "translation" ou si une relance similaire a déjà été posée`;
}
