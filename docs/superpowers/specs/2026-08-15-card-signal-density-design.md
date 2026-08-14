# Cards live-assist : suppression du Jargon, contenu orienté signal, fusion déterministe

## Contexte

Deux retours convergents sur un test réel (13-15 août 2026) :

- Feedback externe (Claude, sur capture d'écran) : 6 cards en 2min58 (une toutes les ~25-30s), charge cognitive trop élevée pour un recruteur qui doit écouter activement ; "Ownership et TypeScript" + 2 cards Jargon juste après répètent la même info (maîtrise TS) sans delta ; le badge de statut "Acquis" est présent sur les cards Traduction mais absent sur Jargon décodé — incohérent si Jargon décodé porte aussi un signal de compétence.
- Retour direct de l'utilisateur : "traduction et jargon décodé se mélangent et n'ont pas d'intérêt ensemble, ça rajoute beaucoup de bruit... Ce que veut un recruteur, c'est aller à l'essentiel : est-ce qu'on a besoin de creuser ? avec quelle question ? comment tu sens la réponse du candidat ? mais pas besoin d'avoir des détails sur TypeScript ou AWS."

Ces deux points recoupent exactement les points 1 et 2 de `bilan-retours-voxhelp-tests.md` (repo root, non versionné), restés ouverts après la tentative de fusion sémantique du 16 juillet 2026 — abandonnée le jour même car le LLM fusionnait à tort deux cards séparées par une relance du recruteur (mémoire `project-live-assist-card-merge`). Leçon retenue à l'époque : *"si on rejoue ce problème, ne pas faire confiance à un jugement de fusion du LLM seul across flush boundaries — la relance/question qui a déclenché la nouvelle réponse est un signal de continuité bien plus fort que le contenu de la card, et devrait conditionner l'éligibilité à la fusion (pas de fusion si une relance a été posée entre les deux), pas juste une fenêtre de temps."*

Confirmé en code : `apps/web/src/components/OverlayPanel.tsx` masque volontairement le badge de statut pour `cat === "jargon"` (`insight.cat !== "jargon" && <StatusBadge .../>`) — la catégorie Jargon n'a jamais été traitée comme un signal de compétence, ce qui explique l'incohérence relevée par le feedback externe.

Bloqué aujourd'hui (fix précédent du 14 août) : le corps des cards est déjà censé tenir en "1 phrase MAX (15-20 mots)" sans tiret de justification — un test réel a montré que le modèle contourne systématiquement cette règle (deux-points ou "et" à la place du tiret, dépassements de 5 à 15 mots). Ce ticket ne retente pas ce correctif isolément : la refonte du corps des cards ci-dessous (section B) le remplace par une nouvelle philosophie de contenu qui rend la contrainte de longueur plus naturelle à respecter.

## Décision

Trois changements, sur le même mécanisme (`live-assist.ts` + `session.ts` + rendu frontend) :

**A. Suppression de la catégorie "Jargon décodé"** comme card autonome. Un terme technique n'est expliqué qu'en glose courte à l'intérieur d'une card `strength`/`attention`/`translation` existante, si nécessaire à la compréhension du signal — jamais comme card à part entière. `Insight.cat` passe de 4 à 3 valeurs.

**B. Le corps des cards devient un signal factuel, pas une explication technique.** Nouvelle philosophie de contenu : ce qui a été dit (factuel, pas de vulgarisation de la techno), et une relance qui devient la norme plutôt que l'exception. Le statut (acquis/à-creuser/pas-acquis) reste le seul signal "faut-il creuser" — pas de nouveau champ.

**C. Fusion déterministe côté code, jamais jugée par le LLM.** Après génération d'une card, si son theme-slug est identique à celui de la dernière card émise ET que cette dernière card n'avait pas de relance, la nouvelle analyse **remplace** la précédente (même `id`, même timestamp d'origine) au lieu de s'empiler. Le jugement "même sujet ou pas" n'est plus demandé au LLM avant coup : il est déduit après coup du theme-slug déjà généré (rendu plus précis par le fix du 14 août sur la granularité des thèmes), et la présence d'une relance sur la card précédente bloque toujours la fusion — ce qui applique directement la leçon retenue de l'échec du 16 juillet.

## Comportement

### A. Suppression de "Jargon décodé"

**`packages/shared/src/index.ts`**
`Insight.cat` : `"translation" | "jargon" | "strength" | "attention"` → `"translation" | "strength" | "attention"`.

**`apps/backend/src/prompts/live-assist.ts`**
- Retirer `jargon` de la section "Catégories" du prompt.
- Retirer entièrement `buildJargonGuardSection` et le paramètre `jargonAlreadyDecoded` de `buildLiveAssistPrompt` (8ème argument positionnel supprimé) — mécanisme devenu sans objet, aucune catégorie jargon à dédupliquer.
- Retirer `jargon` de l'alternation regex dans `extractThemeAndAngle`... non, cette fonction vit dans `session.ts`, voir plus bas.
- Retirer l'exemple `[jargon] [acquis] [aws-lambda-scheduling] [ownership]` de la ligne "IMPORTANT — les 4 champs..." et le remplacer par un exemple `strength`.

**`apps/backend/src/session.ts`**
- Retirer le state `jargonDecodedThemes: Set<string>` (déclaration, reset dans `startSession`, reset dans `cleanup`).
- Retirer le bloc `if (card.cat === "jargon" && card.theme) { this.jargonDecodedThemes.add(card.theme); }` dans `processTranscript`.
- Retirer le calcul `jargonAlreadyDecoded` et le 8ème argument passé à `buildLiveAssistPrompt`.
- `extractThemeAndAngle` (regex `(?:jargon|strength|attention|translation)`) et `parseAssistText` (regex `(jargon|strength|attention|translation)`) : retirer `jargon` de l'alternation dans les deux regex.

**`apps/web/src/lib/parseAssistCard.ts` et `apps/web/src/lib/parseAssistStream.ts`**
Même retrait de `jargon` : le type `cat` (`"jargon" | "strength" | "attention" | "translation"` → 3 valeurs) et les deux regex d'alternation dans chaque fichier.

**`apps/web/src/components/ui.tsx`**
Retirer l'entrée `jargon` de `CATEGORY_META` (3 catégories restantes : `translation`, `strength`, `attention`).

**`apps/web/src/components/OverlayPanel.tsx`**
- Retirer `jargon: "var(--violet)"` des deux `catColorMap` locaux (`StreamingCardView` et `InsightCardView`).
- `{insight.cat !== "jargon" && <StatusBadge level={insight.status} />}` → `<StatusBadge level={insight.status} />` (inconditionnel, plus de catégorie à exclure).
- Renommer le libellé de section "Ce que ça veut dire" → "Ce qui a été dit" dans `StreamingCardView` et `InsightCardView` (les deux occurrences), pour refléter le changement de nature du contenu (section B) plutôt que de le laisser en décalage avec le nouveau corps factuel.

### B. Corps des cards orienté signal

**`apps/backend/src/prompts/live-assist.ts`**, section "Format de réponse OBLIGATOIRE" :

Remplacer l'instruction actuelle du corps (qui demande explicitement une vulgarisation façon "explique à quelqu'un qui n'a jamais fait de dev") par une instruction orientée signal factuel : ce qui a été dit, pas d'explication de la techno pour elle-même ; un terme technique n'est glosé que s'il est indispensable à la compréhension de la phrase, en 2-3 mots maximum entre parenthèses ; phrase courte, une seule idée.

Remplacer la règle de relance actuelle (`"Pas de relance si cat = translation ou si le sujet est épuisé."`) par une règle inversée : la relance est la norme, l'absence de relance devient l'exception (réservée aux cas où le point est déjà totalement clos et où aucune question n'apporterait de signal supplémentaire) — plus de rattachement de cette règle à `cat = translation` spécifiquement, la logique de statut/besoin-de-creuser prime sur la catégorie.

Mettre à jour la ligne `angle : ... none si pas de relance (cat = translation) ou si...` en conséquence — retirer la référence à `cat = translation` comme motif de `none`, garder uniquement "cas exceptionnel où le point est déjà clos".

Mettre à jour la ligne "Rôle : traduire le jargon, repérer les points forts, aider à poser les bonnes questions." pour refléter le nouvel objectif : donner un signal clair (dit / faut-il creuser / avec quelle question), pas traduire du jargon.

### C. Fusion déterministe

**`packages/shared/src/index.ts`**
Nouveau variant sur `ServerMessage` : `{ type: "assist:update"; id: string; fullText: string }`, ajouté juste après `assist:done`.

**`apps/backend/src/session.ts`**, dans `processTranscript` :

Réordonner la fin de la méthode : le `card` est parsé, sa relance loggée, **puis** la décision fusion/nouvelle-card est prise, **puis seulement** le message WS terminal est envoyé (aujourd'hui `assist:done` part avant le parsing — il doit partir après, une fois qu'on sait si c'est une fusion).

```ts
const card = this.parseAssistText(fullText, cardId, cardT);
if (card.relance) {
  this.relanceLog.push(card.relance);
  if (this.relanceLog.length > this.MAX_LOG_ENTRIES) this.relanceLog.shift();
}

const lastCard = this.cardLog[this.cardLog.length - 1];
const canMerge = !!lastCard && !!card.theme && card.theme === lastCard.theme && !lastCard.relance;

if (canMerge) {
  const mergedCard: Insight = { ...card, id: lastCard.id, t: lastCard.t };
  this.cardLog[this.cardLog.length - 1] = mergedCard;
  this.send({ type: "assist:update", id: lastCard.id, fullText });
  console.log(`[Session] Card fusionnée dans ${lastCard.id} [${card.cat}] [${card.status}] theme=${card.theme} "${card.title}"`);
} else {
  this.cardLog.push(card);
  this.send({ type: "assist:done", id: cardId, fullText });
  console.log(
    `[Session] Card [${card.cat}] [${card.status}] theme=${card.theme ?? "null"} "${card.title}"${card.relance ? ` | relance: "${card.relance}"` : ""}`
  );
}
if (this.cardLog.length > this.MAX_CARD_LOG) this.cardLog.shift();
```

Le reste de la méthode (calcul `theme`/`angle` via `extractThemeAndAngle(fullText)`, mise à jour `lastTheme`/`themeCardCount`/`coveredAngles`) ne change pas — la progression d'angle continue de compter chaque génération, fusionnée ou non, puisqu'elle mesure combien d'analyses ont été faites sur le sujet, pas combien de cards sont visibles.

Pourquoi remplacer plutôt que concaténer les textes : chaque nouvelle génération reçoit déjà tout le contexte de session (cards précédentes incluses dans le prompt via `buildPreviousCards`), donc la nouvelle analyse est déjà une synthèse à jour du thème — concaténer romprait l'objectif de brièveté de la section B.

`assist:start` n'a pas besoin de changer : il envoie toujours un `id` fraîchement généré pour le streaming (`cardId = createId()`), utilisé uniquement le temps de la génération. Seul le message terminal (`assist:done` vs `assist:update`) détermine si le frontend ajoute une nouvelle card ou met à jour une card existante par `id`.

**`apps/web/src/hooks/useWebSocket.ts`**
- Nouveau cas `"assist:update"` dans `handleMessage` : parse `msg.fullText` avec `parseAssistCard` (identique à `assist:done`), mais au lieu d'ajouter à `insights`, remplace l'entrée existante dont `id === msg.id` (garde son `t` d'origine, remplace le reste).
- Nouveau state `touchedId: string | null`, mis à jour à la fois dans le cas `assist:done` (avec le nouvel `id`) et `assist:update` (avec l'`id` mis à jour) — remplace le déclenchement actuel de la mise en avant visuelle "isNew", qui ne se basait que sur la croissance de `insights.length` et ne se déclencherait donc jamais sur une fusion. Exposé dans le retour du hook.

**`apps/web/src/components/OverlayPanel.tsx`**
Remplacer l'effet actuel basé sur `insights.length` (qui pilote `newId`, le highlight visuel "nouvelle card") par un effet basé directement sur `touchedId` renvoyé par `useWebSocket` — fonctionne aussi bien pour un ajout que pour une mise à jour en place.

## Hors scope

- La reformulation du corps (section B) ne retente pas le plafond de mots ni l'interdiction du tiret de manière isolée comme le 14 août — la nouvelle philosophie de contenu (signal factuel, pas d'explication tech) est censée rendre la brièveté plus naturelle à respecter, mais aucune mesure de longueur n'est ajoutée dans cette itération. Si le corps reste trop long en usage réel, ce sera un correctif séparé.
- Pas de fenêtre de fusion à distance : seule la card **immédiatement précédente** est candidate à la fusion (`cardLog[cardLog.length - 1]`), jamais une card plus ancienne même sur le même thème. Cohérent avec le fait que `lastTheme` lui-même ne suit que la continuité immédiate.
- Pas de garde-fou supplémentaire contre une fusion qui traverserait un `ask:question` (question directe du recruteur) — dans les faits, une card générée par `handleAskQuestion`/`buildAskPrompt` n'a jamais de theme-slug (format à 2 crochets, pas 4), donc `card.theme` y est toujours `null`, ce qui bloque déjà la fusion via la condition `!!card.theme` côté carte suivante autant que côté carte précédente. Pas de mécanisme dédié à ajouter.
- Pas de retrait des tokens CSS `--violet`/`--violet-soft` ni de l'icône `sparkle` (`ui.tsx`) — laissés en place, inutilisés mais inoffensifs ; retrait hors scope pour limiter le risque sur du code partagé non vérifié exhaustivement.
- Pas de suppression de la persistance Supabase (`useInterviews.ts`, `reports`/`transcripts`/`assist_cards`) — toujours du code mort non branché, sans rapport avec ce ticket.

## Tests

Impact vérifié fichier par fichier sur `apps/backend/src/__tests__/` :

- **`session-jargon-dedup.test.ts`** — entièrement obsolète (teste exclusivement `jargonDecodedThemes`/`buildJargonGuardSection`, tous deux supprimés) : à supprimer (`git rm`).
- **`session-theme-angle.test.ts`** — impacté par la fusion déterministe : ses 5 tests enchaînent des cards sur le **même theme-slug sans relance** (`awsCard()` ne génère jamais de ligne `>>`), donc chaque card après la première sur un même thème va désormais fusionner. Chaque `await waitForMessage(ws, "assist:done")` qui suit une card de même thème que la précédente doit devenir `await waitForMessage(ws, "assist:update")`. Un des tests utilise aussi `[jargon]` comme catégorie dans un fixture brut — à remplacer par une catégorie valide (`strength` ou `translation`), indépendamment de la question de fusion.
- **`prompts.test.ts`** — retirer/adapter les tests `buildLiveAssistPrompt` qui vérifient le garde-fou jargon (`"adds/omits the jargon-guard instruction..."`, 5 tests) ; retirer `jargon` des tests qui listent les catégories ou citent l'exemple d'en-tête ; ajouter des tests pour : catégories réduites à 3 dans le prompt, règle de relance par défaut (plus de mention `cat = translation` comme motif d'omission), rôle reformulé (pas de mention "traduire le jargon").
- **`session.test.ts`, `session-keywords.test.ts`, `session-max-buffer.test.ts`, `session-usage-limit.test.ts`, `session-tech-matching.test.ts`** — vérifiés, non impactés : soit les fixtures de cards n'utilisent pas de theme-slug (`extractThemeAndAngle` renvoie `theme: null`, donc `!!card.theme` bloque toute fusion), soit ces fichiers ne génèrent qu'une seule card par test.
- **Nouveau fichier `session-card-merge.test.ts`** couvrant la fusion déterministe elle-même : même theme-slug + dernière card sans relance → `assist:update`, même `id`/`t` que la première card, `cardLog` ne grandit pas ; dernière card **avec** relance → pas de fusion, `assist:done`, `cardLog` grandit ; theme-slug différent → pas de fusion.

Frontend (`apps/web`) : toujours aucune infra de test automatisé — vérification par `tsc --noEmit` + smoke test manuel (une session réelle avec plusieurs segments sur le même sujet doit produire une card qui se met à jour en place plutôt que de s'empiler, avec le highlight visuel qui se déclenche sur la mise à jour).
