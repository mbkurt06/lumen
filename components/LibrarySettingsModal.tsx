"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { importQuranMushafDocx } from "@/lib/quranMushafDocx";

type ReaderScope = "ezber" | "risale" | "quran" | "he";

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
  quranFontFamily: string;
  quranPageTheme: "paper" | "white" | "sepia" | "dark";
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
  quranFontWeight: 300,
  quranFontFamily: "Shaikh Hamdullah Mushaf",
  quranPageTheme: "paper",
};

function scopeKey(scope: ReaderScope, key: "fontScale" | "showArabic" | "showLatin" | "showTurkish") {
  return `${scope}${key[0].toUpperCase()}${key.slice(1)}`;
}

function readScopedPrefs(raw: Record<string, unknown>, scope: ReaderScope): Prefs {
  const next = { ...defaults, ...(raw as Partial<Prefs>) };
  const fontScale = raw[scopeKey(scope,"fontScale")];
  const showArabic = raw[scopeKey(scope,"showArabic")];
  const showLatin = raw[scopeKey(scope,"showLatin")];
  const showTurkish = raw[scopeKey(scope,"showTurkish")];
  if (typeof fontScale === "number") next.fontScale = fontScale;
  if (typeof showArabic === "boolean") next.showArabic = showArabic;
  if (typeof showLatin === "boolean") next.showLatin = showLatin;
  if (typeof showTurkish === "boolean") next.showTurkish = showTurkish;
  if (scope === "quran") next.showArabic = true;
  return next;
}

function applyPrefs(p: Prefs, scope: ReaderScope) {
  document.documentElement.classList.toggle("pre-dark", p.theme === "dark");
  document.body.classList.toggle("dark", p.theme === "dark");
  localStorage.setItem("lumen-theme", p.theme);
  document.body.dataset.readerScope = scope;
  document.body.classList.toggle("hideArabic", scope !== "quran" && !p.showArabic);
  document.body.classList.toggle("hideLatin", scope !== "quran" && !p.showLatin);
  document.body.classList.toggle("hideTurkish", scope !== "quran" && !p.showTurkish);
  document.documentElement.style.setProperty("--font-scale", String(p.fontScale));
  document.documentElement.style.setProperty("--quran-font-scale", String(p.quranFontScale));
  document.documentElement.style.setProperty("--quran-font-weight", String(p.quranFontWeight));
  document.documentElement.style.setProperty("--quran-font-family", JSON.stringify(p.quranFontFamily));
  document.body.dataset.quranPageTheme = p.quranPageTheme;
  document.body.classList.toggle("quranHideLatin", scope === "quran" && !p.quranShowLatin);
  document.body.classList.toggle("quranHideTranslation", scope === "quran" && !p.quranShowTranslation);
  document.body.classList.remove("quranEasyRead");
  if (scope === "quran") {
    localStorage.setItem("lumen-quran-page-prefs", JSON.stringify({
      quranFontScale: p.quranFontScale,
      quranPageTheme: p.quranPageTheme,
      quranFontFamily: p.quranFontFamily,
      quranShowLatin: p.quranShowLatin,
      quranShowTranslation: p.quranShowTranslation,
    }));
  }
  window.dispatchEvent(new CustomEvent("lumen-library-prefs", { detail: { ...p, scope } }));
}

