import type { JobContext } from "@voxhelp/shared";

export function buildLiveAssistPrompt(jobContext?: JobContext): string {
  const contextSection = jobContext
    ? `\nContexte du poste : ${jobContext.title} — niveau ${jobContext.level} — stack attendue : ${jobContext.stack}\nCalibre ton signal et ton niveau de confiance en tenant compte de ces attentes.\n`
    : "";

  return `Tu es un assistant IA pour entretien technique. Tu reçois un extrait de transcript d'entretien.${contextSection}
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
- vague = difficile à évaluer, réponse ambiguë`;
}
