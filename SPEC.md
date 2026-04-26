# VoxHelp — Spécification Technique Complète

## 1. Contexte Produit

### Qu'est-ce que VoxHelp ?

VoxHelp est un assistant IA temps réel qui écoute tes appels vidéo (Google Meet, Teams web, Zoom web) et affiche du contenu utile sur ton écran — soit une traduction live, soit des suggestions de réponse pour un entretien technique.

### Deux modes, un seul pipeline

**Mode Traducteur** : l'interlocuteur parle dans une langue (ex: malgache), VoxHelp transcrit et traduit en français sur l'écran de l'utilisateur. Traduction unidirectionnelle : on ne traduit que ce que l'interlocuteur dit.

**Mode Entretien** : l'intervieweur pose une question, VoxHelp la transcrit et génère une suggestion de réponse pertinente affichée sur l'écran du candidat.

### Utilisateur cible

- Développeurs en entretien technique (mode entretien)
- Personnes malgachophones/francophones en appel (mode traducteur)
- À terme : tout professionnel en appel qui a besoin d'aide temps réel

### Business model prévu

SaaS B2C : freemium (30 min/mois) + Pro (29€/mois illimité).

---

## 2. Architecture

### Vue d'ensemble

```
┌─────────────────────────────────────────┐
│  FRONTEND (React + Vite + TypeScript)   │
│  - Phase 1 : web app                   │
│  - Phase 2 : embedded dans Electron    │
│  - Capture audio (micro + tab)         │
│  - Affichage transcription + réponses  │
└────────────────┬────────────────────────┘
                 │ WebSocket (audio PCM base64)
                 ▼
┌─────────────────────────────────────────┐
│  BACKEND (Fastify + TypeScript)         │
│  - WebSocket server                     │
│  - Session manager                      │
│  - STT routing (Deepgram / Groq)        │
│  - LLM orchestration (Claude streaming) │
└─────────────────────────────────────────┘
```

### Monorepo structure

```
voxhelp/
├── pnpm-workspace.yaml
├── package.json                  # Scripts racine (dev, build)
├── tsconfig.json                 # Config TS partagée
├── packages/
│   └── shared/
│       └── src/index.ts          # Types WebSocket, constantes, helpers
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── index.ts          # Serveur Fastify + WS endpoint
│   │   │   ├── session.ts        # Orchestrateur par connexion client
│   │   │   ├── deepgram.ts       # STT streaming (FR/EN)
│   │   │   ├── groq-whisper.ts   # STT chunk-based (malgache)
│   │   │   ├── llm.ts            # Claude Sonnet streaming
│   │   │   └── prompts.ts        # System prompts (traducteur + entretien)
│   │   └── .env.example
│   └── web/
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx           # UI complète
│       │   └── hooks/
│       │       ├── useWebSocket.ts    # Gestion connexion + messages
│       │       └── useAudioCapture.ts # Capture micro + tab audio
│       ├── vite.config.ts
│       └── tailwind.config.js
└── docs/
    └── SPEC.md                   # Ce fichier
```

---

## 3. Stack Technique

| Couche | Techno | Version | Pourquoi |
|--------|--------|---------|----------|
| Runtime | Node.js | >= 20 | LTS, requis |
| Package manager | pnpm | latest | Workspaces, rapide |
| Monorepo | pnpm workspaces | - | Un seul `pnpm install` |
| Frontend framework | React | 19 | Standard |
| Build tool | Vite | 6 | HMR rapide, proxy WS |
| CSS | Tailwind CSS | 3.4 | Utility-first, rapide |
| Backend framework | Fastify | 5 | Perf, TypeScript natif, WebSocket intégré |
| WebSocket | @fastify/websocket | 11 | Intégré à Fastify |
| STT (FR/EN) | Deepgram Nova-3 | API streaming | Meilleur ratio latence/prix/qualité |
| STT (Malgache) | Groq Whisper large-v3-turbo | API REST | Seul STT fiable pour le malgache |
| LLM | Claude Sonnet 4 | @anthropic-ai/sdk | Qualité + streaming |
| Langage | TypeScript | 5.7+ | Strict mode, end-to-end type safety |

