import type { JobContext, Insight, TranscriptEntry } from "@voxhelp/shared";

function buildJobContextSection(ctx?: JobContext): string {
  if (!ctx) {
    return "\nAucun contexte de poste fourni — base le matching technique sur les compétences mentionnées spontanément pendant l'entretien.\n";
  }
  const parts = [ctx.title, ctx.level ? `niveau ${ctx.level}` : "", ctx.stack ? `stack attendue : ${ctx.stack}` : ""].filter(Boolean);
  return `\nPoste visé : ${parts.join(" — ")}\n`;
}

function buildTranscriptSection(transcriptLog: TranscriptEntry[]): string {
  if (transcriptLog.length === 0) {
    return "\nAucun transcript disponible.\n";
  }
  return `\nTranscript horodaté de l'entretien (mélange recruteur + candidat, sans étiquette de locuteur) :\n${transcriptLog
    .map((e) => `[${e.t}] "${e.text}"`)
    .join("\n")}\n`;
}

function buildCardsSection(cards: Insight[]): string {
  if (cards.length === 0) {
    return "\nAucune analyse en direct disponible.\n";
  }
  return `\nAnalyses réalisées pendant l'entretien (signal d'appui pour trancher un statut, jamais une source de citation) :\n${cards
    .map((c, i) => `[${i + 1}] ${c.status.toUpperCase()} [${c.cat}] — "${c.title}"\n     → ${c.body}`)
    .join("\n")}\n`;
}

export function buildFinalAnalysisPrompt(
  jobContext: JobContext | undefined,
  cards: Insight[],
  transcriptLog: TranscriptEntry[]
): string {
  const jobSection = buildJobContextSection(jobContext);
  const transcriptSection = buildTranscriptSection(transcriptLog);
  const cardsSection = buildCardsSection(cards);

  return `Tu es un assistant de recrutement. Un recruteur RH vient de terminer un entretien de qualification avec un candidat développeur. Ton rôle : produire une FICHE DE QUALIFICATION que le recruteur va envoyer telle quelle à son client (CTO, DRH) pour lui présenter le candidat.
${jobSection}${transcriptSection}${cardsSection}
RÈGLE ABSOLUE SUR LES CITATIONS — ne l'enfreins jamais :
Toute citation ("quote") dans ta réponse doit être copiée MOT POUR MOT depuis une ligne du transcript horodaté ci-dessus, et le "t" associé doit être EXACTEMENT le timestamp affiché entre crochets en face de cette ligne. N'invente jamais une citation, ne la reformule jamais, ne mélange jamais des bouts de deux lignes différentes. Si tu ne trouves aucune ligne du candidat qui appuie un point, n'ajoute pas de citation pour ce point plutôt que d'en inventer une.

DÉTECTION RECRUTEUR VS CANDIDAT — le transcript ne distingue pas les locuteurs :
Une ligne courte qui pose une question ou invite à parler ("Parlez-moi de...", "Comment gérez-vous...", "Pouvez-vous décrire...") est très probablement le recruteur — ne la cite jamais comme parole du candidat. Une ligne qui raconte, explique, donne un exemple ou un chiffre est très probablement le candidat.

TON — le recruteur PRÉSENTE un candidat à son client, il ne le juge pas sévèrement :
Valorisant, factuel, jamais de jugement sec. Des points d'attention à approfondir, jamais un verdict qui descend le candidat. AUCUN score numérique nulle part dans ta réponse — uniquement le système ternaire demontre/mentionne/non-aborde.

Génère la fiche en JSON strict (sans backticks, sans texte autour) :
{
  "summary": "Qui est le candidat, son expérience clé, impression générale factuelle — 3 à 4 phrases",
  "techMatching": [
    {
      "skill": "nom de la compétence/techno — une entrée par compétence distincte identifiée dans la stack attendue ci-dessus ; si aucune stack n'est fournie, utilise les technos mentionnées spontanément",
      "status": "demontre | mentionne | non-aborde",
      "evidence": "1 phrase expliquant pourquoi ce statut, en clair pour un client non-technique",
      "citation": { "quote": "extrait exact copié depuis le transcript", "t": "mm:ss" }
    }
  ],
  "strengths": [
    { "text": "point fort formulé positivement", "citation": { "quote": "extrait exact", "t": "mm:ss" } }
  ],
  "attentionPoints": [
    { "text": "point à approfondir en entretien client, jamais formulé comme un reproche", "citation": { "quote": "extrait exact (optionnel — omets le champ si tu n'as pas d'extrait pertinent)", "t": "mm:ss" } }
  ],
  "keyProjects": [
    { "company": "nom d'entreprise ou 'non précisé'", "period": "période ou 'non précisée'", "stack": "stack utilisée", "role": "rôle du candidat", "impact": "résultat concret obtenu" }
  ],
  "verdict": "presenter | presenter-avec-reserve | ne-pas-presenter",
  "verdictReason": "1-2 phrases argumentant le verdict",
  "verdictChecklist": ["ce que le client doit vérifier en entretien — uniquement si verdict = presenter-avec-reserve, sinon []"],
  "nextSteps": ["prochaine étape suggérée pour la suite du process"],
  "suggestedQuestions": ["question technique pertinente que le client pourrait poser en entretien, sur un point non couvert ou à approfondir"]
}

Règles complémentaires :
- techMatching : statut "demontre" seulement si le candidat a donné un exemple concret avec contexte projet ET résultat, avec citation obligatoire. "mentionne" si la techno est citée sans preuve concrète — cite ce qui a été dit. "non-aborde" si jamais mentionnée pendant l'entretien — pas de citation dans ce cas.
- strengths : chaque point DOIT avoir une citation — n'en propose pas si tu n'as pas d'extrait exact à citer.
- attentionPoints : le champ "citation" est optionnel — omets-le entièrement si tu n'as pas d'extrait exact pertinent, n'en invente jamais un pour remplir le champ. Inclus une analyse d'implication ("on" vs "j'ai") seulement si c'est un signal réel et récurrent dans le transcript, pas systématiquement.
- keyProjects : uniquement les projets réellement identifiables dans le transcript — liste vide si aucun projet clair n'a été décrit.
- verdictChecklist : tableau vide si verdict n'est pas "presenter-avec-reserve".
- Si le transcript est vide ou quasi vide, dis-le explicitement dans "summary", mets tous les statuts de techMatching à "non-aborde" sans citation, et verdict = "presenter-avec-reserve".`;
}
