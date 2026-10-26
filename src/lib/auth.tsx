import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setState({ session: data.session, loading: false }));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setState({ session, loading: false }));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
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
