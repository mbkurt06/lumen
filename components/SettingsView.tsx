"use client";
import type { User } from "@supabase/supabase-js";

export function SettingsView({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  return (
    <div className="settingsCard">
      <div className="dialogHead">
        <strong>Genel ayarlar</strong>
      </div>

      <div className="settingRow">
        <span>Hesap</span>
        <strong>{user.email}</strong>
      </div>

      <div className="settingRow">
        <span>Uygulama</span>
        <span className="muted">Lumen</span>
      </div>

      <p className="muted" style={{marginTop:16}}>
        Okuma görünümü, gece modu, yazı boyutu, Arapça, Latin harfleri ve meal
        ayarları Kütüphane içindeki sağ üst ayarlar düğmesinden yönetilir.
      </p>

      <button
        className="secondary danger"
        style={{ marginTop: 18 }}
        onClick={onSignOut}
      >
        Çıkış yap
      </button>
    </div>
  );
}
