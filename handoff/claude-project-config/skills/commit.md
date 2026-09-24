---
name: commit
description: Créer un commit en suivant la convention Conventional Commits du projet
---

Crée un commit en respectant la convention du projet.

## Format

```
type(scope?): description
```

## Types disponibles

| Type | Usage |
|------|-------|
| `feat` | Ajout ou modification d'une fonctionnalité |
| `fix` | Correction d'un bug |
| `refactor` | Restructuration sans altérer le comportement |
| `perf` | Amélioration des performances |
| `style` | Formatage sans impact comportemental |
| `test` | Ajout ou correction de tests |
| `docs` | Documentation |
| `build` | Système de build (vite, tsconfig, pnpm) |
| `chore` | Dépendances, config, divers |

## Scopes disponibles

| Scope | Périmètre |
|-------|-----------|
| `backend` | `apps/backend/` |
| `web` | `apps/web/` |
| `shared` | `packages/shared/` |
| `infra` | config monorepo, CI |

## Procédure

1. `git diff --staged` (et `git status` si rien de stagé)
2. Choisis le type et le scope selon les fichiers modifiés
3. Message concis en anglais, description en minuscules
4. Stage les fichiers pertinents si nécessaire
5. Commit — ne pas utiliser `--no-verify`
6. Ne pas ajouter `Co-Authored-By` ou toute mention de Claude

## Exemples

```
feat(backend): route malagasy audio to gemini translator
fix(web): prevent tab capture when no audio track returned
refactor(backend): extract stt factory from session orchestrator
chore(shared): add TranslatorLanguage type
```
