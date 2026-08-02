# Keyterm boosting Deepgram à partir du CV + fiche de poste

## Contexte

`docs/superpowers/specs/2026-08-02-status-recruteur-rollup-theme-design.md` a introduit le vocabulaire acquis/à-creuser/pas-acquis, mais un problème antérieur du bilan de tests reste ouvert : les noms propres (nom d'entreprise, d'outil interne) sont parfois mal transcrits par Deepgram Flux (ex : "Cléo" → "Clés Haut"), car un terme rare n'a presque aucune probabilité a priori dans le modèle de langage générique.

Deepgram expose un mécanisme fait pour ça : le **keyterm prompting**, un paramètre `keyterm` sur la connexion `client.listen.v2.connect(...)` (SDK `@deepgram/sdk@5.4.0` installé, type `ListenV2Keyterm = string | string[]`, confirmé dans `V2Client.ConnectArgs`). Contraintes de l'API (vérifiées via la doc officielle + une discussion GitHub Deepgram sur l'API v2 Listen) :
- Chaque keyterm individuel : max 100 caractères
- Total sur tous les keyterms d'une requête : max 500 tokens (soft guidance ≈ 100 termes courts, moins si termes multi-mots)
- Recommandation Deepgram : se limiter aux 20-50 termes les plus pertinents

Aujourd'hui, `apps/backend/src/deepgram-flux.ts:43-49` n'envoie aucun `keyterm`. Le formulaire "Contexte du poste" existant (`OverlayPanel.tsx`, ~ligne 941-1005 : `jobTitle`/`jobLevel`/`jobStack`) est la seule source d'info sur le poste — il n'y a ni upload de fichier ni parsing PDF/DOCX dans le projet à ce jour (aucune dépendance de ce type dans `apps/backend/package.json`), ni route REST du tout (le fichier `routes.ts` mentionné dans `CLAUDE.md` n'existe plus — tout passe aujourd'hui par le WebSocket `/ws`).

Objectif produit : le recruteur peut optionnellement uploader le CV du candidat (recommandé, pas obligatoire) avant de démarrer l'entretien. Les termes qui en sont extraits (noms propres, entreprises, technos, certifs) + les termes déjà présents dans le champ "Stack" du formulaire existant sont envoyés à Deepgram comme `keyterm` pour améliorer la reconnaissance vocale sur ce vocabulaire spécifique au candidat.

## Décision

