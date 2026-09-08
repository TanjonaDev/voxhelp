export function buildCvKeywordExtractionPrompt(cvText: string): string {
  return `Tu extrais les termes qui aideront un système de reconnaissance vocale à bien transcrire un entretien technique avec ce candidat.

Contenu du CV :
"""
${cvText}
"""

Retourne un JSON strict (sans backticks, sans texte autour) :
{ "keywords": ["terme1", "terme2", ...] }

Règles :
- Uniquement des noms propres et termes spécifiques à CE candidat : noms d'entreprises, noms de produits/outils internes, certifications, technologies/frameworks nommés précisément, noms de projets.
- Pas de mots génériques (ex : "développeur", "expérience", "gestion de projet").
- Maximum 40 termes, les plus susceptibles d'être mal transcrits en priorité (noms propres rares avant termes techniques courants).
- Chaque terme fait au maximum 100 caractères, idéalement 1 à 4 mots.
- Si rien de pertinent n'est trouvé, retourne { "keywords": [] }.`;
}
