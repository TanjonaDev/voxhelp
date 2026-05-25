export function buildReportPrompt(
  jobDescription: string,
  transcriptEntries: { text: string; timestamp: number }[],
  scorecard: { id: string; name: string; description: string; weight: number }[]
): { system: string; user: string } {
  const transcript = transcriptEntries.map((t) => t.text).join("\n");
  const criteria = scorecard
    .map((c) => `- ${c.name} (poids ${c.weight}): ${c.description}`)
    .join("\n");

  return {
    system: `Tu es un expert en évaluation de recrutement technique.
Tu analyses la transcription d'un entretien et tu génères un rapport structuré.

Score chaque critère de 1 à 5. Donne une recommandation globale.

Réponds UNIQUEMENT en JSON valide, sans backticks :
{
  "summary": "Résumé de l'entretien en 3-4 phrases",
  "strengths": ["Point fort 1", "Point fort 2"],
  "weaknesses": ["Point faible 1"],
  "redFlags": ["Red flag 1"],
  "recommendation": "STRONG_HIRE|HIRE|LEAN_HIRE|LEAN_NO_HIRE|NO_HIRE",
  "overallScore": 3,
  "scoredCriteria": [
    {
      "id": "id du critère",
      "name": "nom",
      "description": "description",
      "weight": 1,
      "score": 3,
      "notes": "Justification en 1 phrase"
    }
  ]
}`,
    user: `FICHE DE POSTE :\n${jobDescription}\n\nCRITÈRES D'ÉVALUATION :\n${criteria}\n\nTRANSCRIPTION :\n${transcript || "(aucune transcription disponible)"}`,
  };
}
