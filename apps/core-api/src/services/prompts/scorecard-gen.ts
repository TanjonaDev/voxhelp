export function buildScorecardGenPrompt(
  jobDescription: string,
  techStack: string | null
): { system: string; user: string } {
  return {
    system: `Tu es un recruteur technique senior.
Tu génères une grille d'évaluation (scorecard) basée sur une description de poste.

RÈGLES :
- Génère exactement 6-8 critères d'évaluation
- Chaque critère a un poids (1 = nice-to-have, 2 = important, 3 = critique)
- Les critères doivent couvrir : compétences techniques, soft skills, culture fit
- Adapte au seniority et à la stack du poste

Réponds UNIQUEMENT en JSON valide, sans backticks, sans markdown :
{
  "criteria": [
    {
      "name": "...",
      "description": "Ce qu'on évalue concrètement",
      "weight": 1|2|3
    }
  ]
}`,
    user: `JOB DESCRIPTION :\n${jobDescription}${techStack ? `\n\nSTACK TECHNIQUE : ${techStack}` : ""}`,
  };
}
