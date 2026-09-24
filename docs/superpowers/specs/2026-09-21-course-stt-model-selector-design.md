# Choix du modèle de transcription pour la verticale cours — Design

Date : 2026-09-21
Statut : design validé en brainstorming, en attente de relecture du spec
Prolonge : `2026-09-21-stt-model-selector-design.md` (choix du modèle pour le live) et `2026-09-20-stt-provider-decoupling-design.md` (ports `LiveStt` / `BatchStt`)

## Contexte et objectif

Le live (entretiens) permet de choisir le modèle STT depuis l'interface (Deepgram Flux ou Inworld). La verticale **cours** transcrit un fichier enregistré (« batch ») avec un seul modèle câblé, Deepgram Nova-3. Objectif : le même choix de modèle sur l'écran d'import d'un cours, avec les mêmes familles que l'entretien : **Deepgram** (Nova-3 pour les fichiers ; Flux n'existe qu'en streaming) et **Inworld**.

Hors périmètre :
- Le live des cours (toujours reporté), la reconnexion, un troisième fournisseur.
- Le choix du modèle du LLM (Claude) de la pipeline cours.
- Optimiser la mémoire du serveur pour les très gros fichiers (le fichier reste assemblé en `Buffer`, comme aujourd'hui).

## Ce que le flux cours fait aujourd'hui

`UploadScreen` → `useCourseAnalysis` → `uploadAudioChunked` : le navigateur envoie le fichier par morceaux, puis `POST /api/lecture/audio-chunk/finalize` (`{ uploadId, totalChunks, language, existingGlossary }`) ; le serveur réassemble le fichier en `Buffer` et le passe **brut** à `getBatchStt().transcribe(buffer, { language, keyterms })`, c'est-à-dire à Deepgram Nova-3, qui décode lui-même n'importe quel conteneur (mp3, m4a, mp4/m4v…). Une route jumelle `POST /api/lecture/transcribe-audio` (multipart) existe pour la page de debug. Le résultat est une liste de `SttUtterance` (secondes, avec `confidence` obligatoire), convertie en `TranscriptSegment` ; la confiance de chaque segment est **affichée au LLM** (`packages/lecture/src/prompts.ts:114`).

## Faits mesurés sur l'API réelle (2026-09-21, cours de 103 min, `.m4v` de 275 Mo)

**API synchrone d'Inworld** (`POST /stt/v1/transcribe`) :

| | Constat |
|---|---|
| Formats acceptés | `WAV, MP3, OGG, FLAC, M4A, WebM` ; un `.mp4/.m4v` est refusé (`unsupported audio format`) |
| Taille maximale | **32 Mio par appel** (`larger than max (… vs 33554432)`, sur les octets audio ; la doc dit ~16 Mo) |
| Vitesse | 10 min d'audio en 6,7 s (~90× le temps réel) |
| Mots horodatés | oui avec `include_word_timestamps: true` ; **sans ponctuation** ; `confidence` toujours 0 |
| Résultat | un texte ponctué par requête, pas de découpage en phrases |
| `prompts` | acceptés dans l'API synchrone, mêmes règles que le live (`C#` refusé) |

**ffmpeg** (paquet `ffmpeg-static`, build 6.0, 46 Mo, licence GPL) : convertit ton `.m4v` entier en WAV 16 kHz mono en ~8 s (761× le temps réel) **et** détecte les silences dans la même passe (`silencedetect=noise=-35dB:d=0.4`) : 1 480 silences, dont 22 à 31 dans ±60 s de chaque multiple de 10 min. Sa sortie WAV n'a pas toujours un en-tête de 44 octets (chunk `LIST`).

**Alignement texte / mots** : en extrayant les « vrais mots » du texte (`[\p{L}\p{N}]+(['’-][\p{L}\p{N}]+)*`), 355 mots pour 355 mots horodatés, zéro désaccord. Un jeton isolé `?` (typographie française) décale tout si on découpe sur les espaces.

**Qualité comparée sur les mêmes 10 minutes** : Nova-3, Inworld et `whisper-large` (Deepgram) sont proches à ~91 % entre eux ; Nova-3 3,3 s, Inworld 7,1 s, whisper-large 80 s. Aucun gagnant net : le choix du modèle est une préférence de l'utilisateur, pas une amélioration démontrée.

## Design

### 1. Backend : choix du modèle batch par requête

Le registre batch prend la forme du registre live (`apps/backend/src/stt/index.ts`) :

```ts
interface BatchProviderEntry { label: string; requiredEnv: string; transcriber: BatchStt }
// deepgram: { label: "Deepgram Nova-3", requiredEnv: "DEEPGRAM_API_KEY", … }
// inworld:  { label: "Inworld",         requiredEnv: "INWORLD_API_KEY",  … }   (ajouté avec l'adapter)
```

- `listBatchProviders(): SttProviderInfo[]`, `defaultBatchProviderId(): string` (valeur de `STT_BATCH_PROVIDER`, sinon `deepgram`), `getBatchStt(providerId?)` : un identifiant explicite l'emporte sur `STT_BATCH_PROVIDER` ; inconnu = `SttProviderError('Modèle STT inconnu : "x"')`. Un modèle connu mais sans clé n'est pas bloqué par la fabrique : l'adapter échoue avec une erreur claire.
- Route `GET /api/stt/batch-providers` (même contrôle de jeton que les autres) : `SttProvidersResponse`, type partagé existant.
- `POST /api/lecture/audio-chunk/finalize` (corps JSON) et `POST /api/lecture/transcribe-audio` (champ de formulaire) acceptent `sttProvider` optionnel. Absent ou vide = `STT_BATCH_PROVIDER` : **comportement par défaut inchangé**. Valeur non textuelle = `400 Invalid sttProvider` ; identifiant inconnu = `400` avec le message de `SttProviderError`. Le modèle est résolu **avant** le travail lourd ; sur `finalize`, un rejet nettoie aussi l'upload temporaire.

### 2. Adapter Inworld pour les fichiers (`stt/providers/inworld-batch.ts`)

Pipeline de `transcribe(audio, { language, keyterms })` :
1. Le `Buffer` est écrit dans un dossier temporaire (`mkdtemp`), toujours supprimé à la fin (`finally`).
2. **Une seule passe ffmpeg** convertit en WAV 16 kHz mono PCM16 et détecte les silences (`ffmpeg.ts`, arguments fixes, binaire = `FFMPEG_PATH` sinon `ffmpeg-static`).
3. **Découpage** (`planCuts`, fonction pure) : une coupe près de chaque multiple de 600 s, au milieu du plus long silence dans ±60 s, sinon coupe exacte ; pas de coupe si la fin restante est < 30 s. Tout morceau fait donc au plus 720 s (23 Mo), sous la limite de 32 Mio.
4. Les morceaux sont lus par tranches d'octets dans le WAV (l'en-tête est parsé, pas supposé de 44 octets) et enveloppés dans un WAV canonique. Requêtes en parallèle (3 max), 2 reprises (1 s puis 3 s) sur erreur réseau, `429` ou `5xx`, aucune reprise sur `4xx`. Config : `model_id`, `language`, `audio_encoding: LINEAR16`, `sample_rate_hertz: 16000`, `include_word_timestamps: true`, `prompts` issus de `sanitizeInworldPrompts` (réutilisé du live).
5. **Phrases** (`buildUtterances`, fonction pure) : coupe du texte ponctué après `. ! ? …`, mots extraits par expression régulière, alignés un pour un sur les mots horodatés (proportionnellement si les décomptes diffèrent), temps décalés du début du morceau. Une phrase de plus de 60 mots est redécoupée par tranches de 40. Sans mots horodatés, un seul énoncé couvre le morceau.
6. **Confiance** : Inworld renvoie 0 ; le LLM lit la confiance de chaque segment : valeur neutre `UNKNOWN_CONFIDENCE = 0.9`.

