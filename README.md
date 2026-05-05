# VoxHelp — Interview Assistant

Assistant IA invisible qui écoute ton entretien technique et affiche des suggestions de réponse en temps réel.

## Pipeline

```
Interviewer pose une question
  → Tab capture (Chrome) → WebSocket → Backend
    → Deepgram Nova-3 (STT streaming)
      → Transcription → Claude Sonnet 4
        → Suggestion streamée → Frontend
```

## Architecture

```
apps/
  web/       → Frontend React + Vite + TypeScript + Tailwind
  backend/   → Backend Fastify + WebSocket + TypeScript
packages/
  shared/    → Types partagés (messages WS, SessionConfig)
```

## Setup

### Prérequis

- Node.js >= 20
- pnpm (`npm install -g pnpm`)
- Comptes API :
  - [Deepgram](https://console.deepgram.com/) — STT streaming
  - [Anthropic](https://console.anthropic.com/) — Claude pour les suggestions

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
pnpm dev        # backend :3001 + frontend :5173 en parallèle
```

Ouvrir http://localhost:5173 dans **Chrome**.

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | React 19, Vite 6, TypeScript, Tailwind CSS |
| Backend | Fastify 5, TypeScript, WebSocket |
| STT | Deepgram Nova-3 (streaming, FR/EN/ES/PT/ZH) |
| LLM | Claude Sonnet 4 (streaming) |
| Monorepo | pnpm workspaces |

## Documentation

- **[SPEC.md](./SPEC.md)** — Spécification technique complète
