---
name: refactor
description: Refactoring ciblé d'un fichier en appliquant les principes clean code du projet
---

Lis le fichier $ARGUMENTS.

Applique les refactorings dans cet ordre :

**Étape 1 — Sécuriser**
Lance le typecheck : `cd apps/backend && npx tsc --noEmit` ou `cd apps/web && npx tsc --noEmit`
Si ça échoue, arrête-toi et demande à l'utilisateur.

**Étape 2 — Identifier**
Liste les problèmes clean code trouvés (sans modifier le code encore).
Attends la validation de l'utilisateur avant de continuer.

**Étape 3 — Refactorer**
Applique un refactoring à la fois. Pour chaque changement :
- Explique ce qui change et pourquoi
- Modifie le code
- Relance le typecheck pour confirmer que tout passe

Patterns à privilégier dans le contexte voxhelp :

- **Interface STT** : `deepgram.ts`, `groq-whisper.ts`, `gemini-audio.ts` partagent la même interface → extraire `STTProvider` dans `shared/`
- **Factory STT** : la logique de sélection dans `session.ts` → `createSTTProvider(config)` dans un fichier dédié `stt-factory.ts`
- **Early return** : réduire le nesting dans les handlers WebSocket
- **Context object** : regrouper les callbacks `{ onPartial, onFinal, onError }` en type nommé `STTCallbacks`
- **Extract function** : tout bloc avec un commentaire `// Step X` mérite sa propre fonction nommée

**Étape 4 — Valider**
`cd apps/backend && npx tsc --noEmit`
`cd apps/web && npx tsc --noEmit`