### Clés API requises

| Service | Variable d'env | Signup |
|---------|----------------|--------|
| Deepgram | `DEEPGRAM_API_KEY` | console.deepgram.com (200$ crédits gratuits) |
| Groq | `GROQ_API_KEY` | console.groq.com (gratuit, rate limited) |
| Anthropic | `ANTHROPIC_API_KEY` | console.anthropic.com |

---

## 4. Flux de données temps réel

### Pipeline principal

```
1. L'utilisateur démarre une session (mode + config)
   → Client envoie { type: "session:start", config }
   → Backend crée une Session, connecte le STT approprié

2. Audio capturé côté client
   → Tab capture (getDisplayMedia) pour l'audio de l'interlocuteur
   → Converti en PCM 16kHz mono Int16
   → Encodé en base64
   → Envoyé via WebSocket toutes les ~250ms

3. Backend reçoit l'audio
   → Forward vers Deepgram (streaming) ou Groq Whisper (chunks de 3s)
   → Deepgram renvoie des transcriptions partielles et finales
   → Groq renvoie uniquement des transcriptions finales

4. Sur transcription finale
   → Backend envoie { type: "transcript:final", text } au client
   → Backend lance Claude en streaming avec le contexte
   → Tokens streamés vers le client via { type: "suggestion:chunk", text }
   → Fin du stream : { type: "suggestion:done", fullText }

5. Client affiche
   → Transcriptions dans des bulles (gauche)
   → Traductions/suggestions dans des cartes (droite)
   → Streaming visible avec cursor clignotant
```

### Latence cible

| Étape | Objectif |
|-------|----------|
| Audio capture → serveur | < 100ms |
| STT (Deepgram streaming) | < 500ms |
| STT (Groq Whisper chunk) | < 1.5s |
| LLM first token | < 800ms |
| **Bout-en-bout** | **< 1.5s** (Deepgram) / **< 3s** (Groq) |

---

## 5. Protocole WebSocket

### Messages Client → Serveur (`ClientMessage`)

```typescript
| { type: "session:start"; config: SessionConfig }
| { type: "session:stop" }
| { type: "audio:chunk"; data: string }  // base64 PCM
| { type: "ping" }
```

### Messages Serveur → Client (`ServerMessage`)

```typescript
| { type: "session:ready"; sessionId: string }
| { type: "session:error"; error: string }
| { type: "transcript:partial"; text: string; speaker?: string }
| { type: "transcript:final"; text: string; speaker?: string }
| { type: "suggestion:start" }
| { type: "suggestion:chunk"; text: string }
| { type: "suggestion:done"; fullText: string }
| { type: "suggestion:error"; error: string }
| { type: "pong" }
```

### SessionConfig

```typescript
{
  mode: "interview" | "translator";
  // Mode traducteur
  sourceLanguage?: "mg" | "fr" | "en";
  targetLanguage?: "mg" | "fr" | "en";
  // Mode entretien
  jobDescription?: string;
  cvContent?: string;
}
```

---

## 6. Composants Backend — Détail

### `index.ts` — Serveur

