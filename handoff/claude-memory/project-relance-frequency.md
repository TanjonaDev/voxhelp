---
name: project-relance-frequency
description: "Test réel (13 août 2026) — trop peu de questions de relance générées par le live-assist, à investiguer plus tard"
metadata: 
  node_type: memory
  type: project
  originSessionId: ffe8e815-8f05-4ff9-ac67-7f9b2ba3dafe
  modified: 2026-08-12T23:09:09.529Z
---

Sur un test réel complet (11 cards générées), seulement 2 questions de relance (`>>`) ont été produites — 2 sur les 7 cards éligibles (jargon + point fort), les 4 cards `translation` n'ayant jamais de relance par design (`live-assist.ts`, règle explicite "Pas de relance si cat = translation").

**Cause probable :** la règle "Pas de relance... si le sujet est épuisé" (`live-assist.ts`) laisse le LLM libre de juger, sans critère strict — il semble se montrer nettement plus avare que souhaité.

**Statut :** noté par l'utilisateur, pas encore priorisé ("on verra ça plus tard"). Piste de travail suggérée : resserrer le prompt pour rendre la relance par défaut sauf raison explicite de s'abstenir, plutôt que l'inverse.

Lié à [[project-live-assist-card-merge]] (même fichier `live-assist.ts`, mécanisme de progression thème/angle).
