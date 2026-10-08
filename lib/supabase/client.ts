import { createClient } from "@supabase/supabase-js";

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredSupabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Lumen is local-first. Missing/renamed Supabase environment variables must not
// prevent the UI and the already-cached IndexedDB data from opening offline.
// The legacy ANON key is still accepted so existing .env.local files keep
// working after migrating to Supabase publishable keys.
export const supabaseConfigured = Boolean(
  configuredSupabaseUrl && configuredSupabaseKey
);

const supabaseUrl =
  configuredSupabaseUrl || "https://lumen-offline.invalid";
const supabaseKey =
  configuredSupabaseKey || "lumen-offline-placeholder";

if (!supabaseConfigured && typeof window !== "undefined") {
  console.warn(
    "Supabase environment variables are missing. Lumen is running in local/offline mode."
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: supabaseConfigured,
      detectSessionInUrl: supabaseConfigured
    }
  }
);
