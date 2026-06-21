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

- **Runtime** : Node.js >= 20
- **Langage** : TypeScript strict, ESM (`"type": "module"`)
- **Frontend** : React 19, Vite 6, Tailwind CSS 3.4
- **Backend** : Fastify 5, @fastify/websocket
- **STT** : Deepgram Flux Multilingual streaming v2 (PCM 16kHz mono) + correction Haiku
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
- `DEEPGRAM_API_KEY` — STT streaming
- `ANTHROPIC_API_KEY` — Claude Sonnet (assist + JSON)
- `PORT` — port backend (default 3001)
- `CORS_ORIGIN` — origin frontend (default http://localhost:5173)

## Architecture clé

Flux demo complet :

**Prep** : saisie job description → `POST /api/analyze-job` → Claude JSON → questions + scorecard affichés

**Live** :
1. Frontend capture l'audio de l'onglet → PCM 16kHz mono base64 (ScriptProcessorNode + RMS VAD)
2. `audio:chunk` via WebSocket → Deepgram Flux v2 streaming STT (end-of-turn detection intégré)
3. `transcript:final` → correction Haiku → Claude JSON live-assist
4. Résultats poussés au frontend : `assist:chunk`, `tech:translation`
5. Recruiter coche questions (`question:mark-asked`) et note critères (`criterion:score`)

**Report** : `POST /api/generate-report` → Claude JSON → rapport structuré avec recommandation

## Fichiers importants

- `packages/shared/src/index.ts` — Tous les types (ClientMessage, ServerMessage, domaine)
- `apps/backend/src/session.ts` — Orchestrateur par connexion WebSocket
- `apps/backend/src/llm.ts` — `generateFromPrompt` (streaming) + `callClaudeJSON<T>` (JSON)
- `apps/backend/src/routes.ts` — Routes REST (`/api/analyze-job`, `/api/generate-report`)
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
