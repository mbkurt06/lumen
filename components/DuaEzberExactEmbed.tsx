"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type SharedPrefs = {
  theme: "light" | "dark";
  fontScale: number;
  showArabic: boolean;
  showLatin: boolean;
  showTurkish: boolean;
};

const defaults: SharedPrefs = {
  theme: "light",
  fontScale: 1,
  showArabic: true,
  showLatin: true,
  showTurkish: false,
};

function applyOuter(prefs: SharedPrefs) {
  document.documentElement.classList.toggle("pre-dark", prefs.theme === "dark");
  document.body.classList.toggle("dark", prefs.theme === "dark");
  localStorage.setItem("lumen-theme", prefs.theme);
  document.body.classList.toggle("hideArabic", !prefs.showArabic);
  document.body.classList.toggle("hideLatin", !prefs.showLatin);
  document.body.classList.toggle("hideTurkish", !prefs.showTurkish);
  document.documentElement.style.setProperty("--font-scale", String(prefs.fontScale));
}

export function DuaEzberExactEmbed({ active, user }: { active: boolean; user: User }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [prefs, setPrefs] = useState<SharedPrefs>(defaults);

  const sendPrefs = useCallback((next: SharedPrefs) => {
    frameRef.current?.contentWindow?.postMessage({ type: "lumen-library-prefs", prefs: next }, window.location.origin);
  }, []);

  const persistPrefs = useCallback(async (next: SharedPrefs) => {
    setPrefs(next);
    applyOuter(next);
    sendPrefs(next);
    window.dispatchEvent(new CustomEvent("lumen-library-prefs", { detail: next }));

    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const old = (data?.preferences ?? {}) as Record<string, unknown>;
    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: { ...old, ...next },
    });
  }, [sendPrefs, user.id]);

  useEffect(() => {
    let cancelled = false;
    supabase.from("user_preferences").select("preferences").maybeSingle().then(({ data }) => {
      if (cancelled) return;
      const raw = (data?.preferences ?? {}) as Partial<SharedPrefs>;
      const next = { ...defaults, ...raw };
      setPrefs(next);
      applyOuter(next);
      sendPrefs(next);
    });
    return () => { cancelled = true; };
  }, [sendPrefs]);

  useEffect(() => {
    const onShared = (event: Event) => {
      const next = (event as CustomEvent<SharedPrefs>).detail;
      if (!next) return;
      setPrefs(next);
      sendPrefs(next);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "lumen-update-library-prefs") return;
      const patch = event.data.patch || {};
      const next = { ...prefs, ...patch };
      void persistPrefs(next);
    };
    window.addEventListener("lumen-library-prefs", onShared);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("lumen-library-prefs", onShared);
      window.removeEventListener("message", onMessage);
    };
  }, [persistPrefs, prefs, sendPrefs]);

  useEffect(() => {
    if (active) document.body.classList.add("exactV2EzberActive");
    else document.body.classList.remove("exactV2EzberActive");
    return () => document.body.classList.remove("exactV2EzberActive");
  }, [active]);

  return (
    <div className={"exactV2EzberFrame " + (active ? "active" : "preloaded")}>
      <iframe
        ref={frameRef}
        src="/dua-v2/index.html?embedded=1"
        title="Dua Ezber"
        allow="autoplay; fullscreen"
        onLoad={() => sendPrefs(prefs)}
      />
    </div>
  );
}
