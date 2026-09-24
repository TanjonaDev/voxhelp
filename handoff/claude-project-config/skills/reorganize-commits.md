---
name: reorganize-commits
description: Réorganiser, squasher ou nettoyer les commits d'une branche — "refais les commits", "regroupe en N commits", "nettoie l'historique"
---

# Reorganize Branch Commits

Reset tous les commits de la branche vers des changements stagés, puis reconstruit des commits propres un par un.

---

## PHASE 1 — Lister les commits et fichiers modifiés

```bash
git log main..HEAD --oneline
git diff main..HEAD --name-only
```

Propose un regroupement en N commits avec une justification pour chaque groupe.
**Attends la confirmation de l'utilisateur** avant de faire quoi que ce soit.

---

## PHASE 2 — Sauvegarder un restore point, puis soft reset

```bash
RESTORE_POINT=$(git rev-parse HEAD)
echo "Restore point: $RESTORE_POINT"
```

Puis reset :

```bash
git reset --soft main
```

**Vérifier immédiatement** que la liste des fichiers stagés correspond exactement à ce qui était dans la branche :

```bash
git diff --cached --name-only
```

Comparer avec la liste de la Phase 1. Si un fichier manque ou est inattendu — **stop et restore** :

```bash
git reset --soft $RESTORE_POINT
```

Puis stopper et expliquer ce qui ne va pas. Ne pas continuer.

---

## PHASE 3 — Reconstruire les commits

Tous les changements de la branche sont maintenant stagés. Reconstruire les commits un par un en sélectionnant les fichiers :

```bash
# Commit 1
git add <files for commit 1>
git commit -m "type(scope): message"

# Commit 2
git add <files for commit 2>
git commit -m "type(scope): message"
```

---

## Règles

- **Avant le reset** : toujours sauvegarder `git rev-parse HEAD` comme restore point
- **Après le reset** : toujours comparer `git diff --cached --name-only` avec la liste Phase 1 — stop et restore si quelque chose ne correspond pas
- Si un commit échoue — restore avec `git reset --soft $RESTORE_POINT` et stop
- Toujours montrer le regroupement proposé et **attendre la confirmation** avant d'exécuter le reset
- Respecter la convention commit du projet (voir `.claude/skills/commit.md`)
- Ne jamais utiliser `--no-verify`
- Ne jamais ajouter `Co-Authored-By` ou mentions Claude dans les messages
