"use client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type Prefs = {
  theme: "light" | "dark";
  fontScale: number;
  showArabic: boolean;
  showLatin: boolean;
  showTurkish: boolean;
};

const defaults: Prefs = {
  theme: "light",
  fontScale: 1,
  showArabic: true,
  showLatin: true,
  showTurkish: false,
};

function applyPrefs(p: Prefs) {
  document.body.classList.toggle("dark", p.theme === "dark");
  document.body.classList.toggle("hideArabic", !p.showArabic);
  document.body.classList.toggle("hideLatin", !p.showLatin);
  document.body.classList.toggle("hideTurkish", !p.showTurkish);
  document.documentElement.style.setProperty("--font-scale", String(p.fontScale));
}

export function SettingsView({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.from("user_preferences").select("preferences").maybeSingle().then(({ data }) => {
      const raw = (data?.preferences ?? {}) as Partial<Prefs>;
      const next = { ...defaults, ...raw };
      setPrefs(next);
      applyPrefs(next);
    });
  }, []);

  async function update(next: Prefs) {
    setPrefs(next);
    applyPrefs(next);
    const { error } = await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: next,
    });
    setMessage(error ? error.message : "Ayarlar kaydedildi.");
  }

  return (
    <div className="settingsCard">
      <div className="dialogHead"><strong>Görünüm</strong></div>

      <div className="settingRow">
        <span>Gece modu</span>
        <button className="settingButton" onClick={() => update({...prefs,theme:prefs.theme==="dark"?"light":"dark"})}>
          {prefs.theme === "dark" ? "Açık" : "Kapalı"}
        </button>
      </div>

      <div className="settingRow">
        <span>Yazı boyutu</span>
        <div className="fontControls">
          <button onClick={() => update({...prefs,fontScale:Math.max(.8,+(prefs.fontScale-.1).toFixed(1))})}>A−</button>
          <button onClick={() => update({...prefs,fontScale:1})}>A</button>
          <button onClick={() => update({...prefs,fontScale:Math.min(1.8,+(prefs.fontScale+.1).toFixed(1))})}>A+</button>
        </div>
      </div>

      <div className="settingRow">
        <span>Arapça</span>
        <button className="settingButton" onClick={() => update({...prefs,showArabic:!prefs.showArabic})}>
          {prefs.showArabic ? "Açık" : "Gizli"}
        </button>
      </div>

      <div className="settingRow">
        <span>Latin harfleri</span>
        <button className="settingButton" onClick={() => update({...prefs,showLatin:!prefs.showLatin})}>
          {prefs.showLatin ? "Açık" : "Gizli"}
        </button>
      </div>

      <div className="settingRow">
        <span>Türkçe anlam</span>
        <button className="settingButton" onClick={() => update({...prefs,showTurkish:!prefs.showTurkish})}>
          {prefs.showTurkish ? "Açık" : "Gizli"}
        </button>
      </div>

      <button className="secondary danger" style={{marginTop:18}} onClick={onSignOut}>Çıkış yap</button>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