- Fastify avec CORS + WebSocket
- Port configurable via `PORT` (default 3001)
- CORS origin configurable via `CORS_ORIGIN` (default http://localhost:5173)
- Route `/health` pour healthcheck
- Route `/ws` pour WebSocket → crée une `Session` par connexion

### `session.ts` — Orchestrateur

Chaque connexion WebSocket crée une `Session` qui :
- Parse les messages JSON entrants
- Gère le lifecycle (start → audio → stop)
- Choisit le STT selon la langue source (Deepgram pour FR/EN, Groq pour MG)
- Maintient un `conversationHistory: string[]` (10 dernières transcriptions)
- Queue les transcriptions si le LLM est déjà en train de répondre (`pendingTranscript`)
- Cleanup propre à la déconnexion

### `deepgram.ts` — STT Streaming

- Connexion WebSocket vers `wss://api.deepgram.com/v1/listen`
- Params : model=nova-3, smart_format, interim_results, utterance_end_ms=1500, vad_events
- Audio : linear16, 16kHz, 1 channel
- Callbacks : `onPartial(text)`, `onFinal(text)`, `onError(err)`

### `groq-whisper.ts` — STT Chunk

- REST API : `POST https://api.groq.com/openai/v1/audio/transcriptions`
- Accumule les chunks audio dans un buffer
- Flush toutes les 3 secondes
- Crée un header WAV pour le PCM brut avant envoi
- Model : whisper-large-v3-turbo
- Callback : `onFinal(text)` uniquement (pas de partials)

### `llm.ts` — Claude Streaming

- SDK `@anthropic-ai/sdk`
- Model : `claude-sonnet-4-20250514`
- Max tokens : 1024
- System prompt construit dynamiquement selon le mode (via `prompts.ts`)
- User message : historique récent + nouvelle transcription
- Streaming : itère sur les `content_block_delta` events

### `prompts.ts` — Prompts système

**Mode traducteur** :
- Traduit uniquement de la langue source vers la cible
- Pas de commentaires, pas d'explications
- Garde le ton et le registre
- Mots incompris entre crochets

**Mode entretien** :
- Génère des suggestions de réponse courtes (3-5 phrases)
- Techniques et précises
- Structure STAR pour questions comportementales
- Intègre le CV et la JD si fournis
- Même langue que la question

---

## 7. Composants Frontend — Détail

### `useAudioCapture.ts`

Deux modes de capture :
- `startMicrophone()` : `getUserMedia({ audio: true })` — pour capter sa propre voix
- `startTabCapture()` : `getDisplayMedia({ video: true, audio: true })` — pour capter l'audio de l'interlocuteur via l'onglet. Le track vidéo est immédiatement stoppé.

Pipeline audio :
1. `MediaStream` → `AudioContext` (16kHz)
2. `createMediaStreamSource` → `ScriptProcessorNode`
3. Float32 → Int16 PCM → base64
4. Envoi via callback `onAudioChunk(base64)`

### `useWebSocket.ts`

- Connexion auto au mount
- Reconnexion si déconnecté
- Ping/pong toutes les 30s
- State management :
  - `status: ConnectionStatus`
  - `transcripts: TranscriptEntry[]`
  - `currentPartial: string`
  - `suggestion: Suggestion | null`
- Parse les `ServerMessage` et met à jour le state

### `App.tsx`

Layout :
- **Header** : logo + status de connexion (dot vert/jaune/rouge)
- **Sidebar gauche (w-72)** : mode selector, config langue/JD, bouton start/stop, instructions
- **Zone principale** : transcriptions (bulles gauche) + suggestions (cartes droite, colorées selon le mode)

États visuels :
- Vide : emoji + texte d'onboarding
- En attente : animation pulse "En écoute..."
- Transcript partiel : italique, opacité réduite
- Suggestion en streaming : cursor clignotant via CSS `cursor-blink`

---

## 8. Configuration et déploiement

### Développement local

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env
# Remplir les 3 clés API

# Terminal 1
pnpm dev:backend   # Fastify sur :3001

# Terminal 2
pnpm dev:web        # Vite sur :5173 avec proxy WS vers :3001
```

### Variables d'environnement (apps/backend/.env)

```
DEEPGRAM_API_KEY=xxx
GROQ_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

### Vite proxy

Le `vite.config.ts` proxy `/ws` vers `ws://localhost:3001` pour éviter les problèmes CORS en dev.

---

## 9. Contraintes techniques

### Audio

- Format : PCM 16-bit signed, 16kHz, mono
- Chunks envoyés toutes les ~250ms
- `ScriptProcessorNode` utilisé (deprecated mais universel). Migration vers `AudioWorklet` prévue si problèmes de perf.
- Le buffer size est arrondi à la puissance de 2 la plus proche

### Navigateur

- Chrome obligatoire pour `getDisplayMedia({ audio: true })`
- L'utilisateur doit cocher "Partager l'audio" lors du partage d'onglet
- Fonctionne avec : Google Meet, Teams web, Zoom web (dans Chrome)
- Ne fonctionne PAS avec : apps desktop (Teams, Zoom, Slack)

### Malgache (STT)

- Deepgram ne supporte pas le malgache → fallback sur Groq Whisper
- Groq Whisper n'est pas streaming → chunks de 3s, flush asynchrone
- Latence plus élevée que pour FR/EN (~2-3s vs ~0.5s)
- La qualité de transcription malgache reste à valider empiriquement

---

## 10. Roadmap & TODO

### Phase 1 — MVP Web (actuel)

- [x] Monorepo setup (pnpm workspaces)
- [x] Types partagés (packages/shared)
- [x] Backend Fastify + WebSocket
- [x] Session manager avec routing STT
- [x] Intégration Deepgram streaming (FR/EN)
- [x] Intégration Groq Whisper (malgache)
- [x] Claude Sonnet streaming
- [x] Prompts traducteur + entretien
- [x] Frontend React + hooks audio/WS
- [x] UI complète avec sidebar config
- [ ] **Tester le STT malgache** (risque n°1)
- [ ] Tester latence bout-en-bout
- [ ] Affiner les prompts après tests réels
- [ ] Migrer ScriptProcessorNode → AudioWorklet
- [ ] Ajouter VAD (Voice Activity Detection) côté client pour ne pas streamer du silence
- [ ] Ajouter un indicateur de volume audio (VU meter)
- [ ] Gérer la reconnexion WebSocket automatique
- [ ] Ajouter un mode "micro uniquement" pour le traducteur en présentiel
- [ ] Error boundaries React

### Phase 2 — Auth & Billing

- [ ] Supabase Auth (email + OAuth Google)
- [ ] Stripe billing (freemium 30min/mois + Pro 29€/mois)
- [ ] Metering des minutes utilisées
- [ ] Dashboard utilisateur (historique sessions)
- [ ] Stockage optionnel des sessions (opt-in, RGPD)

### Phase 3 — Electron Desktop

- [ ] Wrapper Electron (`apps/desktop/`)
- [ ] Capture audio système (ScreenCaptureKit macOS / WASAPI Windows)
- [ ] Overlay transparent always-on-top
- [ ] `setContentProtection(true)` (invisible au screen share)
- [ ] Raccourcis globaux (Cmd+\ toggle, Cmd+Enter régénérer)
- [ ] Auto-updater (electron-updater + S3/R2)
- [ ] Build CI/CD (GitHub Actions, code signing)

### Phase 4 — Features avancées

- [ ] Upload CV + parsing (PDF → texte)
- [ ] Upload Job Description
- [ ] Résumé post-session (summary généré par Claude)
- [ ] Diarization (identifier qui parle)
- [ ] Mode "prospecteur téléphonique" (pour l'outil de gestion BTP/ménage)
- [ ] TTS optionnel (text-to-speech pour la traduction)
- [ ] Support multi-langues supplémentaires

---

## 11. Commandes utiles

```bash
# Dev (les deux en parallèle)
pnpm dev

# Dev séparé
pnpm dev:backend
pnpm dev:web

# Typecheck
cd apps/backend && npx tsc --noEmit
cd apps/web && npx tsc --noEmit

# Build
pnpm build

# Ajouter une dépendance au backend
pnpm --filter @voxhelp/backend add <package>

# Ajouter une dépendance au frontend
pnpm --filter @voxhelp/web add <package>
```

---

## 12. Conventions de code

- **TypeScript strict** : `strict: true`, pas de `any`
- **ESM** : `"type": "module"` partout
- **Imports** : extensions `.js` dans le backend (requis pour ESM Node)
- **Nommage** : camelCase pour les variables/fonctions, PascalCase pour les types/composants
- **Fichiers** : kebab-case (ex: `groq-whisper.ts`)
- **React** : functional components uniquement, hooks custom dans `hooks/`
- **CSS** : Tailwind utility classes, pas de CSS custom sauf animations dans `index.css`
- **Pas de** : classes React, Redux, CSS modules, styled-components
