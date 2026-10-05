"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export function AuthPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Supabase bağlantısı kontrol ediliyor...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        setMessage("Supabase bağlantısı var, aktif oturum bulunamadı.");
        return;
      }
      setUser(data.user ?? null);
      setMessage(data.user ? "Oturum açık." : "Supabase bağlantısı hazır.");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
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
    setMessage(error ? error.message : "Oturum kapatıldı.");
    setBusy(false);
  }

  if (user) {
    return (
      <section style={styles.card}>
        <h2 style={styles.heading}>Supabase bağlı</h2>
        <p style={styles.text}>Giriş yapan kullanıcı: {user.email}</p>
        <button style={styles.button} onClick={signOut} disabled={busy}>
          Çıkış yap
        </button>
        <p style={styles.status}>{message}</p>
      </section>
    );
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
