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
};

const defaults: Prefs = {
  theme: "light",
  fontScale: 1,
  showArabic: true,
  showLatin: true,
  showTurkish: false,
};

function applyPrefs(p: Prefs) {
  document.documentElement.classList.toggle("pre-dark", p.theme === "dark");
  document.body.classList.toggle("dark", p.theme === "dark");
  localStorage.setItem("lumen-theme", p.theme);
  document.body.classList.toggle("hideArabic", !p.showArabic);
  document.body.classList.toggle("hideLatin", !p.showLatin);
  document.body.classList.toggle("hideTurkish", !p.showTurkish);
  document.documentElement.style.setProperty("--font-scale", String(p.fontScale));
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
