import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { storedSession, supabase } from "./supabase";

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

/* Bu cihazda girişi hatırla (Android uygulamasında): e-posta ve şifre uygulamanın kendi deposunda tutulur.
   Oturum bir sebeple düşerse (yenileme reddedildi vb.) internet varken sessizce yeniden giriş yapılır.
   "Çıkış yap" deyince silinir. */
const CK = "lumen.login.v1";
let userSignedOut = false;
type Cred = { email: string; pw?: string };
export const lastLogin = (): Cred | null => { try { return JSON.parse(localStorage.getItem(CK) ?? "null") as Cred | null; } catch { return null; } };
export const rememberLogin = (email: string, pw: string | null) => { userSignedOut = false; try { localStorage.setItem(CK, JSON.stringify(pw ? { email, pw } : { email })); } catch { /* yok */ } };
export const forgetLogin = () => { userSignedOut = true; try { const c = lastLogin(); localStorage.setItem(CK, JSON.stringify(c ? { email: c.email } : null)); } catch { /* yok */ } };
let relogging = false;
async function silentRelogin(): Promise<Session | null> {
  const c = lastLogin();
  if (!c?.pw || relogging || userSignedOut || (typeof navigator !== "undefined" && navigator.onLine === false)) return null;
  relogging = true;
  try { const { data } = await supabase.auth.signInWithPassword({ email: c.email, password: c.pw }); return data.session; } catch { return null; } finally { relogging = false; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      let s = data.session ?? (storedSession() as Session | null);
      if (!s) s = await silentRelogin();
      if (alive) setState({ session: s, loading: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, session) => {
      if (session) { setState({ session, loading: false }); return; }
      // oturumsuz olay: kullanıcı çıkış yapmadıysa önce cihazdaki oturum, sonra kayıtlı girişle yeniden dene
      if (e !== "SIGNED_OUT" && storedSession()) return;
      if (!userSignedOut) {
        void silentRelogin().then((s2) => { if (alive) setState({ session: s2, loading: false }); });
        return;
      }
      setState({ session: null, loading: false });
    });
    // internet geri gelince süresi dolmuş oturumu yenile
    const on = () => { void supabase.auth.refreshSession().catch(() => {}); };
    window.addEventListener("online", on);
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("online", on);
    };
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function trAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "E-posta veya şifre hatalı.";
  if (m.includes("email not confirmed")) return "E-posta henüz onaylanmamış.";
  if (m.includes("rate limit") || m.includes("too many")) return "Çok fazla deneme yapıldı, biraz bekleyip tekrar dene.";
  if (m.includes("network") || m.includes("fetch")) return "Bağlantı kurulamadı. İnternetini kontrol et.";
  return "Giriş yapılamadı: " + message;
}
