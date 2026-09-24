---
name: project-jargon-removal-validates-density
description: "Retrait de la catégorie Jargon (seul) explique déjà l'essentiel du gain de densité observé sur le test réel du 15 août — la fusion déterministe n'est qu'un filet marginal"
metadata: 
  node_type: memory
  type: project
  originSessionId: ffe8e815-8f05-4ff9-ac67-7f9b2ba3dafe
  modified: 2026-08-21T23:17:07.585Z
---

Sur le test réel du 15 août (capture `Capture d'écran 2026-08-15 à 00.22.16.png`, 6 cards en 2min58), 2 des 6 cards étaient des "Jargon décodé" ("DynamoDB Streams et Lambda", "Types génériques et utilitaires TypeScript"). Le retrait de la catégorie Jargon (partie A de la refonte `[[card-signal-density]]`) fait disparaître ces 2 cards du flux à lui seul — 6 → 4 cards sans qu'aucune fusion n'intervienne.

La seule redondance restante sur ce screen (cards "Ownership et TypeScript" / "TypeScript strict mode", toutes deux `translation`) est le seul cas où la fusion déterministe (partie C) aurait pu jouer, et encore seulement si les deux partagent le même theme-slug précis.

**Conclusion retenue avec l'utilisateur (22 août) :** le retrait du Jargon fait l'essentiel du travail de réduction de densité ; la fusion reste en place (implémentée, review-clean) mais n'est qu'un filet marginal — pas la peine d'investir davantage dessus pour l'instant, notamment sur les deux points ouverts de la revue finale (relance par défaut qui pourrait la rendre rarement éligible ; remplacement de contenu qui peut perdre un signal fort sur une chaîne de fusions).
