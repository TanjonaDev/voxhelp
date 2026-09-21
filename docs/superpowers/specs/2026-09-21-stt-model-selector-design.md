# Sélecteur de modèle STT et `prompts` Inworld — Design

Date : 2026-09-21
Statut : design validé en brainstorming, en attente de relecture du spec
Prolonge : `2026-09-20-stt-provider-decoupling-design.md` (dont la « sélection du fournisseur par session », alors hors périmètre, est désormais dans le périmètre)

## Contexte et objectif

Le STT est découplé derrière des ports (`LiveStt` / `BatchStt`) et le fournisseur live se choisit par variable d'env (`STT_LIVE_PROVIDER`), globalement. Deux besoins :

1. **Choisir le modèle depuis l'interface** : une liste déroulante en haut à droite, aujourd'hui Deepgram Flux et Inworld, et d'autres modèles ajoutables ensuite « au moindre effort ».
2. **Aller au bout de l'équivalent du `keyterm` pour Inworld** (`prompts`). L'adapter passe aujourd'hui les mots-clés tels quels ; le test réel du 2026-09-21 montre que ça peut faire échouer toute la session (voir ci-dessous).

Hors périmètre :
- Le batch des cours (`STT_BATCH_PROVIDER`, Deepgram Nova-3 seul).
- Le réglage des seuils de fin de tour d'Inworld (tours coupés à ~30 s en parole continue) : sujet séparé, à traiter sur un enregistrement d'entretien.
- Un « contexte du poste » envoyé en `prompts` : décision de l'utilisateur, **mots-clés seulement** (même information que `keyterm` chez Flux).
- Changer de modèle en cours de session live.

## Faits mesurés sur l'API Inworld réelle (2026-09-21)

Sonde jetable sur `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`, `language: "fr"`, 66 cas.

**Règles de `prompts`** (`INVALID_ARGUMENT`, code 3, si violées) :

| | Valeur |
|---|---|
| Caractères acceptés | lettres (accents et autres alphabets compris), chiffres, espace, `. , ; : ! ? ' ( ) -` |
| Caractères refusés | `" _ + & % * = < > [ ] { } # / @ \| \ ~ ^ $` `` ` ``, apostrophe courbe `’`, emojis |
| Nombre maximum de prompts | 100 (`too many prompts: got 200, max 100`) |
| Longueur maximum par prompt | 100 caractères (`prompt[0] too long: got 500 characters, max 100`) |
| Éléments vides `""`, `" "`, tableau `[]` | acceptés |
| Exemples réels | `C#`, `F#`, `C++`, `CI/CD`, `TCP/IP`, `A/B testing`, `@angular/core` refusés ; `Node.js`, `.NET`, `OAuth 2.0`, `M.E.C.C.`, `Spring Boot`, `l'agilité`, `e-commerce` acceptés |

**Forme de l'erreur serveur** : `{"error":{"code":3,"message":"invalid transcribe config: invalid prompts: prompt[0] contains disallowed character \"#\"","details":[]}}` puis fermeture WebSocket code 1000. L'adapter actuel signale l'erreur puis re-signale la fermeture : deux `session:error` pour une seule panne.

**Effet réel** sur un passage de cours : sans `prompts`, « cette MECCE » ; avec `["MECC"]` ou une liste plus riche, « cette MECC ». Un essai a aussi changé « le Nouveau Testament » en « de nouveaux testaments », ce qui peut être du bruit (le décodage varie d'un run à l'autre) et n'est pas conclusif.

**Côté app**, `mergeKeywords` plafonne déjà à 50 termes de 100 caractères maximum, dédoublonnés : seuls les caractères posent problème, mais l'adapter ne doit pas dépendre du client.

## Design

### 1. Choix du modèle par session (backend)

**Registre** (`apps/backend/src/stt/index.ts`), source de vérité des modèles live :

```ts
interface LiveProviderEntry { label: string; requiredEnv: string; create: LiveSttFactory }
// deepgram: { label: "Deepgram Flux", requiredEnv: "DEEPGRAM_API_KEY", … }
// inworld:  { label: "Inworld",       requiredEnv: "INWORLD_API_KEY",  … }
```

