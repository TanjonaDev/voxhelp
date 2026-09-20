# Découplage du STT et adapter Inworld — Design

Date : 2026-09-20
Statut : validé en brainstorming, en attente de relecture du spec

## Contexte et objectif

Le STT est aujourd'hui câblé en dur sur Deepgram :

- **Live** : `session.ts` dépend de la classe concrète `FluxSTT` (`private stt: FluxSTT | null`, `new FluxSTT(...)`). Les logs parlent de « Deepgram Flux » et de « keyterm boosting ».
- **Batch (cours)** : `routes.ts` appelle `transcribeAudioBatch` (`deepgram-batch.ts`, Nova-3), qui renvoie un type nommé `DeepgramUtterance`, défini dans `packages/lecture`. Le nom du fournisseur a fuité dans le domaine.

Objectif : pouvoir changer de modèle STT au moindre effort (une variable d'env et un adapter), puis essayer Inworld STT (`inworld/inworld-stt-1`) comme premier nouveau fournisseur live.

Hors périmètre :
- Reconnexion WebSocket automatique (priorité n°4 du CLAUDE.md, bénéficiera à tous les adapters).
- Sélection du fournisseur par utilisateur ou par session (l'env est global).
- Fournisseur batch autre que Deepgram (l'API sync d'Inworld est limitée à ~16 Mo, inutilisable pour un cours de 2h).
- Exploitation des `voiceProfile`, `speechStarted/Stopped` et `usage` d'Inworld.

## Approche retenue

Ports et adapters simples : interfaces TypeScript, un adapter par fournisseur, une fabrique qui choisit selon l'env. On conserve la forme actuelle (callbacks + `start / sendAudio / close`) pour que `session.ts` change à peine.

Écartées : un registre de plugins à chargement dynamique (trop lourd pour 2 ou 3 fournisseurs) et un simple renommage de `FluxSTT` (`session.ts` resterait lié à la forme du SDK Deepgram).

## Structure

Backend uniquement (plus un renommage de type dans `packages/lecture`) :

```
apps/backend/src/stt/
  types.ts                  # LiveStt, LiveSttOptions, LiveSttCallbacks, BatchStt
  index.ts                  # createLiveStt(), getBatchStt(), validation de l'env
  providers/
    deepgram-flux.ts        # FluxSTT actuel, déplacé, implements LiveStt
    deepgram-batch.ts       # Nova-3 actuel, implements BatchStt
    inworld-live.ts         # nouveau
```

`apps/backend/src/groq-stt.ts` est supprimé : il n'est importé nulle part (code mort).

## Contrats

### Port live

```ts
interface LiveSttOptions { language: InterviewLanguage; keyterms?: string[] }

interface LiveSttCallbacks {
  onTranscript(text: string): void; // un tour de parole terminé : texte final non vide, trimé
  onListening(): void;
  onError(message: string): void;
}

interface LiveStt {
  start(): Promise<void>;
  sendAudio(pcm: Buffer): void;     // toujours PCM16 16 kHz mono (AUDIO_SAMPLE_RATE)
  close(): void;
}

createLiveStt(options: LiveSttOptions, callbacks: LiveSttCallbacks): LiveStt
```

- `session.ts` ne connaît que `LiveStt` et `createLiveStt`.
- Le constructeur de `FluxSTT` garde sa signature actuelle `(language, keywords, callbacks)` ; c'est `createLiveStt` qui adapte `LiveSttOptions`.
- `keyterms` est traduit dans le dialecte de chaque adapter (`keyterm` chez Deepgram, `prompts` chez Inworld).
- Après `close()`, un adapter n'émet plus aucun callback (drapeau `closed`, comme dans `FluxSTT`).

### Port batch

```ts
interface BatchStt {
  transcribe(audio: Buffer, opts: { language: string; keyterms?: string[] }): Promise<SttUtterance[]>;
}

getBatchStt(): BatchStt
```

`DeepgramUtterance` est renommé `SttUtterance` dans `packages/lecture` (`stt/types.ts`, `stt/map-utterances.ts`, son test, et l'import backend). Même forme, inchangée : tous les champs optionnels (`start`, `end`, `confidence`, `transcript`, `speaker`).

### Règles communes

- Chaque adapter garde ses réglages propres (`eot_threshold: 0.85` chez Flux, seuils de fin de tour chez Inworld) en constantes commentées en tête de fichier, jamais dans `session.ts`.
- L'encodage de transport (binaire ou base64 JSON) est caché dans l'adapter.
- Les logs de `session.ts` deviennent neutres (« STT connected », « keyterms: … »). Chaque adapter loggue ses détails.

## Adapter Inworld (`providers/inworld-live.ts`)

- **Connexion** avec `ws` (déjà dépendance directe du backend) sur `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`, en-tête `Authorization: Basic ${INWORLD_API_KEY}`. La clé du portail est déjà en Base64 : elle n'est pas ré-encodée.
- **Premier message** :
  ```json
  { "transcribeConfig": {
      "modelId": "inworld/inworld-stt-1",
      "audioEncoding": "LINEAR16",
      "sampleRateHertz": 16000,
      "language": "fr",
      "prompts": ["<keyterms>"],
      "endOfTurnConfidenceThreshold": 0.7,
      "inworldSttV1Config": { "minEndOfTurnSilenceWhenConfident": 300, "maxTurnSilence": 1200 }
  } }
  ```
  `language` reçoit la langue de la session (`fr` ici à titre d'exemple ; format et cas du mélange FR/EN dans les questions ouvertes 1 et 4). `onListening()` n'est appelé qu'une fois la config envoyée. Tout audio reçu avant est ignoré (comportement identique à `FluxSTT`).
- **Audio** : `{"audioChunk":{"content":"<base64>"}}`.
- **Réception** : seul `result.transcription` avec `isFinal: true` et un texte non vide déclenche `onTranscript`. Les résultats interim, `speechStarted`, `speechStopped`, `usage` et `voiceProfile` sont ignorés.
- **Fermeture** : `{"closeStream":{}}` puis `ws.close()`.
- **Seuils de fin de tour** : valeurs de départ (exemple de la doc), les défauts Inworld (`maxTurnSilence` 300 ms, confiance 0.4) étant trop agressifs pour un entretien. À ajuster au test réel, comme `eot_threshold` l'a été pour Flux.
- **`inactivityTimeoutSeconds`** : à régler ou omettre pour qu'une longue pause ne ferme pas le flux.
- **Chinois** (`zh`) : non listé en streaming chez Inworld. L'adapter appelle `onError` avec un message explicite plutôt que d'échouer silencieusement.

### Questions ouvertes (à trancher au premier test réel avec la clé)

1. Format de `language` : `fr` ou `fr-FR` (la doc est incohérente entre streaming et sync).
2. Emplacement exact des champs de seuil (racine de `transcribeConfig` ou sous `inworldSttV1Config`). On suit l'exemple de la doc.
3. Sens de `isFinal` : un tour entier ou une phrase. Départ : émettre chaque final tel quel. Si ça sur-segmente, ajouter un regroupement dans l'adapter (le debounce de `session.ts` fait déjà un premier filet).
4. Français et anglais mélangés : `language: "fr"` ou omission (auto-détection). Tester les deux, garder le meilleur.
5. Chinois : confirmer l'absence de support streaming.

## Configuration et erreurs

- `STT_LIVE_PROVIDER=deepgram|inworld` (défaut `deepgram` : aucun changement de comportement sans action).
- `STT_BATCH_PROVIDER=deepgram` (seule valeur supportée pour l'instant).
- `INWORLD_API_KEY` (uniquement requise si `STT_LIVE_PROVIDER=inworld`).
- **Échec rapide** : une valeur inconnue fait échouer le démarrage du serveur avec un message clair, sans fallback silencieux. Au boot, une ligne de log : `STT live=… batch=…`.
- **Erreurs runtime** : clé absente, erreur WebSocket, fermeture inattendue → `onError(message)` → `session:error` côté client (comportement actuel). Pas de reconnexion automatique.
- Mise à jour de `apps/backend/.env.example` et de la section STT / variables d'environnement de `CLAUDE.md`.

## Tests

- **Adapter Inworld** (`ws` mocké, sur le modèle du test Flux qui mocke le SDK) : en-tête d'auth, contenu du premier message, emballage base64, ignorance des interim et des finals vides, `closeStream` à la fermeture, mapping des erreurs, aucun audio envoyé avant la config, erreur explicite pour `zh`.
- **Fabrique** : défaut deepgram, inworld, valeur inconnue → erreur.
- **`deepgram-flux.test.ts`** : déplacé avec le module, fond inchangé (`eot_threshold: 0.85`).
- **10 tests existants à mettre à jour** (modification mécanique) :
  - 8 fichiers `session*.test.ts` qui mockent `../deepgram-flux.js` → mock de `createLiveStt` dans `../stt/index.js`.
  - `session-keywords.test.ts` vérifie désormais les arguments de `createLiveStt` (`{ language, keyterms }`) plutôt que ceux du constructeur `FluxSTT`.
  - 2 fichiers `lecture-*.test.ts` qui mockent `../deepgram-batch.js` → mock de `getBatchStt`.
- `deepgram-batch.test.ts` suit le déplacement du module.

## Ordre d'exécution (commits séparés)

1. **Refactor pur, Deepgram uniquement** : ports, fabrique, déplacement des adapters, renommage `SttUtterance`, suppression de `groq-stt.ts`, mise à jour des mocks. Typecheck (`apps/backend`, `apps/web`) et `pnpm test` verts, comportement identique.
2. **Adapter Inworld** avec ses tests unitaires, config d'env, `.env.example`, `CLAUDE.md`.
3. **Validation réelle** avec la clé : trancher les questions ouvertes, régler les seuils.
4. **Optionnel (à confirmer)** : `apps/backend/scripts/stt-compare.ts`, qui envoie un même fichier audio en temps réel à chaque fournisseur live et affiche transcripts et nombre de tours, pour comparer Flux et Inworld sans passer par Google Meet.

## Résultats du test réel (2026-09-20)

Enregistrement : cours de 103 min en français (monologue, un seul locuteur). Extrait 0:00–10:00 rejoué en temps réel (16 kHz mono) avec `scripts/stt-compare.ts`, Flux et Inworld en parallèle, `language=fr`, sans keyterms, avec 4 s de silence diffusé en fin de flux. Aucune erreur des deux côtés.

**Réponses aux questions ouvertes**
1. Format de `language` : `fr` est accepté. `fr-FR` non testé.
2. Placement des seuils : la config (`endOfTurnConfidenceThreshold` à la racine de `transcribeConfig`, `minEndOfTurnSilenceWhenConfident` / `maxTurnSilence` sous `inworldSttV1Config`) est acceptée sans erreur. Inférence : le serveur rejette normalement les champs inconnus, donc le placement est valide ; l'effet réel des valeurs reste à mesurer.
3. Sens de `isFinal` : un seul final par tour, avec le texte complet du tour ; les interim sont des révisions cumulatives du tour en cours. En parole continue, les finals arrivent à cadence quasi fixe (~30,6 s : 32,0 / 62,6 / 93,2 / 123,9 s…), ce qui correspond au plafond de durée de tour, et coupent parfois au milieu d'un groupe syntaxique. Avec les seuils de départ (0.7 / 300 ms / 1200 ms), la fin de tour par silence ne se déclenche presque jamais sur ce cours.
4. FR/EN mélangé : non testé (enregistrement quasi exclusivement français).
5. Chinois : non testé.
Autres constats : auth `Basic <clé>` OK ; formes des messages conformes à l'adapter (`result.transcription`, `speechStarted`, `usage`) ; aucune erreur serveur observée, donc la forme `{ error: { message } }` reste non vérifiée.

**Comparaison (10 min)**

| | Flux | Inworld |
|---|---|---|
| Tours | 18 | 25 |
| Mots (couverture) | 1193 | 1171 |
| Mots par tour (médiane / max) | 28 / 276 | 58 / 71 |
| Intervalle entre tours (médiane / max) | 13 s / 133 s | 31 s / 31 s |
| Tours ne finissant pas par `. ? ! …` | 2/18 | 0/25 |
| Disfluences « euh » conservées | 0 | 3 |
| Premier tour livré | 19,9 s | 32,0 s |

Qualité du texte comparable (mêmes erreurs de vocabulaire sur les sigles). Flux segmente sur les pauses (tours de 1 à 276 mots) ; Inworld segmente surtout sur la durée (~30 s), ce qui ajoute de la latence sur une parole continue et coupe des phrases.

**Limites et suite**
- Un cours n'est pas un entretien : peu de pauses, un seul locuteur. La segmentation Inworld peut être meilleure sur un audio avec alternance de locuteurs.
- Pistes : rejouer avec un enregistrement d'entretien réel ; essayer des seuils plus courts (`maxTurnSilence` 500–800 ms, `endOfTurnConfidenceThreshold` plus bas) pour que la fin de tour se déclenche sur les pauses ; tester `language` omis pour le FR/EN mélangé.
- Conclusion provisoire : ne pas basculer le défaut sur Inworld sur la base de ce test.
