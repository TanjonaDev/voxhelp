import type { JobContext, InsightCard } from "@voxhelp/shared";

export function buildLiveAssistPrompt(
  jobContext?: JobContext,
  history?: string[],
  previousQuestions?: string[],
  previousCards?: InsightCard[]
): string {
  const contextSection = jobContext
    ? `\nContexte du poste : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\nCalibre ton signal et ton niveau de confiance en tenant compte de ces attentes.\n`
    : "";

  const historySection =
    history && history.length > 0
      ? `\nCe qui a été dit avant dans cette session :\n${history.map((t, i) => `[${i + 1}] "${t}"`).join("\n")}\n`
      : "";

  const questionsSection =
    previousQuestions && previousQuestions.length > 0
      ? `\nQuestions déjà posées (NE PAS répéter ni reformuler) :\n${previousQuestions.map((q, i) => `[${i + 1}] ${q}`).join("\n")}\n`
      : "";

  const recentCards = previousCards?.slice(-5);
  const cardsSection =
    recentCards && recentCards.length > 0
      ? `\nAnalyses déjà effectuées dans cette session (construis sur ces observations, cherche des patterns) :\n${recentCards.map((c, i) => `[${i + 1}] ${c.confidence.toUpperCase()} — "${c.signal.label}" — ${c.meaning}`).join("\n")}\n`
      : "";

  return `Tu assistes un recruteur RH (non-technique) pendant un entretien avec un candidat développeur.${contextSection}${historySection}${cardsSection}${questionsSection}
Ton rôle : aider le recruteur à vérifier si le candidat a une vraie expérience pratique, pas juste des connaissances théoriques.

Produis une analyse en JSON strict (sans backticks, sans texte autour) :
{
  "meaning": "En 1 phrase simple : est-ce que le candidat montre une vraie expérience ou reste vague ?",
  "signal": {
    "label": "Signal en 5-8 mots cohérent avec confidence (ex: 'Expérience terrain solide' si confirmed, 'Réponse floue, à creuser' si vague)"
  },
  "followUp": "Une question simple que le recruteur peut poser mot pour mot, orientée expérience concrète",
  "confidence": "confirmed|partial|vague"
}
Règles confidence :
- confirmed = expérience terrain évidente
- partial = a utilisé la techno mais de façon limitée ou ancienne
- vague = impossible de juger (réponse trop courte, coupée, ou trop générale)

Règles followUp — la question doit :
- Viser à confirmer l'expérience réelle (durée, projet, rôle, résultat, architecture)
- Rester au niveau architecture ou organisation du code — pas descendre dans les détails d'implémentation
- Être courte et naturelle
- Ne pas répéter une question déjà posée
- Niveau OK : "Quelle architecture vous avez utilisée ?" / "Comment vous avez organisé le projet ?" / "C'était dans quel contexte ?" / "Vous avez géré de la performance ?"
- Trop technique : "Comment vous gérez le retry dans les appels API ?" / "Quelle stratégie de cache ?" / "Expliquez le mécanisme interne de X"`;

}
