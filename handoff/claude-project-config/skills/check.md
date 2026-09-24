---
name: check
description: Validation complète avant commit (typecheck backend + frontend)
---

Lance dans l'ordre :

1. `cd apps/backend && npx tsc --noEmit` — types backend
2. `cd apps/web && npx tsc --noEmit` — types frontend

Si une étape échoue, s'arrête et propose des corrections avant de continuer.
Si tout passe, confirme que le code est prêt à être commité.