- `listLiveProviders(): SttProviderInfo[]` → `{ id, label, available }`, où `available = Boolean(process.env[requiredEnv])`.
- `defaultLiveProviderId(): string` → valeur de `STT_LIVE_PROVIDER`, sinon `deepgram`.
- `createLiveStt(options, callbacks, providerId?)` : un identifiant explicite l'emporte sur `STT_LIVE_PROVIDER` ; un identifiant inconnu lève `SttProviderError('Modèle STT inconnu : "x"')`. Un modèle connu mais sans clé n'est pas bloqué ici : l'adapter le signale par `onError` (« INWORLD_API_KEY not set »), comme aujourd'hui. Le menu grise ces modèles, donc ce cas est rare.
- `assertSttConfig()` au boot est inchangé (valide l'env par défaut).

**Contrat partagé** (`packages/shared/src/index.ts`) :

```ts
SessionConfig.sttProvider?: string
interface SttProviderInfo { id: string; label: string; available: boolean }
interface SttProvidersResponse { default: string; providers: SttProviderInfo[] }
```

**Route** `GET /api/stt/providers`, avec le même contrôle de jeton Bearer que les autres routes, répond `SttProvidersResponse`.

**Démarrage de session** (`session.ts`) : `startSession` réinitialise l'état avant de créer le STT ; une erreur de fournisseur à ce moment laisserait une session à moitié démarrée. On crée donc l'objet STT **avant** de toucher à l'état, dans un `try/catch` : en cas d'échec, `session:error` avec le message, aucune `session:ready`, retour immédiat. Les tests de session existants (mock de `createLiveStt` seul) restent valides.

### 2. `prompts` Inworld

**Nettoyage** (`apps/backend/src/stt/providers/inworld-prompts.ts`, fonction pure) :

`sanitizeInworldPrompts(terms) → { prompts, adjusted, dropped }`, dans cet ordre :
1. normalisation Unicode NFC ; `’ ‘ ′` deviennent `'` ;
2. formes parlées, uniquement juste après une lettre ou un chiffre : `++` devient « plus plus », `#` devient « sharp » (`C#` → « C sharp », `F#` → « F sharp », `C++` → « C plus plus ») ;
3. tout autre caractère hors liste acceptée devient une espace (`CI/CD` → « CI CD », `@angular/core` → « angular core », `snake_case` → « snake case ») ;
4. espaces réduites et bords retirés ;
5. termes vides ou de plus de 100 caractères écartés ; doublons (insensible à la casse) écartés, le premier gagne ; 100 termes maximum, dans l'ordre reçu.

`adjusted` compte les termes modifiés, `dropped` les termes écartés. L'adapter les écrit dans son log de connexion, sans afficher de secret.

**Adapter** (`inworld-live.ts`) :
- `sendConfig` envoie `prompts` issus du nettoyage (omis s'il n'en reste aucun) ;
- **erreur unique** : les trois sources d'erreur (événement `error` du socket, fermeture inattendue, message serveur `{ error }`) passent par un même point qui ne signale qu'une fois par connexion ;
- **solidité** : `transcript` et `error.message` sont vérifiés comme chaînes avant usage (point parqué de la revue finale) ;
- **commentaire d'en-tête** mis à jour : sont désormais vérifiés l'auth, `fr`, le placement des seuils, la forme des erreurs et les règles de `prompts` ; restent non vérifiés `fr-FR` et le FR/EN mélangé, le réglage des seuils sur un vrai entretien, `inactivityTimeoutSeconds`, `es`/`pt`.

### 3. Interface (front)

- **Composant** `SttProviderSelect` (`apps/web/src/components/SttProviderSelect.tsx`) basé sur le `Select` de `ui.tsx`, placé en haut à droite de la `HeaderBar`, avant les éléments du mode live. Libellé accessible « Modèle de transcription ». Options grisées « (non configuré) » quand `available` est faux. Verrouillé pendant une session live (`isLive`), avec l'infobulle « Arrêtez la session pour changer de modèle ». Masqué si la liste est vide.
- **Hook** `useSttProviders(token)` (`apps/web/src/hooks/useSttProviders.ts`) : lit `GET /api/stt/providers` avec le jeton Bearer. Sélection initiale : dernier choix mémorisé (`localStorage`, clé `voxhelp.sttProvider`) s'il est encore disponible, sinon le défaut du serveur s'il est disponible, sinon le premier modèle disponible. Liste indisponible : menu masqué, le serveur applique son modèle par défaut.
- **Câblage** : l'état vit dans `SessionApp` (`App.tsx`), `handleStartAudio` passe `sttProvider` à `ws.startSession`, `OverlayPanel` et `HeaderBar` reçoivent la liste, la valeur et le callback.
- Le style suit le fichier voisin (styles en ligne et variables CSS du thème, comme le reste de `HeaderBar`).

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| `sttProvider` inconnu envoyé par un client | `session:error` `Modèle STT inconnu : "x"`, pas de session |
| Modèle connu sans clé serveur | l'adapter appelle `onError` (`… not set`) après `session:ready`, comme aujourd'hui ; le menu le grise |
| Terme de mot-clé avec caractère interdit (`C#`…) | nettoyé avant envoi, plus d'`INVALID_ARGUMENT` |
| Erreur serveur Inworld puis fermeture | un seul `session:error` |
| Liste des modèles injoignable côté front | menu masqué, défaut serveur |

## Tests

- **Backend** (vitest) :
  - `inworld-prompts.test.ts` : formes parlées, séparateurs, caractères acceptés conservés, apostrophes courbes, espaces, termes vides ou symboles seuls, doublons, limite de 100 caractères et de 100 termes, compteurs, entrée absente.
  - `inworld-live.test.ts` : `prompts` nettoyés envoyés, omis quand tout est écarté, erreur serveur signalée une seule fois avant la fermeture, `transcript` non textuel ignoré, `error.message` non textuel remplacé par un message générique.
  - `stt-factory.test.ts` : identifiant explicite prioritaire, identifiant inconnu, `listLiveProviders` selon l'env, `defaultLiveProviderId`.
  - `stt-providers-route.test.ts` : réponse par défaut, défaut piloté par `STT_LIVE_PROVIDER`.
  - `session-stt-provider.test.ts` : transmission de `sttProvider`, valeur absente, rejet avec `session:error` sans `session:ready`.
- **Front** : aucun outil de test dans `apps/web` (ni vitest ni testing-library) ; vérification par typecheck, build et contrôle visuel dans le navigateur. La logique de sélection initiale est isolée dans une fonction pure pour faciliter un futur test.
- **Réel (avec la clé, hors CI)** : la liste piégée `C#, CI/CD, TCP/IP, @angular/core, l’agilité, Genèse` passée à l'adapter via `stt-compare` : avant correction, erreur `invalid prompts` ; après, connexion établie et transcripts.

## Ordre des commits

1. **Inworld** : nettoyage des `prompts`, erreur unique, gardes de type, commentaire d'en-tête.
2. **Backend** : registre, `listLiveProviders` / `defaultLiveProviderId`, `sttProvider` dans le contrat partagé, route, démarrage de session.
3. **Front** : hook, composant, câblage, mise à jour de `CLAUDE.md`.
