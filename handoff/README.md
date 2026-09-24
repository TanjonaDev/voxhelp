# Reprise sur le nouveau Mac (état au 2026-09-24)

Branche de transfert uniquement : ne pas la merger dans `main`.

## Où on en est

- `main` (`e007fdd`) contient tout le découplage STT, Inworld en live (expérimental), le menu de choix du modèle live et le durcissement de `session:start`.
- Travail en cours : **choix du modèle de transcription pour les cours** sur la branche `feat/course-stt-model-selector`.
  - Spec : `docs/superpowers/specs/2026-09-21-course-stt-model-selector-design.md`
  - Plan : `docs/superpowers/plans/2026-09-21-course-stt-model-selector.md`
  - **Aucune tâche du plan n'est commencée** (aucune case cochée, aucun code modifié).

## Reste à faire (plan, dans l'ordre)

1. Registre batch + `GET /api/stt/batch-providers` + champ `sttProvider` sur les 2 routes de transcription des cours.
2. Adapter Inworld batch : ffmpeg (`ffmpeg-static`) → WAV 16 kHz mono + silences, découpage ≤ 720 s aux silences, 3 requêtes en parallèle avec reprises, reconstruction des énoncés.
3. Sélecteur de modèle sur l'écran d'import des cours (`localStorage` : `voxhelp.batchSttProvider`).
4. Vérification réelle avec la clé Inworld : cours entier, aucun mot perdu ou doublé aux coupures, contrôle visuel du champ.

État de base attendu avant de commencer : backend 27 fichiers / 210 tests, lecture 14 fichiers / 74 tests, typechecks verts.

## Points ouverts (hors plan)

- Inworld live jamais testé sur un vrai **entretien** (seulement sur un cours) : Deepgram Flux reste le défaut.
- Menu de choix du modèle live jamais vérifié dans un navigateur.
- Voir aussi les notes dans `claude-memory/` (relances trop rares, skip live-assist trop agressif, etc.).

## Restaurer sur le nouveau Mac

```bash
git clone https://github.com/TanjonaDev/voxhelp.git && cd voxhelp
git fetch origin handoff/mac-transfer
git switch feat/course-stt-model-selector

# Fichiers hors git récupérés depuis la branche de transfert
git checkout origin/handoff/mac-transfer -- handoff bilan-retours-voxhelp-tests.md design_handoff_voxhelp_overlay
git restore --staged handoff bilan-retours-voxhelp-tests.md design_handoff_voxhelp_overlay

# Config Claude du projet (.claude/ est ignoré par git)
mkdir -p .claude && cp -R handoff/claude-project-config/* .claude/

# Mémoire Claude : le dossier dépend du chemin absolu du dépôt
# (chemin avec les "/" remplacés par "-"), ex. pour ~/TanjonaDev/voxhelp :
MEM=~/.claude/projects/$(pwd | tr '/' '-')/memory
mkdir -p "$MEM" && cp handoff/claude-memory/*.md "$MEM/"

pnpm install   # Node >= 22
```

## À transférer à la main (jamais dans git)

- `apps/backend/.env` et `apps/web/.env` : vraies clés (Deepgram, Anthropic, Inworld, Supabase…). Les copier par AirDrop / gestionnaire de mots de passe, ou repartir de `.env.example`.
- Accès GitHub : sur l'ancien Mac, le SSH port 22 échouait par timeout (le push est passé en HTTPS via `gh auth git-credential`). Sur le nouveau Mac : `gh auth login`.
- `ffmpeg` absent sur macOS par défaut (le plan passe par `ffmpeg-static`).
