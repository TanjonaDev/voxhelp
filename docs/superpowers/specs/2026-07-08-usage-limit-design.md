# Limite d'usage par utilisateur (nombre de sessions)

## Contexte

VoxHelp est en bêta avec un compte Claude API et un plan Deepgram gratuit partagés par tous les utilisateurs. Il faut limiter le nombre d'entretiens (sessions live) que chaque utilisateur peut lancer, pour contenir les coûts et l'usage du quota Deepgram gratuit pendant la phase bêta (beta testeurs : Olivier, Randstad).

Ce document couvre uniquement la persistance et l'enforcement de la limite d'usage. La persistance complète des entretiens (transcripts, cartes, rapports) et le dashboard restent hors scope, prévus pour une itération ultérieure.

## Décisions

- **Métrique limitée** : nombre de sessions (entretiens démarrés avec succès), pas la durée cumulée.
- **Limite par défaut** : 5 sessions par utilisateur, stockée en base (`profiles.session_limit`), ajustable manuellement par ligne dans le Supabase Dashboard (pas d'UI d'admin).
- **Moment du comptage** : incrémenté à la fin de la session, uniquement si au moins un échange réel a eu lieu (au moins un transcript traité). Un démarrage raté (capture audio qui échoue avant tout audio) ne consomme pas de quota — la capture audio est encore instable en dev.
- **Enforcement** : vérifié au moment de `session:start`, avant la création du client STT (Deepgram). Si le quota est atteint, le backend refuse silencieusement d'ouvrir la session STT et renvoie une erreur.
- **Fail-open** : si Supabase n'est pas configuré (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` absents) ou si la lecture du profil échoue, la session démarre quand même. Cohérent avec le comportement déjà en place pour la vérification du token WebSocket (`apps/backend/src/index.ts`).

## Schéma SQL

À exécuter par l'utilisateur dans Supabase Dashboard → SQL Editor (extension du schéma `profiles` défini dans `SUPABASE_AUTH_DEPLOY.md` JOUR 1) :

```sql
alter table public.profiles
  add column session_count int not null default 0,
  add column session_limit int not null default 5;

create or replace function public.increment_session_count(uid uuid)
returns void as $$
begin
  update public.profiles set session_count = session_count + 1 where id = uid;
end;
$$ language plpgsql;
```

`increment_session_count` est appelée via le client `supabaseAdmin` (clé service-role, qui bypass RLS), donc pas besoin de `security definer`. L'incrément passe par une fonction SQL plutôt qu'un `update` applicatif read-modify-write pour rester atomique, même si la concurrence est faible en bêta.

## Backend

### `apps/backend/src/index.ts`

Le handler `/ws` vérifie déjà le token et récupère `data.user.id` via `supabaseAdmin.auth.getUser(token)`. Ce `userId` est maintenant transmis au constructeur de `Session` :

```ts
new Session(socket, supabaseAdmin ? data.user.id : null);
```

### `apps/backend/src/session.ts`

- Le constructeur accepte un second paramètre `userId: string | null = null`, stocké en propriété privée.
- `startSession(config)` devient asynchrone (`private async startSession(...)`), appelée depuis `handleMessage` avec `void this.startSession(message.config)` (même pattern que `handleAskQuestion`/`generateFinalReport`).
- En tout début de `startSession`, avant toute autre logique :
  ```ts
  if (this.userId && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("session_count, session_limit")
      .eq("id", this.userId)
      .single();

    if (!error && data && data.session_count >= data.session_limit) {
      this.send({
        type: "session:error",
        error: `Limite de ${data.session_limit} entretiens atteinte pour ce compte. Contacte-nous pour continuer.`,
      });
      return;
    }
  }
  ```
  Si `error` est présent (lecture échouée, profil manquant), on ne bloque pas — fail-open.
- Dans `cleanup()`, avant la réinitialisation de `conversationLog` :
  ```ts
  if (this.userId && supabaseAdmin && this.conversationLog.length > 0) {
    void supabaseAdmin.rpc("increment_session_count", { uid: this.userId }).then(({ error }) => {
      if (error) console.error("[Session] Failed to increment session_count:", error.message);
    });
  }
  ```
  Fire-and-forget : ne bloque pas le cleanup, une erreur d'incrément est loggée mais non bloquante (au pire on sous-compte).

### `apps/backend/src/supabase.ts`

Aucun changement — `supabaseAdmin` est déjà `null` si non configuré (garde déjà en place).

## Frontend

Aucun changement de code. Le message d'erreur de quota transite par le flux `session:error` existant → `useWebSocket` (`setLastError`) → bannière rouge dans `OverlayPanel`.

**Limite UX connue et acceptée** : `ws.startSession` (frontend) envoie le message `session:start` sans attendre d'accusé de réception. `OverlayPanel.handleStart` bascule donc `audioStarted` à `true` immédiatement, indépendamment de la réponse backend. Si le quota est dépassé, l'utilisateur voit l'écran "live" (mic actif visuellement) mais aucune carte n'apparaîtra jamais, avec la bannière d'erreur affichant le message de quota. Corriger ce comportement proprement nécessiterait d'attendre `session:ready` avant de basculer l'UI côté `OverlayPanel` — explicitement hors scope de cette itération.

## Tests

- La suite existante `apps/backend/src/__tests__/session.test.ts` instancie `new Session(socket)` sans `userId` (via `createTestServer`) → `userId` reste `null` → quota check et incrément sont skippés → tests inchangés, doivent rester verts.
- Nouveau test à ajouter (même fichier ou nouveau `session-usage-limit.test.ts`) : nécessite de pouvoir injecter un `userId` et un mock de `supabaseAdmin` dans `createTestServer`. Couvre :
  1. Session bloquée quand `session_count >= session_limit` (mock du client Supabase renvoyant ce cas) → `session:error` reçu, pas de `session:ready`.
  2. `increment_session_count` appelé une fois après un cycle complet avec au moins un `assist:done`, puis `session:stop`.
  3. Pas d'incrément si aucun transcript n'a été traité avant `session:stop` (session vide).

## Hors scope

- Dashboard listant les entretiens passés.
- Persistance des transcripts/cartes/rapports en base (`useInterviews`, déjà scaffoldé côté frontend mais non branché).
- UI d'administration pour ajuster `session_limit` par utilisateur.
- Limite basée sur la durée cumulée plutôt que le nombre de sessions.
- Correction du comportement optimiste de bascule UI décrit ci-dessus.
