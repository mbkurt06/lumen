"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AppShell } from "@/components/AppShell";
import { cacheOfflineUser, readOfflineUser } from "@/lib/offlineIdentity";

export function AuthPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Supabase bağlantısı kontrol ediliyor...");
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(true);

  useEffect(() => {
    let cancelled=false;

    const boot=async()=>{
      // Recover the cached identity first; never hide the login screen while
      // waiting for Supabase auth/network to settle.
      const localUser=readOfflineUser();
      if(localUser){
        setUser(localUser);
        setMessage("Bu cihazdaki kayıtlı hesap açılıyor.");
      }
      setAuthReady(true);
      try {
      // getSession reads the persisted Supabase session locally, so an already
      // signed-in device can boot even when there is no network connection.
      const {data:sessionData}=await supabase.auth.getSession();
      if(cancelled) return;

      const sessionUser=sessionData.session?.user ?? null;
      if(sessionUser) cacheOfflineUser(sessionUser);
      const cachedUser=sessionUser ?? readOfflineUser();

      if(cachedUser){
        setUser(cachedUser);
        setMessage(navigator.onLine ? "Oturum açık." : "Çevrimdışı mod — bu cihazdaki kayıtlı kullanıcı kullanılıyor.");
        setAuthReady(true);
      }

      if(!navigator.onLine){
        if(!cachedUser){
          setMessage("Çevrimdışısın. Bu cihazda daha önce açılmış bir hesap bulunamadı.");
          setAuthReady(true);
        }
        return;
      }

      const {data,error}=await supabase.auth.getUser();
      if(cancelled) return;
      if(error){
        if(!cachedUser){
          setMessage("Aktif oturum bulunamadı.");
          setAuthReady(true);
        }
        return;
      }
      if(data.user) cacheOfflineUser(data.user);
      setUser(data.user ?? cachedUser);
      setMessage(data.user || cachedUser ? "Oturum açık." : "Supabase bağlantısı hazır.");
      setAuthReady(true);
      } catch(error) {
        console.warn("Auth bootstrap failed",error);
        if(!cancelled){
          setUser(readOfflineUser());
          setMessage("Bağlantı kurulamadı. Yerel hesap kullanılabilir.");
          setAuthReady(true);
        }
      }
    };

    void boot();

    const handleOnline=()=>void boot();
    window.addEventListener("online",handleOnline);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Do not throw away the persisted user merely because token refresh cannot
      // reach Supabase while the device is offline.
      if (!navigator.onLine && !session) {
        const offlineUser=readOfflineUser();
        if(offlineUser) setUser(offlineUser);
        setAuthReady(true);
        return;
      }
      if(session?.user) cacheOfflineUser(session.user);
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled=true;
      window.removeEventListener("online",handleOnline);
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("Giriş yapılıyor...");

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error ? error.message : "Giriş başarılı.");
    setBusy(false);
  }

  async function signUp() {
    setBusy(true);
    setMessage("Hesap oluşturuluyor...");

    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(
      error
        ? error.message
        : "Hesap oluşturuldu. E-posta doğrulaması açıksa gelen kutunu kontrol et."
    );
    setBusy(false);
  }

  async function signOut() {
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    if(!error){
      cacheOfflineUser(null);
      setUser(null);
    }
    setMessage(error ? error.message : "Oturum kapatıldı.");
    setBusy(false);
  }

  if (!authReady) return <div className="authBootBlank" />;

  if (user) {
    return <AppShell user={user} onSignOut={signOut} />;
  }

  return (
    <section style={styles.card}>
      <h2 style={styles.heading}>Lumen hesabı</h2>
      <p style={styles.text}>
        Aynı hesapla giriş yaptığın tüm cihazlar merkezi veritabanını kullanacak.
      </p>

      <form onSubmit={signIn} style={styles.form}>
        <input
          style={styles.input}
          type="email"
          placeholder="E-posta"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
        <input
          style={styles.input}
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          minLength={6}
          required
        />

        <div style={styles.actions}>
          <button style={styles.button} type="submit" disabled={busy}>
            Giriş yap
          </button>
          <button
            style={styles.secondaryButton}
            type="button"
            onClick={signUp}
            disabled={busy}
          >
            Hesap oluştur
          </button>
        </div>
      </form>

      <p style={styles.status}>{message}</p>
    </section>
  );
}

const styles = {
  card: {
    width: "min(520px, 100%)",
    border: "1px solid #ddd",
    borderRadius: 18,
    padding: 24,
    background: "white",
    boxShadow: "0 10px 30px rgba(0,0,0,.06)",
  },
  heading: { marginTop: 0 },
  text: { color: "#555", lineHeight: 1.5 },
  form: { display: "grid", gap: 12, marginTop: 20 },
  input: {
    width: "100%",
    padding: "12px 14px",
    border: "1px solid #ccc",
    borderRadius: 10,
    fontSize: 16,
  },
  actions: { display: "flex", gap: 10, flexWrap: "wrap" as const },
  button: {
    border: 0,
    borderRadius: 10,
    padding: "11px 16px",
    background: "#2563eb",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #ccc",
    borderRadius: 10,
    padding: "11px 16px",
    background: "white",
    color: "#222",
    fontWeight: 600,
    cursor: "pointer",
  },
  status: { marginBottom: 0, marginTop: 16, fontSize: 14, color: "#666" },
};
