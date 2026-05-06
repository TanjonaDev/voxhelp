export function buildScoringPrompt(
  transcript: { text: string; speaker: string }[],
  criteria: { id: string; name: string; description: string | null; weight: number }[],
  questions: { text: string; expectedAnswer: string | null }[]
): { system: string; user: string } {
  const formattedTranscript = transcript
    .map((t) => `[${t.speaker}] ${t.text}`)
    .join("\n");

  const formattedCriteria = criteria
    .map((c) => `- ${c.name} (poids: ${c.weight})${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  return {
    system: `Tu es un recruteur technique senior. Tu évalues un candidat après un entretien.

Score chaque critère de 1 à 5 :
1 = Très insuffisant
2 = Insuffisant
3 = Acceptable
4 = Bon
5 = Excellent

Donne aussi une recommandation globale et un score global.

Réponds UNIQUEMENT en JSON valide, sans backticks, sans markdown :
{
  "scores": [
    {
      "criterionId": "...",
      "score": 1-5,
      "notes": "Justification en 1-2 phrases"
    }
  ],
  "overallScore": 1-5,
  "recommendation": "STRONG_HIRE|HIRE|LEAN_HIRE|LEAN_NO_HIRE|NO_HIRE|STRONG_NO_HIRE"
}`,
    user: `CRITÈRES D'ÉVALUATION :\n${formattedCriteria}\n\nTRANSCRIPTION :\n${formattedTranscript}`,
  };
}
