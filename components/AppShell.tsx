"use client";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ReaderView } from "@/components/ReaderView";
import { MemorizationView } from "@/components/MemorizationView";
import { type EzberItem } from "@/components/EzberHomeView";
import { LibraryHubView } from "@/components/LibraryHubView";
import { LibrarySettingsModal } from "@/components/LibrarySettingsModal";
import { TodoList } from "@/components/TodoList";
import { SettingsView } from "@/components/SettingsView";
import { supabase } from "@/lib/supabase/client";

type Tab = "todos" | "library" | "settings";
type LibraryMode = "hub" | "read" | "memorize";

export function AppShell({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("library");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("hub");
  const [selectedItem, setSelectedItem] = useState<EzberItem | null>(null);
  const [siblings, setSiblings] = useState<EzberItem[]>([]);
  const [initialSegmentIndex, setInitialSegmentIndex] = useState(0);
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [returnEzberRoot, setReturnEzberRoot] = useState<EzberItem | null>(null);

  useEffect(() => {
    supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle()
      .then(({ data }) => {
        const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
        const theme = typeof prefs.theme === "string" ? prefs.theme : "light";
        const fontScale = typeof prefs.fontScale === "number" ? prefs.fontScale : 1;
        document.body.classList.toggle("dark", theme === "dark");
        document.body.classList.toggle("hideArabic", prefs.showArabic === false);
        document.body.classList.toggle("hideLatin", prefs.showLatin === false);
        document.body.classList.toggle("hideTurkish", prefs.showTurkish !== true);
        document.documentElement.style.setProperty("--font-scale", String(fontScale));
      });
  }, []);

  function openRead(item: EzberItem, list: EzberItem[], parent: EzberItem | null) {
    setSelectedItem(item);
    setReturnEzberRoot(parent);
    setSiblings(list.filter(x => x.kind === "document"));
    setInitialSegmentIndex(0);
    setLibraryMode("read");
    setTab("library");
  }

  function openLibraryHome() {
    setSelectedItem(null);
    setSiblings([]);
    setInitialSegmentIndex(0);
    setReturnEzberRoot(null);
    setLibraryMode("hub");
    setTab("library");
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
    setLibraryMode("read");
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">Lumen</div>

        <nav className="nav">
          <button
            className={"navButton " + (tab === "todos" ? "active" : "")}
            onClick={() => setTab("todos")}
          >
            TODO
          </button>

          <button
            className={"navButton " + (tab === "library" ? "active" : "")}
            onClick={openLibraryHome}
          >
            Kütüphane
          </button>

          <button
            className={"navButton " + (tab === "settings" ? "active" : "")}
            onClick={() => setTab("settings")}
          >
            Ayarlar
          </button>
        </nav>
      </aside>

      <main className="mainPane">
        {tab !== "library" && (
          <header className="topbar">
            <h1 className="pageTitle">{tab === "todos" ? "TODO" : "Ayarlar"}</h1>
            <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
          </header>
        )}

        {tab === "library" && (
          <button
            className="persistentLibrarySettings"
            onClick={() => setLibrarySettingsOpen(true)}
            aria-label="Kütüphane ayarları"
            title="Kütüphane ayarları"
          >
            ⚙
          </button>
        )}

        <div className={tab === "library" ? "" : "pageWrap"}>
          {tab === "todos" && <TodoList />}

          {tab === "library" && libraryMode === "hub" && (
            <LibraryHubView
              user={user}
              onOpenItem={openRead}
              initialSection={returnEzberRoot ? "ezber" : null}
              initialEzberRoot={returnEzberRoot}
            />
          )}

          {tab === "library" && libraryMode === "read" && selectedItem && (
            <ReaderView
              item={selectedItem}
              onBack={() => setLibraryMode("hub")}
              onMemorize={(index = 0) => {
                setInitialSegmentIndex(index);
                setLibraryMode("memorize");
              }}
              onPreviousItem={() => moveDocument(-1)}
              onNextItem={() => moveDocument(1)}
              hasPreviousItem={selectedIndex > 0}
              hasNextItem={selectedIndex >= 0 && selectedIndex < siblings.length - 1}
            />
          )}

          {tab === "library" && libraryMode === "memorize" && selectedItem && (
            <MemorizationView
              item={selectedItem}
              initialIndex={initialSegmentIndex}
              onBack={() => setLibraryMode("read")}
            />
          )}

          {tab === "settings" && (
            <SettingsView user={user} onSignOut={onSignOut} />
          )}
        </div>
      </main>

      <LibrarySettingsModal
        user={user}
        open={librarySettingsOpen}
        onClose={() => setLibrarySettingsOpen(false)}
      />
    </div>
  );
}
