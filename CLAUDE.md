# CLAUDE.md — Instructions pour Claude Code

## Projet

VoxHelp est un assistant IA temps réel pour appels vidéo. Deux modes : traducteur live (malgache→français) et souffleur d'entretien technique. Web app Phase 1, Electron Phase 2.

## Structure

Monorepo pnpm workspaces :
- `packages/shared/` — types TypeScript partagés (messages WebSocket, config)
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
- **STT** : Deepgram Nova-3 (FR/EN streaming), Groq Whisper large-v3-turbo (malgache, chunks)
- **LLM** : Claude Sonnet 4 via @anthropic-ai/sdk (streaming)

## Conventions

- TypeScript strict, pas de `any`
- ESM partout, imports avec extensions `.js` dans le backend
- camelCase variables/fonctions, PascalCase types/composants, kebab-case fichiers
- React : functional components + hooks custom dans `hooks/`
- CSS : Tailwind utility classes uniquement
- Pas de : Redux, CSS modules, styled-components, classes React

## Variables d'environnement

Fichier `apps/backend/.env` (copier `.env.example`) :
- `DEEPGRAM_API_KEY` — STT français/anglais
- `GROQ_API_KEY` — STT malgache (Whisper)
- `ANTHROPIC_API_KEY` — Claude Sonnet
- `PORT` — port backend (default 3001)
- `CORS_ORIGIN` — origin frontend (default http://localhost:5173)

## Architecture clé

Le flux temps réel :
1. Frontend capture l'audio de l'onglet (tab capture) → PCM 16kHz mono → base64
2. Envoi via WebSocket au backend toutes les ~250ms
3. Backend route vers Deepgram (streaming FR/EN) ou Groq Whisper (chunks malgache)
4. Transcription finale → Claude Sonnet en streaming (traduction ou suggestion)
5. Tokens streamés au frontend → affichage progressif

## Fichiers importants

- `packages/shared/src/index.ts` — Contrat WebSocket (tous les types de messages)
- `apps/backend/src/session.ts` — Orchestrateur central (STT + LLM par connexion)
- `apps/backend/src/prompts.ts` — System prompts (traducteur + entretien)
- `apps/web/src/App.tsx` — UI complète
- `apps/web/src/hooks/useAudioCapture.ts` — Capture audio navigateur
- `SPEC.md` — Spécification technique détaillée avec roadmap

## Ce qui est fait

- Monorepo setup complet
- Types WebSocket partagés
- Backend Fastify + WebSocket
- Session manager avec routing STT (Deepgram / Groq)
- Intégration Deepgram streaming
- Intégration Groq Whisper chunks
- Claude Sonnet streaming
- Prompts traducteur + entretien
- Frontend React avec hooks audio/WS
- UI complète (sidebar config + flux live)
- Tout compile en TypeScript strict

## Prochaines priorités

1. Tester le STT malgache (Groq Whisper) — valider la qualité
2. Ajouter VAD (Voice Activity Detection) côté client
3. Migrer ScriptProcessorNode → AudioWorklet
4. Reconnexion WebSocket automatique
5. Auth (Supabase) + billing (Stripe)
6. Electron wrapper (Phase 2)
