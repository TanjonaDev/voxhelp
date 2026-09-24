---
name: project-cours-verticale
description: "Vision produit et roadmap de la verticale \"cours\" (transcription de cours universitaires), scope confirmé par l'utilisateur"
metadata: 
  node_type: memory
  type: project
  originSessionId: b695adf4-9a69-46a6-b148-5ceba7f8479d
  modified: 2026-09-10T13:15:24.090Z
---

VoxHelp aura une deuxième verticale, indépendante de Recruit : transcrire des cours (visio ou enregistrés) et produire un document de cours propre, sans que l'étudiant ait besoin de prendre des notes.

Spec détaillée de la passe 1 (analyse) dans `voxhelp-verticale-cours-passe1.md` à la racine du repo, implémentée dans `packages/lecture` (voir commits `254e915`..`97fdcf7`).

**Scope confirmé (2026-09-10) :**
- **Live vs différé** : on garde **post-hoc uniquement pour l'instant**. Le mode live est prévu mais reporté à plus tard — ne pas l'implémenter maintenant même si évoqué dans les discussions produit.
- **Upload PDF du support de cours** : sert de **source de contexte pour la passe 2** (réécriture), pas pour le glossaire/keyword boosting de la passe 1. Raison : les profs s'appuient souvent sur un support PDF (slides) pendant le cours, donc le PDF aide à recaler vocabulaire/plan/structure au moment de la réécriture.
- Le keyword boosting Deepgram reste alimenté par le glossaire persistant du `Course` (boucle décrite dans le brief passe 1), pas par le PDF.

**Why:** évite de confondre les deux mécanismes d'amélioration (glossaire audio → boosting STT ; PDF slides → contexte de réécriture) qui répondent à des problèmes différents.

**How to apply:** avant de coder la passe 2 ou l'ingestion PDF, vérifier qu'elle consomme le PDF comme contexte de réécriture (pas comme keywords Deepgram), et ne pas commencer d'implémentation live tant que ce n'est pas explicitement redemandé.

Voir aussi [[project-state]] pour l'état d'avancement de Recruit.