1. Nouvelle route REST `POST /api/extract-cv-keywords` : upload multipart d'un CV (PDF ou DOCX, 5 Mo max), parsing en texte brut, puis extraction des keyterms pertinents via un appel Claude (`callClaudeJSON`), qui retourne un JSON `{ keywords: string[] }` déjà conforme aux contraintes Deepgram (≤ 40 termes, chacun ≤ 100 caractères — la marge sous 50 est réservée aux termes dérivés du champ Stack).
2. Le champ CV est ajouté au formulaire Setup existant, marqué "recommandé". L'extraction se déclenche dès la sélection du fichier (pas au clic sur Démarrer), pour tourner en tâche de fond pendant que le recruteur termine de remplir le formulaire. Le bouton Démarrer est désactivé le temps de l'extraction **uniquement si un CV a été sélectionné** ; un échec d'extraction (parsing invalide, timeout LLM) débloque automatiquement le bouton et la session démarre sans keyterms CV — jamais de blocage définitif.
3. Au clic sur Démarrer, les termes du champ Stack sont dérivés localement par un simple split (pas de second appel LLM — recalculé à chaque clic, donc jamais périmé même si le recruteur modifie Stack après la fin de l'extraction CV), puis fusionnés + dédoublonnés avec les keyterms CV, plafonnés à 50 termes / 100 caractères chacun.
4. `SessionConfig` (`packages/shared`) gagne un champ optionnel `keywords?: string[]`, propagé via le message `session:start` existant (pas de nouveau message WebSocket) jusqu'à `deepgram-flux.ts`, qui l'ajoute au paramètre `keyterm` de `client.listen.v2.connect(...)`.

**Hors scope explicite** : les keyterms n'alimentent **pas** le prompt live-assist (`buildLiveAssistPrompt`) — ce mécanisme reste isolé à la reconnaissance vocale Deepgram. `jobContext.title`/`level`/`stack` continue d'alimenter le prompt live-assist exactement comme aujourd'hui, indépendamment de cette fonctionnalité.

## Comportement

### 1. Backend — nouvelle route (`apps/backend/src/index.ts`)

Nouvelles dépendances à ajouter :
- `@fastify/multipart` — gestion de l'upload de fichier
- `mammoth` (DOCX → HTML/texte) — actif, largement utilisé (1368+ dépendants), dernière version 1.12.0 au moment de la rédaction. API Node : `mammoth.extractRawText({ buffer })`.
- Pour le PDF → texte : le projet est en ESM strict (`"type": "module"`) partout, ce qui rend `pdf-parse` classique (interop CJS parfois fragile) moins sûr par défaut. Deux options équivalentes à trancher au moment du plan : `unpdf` (ESM-first, plus moderne) ou `@cedrugs/pdf-parse` (fork ESM-friendly, API identique à `pdf-parse` donc migration triviale si besoin). Choix exact + vérification de compatibilité Node 20 à faire au moment du plan d'implémentation, pas figé ici.

```
POST /api/extract-cv-keywords
Authorization: Bearer <supabase access_token>   (même vérification que le WS : supabaseAdmin.auth.getUser(token))
Content-Type: multipart/form-data
  champ "cv": fichier PDF ou DOCX, 5 Mo max

Réponse 200: { "keywords": string[] }
Réponse 400: type de fichier non supporté / fichier manquant
Réponse 401: token manquant/invalide
Réponse 502: échec de l'appel LLM (le parsing a réussi mais l'extraction a échoué)
```

Détection du type par le MIME/extension du fichier uploadé :
- `application/pdf` / `.pdf` → parsing PDF
- `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) → parsing DOCX
- autre → 400

Le texte extrait est tronqué à une longueur raisonnable avant l'appel LLM (ex. 20 000 caractères) pour éviter d'envoyer un CV anormalement long en entier — un CV dépasse rarement quelques pages.

### 2. Nouveau prompt (`apps/backend/src/prompts/cv-keyword-extraction.ts`)

```ts
export function buildCvKeywordExtractionPrompt(cvText: string): string {
  return `Tu extrais les termes qui aideront un système de reconnaissance vocale à bien transcrire un entretien technique avec ce candidat.

Contenu du CV :
"""
${cvText}
"""

Retourne un JSON strict (sans backticks, sans texte autour) :
{ "keywords": ["terme1", "terme2", ...] }

Règles :
- Uniquement des noms propres et termes spécifiques à CE candidat : noms d'entreprises, noms de produits/outils internes, certifications, technologies/frameworks nommés précisément, noms de projets.
- Pas de mots génériques (ex : "développeur", "expérience", "gestion de projet").
- Maximum 40 termes, les plus susceptibles d'être mal transcrits en priorité (noms propres rares avant termes techniques courants).
- Chaque terme fait au maximum 100 caractères, idéalement 1 à 4 mots.
- Si rien de pertinent n'est trouvé, retourne { "keywords": [] }.`;
}
```

Appelé via `callClaudeJSON<{ keywords: string[] }>(buildCvKeywordExtractionPrompt(cvText), "Extrais les keyterms.")`.

### 3. Fusion des keywords (`apps/web/src/lib/mergeKeywords.ts`, nouveau fichier frontend)

Vit côté frontend, pas backend : le split du Stack n'a besoin d'aucun aller-retour serveur, et c'est là que `handleStart` (section 4) a directement besoin du résultat avant d'appeler `onStartAudio`.

```ts
function deriveStackKeywords(stack: string): string[] {
  return stack
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 100);
}

