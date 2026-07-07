# VOXHELP — Auth, Persistance & Déploiement

## Vue d'ensemble

Ajouter l'authentification, la persistance des données et déployer en production. L'objectif est d'avoir un produit utilisable par des beta testeurs externes (Olivier, Randstad, etc.).

---

## JOUR 1 — Supabase (Auth + Base de données)

### 1.1 Setup Supabase

Créer un projet sur https://supabase.com :
- Région : West EU (Paris)
- Récupérer les clés :
  - `SUPABASE_URL` (ex: https://xxxxx.supabase.co)
  - `SUPABASE_ANON_KEY` (clé publique, utilisée côté frontend)
  - `SUPABASE_SERVICE_ROLE_KEY` (clé privée, utilisée côté backend uniquement)

### 1.2 Activer l'auth Google OAuth

Dans Supabase Dashboard → Authentication → Providers → Google :
- Activer Google
- Créer un projet sur https://console.cloud.google.com
- APIs & Services → Credentials → OAuth 2.0 Client ID
- Authorized redirect URI : `https://<SUPABASE_URL>/auth/v1/callback`
- Copier Client ID et Client Secret dans Supabase

### 1.3 Schéma de base de données

Exécuter ce SQL dans Supabase Dashboard → SQL Editor :

```sql
-- ═══════════════════════════════════
-- Profils utilisateurs
-- ═══════════════════════════════════

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  company text,
  created_at timestamptz default now() not null
);

-- Auto-créer un profil quand un user s'inscrit
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════
-- Entretiens
-- ═══════════════════════════════════

create type interview_status as enum (
  'prep',
  'live', 
  'review',
  'completed'
);

create table public.interviews (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null default 'Nouvel entretien',
  candidate_name text not null,
  candidate_email text,
  job_description text,
  tech_stack text,
  language text default 'fr',
  status interview_status default 'prep' not null,
  
  -- Résultat de l'analyse IA de la fiche de poste (JSON)
  job_analysis jsonb,
  
  -- Questions générées (JSON array)
  questions jsonb default '[]'::jsonb,
  
  -- Scorecard critères (JSON array)
  scorecard jsonb default '[]'::jsonb,

  duration_seconds int,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Index pour lister les entretiens d'un user
create index idx_interviews_user_id on public.interviews(user_id);
create index idx_interviews_created_at on public.interviews(created_at desc);

-- ═══════════════════════════════════
-- Transcriptions
-- ═══════════════════════════════════

create table public.transcripts (
  id uuid default gen_random_uuid() primary key,
  interview_id uuid references public.interviews(id) on delete cascade not null,
  text text not null,
  timestamp_ms bigint not null,
  created_at timestamptz default now() not null
);

create index idx_transcripts_interview_id on public.transcripts(interview_id);

-- ═══════════════════════════════════
-- Cartes d'analyse live (les cartes VoxHelp)
-- ═══════════════════════════════════

create table public.assist_cards (
  id uuid default gen_random_uuid() primary key,
  interview_id uuid references public.interviews(id) on delete cascade not null,
  cat text not null,          -- jargon, strength, attention, translation
  evidence text,              -- high, medium, low
  title text not null,
  body text,
  relance text,
  timestamp_ms bigint not null,
  created_at timestamptz default now() not null
);

create index idx_assist_cards_interview_id on public.assist_cards(interview_id);

-- ═══════════════════════════════════
-- Rapports post-entretien
-- ═══════════════════════════════════

create table public.reports (
  id uuid default gen_random_uuid() primary key,
  interview_id uuid references public.interviews(id) on delete cascade unique not null,
  summary text,
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  red_flags text[] default '{}',
  recommendation text,         -- STRONG_HIRE, HIRE, LEAN_HIRE, LEAN_NO_HIRE, NO_HIRE
  overall_score numeric(2,1),  -- 1.0 à 5.0
  scored_criteria jsonb,       -- critères avec scores
  created_at timestamptz default now() not null
);

-- ═══════════════════════════════════
-- Row Level Security (RLS)
-- ═══════════════════════════════════

alter table public.profiles enable row level security;
alter table public.interviews enable row level security;
alter table public.transcripts enable row level security;
alter table public.assist_cards enable row level security;
alter table public.reports enable row level security;

-- Profiles : un user ne voit que son profil
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Interviews : un user ne voit que ses entretiens
create policy "Users can view own interviews"
  on public.interviews for select
  using (auth.uid() = user_id);

create policy "Users can insert own interviews"
  on public.interviews for insert
  with check (auth.uid() = user_id);

create policy "Users can update own interviews"
  on public.interviews for update
  using (auth.uid() = user_id);

create policy "Users can delete own interviews"
  on public.interviews for delete
  using (auth.uid() = user_id);

-- Transcripts : via l'interview
create policy "Users can view own transcripts"
  on public.transcripts for select
  using (
    interview_id in (
      select id from public.interviews where user_id = auth.uid()
    )
  );

create policy "Users can insert own transcripts"
  on public.transcripts for insert
  with check (
    interview_id in (
      select id from public.interviews where user_id = auth.uid()
    )
  );

-- Assist cards : via l'interview
create policy "Users can view own assist cards"
  on public.assist_cards for select
  using (
    interview_id in (
      select id from public.interviews where user_id = auth.uid()
    )
  );

create policy "Users can insert own assist cards"
  on public.assist_cards for insert
  with check (
    interview_id in (
      select id from public.interviews where user_id = auth.uid()
    )
  );

-- Reports : via l'interview
create policy "Users can view own reports"
  on public.reports for select
  using (
    interview_id in (
      select id from public.interviews where user_id = auth.uid()
    )
  );

create policy "Users can insert own reports"
  on public.reports for insert
  with check (
    interview_id in (
      select id from public.interviews where user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════
-- Updated_at trigger
-- ═══════════════════════════════════

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on public.interviews
  for each row execute function update_updated_at();
```

### 1.4 Installer le SDK Supabase

```bash
# Frontend
pnpm --filter @voxhelp/web add @supabase/supabase-js

# Backend
pnpm --filter @voxhelp/backend add @supabase/supabase-js
```

### 1.5 Variables d'environnement

Ajouter dans `apps/backend/.env` :

```
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# Existants
DEEPGRAM_API_KEY=xxx
GROQ_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

Créer `apps/web/.env` :

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_API_URL=http://localhost:3001
```

---

## JOUR 2 — Intégration dans la web app

### 2.1 Client Supabase frontend

Créer `apps/web/src/lib/supabase.ts` :

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

### 2.2 Client Supabase backend

Créer `apps/backend/src/supabase.ts` :

```typescript
import { createClient } from "@supabase/supabase-js";

// Client admin (service role) pour les opérations backend
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### 2.3 Hook d'auth frontend

Créer `apps/web/src/hooks/useAuth.ts` :

```typescript
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Récupérer la session actuelle
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Écouter les changements d'auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
  };

  const signInWithEmail = async (email: string, password: string) => {
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    user,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  };
}
```

### 2.4 Hook API pour les entretiens

Créer `apps/web/src/hooks/useInterviews.ts` :

```typescript
import { supabase } from "../lib/supabase";

