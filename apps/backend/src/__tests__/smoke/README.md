# Smoke tests LLM (vrai Claude)

Ces tests appellent le **vrai** Anthropic (pas de mock) pour valider ce que
Claude renvoie réellement sur `live-assist` (les cards), `final-analysis` (le
bilan) et `extract-cv-keywords` — avec des scénarios adversariaux : transcript
dégradé par des erreurs STT typiques, stack visée jamais abordée à l'oral
(appât à hallucination), questions recruteur seules, session vide, CV avec
mots génériques à ne pas remonter comme keywords.

## Pourquoi séparés de `pnpm test`

- Coût réel (appels API à chaque run)
- Non-déterministes (le LLM peut varier d'un run à l'autre)
- Réseau requis

Donc : jamais dans `vitest.config.ts` (exclus explicitement), jamais en CI.

## Lancer

```bash
cd apps/backend
cp .env.example .env   # si pas déjà fait — ANTHROPIC_API_KEY requis
pnpm test:smoke
```

Sans `ANTHROPIC_API_KEY` dans l'environnement, les tests sont skip proprement
(`describe.skipIf`) plutôt que d'échouer.

## Ce qui est vérifié automatiquement (`verify.ts`)

Pas de LLM-juge — uniquement des checks déterministes sur des invariants qui
ne doivent jamais être violés :

- chaque citation du bilan est copiée **mot pour mot** depuis une ligne du
  transcript, avec le timestamp exact de cette ligne
- une compétence de la stack visée jamais mentionnée à l'oral reste
  `non-aborde`, jamais `demontre`/`mentionne` avec une citation inventée
- aucun prénom inventé quand `candidateName` n'est pas fourni
- format strict de l'en-tête des cards (`[cat] [statut] [theme] [angle]`) —
  une dérive silencieuse ici retomberait sur les defaults de
  `parseAssistText`/`extractThemeAndAngle` sans jamais faire échouer un test
  unitaire classique (qui mocke ce texte)
- comportement `[skip]` correct sur les questions recruteur
- règle explicite du prompt sur session vide (verdict prudent, tout
  `non-aborde`, aucune citation)
- chaque keyword CV extrait est une sous-chaîne littérale du texte source, et
  aucun terme générique de la liste `shouldNotAppear` ne remonte

Tout le texte brut généré par Claude est aussi imprimé en console (cards,
bilan JSON complet, corrections STT) — le ton et la pertinence restent à
relire à l'œil, ce qu'aucun check déterministe ne peut juger.

## Fichiers

- `fixtures/interview-scenarios.ts` — scénarios multi-tours (cards + bilan)
- `fixtures/garbled-transcripts.ts` — erreurs STT typiques pour `correctTranscript`
- `fixtures/cv-texts.ts` — faux CVs pour `extract-cv-keywords`
- `verify.ts` — les checks eux-mêmes
- `*.smoke.test.ts` — un fichier par flux testé

## Maintenance

`live-assist-and-report.smoke.test.ts` réimplémente la boucle de
`Session.processTranscript` (merge de card par thème, tracking d'angle) pour
piloter les scénarios sans passer par le WebSocket. Le **parsing** du texte
de Claude (`parseAssistText`, `extractThemeAndAngle` dans
`../../insight-parsing.ts`, `normalizeSkillMatchStatus`/`normalizeVerdict`
dans `../../report-normalize.ts`) est en revanche importé directement de la
prod — jamais dupliqué — pour qu'un changement de format soit détecté ici. Si
`Session.processTranscript` change sa règle de merge, garder ce fichier
synchronisé.
