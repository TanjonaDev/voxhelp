import type { JobContext, InsightCard } from "@voxhelp/shared";

export function buildFinalAnalysisPrompt(jobContext?: JobContext, cards?: InsightCard[]): string {
  const contextSection = jobContext
    ? `\nPoste visé : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\n`
    : "";

  const cardsSection =
    cards && cards.length > 0
      ? `\nAnalyses réalisées pendant l'entretien :\n${cards.map((c, i) => `[${i + 1}] ${c.confidence.toUpperCase()} — "${c.signal.label}"\n     → ${c.meaning}`).join("\n")}\n`
      : "\nAucune analyse disponible.\n";

  return `Tu es un assistant de recrutement. Un recruteur RH vient de terminer un entretien technique avec un candidat développeur.${contextSection}${cardsSection}
Génère un bilan final du candidat en JSON strict (sans backticks, sans texte autour) :
{
  "overall": "Bilan global en 2-3 phrases : niveau général, cohérence des réponses, impression d'ensemble",
  "strengths": ["Point fort 1 observé", "Point fort 2", "..."],
  "gaps": ["Lacune ou doute 1", "..."],
  "recommendation": "hire|maybe|pass",
  "recommendationReason": "1 phrase courte expliquant la recommandation"
}

Règles :
- Baseque sur les signaux observés, pas sur des suppositions
- hire = expérience terrain clairement démontrée, cohérent avec le niveau attendu
- maybe = profil intéressant mais incomplet ou niveau incertain
- pass = trop vague, trop théorique, ou clairement sous le niveau attendu
- Si peu d'analyses disponibles, indique-le dans overall et mets recommendation: "maybe"
- strengths : 2-3 éléments max, concrets
- gaps : 1-3 éléments, honnêtes mais bienveillants`;
}
