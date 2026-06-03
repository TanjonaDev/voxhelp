import type { JobContext } from "@voxhelp/shared";

export function buildLiveAssistPrompt(jobContext?: JobContext, history?: string[], previousQuestions?: string[]): string {
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

  return `Tu es un assistant IA pour entretien technique. Tu reçois un extrait de transcript d'entretien.${contextSection}${historySection}${questionsSection}
Produis une analyse structurée en JSON strict (sans backticks, sans texte autour) :
{
  "meaning": "Ce que ça veut dire pour un recruteur non-tech (1-2 phrases)",
  "signal": {
    "label": "Signal observé (1 phrase courte)",
    "type": "positive|weak|dig"
  },
  "followUp": "Une question concrète de relance pour le recruteur",
  "confidence": "confirmed|partial|vague"
}
Règles :
- positive = maîtrise claire et articulée
- weak = réponse vague, superficielle ou incorrecte
- dig = sujet prometteur mais incomplet, mérite approfondissement
- confirmed = le candidat démontre une vraie expérience
- partial = connaissance théorique, expérience limitée
- vague = difficile à évaluer, réponse ambiguë
- Si le transcript semble incomplet ou coupé mid-phrase : confidence "vague", followUp question ouverte
- followUp doit progresser dans la conversation — ne jamais demander ce qui vient d'être expliqué ni reformuler une question déjà posée`;
}
