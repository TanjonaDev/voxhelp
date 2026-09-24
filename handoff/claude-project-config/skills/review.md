---
name: review
description: Revue clean code d'un fichier ou d'une fonction ciblée
---

Lis le fichier ou la fonction $ARGUMENTS.

Analyse selon ces critères, dans l'ordre de priorité :

**1. Responsabilité unique (SRP)**
- Le fichier/classe/hook fait-il une seule chose ?
- Backend : `index.ts` est-il thin (setup serveur uniquement) ? `session.ts` orchestre-t-il sans logique métier inline ?
- Frontend : le composant délègue-t-il la logique aux hooks ?

**2. Nommage**
- Les fonctions sont-elles des verbes d'action (`sendAudio`, `handleMessage`, `buildPrompt`) ?
- Les variables révèlent-elles l'intention (pas `data`, `result`, `tmp`) ?
- Les booléens sont-ils préfixés (`is`, `has`, `should`) ?

**3. Fonctions pures vs effets de bord**
- Les builders/mappers sont-ils purs (pas d'I/O, pas d'appels réseau) ?
- Les effets de bord (WebSocket, Deepgram, Gemini, Claude) sont-ils isolés dans des classes/fonctions dédiées ?

**4. Profondeur de nesting**
- Plus de 2 niveaux d'imbrication ? → proposer early return ou extraction de fonction.

**5. Paramètres**
- Une fonction a-t-elle plus de 3 paramètres ? → regrouper dans un objet (ex: `{ onPartial, onFinal, onError }`).

**6. Couplage**
- `session.ts` importe-t-il directement des détails d'implémentation STT ? → devrait dépendre d'une interface, pas d'une classe concrète.
- Les hooks frontend importent-ils des constantes backend ? → doivent passer par `@voxhelp/shared`.

**7. Duplication**
- Logique copiée entre `deepgram.ts`, `groq-whisper.ts`, `gemini-audio.ts` ? → candidat pour un utilitaire partagé.

Pour chaque problème : cite la ligne, explique pourquoi c'est un problème, propose une correction concrète.
Ne modifie pas le fichier sauf si l'utilisateur le demande explicitement.
