# CLAUDE.md — Instructions pour Claude Code

## Projet

VoxHelp est un copilote d'entretien technique en temps réel. Demo track : flux Prep → Live → Report, sans auth, tout en mémoire.

## Structure

Monorepo pnpm workspaces :
- `packages/shared/` — types TypeScript partagés (messages WebSocket, types domaine)
- `apps/backend/` — serveur Fastify + WebSocket + STT + LLM
- `apps/web/` — frontend React + Vite + Tailwind

## Commandes

```bash
pnpm install              # Installer les dépendances
pnpm dev                  # Lancer backend + frontend en parallèle
pnpm dev:backend          # Backend seul (port 3001)
pnpm dev:web              # Frontend seul (port 5173)
pnpm build                # Build tout
```

### Typecheck

```bash
cd apps/backend && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

### Ajouter des dépendances

```bash
pnpm --filter @voxhelp/backend add <package>
pnpm --filter @voxhelp/web add <package>
pnpm --filter @voxhelp/shared add <package>
```

## Stack

- **Runtime** : Node.js >= 22 (requis par `unpdf`, utilisé pour le parsing PDF des CVs)
- **Langage** : TypeScript strict, ESM (`"type": "module"`)
- **Frontend** : React 19, Vite 6, Tailwind CSS 3.4
- **Backend** : Fastify 5, @fastify/websocket
- **STT** : ports `LiveStt` / `BatchStt` (`apps/backend/src/stt/`), fournisseur choisi par env — live : Deepgram Flux Multilingual streaming v2 (défaut) ou Inworld STT (PCM 16kHz mono) + correction Haiku ; batch (cours) : Deepgram Nova-3 (défaut) ou Inworld (API synchrone via ffmpeg)
- **LLM** : Claude Sonnet 4.6 via @anthropic-ai/sdk (JSON)

## Conventions

- TypeScript strict, pas de `any`
- ESM partout, imports avec extensions `.js` dans le backend
- camelCase variables/fonctions, PascalCase types/composants, kebab-case fichiers
- React : functional components + hooks custom dans `hooks/`
- CSS : Tailwind utility classes uniquement
- Pas de : Redux, CSS modules, styled-components, classes React

## Variables d'environnement

Fichier `apps/backend/.env` (copier `.env.example`) :
- `DEEPGRAM_API_KEY` — STT live (Flux) et batch (Nova-3)
- `STT_LIVE_PROVIDER` — modèle STT live **par défaut** : `deepgram` (défaut) ou `inworld` (expérimental : validé sur un cours, pas encore sur un entretien ; tours coupés à ~30 s en parole continue ; `zh` non supporté). L'utilisateur peut en choisir un autre par session via le menu en haut à droite.
- `STT_BATCH_PROVIDER` — modèle de transcription **par défaut** des cours (fichiers) : `deepgram` (Nova-3, défaut) ou `inworld` (expérimental : conversion ffmpeg, découpage en morceaux ≤ 12 min). L'utilisateur peut en choisir un autre par cours sur l'écran d'import.
- `FFMPEG_PATH` — binaire ffmpeg utilisé par Inworld pour les cours (optionnel : sinon celui du paquet `ffmpeg-static`, sous licence GPL)
- `INWORLD_API_KEY` — clé « Basic (Base64) » du portail Inworld : rend Inworld sélectionnable dans le menu (requise aussi si `STT_LIVE_PROVIDER=inworld`)
- `ANTHROPIC_API_KEY` — Claude Sonnet (assist + JSON)
- `PORT` — port backend (default 3001)
- `CORS_ORIGIN` — origin frontend (default http://localhost:5173)

## Architecture clé

Flux demo complet :

**Prep** : saisie job description → `POST /api/analyze-job` → Claude JSON → questions + scorecard affichés

**Live** :
1. Frontend capture l'audio de l'onglet → PCM 16kHz mono base64 (ScriptProcessorNode + RMS VAD)
2. `audio:chunk` via WebSocket → STT streaming via `createLiveStt` (Deepgram Flux v2 par défaut, détection de fin de tour intégrée)
3. `transcript:final` → correction Haiku → Claude JSON live-assist
4. Résultats poussés au frontend : `assist:chunk`, `tech:translation`
5. Recruiter coche questions (`question:mark-asked`) et note critères (`criterion:score`)

**Report** : `POST /api/generate-report` → Claude JSON → rapport structuré avec recommandation

## Fichiers importants

- `packages/shared/src/index.ts` — Tous les types (ClientMessage, ServerMessage, domaine)
- `apps/backend/src/session.ts` — Orchestrateur par connexion WebSocket
- `apps/backend/src/stt/` — Ports STT (`types.ts`), sélection par env (`index.ts`), adapters (`providers/`)
- `apps/web/src/hooks/useSttProviders.ts` + `components/SttProviderSelect.tsx` — Menu de choix du modèle STT (liste lue sur `GET /api/stt/providers`)
- `apps/backend/src/llm.ts` — `generateFromPrompt` (streaming) + `callClaudeJSON<T>` (JSON)
- `apps/backend/src/routes.ts` — Routes REST (`/api/analyze-job`, `/api/generate-report`, `GET /api/stt/providers`, `GET /api/stt/batch-providers`)
- `apps/web/src/lecture-cours/UploadScreen.tsx` — Écran d'import d'un cours (dont le choix du modèle de transcription, liste lue sur `GET /api/stt/batch-providers`)
- `apps/backend/src/prompts/` — Prompts métier (job-analysis, live-assist, tech-translate, report)
- `apps/web/src/App.tsx` — Router 3 étapes (prep/live/report)
- `apps/web/src/hooks/useAudioCapture.ts` — Capture audio (ScriptProcessorNode + amplitude VAD)
- `apps/web/src/hooks/useWebSocket.ts` — Gestion WS + état session
- `apps/web/src/hooks/useApi.ts` — Appels REST (analyzeJob, generateReport)

## Prochaines priorités

1. Débugger la capture audio onglet (Google Meet) — vérifier RMS, sampleRate réel, routing audio OS
2. Tester le flux end-to-end complet (Prep → Live → Report)
3. Migrer ScriptProcessorNode → AudioWorklet
4. Reconnexion WebSocket automatique
5. Auth (Supabase) + billing (Stripe) — Phase 2
