export function buildSummaryPrompt(
  transcript: { text: string; speaker: string }[],
  jobDescription: string | null,
  questions: { text: string; expectedAnswer: string | null }[]
): { system: string; user: string } {
  const formattedTranscript = transcript
    .map((t) => `[${t.speaker}] ${t.text}`)
    .join("\n");

  return {
    system: `Tu es un recruteur technique senior. Tu analyses un entretien terminé.

Génère un rapport structuré de l'entretien.

Réponds UNIQUEMENT en JSON valide, sans backticks, sans markdown :
{
  "summary": "Résumé global de l'entretien en 3-4 phrases",
  "strengths": ["Point fort 1", "Point fort 2", ...],
  "weaknesses": ["Point faible 1", ...],
  "redFlags": ["Red flag 1", ...],
  "keyTopics": ["Sujet 1", "Sujet 2", ...],
  "followUpActions": ["Action 1", ...]
}`,
    user: `TRANSCRIPTION DE L'ENTRETIEN :\n${formattedTranscript}${jobDescription ? `\n\nJOB DESCRIPTION :\n${jobDescription}` : ""}`,
  };
}
