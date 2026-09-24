---
name: project-stt-provider-decoupling
description: STT découplé derrière des ports (LiveStt/BatchStt) + adapter Inworld ; résultat du test réel Flux vs Inworld et suite prévue
metadata: 
  node_type: memory
  type: project
  originSessionId: 0fb4cd1d-a45d-4633-befd-f64f81ca849d
  modified: 2026-09-21T10:32:38.053Z
---

Le STT est découplé du reste de l'app (branche `feat/stt-provider-decoupling`, spec/plan dans `docs/superpowers/specs|plans/2026-09-20-stt-provider-decoupling*`). Choix par env : `STT_LIVE_PROVIDER` (`deepgram` défaut | `inworld`), `STT_BATCH_PROVIDER` (`deepgram` seul). Inworld est branché mais **expérimental**.

**Test réel (2026-09-20)** sur 10 min d'un cours FR de 103 min (`~/Downloads/video-0 (4).m4v`) via `apps/backend/scripts/stt-compare.ts` : couverture du texte équivalente (1193 vs 1171 mots), mais Inworld coupe les tours à cadence fixe ~30 s (plafond de durée de tour, parfois au milieu d'un groupe syntaxique) alors que Flux suit les pauses. Conclusion provisoire : ne pas basculer le défaut sur Inworld.

**Why:** un cours (monologue) n'est pas un entretien ; la segmentation d'Inworld n'a donc pas été jugée sur le cas d'usage réel (alternance de locuteurs).

**How to apply:** avant de rouvrir le sujet, refaire le test avec un enregistrement d'**entretien** et des seuils plus courts (`maxTurnSilence` 500–800 ms, `endOfTurnConfidenceThreshold` plus bas) ; tester aussi `language` omis pour le FR/EN mélangé. La clé Inworld de l'utilisateur est dans `apps/backend/.env` (ignoré par git, jamais dans le dépôt ni ici). Sur macOS `ffmpeg` est absent : le script convertit avec `afconvert`. Un `GROQ_API_KEY` mort traîne dans ce `.env` (groq-stt.ts supprimé).

**Sélecteur de modèle (2026-09-21, même branche)** : menu déroulant en haut à droite de la `HeaderBar` (`OverlayPanel.tsx`), alimenté par `GET /api/stt/providers` ; le registre backend (`stt/index.ts`) est la source de vérité, ajouter un modèle = un adapter + une entrée. Choix par session via `SessionConfig.sttProvider`, mémorisé dans `localStorage` (`voxhelp.sttProvider`), verrouillé pendant le live. `STT_LIVE_PROVIDER` devient le défaut serveur. Le menu n'a **pas été vérifié dans un navigateur** par Claude (extension Chrome non connectée) : contrôle visuel laissé à l'utilisateur.

**`prompts` Inworld (mesuré sur l'API réelle)** : refuse `# / @ + & _ " % * = < > [ ] { } | \ ~ ^ $`, l'apostrophe courbe et les emojis (`INVALID_ARGUMENT`, session morte) ; 100 termes max, 100 caractères max par terme. Le nettoyeur `inworld-prompts.ts` remplace par des espaces (`CI/CD` -> « CI CD ») et dit `C#` -> « C sharp », `C++` -> « C plus plus ». Effet observé : `["MECC"]` corrige « MECCE » en « MECC ».

**Robustesse `session:start` (corrigé, commit e007fdd)** : `config.keywords` envoyé comme chaîne faisait planter le processus (`.join` sur une chaîne dans un log de `session.ts`, rejet non géré, pas de handler `unhandledRejection`, Node 22 s'arrête). `parseSessionConfig` (`apps/backend/src/session-config.ts`) valide maintenant la config au tout début de `startSession` (rejet = `session:error` « Configuration de session invalide »), et `runAsync` rattrape les échecs des trois handlers async non attendus. Piège à retenir : tout `void this.xxx()` async sur des données client non fiables est un risque de plantage tant qu'il n'y a pas de `.catch`.

Voir aussi [[project-cours-verticale]] (le batch Nova-3 des cours passe par le port `BatchStt`).