Erreurs : clé absente, ffmpeg manquant ou en échec, réponse Inworld invalide ou non-2xx après reprises → `Error` au message sans clé ni contenu utilisateur ; les routes répondent déjà `502 Audio transcription failed`.

**Dépendance** : `ffmpeg-static` (installation qui télécharge un binaire : à ajouter à `pnpm.onlyBuiltDependencies` du `package.json` racine, pnpm 10 bloquant sinon les scripts d'installation). Variable optionnelle `FFMPEG_PATH` pour utiliser le binaire du serveur en production. Le binaire est sous licence GPL : sans conséquence pour un service hébergé, à connaître si l'application est un jour distribuée.

### 3. Interface

- `useSttProviders(token, kind = "live")` est généralisé : `kind` choisit la route (`/api/stt/providers` ou `/api/stt/batch-providers`) et la clé de mémorisation (`voxhelp.sttProvider` ou `voxhelp.batchSttProvider`). Les appelants existants (live) ne changent pas.
- `useCourseAnalysis` expose `sttProviders`, `sttProvider`, `setSttProvider` et passe le choix à `uploadAudioChunked`, qui l'ajoute au corps de `finalize`.
- `UploadScreen` : champ « Modèle de transcription » (`Select` du thème cours, comme « Langue »), options grisées « (non configuré) » si la clé manque, verrouillé pendant l'analyse, masqué si la liste est vide. Le composant du live (`SttProviderSelect`, style de l'en-tête sombre) n'est pas réutilisé : le thème cours a son propre style de `Select`.

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| `sttProvider` non textuel | `400 Invalid sttProvider` |
| `sttProvider` inconnu | `400` `Modèle STT inconnu : "x"` (id borné et nettoyé) |
| Modèle connu sans clé (Inworld) | `502 Audio transcription failed`, cause `INWORLD_API_KEY not set` dans les logs ; le menu le grise |
| ffmpeg absent / échec | `502`, cause dans les logs |
| Inworld 429/5xx | 2 reprises puis `502` |
| Liste des modèles injoignable côté front | champ masqué, défaut serveur |

