"use client";
import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export function SettingsView({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [fontScale, setFontScale] = useState(1);
  const [theme, setTheme] = useState("system");
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle()
      .then(({ data }) => {
        const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
        if (typeof prefs.fontScale === "number") setFontScale(prefs.fontScale);
        if (typeof prefs.theme === "string") setTheme(prefs.theme);
      });
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();

    const { error } = await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: { fontScale, theme },
    });

    setMessage(error ? error.message : "Ayarlar kaydedildi.");
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 680 }}>
      <h2 style={{ marginTop: 0 }}>Ayarlar</h2>
      <p className="muted">{user.email}</p>

      <form
        onSubmit={save}
        style={{ display: "grid", gap: 14, marginTop: 20 }}
      >
        <label>
          Yazı ölçeği
          <input
            type="range"
            min="0.8"
            max="1.8"
            step="0.1"
            value={fontScale}
            onChange={e => setFontScale(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div>{fontScale.toFixed(1)}×</div>
        </label>

        <label>
          Tema
          <select
            className="input"
            value={theme}
            onChange={e => setTheme(e.target.value)}
          >
            <option value="system">Sistem</option>
            <option value="light">Açık</option>
            <option value="dark">Koyu</option>
          </select>
        </label>

        <div className="toolbar">
          <button className="primary">Kaydet</button>
          <button
            type="button"
            className="secondary danger"
            onClick={onSignOut}
          >
            Çıkış yap
          </button>
        </div>
      </form>

      {message && <p className="muted">{message}</p>}
    </div>
  );
}