export function useInterviews(userId: string | undefined) {

  const list = async () => {
    if (!userId) return [];
    const { data, error } = await supabase
      .from("interviews")
      .select("id, title, candidate_name, status, overall_score, recommendation, created_at, duration_seconds")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  };

  const get = async (id: string) => {
    const { data, error } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  };

  const create = async (interview: {
    title: string;
    candidateName: string;
    jobDescription: string;
    techStack?: string;
    language?: string;
  }) => {
    const { data, error } = await supabase
      .from("interviews")
      .insert({
        user_id: userId,
        title: interview.title,
        candidate_name: interview.candidateName,
        job_description: interview.jobDescription,
        tech_stack: interview.techStack || null,
        language: interview.language || "fr",
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  const update = async (id: string, fields: Record<string, any>) => {
    const { error } = await supabase
      .from("interviews")
      .update(fields)
      .eq("id", id);
    if (error) throw error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from("interviews")
      .delete()
      .eq("id", id);
    if (error) throw error;
  };

  const saveTranscripts = async (interviewId: string, transcripts: { text: string; timestamp_ms: number }[]) => {
    const rows = transcripts.map(t => ({
      interview_id: interviewId,
      text: t.text,
      timestamp_ms: t.timestamp_ms,
    }));
    const { error } = await supabase.from("transcripts").insert(rows);
    if (error) throw error;
  };

  const saveAssistCards = async (interviewId: string, cards: { cat: string; evidence: string; title: string; body: string; relance: string | null; timestamp_ms: number }[]) => {
    const rows = cards.map(c => ({
      interview_id: interviewId,
      ...c,
    }));
    const { error } = await supabase.from("assist_cards").insert(rows);
    if (error) throw error;
  };

  const saveReport = async (interviewId: string, report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    red_flags: string[];
    recommendation: string;
    overall_score: number;
    scored_criteria: any;
  }) => {
    const { error } = await supabase.from("reports").insert({
      interview_id: interviewId,
      ...report,
    });
    if (error) throw error;
  };

  const getReport = async (interviewId: string) => {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("interview_id", interviewId)
      .single();
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
    return data;
  };

  const getTranscripts = async (interviewId: string) => {
    const { data, error } = await supabase
      .from("transcripts")
      .select("*")
      .eq("interview_id", interviewId)
      .order("timestamp_ms", { ascending: true });
    if (error) throw error;
    return data;
  };

  const getAssistCards = async (interviewId: string) => {
    const { data, error } = await supabase
      .from("assist_cards")
      .select("*")
      .eq("interview_id", interviewId)
      .order("timestamp_ms", { ascending: true });
    if (error) throw error;
    return data;
  };

  return {
    list,
    get,
    create,
    update,
    remove,
    saveTranscripts,
    saveAssistCards,
    saveReport,
    getReport,
    getTranscripts,
    getAssistCards,
  };
}
```

### 2.5 Nouvelles pages frontend

L'app a maintenant 5 pages :

```
/ (racine)
├── Non connecté → LoginPage
├── Connecté →
│   ├── /                → DashboardPage (liste des entretiens)
│   ├── /interview/new   → PrepView (nouvelle préparation)
│   ├── /interview/:id   → LiveView ou ReportView selon le status
```

**LoginPage** :
```
┌─────────────────────────────────┐
│                                 │
│         Logo VoxHelp            │
│   Le copilote IA des            │
│   recruteurs tech               │
│                                 │
│  [Se connecter avec Google]     │
│                                 │
│  ──── ou ────                   │
│                                 │
│  Email    [________________]    │
│  Mot de passe [____________]    │
│                                 │
│  [Se connecter]                 │
│  Pas de compte ? S'inscrire     │
│                                 │
└─────────────────────────────────┘
```

**DashboardPage** :
```
┌─────────────────────────────────────────────┐
│  VoxHelp    [avatar] [Déconnexion]          │
├─────────────────────────────────────────────┤
│                                             │
│  Mes entretiens          [+ Nouvel entretien]│
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Backend Senior — Jean Dupont        │    │
│  │ 📋 Complété · 25 mai · 32 min      │    │
│  │ Score: 3.8/5 · HIRE ✅              │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Frontend React — Marie Martin       │    │
│  │ 🟡 En préparation · 28 mai         │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ DevOps — Paul Bernard               │    │
│  │ 📊 En revue · 30 mai · 45 min      │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

Chaque carte est cliquable :
- Status `prep` → redirige vers PrepView
- Status `live` → redirige vers LiveView (reprendre le call)
- Status `review` ou `completed` → redirige vers ReportView

**PrepView** : identique à l'actuel, mais à la fin de l'analyse, sauvegarder l'entretien en DB avec `status: 'prep'`, puis `status: 'ready'` quand l'analyse est terminée.

**LiveView** : identique à l'actuel. À la fin du call :
- Mettre `status: 'review'`
- Sauvegarder les transcripts en batch
- Sauvegarder les assist cards en batch
- Sauvegarder la durée

**ReportView** : identique à l'actuel. Après génération du rapport :
- Sauvegarder le report en DB
- Mettre `status: 'completed'`
- Le rapport est consultable depuis le dashboard

### 2.6 Router

Installer react-router-dom :

```bash
pnpm --filter @voxhelp/web add react-router-dom
```

Modifier `App.tsx` pour utiliser le router :

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import PrepView from "./pages/PrepView";
import InterviewPage from "./pages/InterviewPage";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <Route path="*" element={<LoginPage />} />
        ) : (
          <>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/interview/new" element={<PrepView />} />
            <Route path="/interview/:id" element={<InterviewPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
```

### 2.7 Passer le token auth au WebSocket

Le backend doit vérifier que l'utilisateur est authentifié quand il se connecte en WebSocket.

Frontend — envoyer le token dans la connexion WS :

```typescript
const token = (await supabase.auth.getSession()).data.session?.access_token;
const ws = new WebSocket(`${WS_URL}?token=${token}`);
```

Backend — vérifier le token à la connexion :

```typescript
import { supabaseAdmin } from "./supabase.js";

// Dans le handler WebSocket
app.get("/ws", { websocket: true }, async (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    socket.close(4001, "Missing token");
    return;
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    socket.close(4003, "Invalid token");
    return;
  }

  // User authentifié, créer la session
  new Session(socket, user.id);
});
```

### 2.8 Sauvegarder les données à la fin du call

Quand le recruteur clique "Terminer le call", le frontend :

1. Envoie `session:stop` au backend
2. Sauvegarde les transcripts en batch via `useInterviews().saveTranscripts()`
3. Sauvegarde les assist cards en batch via `useInterviews().saveAssistCards()`
4. Met à jour l'interview : `status: 'review'`, `ended_at`, `duration_seconds`
5. Redirige vers la page de rapport

Quand le recruteur clique "Générer le rapport" :

1. Appelle `POST /api/generate-report`
2. Sauvegarde le rapport via `useInterviews().saveReport()`
3. Met à jour l'interview : `status: 'completed'`

---

## JOUR 3 — Déploiement

### 3.1 Backend — Railway (gratuit, simple)

Railway est le plus simple pour un backend Node.js avec WebSocket.

1. Créer un compte sur https://railway.app
2. Connecter le repo GitHub
3. Railway détecte automatiquement Node.js
4. Ajouter les variables d'environnement dans Railway Dashboard :
   ```
   DEEPGRAM_API_KEY=xxx
   GROQ_API_KEY=xxx
   ANTHROPIC_API_KEY=xxx
   SUPABASE_URL=xxx
   SUPABASE_SERVICE_ROLE_KEY=xxx
   PORT=3001
   CORS_ORIGIN=https://voxhelp.vercel.app
   ```
5. Ajouter un `Procfile` ou un script start dans `apps/backend/package.json` :
   ```json
   "scripts": {
     "start": "node dist/index.js",
     "build": "tsc"
   }
   ```
6. Railway build et déploie automatiquement
7. Récupérer l'URL publique (ex: `voxhelp-backend.up.railway.app`)

Alternative gratuite : **Render.com** (free tier avec WebSocket support).

### 3.2 Frontend — Vercel (gratuit)

1. Créer un compte sur https://vercel.com
2. Connecter le repo GitHub
3. Settings :
   - Root Directory : `apps/web`
   - Build Command : `pnpm build`
   - Output Directory : `dist`
4. Ajouter les variables d'environnement :
   ```
   VITE_SUPABASE_URL=xxx
   VITE_SUPABASE_ANON_KEY=xxx
   VITE_API_URL=https://voxhelp-backend.up.railway.app
   VITE_WS_URL=wss://voxhelp-backend.up.railway.app/ws
   ```
5. Vercel déploie automatiquement
6. URL : `voxhelp.vercel.app` (ou custom domain plus tard)

### 3.3 Mise à jour du frontend pour les URLs dynamiques

Le frontend doit utiliser les variables d'environnement pour les URLs :

```typescript
// apps/web/src/lib/config.ts
export const config = {
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3001",
  wsUrl: import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws",
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};
```

Utiliser `config.wsUrl` au lieu de `ws://localhost:3001/ws` hardcodé dans les hooks.

### 3.4 CORS backend

Mettre à jour le CORS dans le backend pour accepter le domaine Vercel :

```typescript
await app.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
});
```

### 3.5 Vérification pré-deploy

Checklist avant de lancer :

```
[ ] Supabase : tables créées, RLS activé
[ ] Supabase : Google OAuth configuré avec le bon redirect URI
[ ] Backend : toutes les env vars configurées sur Railway
[ ] Frontend : toutes les env vars configurées sur Vercel
[ ] Frontend : URLs dynamiques (pas de localhost hardcodé)
[ ] CORS : le backend accepte le domaine Vercel
[ ] WebSocket : le frontend se connecte en wss:// (pas ws://)
[ ] Auth : le token est envoyé au WebSocket
[ ] Test : login Google → dashboard → nouvel entretien → call → rapport
```

---

## JOUR 4 — Envoyer l'accès aux beta testeurs

### 4.1 Tester le flow complet soi-même

Avant d'envoyer à qui que ce soit :

1. Aller sur voxhelp.vercel.app
2. Se connecter avec Google
3. Créer un entretien avec une fiche de poste
4. Lancer un call (utiliser ElevenLabs pour simuler un candidat)
5. Terminer le call
6. Générer le rapport
7. Revenir au dashboard → vérifier que l'entretien est listé
8. Cliquer sur l'entretien → vérifier que le rapport est consultable

### 4.2 Message à Olivier

```
Salut Olivier,

VoxHelp est en ligne ! 🚀

Voici ton accès : [lien]

Connecte-toi avec ton email Google et teste sur 
un de tes prochains calls candidat. L'outil 
fonctionne en split screen : ton call à gauche, 
VoxHelp à droite.

C'est encore en bêta, donc n'hésite pas à me dire 
tout ce qui manque, ce qui bug, ou ce qui serait 
utile. Ton retour c'est de l'or pour nous.

Si tu veux, on peut faire un call de 15 min après 
ton premier test pour débriefer ensemble.

Merci encore pour ton aide !
```

### 4.3 Message à la recruteuse Randstad

```
Salut [prénom],

Tu avais répondu à notre sondage et le sujet 
t'intéressait. VoxHelp est maintenant en ligne !

Tu peux tester gratuitement ici : [lien]

L'outil traduit le jargon technique en temps réel 
pendant tes entretiens et génère un rapport 
structuré à la fin.

N'hésite pas à me faire un retour, même court. 
Ça nous aide énormément.

Merci !
```

---

## Résumé des fichiers à créer/modifier

### Nouveaux fichiers

| Fichier | Description |
|---------|-------------|
| `apps/web/src/lib/supabase.ts` | Client Supabase frontend |
| `apps/web/src/lib/config.ts` | Config dynamique (URLs) |
| `apps/web/src/hooks/useAuth.ts` | Hook d'authentification |
| `apps/web/src/hooks/useInterviews.ts` | CRUD entretiens + sauvegarde |
| `apps/web/src/pages/LoginPage.tsx` | Page de connexion |
| `apps/web/src/pages/DashboardPage.tsx` | Liste des entretiens |
| `apps/web/src/pages/InterviewPage.tsx` | Router interne (prep/live/report selon status) |
| `apps/web/.env` | Variables Supabase + API |
| `apps/backend/src/supabase.ts` | Client Supabase backend (admin) |

### Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `apps/web/src/App.tsx` | Ajouter router + auth guard |
| `apps/web/src/hooks/useWebSocket.ts` | Envoyer le token auth à la connexion |
| `apps/web/src/pages/PrepView.tsx` | Sauvegarder l'entretien en DB après analyse |
| `apps/web/src/pages/LiveView.tsx` | Sauvegarder transcripts + cards à la fin du call |
| `apps/web/src/pages/ReportView.tsx` | Sauvegarder le rapport en DB |
| `apps/backend/src/index.ts` | Vérifier le token auth sur le WebSocket |
| `apps/backend/.env.example` | Ajouter SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY |
| `apps/web/package.json` | Ajouter @supabase/supabase-js, react-router-dom |
| `apps/backend/package.json` | Ajouter @supabase/supabase-js |

### Dépendances à installer

```bash
pnpm --filter @voxhelp/web add @supabase/supabase-js react-router-dom
pnpm --filter @voxhelp/backend add @supabase/supabase-js
```