## Tests

- **Backend (vitest)** : registre batch (id explicite, id inconnu, liste, défaut) ; route `GET /api/stt/batch-providers` ; routes `finalize` et `transcribe-audio` (transmission de `sttProvider`, absent, inconnu, non textuel) ; `planCuts`, `parseSilences`, `findDataChunk` / `wavFromPcm`, `buildUtterances` (fonctions pures) ; `ffmpeg` (arguments, chemin, et une **vraie conversion** d'un petit WAV avec le binaire installé) ; orchestrateur Inworld avec faux `fetch`, fausse conversion, petits paramètres de découpage (requête, `prompts` nettoyés, décalage des temps, reprises, pas de reprise sur 400, pas de fuite de clé, nettoyage du dossier temporaire, concurrence bornée, audio vide).
- **Front** : aucun outil de test dans `apps/web` ; typecheck, build, contrôle visuel par l'utilisateur.
- **Réel (avec la clé, hors CI, par le contrôleur)** : le cours entier de 103 min passé par l'adapter Inworld réel puis par Nova-3 : durée, nombre de mots, temps monotones, dernière fin ≈ 6 180 s, aucun mot perdu ou doublé aux coupures, `prompts` acceptés.

## Points incertains à confirmer en réel

- Limites de débit d'Inworld sur un cours long (3 requêtes parallèles, ~11 morceaux).
- Qualité sur un cours entier (mesurée sur 10 minutes seulement) et aux jointures des morceaux.

## Ordre des commits

Sur une nouvelle branche `feat/course-stt-model-selector` issue de `main` :
1. **Backend** : registre batch, route de liste, `sttProvider` sur les deux routes.
2. **Inworld batch** : ffmpeg, découpage, phrases, orchestrateur, dépendance, docs d'environnement.
3. **Front** : hook généralisé, écran d'import, documentation.