export function LibrarySettingsModal({
  user,
  open,
  onClose,
  scope,
}: {
  user: User;
  open: boolean;
  onClose: () => void;
  scope: ReaderScope;
}) {
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [mushafImporting, setMushafImporting] = useState(false);
  const [mushafImportProgress, setMushafImportProgress] = useState("");
  const [mushafImportPercent, setMushafImportPercent] = useState(0);
  const mushafFileRef = useRef<HTMLInputElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const rawPrefsRef = useRef<Record<string, unknown>>({});
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!open) return;
    supabase.from("user_preferences").select("preferences").maybeSingle().then(({ data }) => {
      const serverRaw = (data?.preferences ?? {}) as Record<string, unknown>;
      let raw = serverRaw;
      if (scope === "quran") {
        try {
          const local = JSON.parse(localStorage.getItem("lumen-quran-page-prefs") || "{}") as Record<string, unknown>;
          raw = { ...serverRaw, ...local };
        } catch {}
      }
      rawPrefsRef.current = raw;
      const next = readScopedPrefs(raw, scope);
      setPrefs(next);
      applyPrefs(next, scope);
    });
  }, [open, scope]);

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

  function update(next: Prefs) {
    setPrefs(next);
    applyPrefs(next, scope);

    const scoped = {
      [scopeKey(scope,"fontScale")]: next.fontScale,
      [scopeKey(scope,"showArabic")]: next.showArabic,
      [scopeKey(scope,"showLatin")]: next.showLatin,
      [scopeKey(scope,"showTurkish")]: next.showTurkish,
    };
    const snapshot: Record<string, unknown> = {
      ...rawPrefsRef.current,
      ...next,
      ...scoped,
      quranEasyRead: false,
    };
    rawPrefsRef.current = snapshot;

    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const { error } = await supabase.from("user_preferences").upsert({
          owner_id: user.id,
          preferences: snapshot,
        });
        if (error) console.error("Preferences could not be saved", error);
      });
  }

  async function importMushafFile(file: File | null) {
    if (!file || mushafImporting) return;
    setMushafImporting(true);
    setMushafImportProgress("Word Mushaf hazırlanıyor…");
    setMushafImportPercent(0);
    try {
      await importQuranMushafDocx(file, user.id, (message, percent) => {
        setMushafImportProgress(message);
        setMushafImportPercent(percent);
      });
      setMushafImportProgress("1. cüz test olarak birebir kaydedildi: 21 sayfa · 148 ayet.");
      setMushafImportPercent(100);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : (error && typeof error === "object" && "message" in error)
            ? String((error as {message?:unknown}).message || "Word Mushaf içe aktarılamadı.")
            : String(error || "Word Mushaf içe aktarılamadı.");
      setMushafImportProgress(message);
    } finally {
      setMushafImporting(false);
      if (mushafFileRef.current) mushafFileRef.current.value = "";
    }
  }

  if (!open) return null;

  return (
    <aside ref={dockRef} className="librarySettingsDock" aria-label="Okuma ayarları">
      <div className="librarySettingsModal">
        <div className="modalHead">
          <strong>{scope === "quran" ? "Kur’an ayarları" : scope === "risale" ? "Risale-i Nur ayarları" : scope === "he" ? "H.E. kitapları ayarları" : "Ezber ayarları"}</strong>
          <button className="modalClose" onClick={onClose}>×</button>
        </div>

        {scope !== "quran" && (
          <>
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

          </>
        )}

        {scope === "quran" && (
          <>
        <div className="settingSectionTitle">Kur’an sayfası</div>

        <div className="settingRow quranPrimarySetting">
          <span>Yazı boyutu</span>
          <div className="fontControls">
            <button onClick={() => update({...prefs,quranFontScale:Math.max(.8,+(prefs.quranFontScale-.1).toFixed(1))})}>A−</button>
            <button onClick={() => update({...prefs,quranFontScale:1})}>A</button>
            <button onClick={() => update({...prefs,quranFontScale:Math.min(1.8,+(prefs.quranFontScale+.1).toFixed(1))})}>A+</button>
          </div>
        </div>

        <div className="settingRow quranPrimarySetting">
          <span>Sayfa arka planı</span>
          <div className="quranThemeChoices">
            {([
              ["paper","Krem"],
              ["white","Beyaz"],
              ["sepia","Sarı"],
              ["dark","Karanlık"],
            ] as const).map(([value,label]) => (
              <button
                key={value}
                className={"quranThemeChip " + (prefs.quranPageTheme === value ? "active" : "")}
                onClick={() => update({...prefs,quranPageTheme:value})}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="settingRow quranDocxImportSetting">
          <span>Word Mushaf kaynağı</span>
          <div className="quranDocxImportControl">
            <input
              ref={mushafFileRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              onChange={event => void importMushafFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="settingButton"
              disabled={mushafImporting}
              onClick={() => mushafFileRef.current?.click()}
            >
              {mushafImporting ? "İçe aktarılıyor…" : "1. cüzü DOCX'ten birebir içe aktar"}
            </button>
            {!!mushafImportProgress && (
              <div className="quranDocxImportStatus">
                <span>{mushafImportProgress}</span>
                <progress max={100} value={mushafImportPercent} />
              </div>
            )}
          </div>
        </div>

        <div className="settingRow">
          <span>Kur’an yazı tipi</span>
          <select
            className="input quranFontSelect"
            value={prefs.quranFontFamily}
            onChange={e => update({...prefs,quranFontFamily:e.target.value})}
          >
            <option value="Shaikh Hamdullah Mushaf">Shaikh Hamdullah Mushaf</option>
            <option value="Shaikh Hamdullah Book">Shaikh Hamdullah Book</option>
            <option value="Shaikh Hamdullah Basic">Shaikh Hamdullah Basic</option>
            <option value="Traditional Naskh">Traditional Naskh</option>
            <option value="Traditional Arabic">Traditional Arabic</option>
            <option value="AGA Arabesque Desktop">AGA Arabesque Desktop</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Arial">Arial</option>
            <option value="Tahoma">Tahoma</option>
            <option value="Trebuchet MS">Trebuchet MS</option>
            <option value="Calibri">Calibri</option>
            <option value="Calibri Light">Calibri Light</option>
          </select>
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


          </>
        )}

        {scope !== "quran" && (
          <>
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
          </>
        )}
      </div>
    </aside>
  );
}