function mergeKeywords(cvKeywords: string[], stackKeywords: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const term of [...cvKeywords, ...stackKeywords]) {
    const key = term.toLowerCase();
    if (seen.has(key) || term.length === 0 || term.length > 100) continue;
    seen.add(key);
    merged.push(term);
    if (merged.length >= 50) break;
  }
  return merged;
}
```

Déclenché côté frontend au clic sur Démarrer (le Stack n'a pas besoin d'aller-retour serveur), avant l'appel à `onStartAudio`.

### 4. Frontend — formulaire Setup (`apps/web/src/components/OverlayPanel.tsx`)

Nouveau state : `cvFile: File | null`, `cvKeywords: string[]`, `cvExtractionStatus: "idle" | "extracting" | "done" | "error"`.

Nouveau champ file input dans le bloc "Contexte du poste (optionnel)" existant, avec un libellé du type "CV du candidat (recommandé)". `onChange` déclenche immédiatement l'upload vers `/api/extract-cv-keywords` (nouveau hook dédié, ex. `apps/web/src/hooks/useCvKeywords.ts`, suivant le pattern des hooks existants `useAudioCapture`/`useWebSocket`/`useAuth`).

`handleStart` :
```ts
const handleStart = async () => {
  const stackKeywords = deriveStackKeywords(jobStack);
  const keywords = mergeKeywords(cvKeywords, stackKeywords);
  const jobContext = /* inchangé */;
  ws.startSession({ language: "fr", jobContext, keywords: keywords.length > 0 ? keywords : undefined });
  // ...
};
```

Le bouton Démarrer est désactivé (avec un indicateur de chargement) quand `cvFile !== null && cvExtractionStatus === "extracting"`. En cas d'`error`, le bouton se débloque immédiatement, la session démarre avec `cvKeywords = []` (donc uniquement les termes du Stack, s'il y en a) — pas de message bloquant, au plus un indicateur discret style "CV non pris en compte".

### 5. Types partagés (`packages/shared/src/index.ts`)

```ts
export interface SessionConfig {
  language: InterviewLanguage;
  jobContext?: JobContext;
  keywords?: string[];
}
```

### 6. Propagation jusqu'à Deepgram (`session.ts` → `deepgram-flux.ts`)

`session.ts` passe `config.keywords` au constructeur `FluxSTT` (nouveau paramètre). `deepgram-flux.ts` l'ajoute à l'objet de connexion :
```ts
const connection = await client.listen.v2.connect({
  model: "flux-general-multi",
  encoding: "linear16",
  sample_rate: 16000,
  language_hint: hints,
  ...(keywords && keywords.length > 0 ? { keyterm: keywords } : {}),
  Authorization: `Token ${apiKey}`,
});
```

## Hors scope

- Pas d'injection des keyterms dans `buildLiveAssistPrompt` — mécanisme isolé à la reconnaissance vocale.
- Pas de mise à jour des keyterms en cours de session via le message `Configure` du SDK (existant côté Deepgram mais non exploité ici) — les keyterms sont fixés une fois au démarrage de la session.
- Pas de stockage persistant du CV ni du texte extrait — traité en mémoire pour la durée de la requête d'extraction, jamais écrit sur disque ni en base.
- Pas de support d'autres formats que PDF/DOCX (pas de `.txt`, pas de copier-coller de texte libre).
- Pas de champ "fiche de poste" distinct du formulaire existant — les 3 champs titre/niveau/stack restent la seule source de contexte poste, réutilisés tels quels.

## Tests

- `deriveStackKeywords`/`mergeKeywords` vivent côté frontend (`apps/web/src/lib/mergeKeywords.ts`) où il n'y a pas d'infra de tests (cf. spec précédente) — pas de suite automatisée pour ces deux fonctions ; vérification manuelle au moment de l'implémentation (cas à couvrir à la main : dédoublonnage insensible à la casse, troncature à 50, filtrage des termes > 100 caractères).
- Backend : test d'intégration sur la route `/api/extract-cv-keywords` avec un mock de `callClaudeJSON` (pattern déjà utilisé dans `session.test.ts`) — vérifie l'auth (401 sans token), le rejet des types de fichier non supportés (400), et la forme de la réponse.
- Backend : test sur `deepgram-flux.ts`/`session.ts` vérifiant que `keyterm` est bien passé à `connect()` quand `keywords` est fourni dans `SessionConfig`, et absent sinon.
- Pas de test automatisé sur le parsing PDF/DOCX lui-même dans ce plan (dépendance externe) — vérification manuelle avec un vrai fichier CV recommandée au moment de l'implémentation.
