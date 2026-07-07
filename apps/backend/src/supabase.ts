import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.warn(
    "[Supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants — auth WebSocket désactivée."
  );
}

export const supabaseAdmin = url && serviceRoleKey ? createClient(url, serviceRoleKey) : null;
