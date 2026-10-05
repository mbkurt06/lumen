"use client";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ReaderView } from "@/components/ReaderView";
import { MemorizationView } from "@/components/MemorizationView";
import { EzberHomeView, type EzberItem } from "@/components/EzberHomeView";
import { TodoList } from "@/components/TodoList";
import { SettingsView } from "@/components/SettingsView";
import { supabase } from "@/lib/supabase/client";

type Tab = "todos" | "memorize" | "settings";
type EzberMode = "home" | "read" | "memorize";

export function AppShell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("memorize");
  const [ezberMode, setEzberMode] = useState<EzberMode>("home");
  const [selectedItem, setSelectedItem] = useState<EzberItem | null>(null);
  const [siblings, setSiblings] = useState<EzberItem[]>([]);
  const [initialSegmentIndex, setInitialSegmentIndex] = useState(0);

  useEffect(() => {
    supabase.from("user_preferences").select("preferences").maybeSingle().then(({ data }) => {
      const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
      const theme = typeof prefs.theme === "string" ? prefs.theme : "system";
      const fontScale = typeof prefs.fontScale === "number" ? prefs.fontScale : 1;
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.body.classList.toggle("dark", dark);
      document.body.classList.toggle("hideArabic", prefs.showArabic === false);
      document.body.classList.toggle("hideLatin", prefs.showLatin === false);
      document.body.classList.toggle("hideTurkish", prefs.showTurkish !== true);
      document.documentElement.style.setProperty("--font-scale", String(fontScale));
    });
  }, []);

  function openRead(item: EzberItem, list: EzberItem[]) {
    setSelectedItem(item);
    setSiblings(list.filter(x => x.kind === "document"));
    setInitialSegmentIndex(0);
    setEzberMode("read");
    setTab("memorize");
  }

  function openEzberHome() {
    setSelectedItem(null);
    setSiblings([]);
    setInitialSegmentIndex(0);
    setEzberMode("home");
    setTab("memorize");
  }

  const selectedIndex = useMemo(
    () => selectedItem ? siblings.findIndex(x => x.id === selectedItem.id) : -1,
    [selectedItem, siblings]
  );

  function moveDocument(delta: number) {
    if (selectedIndex < 0) return;
    const next = siblings[selectedIndex + delta];
    if (!next) return;
    setSelectedItem(next);
    setInitialSegmentIndex(0);
    setEzberMode("read");
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">Lumen</div>
        <nav className="nav">
          <button className={"navButton " + (tab === "todos" ? "active" : "")} onClick={() => setTab("todos")}>TODO</button>
          <button className={"navButton " + (tab === "memorize" ? "active" : "")} onClick={openEzberHome}>Ezber</button>
          <button className={"navButton " + (tab === "settings" ? "active" : "")} onClick={() => setTab("settings")}>Ayarlar</button>
        </nav>
      </aside>

      <main className="mainPane">
        {tab !== "memorize" && (
          <header className="topbar">
            <h1 className="pageTitle">{tab === "todos" ? "TODO" : "Ayarlar"}</h1>
            <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
          </header>
        )}

        <div className={tab === "memorize" ? "" : "pageWrap"}>
          {tab === "todos" && <TodoList />}

          {tab === "memorize" && ezberMode === "home" && (
            <EzberHomeView onOpenItem={openRead} />
          )}

          {tab === "memorize" && ezberMode === "read" && selectedItem && (
            <ReaderView
              item={selectedItem}
              onBack={() => setEzberMode("home")}
              onMemorize={(index = 0) => {
                setInitialSegmentIndex(index);
                setEzberMode("memorize");
              }}
              onPreviousItem={() => moveDocument(-1)}
              onNextItem={() => moveDocument(1)}
              hasPreviousItem={selectedIndex > 0}
              hasNextItem={selectedIndex >= 0 && selectedIndex < siblings.length - 1}
            />
          )}

          {tab === "memorize" && ezberMode === "memorize" && selectedItem && (
            <MemorizationView
              item={selectedItem}
              initialIndex={initialSegmentIndex}
              onBack={() => setEzberMode("read")}
            />
          )}

          {tab === "settings" && <SettingsView user={user} onSignOut={onSignOut} />}
        </div>
      </main>
    </div>
  );
}
