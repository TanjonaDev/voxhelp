# VoxHelp — Souffleur IA & Traducteur Live

Assistant IA temps réel qui écoute tes appels vidéo et affiche :
- **Mode Traducteur** : traduction live (malgache → français, etc.)
- **Mode Entretien** : suggestions de réponses pendant un entretien technique

## Architecture

```
apps/
  web/          → Frontend React + Vite + TypeScript + Tailwind
  backend/      → Backend Fastify + WebSocket + TypeScript
packages/
  shared/       → Types partagés (messages WS, config session)
```

### Pipeline temps réel

```
Audio interlocuteur (tab capture)
  → WebSocket → Backend
    → Deepgram Nova-3 (FR/EN) ou Groq Whisper (malgache)
      → Transcription
        → Claude Sonnet 4 (traduction ou suggestion)
          → WebSocket → Frontend (affichage streaming)
```

## Setup

### Prérequis

- Node.js >= 20
- pnpm (`npm install -g pnpm`)
- Comptes API :
  - [Deepgram](https://console.deepgram.com/) — STT pour FR/EN
  - [Groq](https://console.groq.com/) — Whisper pour le malgache
  - [Anthropic](https://console.anthropic.com/) — Claude pour traduction/suggestions

### Installation

```bash
git clone <repo-url> voxhelp
cd voxhelp
pnpm install
cp apps/backend/.env.example apps/backend/.env
# → Remplir les clés API dans apps/backend/.env
```

### Développement

```bash
# Les deux en parallèle
pnpm dev

# Ou séparément
pnpm dev:backend    # port 3001
pnpm dev:web        # port 5173
```

Ouvrir http://localhost:5173

## Documentation

- **[SPEC.md](./SPEC.md)** — Spécification technique complète (architecture, flux, protocole WS, roadmap)

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | React 19, Vite 6, TypeScript, Tailwind CSS |
| Backend | Fastify 5, TypeScript, WebSocket |
| STT (FR/EN) | Deepgram Nova-3 (streaming) |
| STT (Malgache) | Groq Whisper large-v3-turbo (chunk) |
| LLM | Claude Sonnet 4 (streaming) |
| Monorepo | pnpm workspaces |
