import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";
import { looksOffline, netLog, offlineFetch } from "./offlineFetch";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: offlineFetch },
});

/* İnternet yokken oturum yenileme denemesi (Supabase ~25 sn tekrar eder) sayfaları bekletmesin:
   çevrimdışıysa ya da yenileme 4 sn'de bitmezse cihazda kayıtlı oturum kullanılır. */
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
function storedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const s = v?.currentSession ?? v;
    return s?.access_token ? s : null;
  } catch { return null; }
}
const origGetSession = supabase.auth.getSession.bind(supabase.auth);
supabase.auth.getSession = (async () => {
  const t0 = performance.now();
  const note = (how: string) => { netLog.unshift({ t: Date.now(), path: "oturum", how, ms: Math.round(performance.now() - t0) }); if (netLog.length > 60) netLog.length = 60; };
  const fallback = () => ({ data: { session: storedSession() }, error: null });
  if (looksOffline()) { note("kayıtlı"); return fallback(); }
  const r = await Promise.race([
    origGetSession().then((x) => { note("normal"); return x; }),
    new Promise((res) => setTimeout(() => { note("4sn-kayıtlı"); res(fallback()); }, 4000)),
  ]);
  return r;
}) as typeof supabase.auth.getSession;
