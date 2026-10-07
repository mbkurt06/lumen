"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type Prefs = {
  theme: "light" | "dark";
  fontScale: number;
  showArabic: boolean;
  showLatin: boolean;
  showTurkish: boolean;
  quranShowLatin: boolean;
  quranShowTranslation: boolean;
  quranEasyRead: boolean;
  quranFontScale: number;
  quranFontWeight: number;
};

const defaults: Prefs = {
  theme: "light",
  fontScale: 1,
  showArabic: true,
  showLatin: true,
  showTurkish: false,
  quranShowLatin: false,
  quranShowTranslation: false,
  quranEasyRead: false,
  quranFontScale: 1,
  quranFontWeight: 350,
};

function applyPrefs(p: Prefs) {
  document.documentElement.classList.toggle("pre-dark", p.theme === "dark");
  document.body.classList.toggle("dark", p.theme === "dark");
  localStorage.setItem("lumen-theme", p.theme);
  document.body.classList.toggle("hideArabic", !p.showArabic);
  document.body.classList.toggle("hideLatin", !p.showLatin);
  document.body.classList.toggle("hideTurkish", !p.showTurkish);
  document.documentElement.style.setProperty("--font-scale", String(p.fontScale));
  document.documentElement.style.setProperty("--quran-font-scale", String(p.quranFontScale));
  document.documentElement.style.setProperty("--quran-font-weight", String(p.quranFontWeight));
  document.body.classList.toggle("quranHideLatin", !p.quranShowLatin);
  document.body.classList.toggle("quranHideTranslation", !p.quranShowTranslation);
  document.body.classList.toggle("quranEasyRead", p.quranEasyRead);
  window.dispatchEvent(new CustomEvent("lumen-library-prefs", { detail: p }));
}

export function LibrarySettingsModal({
  user,
  open,
  onClose,
}: {
  user: User;
  open: boolean;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const dockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from("user_preferences").select("preferences").maybeSingle().then(({ data }) => {
      const raw = (data?.preferences ?? {}) as Partial<Prefs>;
      const next = { ...defaults, ...raw };
      setPrefs(next);
      applyPrefs(next);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (dockRef.current?.contains(target)) return;
      if (target.closest(".persistentLibrarySettings")) return;
      onClose();
    };

    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, onClose]);

  async function update(next: Prefs) {
    setPrefs(next);
    applyPrefs(next);

    const { data } = await supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle();

    const old = (data?.preferences ?? {}) as Record<string, unknown>;

    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: {
        ...old,
        ...next,
      },
    });
  }

  if (!open) return null;

  return (
    <aside ref={dockRef} className="librarySettingsDock" aria-label="Okuma ayarları">
      <div className="librarySettingsModal">
        <div className="modalHead">
          <strong>Okuma ayarları</strong>
          <button className="modalClose" onClick={onClose}>×</button>
        </div>

        <div className="settingRow">
          <span>Gece modu</span>
          <button
            className="settingButton"
            onClick={() => update({...prefs, theme: prefs.theme === "dark" ? "light" : "dark"})}
          >
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

        <div className="settingSectionTitle">Kur’an görünümü</div>

        <div className="settingRow">
          <span>Kur’an yazı boyutu</span>
          <div className="fontControls">
            <button onClick={() => update({...prefs,quranFontScale:Math.max(.8,+(prefs.quranFontScale-.1).toFixed(1))})}>A−</button>
            <button onClick={() => update({...prefs,quranFontScale:1})}>A</button>
            <button onClick={() => update({...prefs,quranFontScale:Math.min(1.8,+(prefs.quranFontScale+.1).toFixed(1))})}>A+</button>
          </div>
        </div>

        <div className="settingRow quranWeightSetting">
          <span>Arapça yazı kalınlığı</span>
          <div className="quranWeightControl">
            <span>İnce</span>
            <input
              type="range"
              min={200}
              max={700}
              step={50}
              value={prefs.quranFontWeight}
              onChange={e => update({...prefs,quranFontWeight:Number(e.target.value)})}
            />
            <span>Kalın</span>
          </div>
        </div>

        <div className="settingRow">
          <span>Latin harflerle okunuş</span>
          <button className="settingButton" onClick={() => update({...prefs,quranShowLatin:!prefs.quranShowLatin})}>
            {prefs.quranShowLatin ? "Açık" : "Gizli"}
          </button>
        </div>

        <div className="settingRow">
          <span>Türkçe meal</span>
          <button className="settingButton" onClick={() => update({...prefs,quranShowTranslation:!prefs.quranShowTranslation})}>
            {prefs.quranShowTranslation ? "Açık" : "Gizli"}
          </button>
        </div>

        <div className="settingRow">
          <span>Kolay okunur yazım</span>
          <button className="settingButton" onClick={() => update({...prefs,quranEasyRead:!prefs.quranEasyRead})}>
            {prefs.quranEasyRead ? "Açık" : "Kapalı"}
          </button>
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
          <span>Türkçe meal / anlam</span>
          <button className="settingButton" onClick={() => update({...prefs,showTurkish:!prefs.showTurkish})}>
            {prefs.showTurkish ? "Açık" : "Gizli"}
          </button>
        </div>
      </div>
    </aside>
  );
}
