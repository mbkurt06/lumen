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
import { DuaListeningEmbed } from "@/components/DuaListeningEmbed";
import { supabase } from "@/lib/supabase/client";

type Tab = "todos" | "library" | "settings";
type LibraryMode = "hub" | "read" | "memorize" | "listening";

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
  const [returnToEzber, setReturnToEzber] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lumen-app-state");
      if (saved) {
        const state = JSON.parse(saved);
        if (state.tab) setTab(state.tab);
        if (state.libraryMode) setLibraryMode(state.libraryMode);
        if (state.selectedItem) setSelectedItem(state.selectedItem);
        if (Array.isArray(state.siblings)) setSiblings(state.siblings);
        if (typeof state.initialSegmentIndex === "number") setInitialSegmentIndex(state.initialSegmentIndex);
        if (state.returnEzberRoot) setReturnEzberRoot(state.returnEzberRoot);
        if (typeof state.returnToEzber === "boolean") setReturnToEzber(state.returnToEzber);
      }
    } catch {}
    setRestored(true);

    supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle()
      .then(({ data }) => {
        const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
        const theme = typeof prefs.theme === "string" ? prefs.theme : "light";
        const fontScale = typeof prefs.fontScale === "number" ? prefs.fontScale : 1;
        document.documentElement.classList.toggle("pre-dark", theme === "dark");
        document.body.classList.toggle("dark", theme === "dark");
        localStorage.setItem("lumen-theme", theme);
        document.body.classList.toggle("hideArabic", prefs.showArabic === false);
        document.body.classList.toggle("hideLatin", prefs.showLatin === false);
        document.body.classList.toggle("hideTurkish", prefs.showTurkish !== true);
        document.documentElement.style.setProperty("--font-scale", String(fontScale));
      });
  }, []);

  useEffect(() => {
    if (!restored) return;
    if (localStorage.getItem("lumen-repair-todo-target-v1") === "done") return;

    (async () => {
      const { data: todoRows } = await supabase
        .from("todos")
        .select("id,notes,related_library_item_id,related_content_node_id");

      for (const todo of todoRows ?? []) {
        let meta: any;
        try { meta = JSON.parse(todo.notes || "{}"); } catch { continue; }
        if (Number(meta?.schedule?.target || 1) !== 1) continue;

        let target = 0;

        if (todo.related_content_node_id) {
          const { data: node } = await supabase
            .from("content_nodes")
            .select("metadata")
            .eq("id", todo.related_content_node_id)
            .maybeSingle();
          target = Number((node?.metadata as any)?.target || 0);
        }

        if (target <= 1 && todo.related_library_item_id) {
          const { data: item } = await supabase
            .from("library_items")
            .select("metadata")
            .eq("id", todo.related_library_item_id)
            .maybeSingle();
          target = Number((item?.metadata as any)?.target || 0);
        }

        if (target > 1) {
          const next = {
            ...meta,
            schedule: {
              ...meta.schedule,
              target,
            },
          };
          await supabase.from("todos").update({ notes: JSON.stringify(next) }).eq("id", todo.id);
        }
      }

      localStorage.setItem("lumen-repair-todo-target-v1", "done");
    })();
  }, [restored]);

  useEffect(() => {
    if (!restored) return;
    localStorage.setItem("lumen-app-state", JSON.stringify({
      tab,
      libraryMode,
      selectedItem,
      siblings,
      initialSegmentIndex,
      returnEzberRoot,
      returnToEzber,
    }));
  }, [restored, tab, libraryMode, selectedItem, siblings, initialSegmentIndex, returnEzberRoot, returnToEzber]);

  async function openTodoSource(todo: {
    related_library_item_id: string | null;
    related_content_node_id: string | null;
  }) {
    if (!todo.related_library_item_id) return;

    const { data: item } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("id", todo.related_library_item_id)
      .single();

    if (!item) return;

    let parent: EzberItem | null = null;
    let list: EzberItem[] = [];

    if (item.parent_id) {
      const [{ data: parentData }, { data: siblingsData }] = await Promise.all([
        supabase
          .from("library_items")
          .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
          .eq("id", item.parent_id)
          .maybeSingle(),
        supabase
          .from("library_items")
          .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
          .eq("parent_id", item.parent_id)
          .order("sort_order"),
      ]);
      parent = parentData ?? null;
      list = siblingsData ?? [];
    }

    let segmentIndex = 0;
    if (todo.related_content_node_id) {
      const { data: nodes } = await supabase
        .from("content_nodes")
        .select("id")
        .eq("document_id", item.id)
        .order("sort_order");
      const idx = (nodes ?? []).findIndex(node => node.id === todo.related_content_node_id);
      if (idx >= 0) segmentIndex = idx;
    }

    setSelectedItem(item);
    setReturnEzberRoot(parent);
    setReturnToEzber(true);
    setSiblings(list.filter(x => x.kind === "document"));
    setInitialSegmentIndex(segmentIndex);
    setLibraryMode("read");
    setTab("library");
  }

  function openRead(item: EzberItem, list: EzberItem[], parent: EzberItem | null) {
    setSelectedItem(item);
    setReturnEzberRoot(parent);
    setReturnToEzber(true);
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
    setReturnToEzber(false);
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

  if (!restored) return <div className="appRestoreBlank" />;

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
          {tab === "todos" && <TodoList onOpenTodo={openTodoSource} />}

          {tab === "library" && libraryMode === "hub" && (
            <LibraryHubView
              user={user}
              onOpenItem={openRead}
              initialSection={(returnToEzber || returnEzberRoot) ? "ezber" : null}
              initialEzberRoot={returnEzberRoot}
              onOpenListening={() => {
                setReturnEzberRoot(null);
                setReturnToEzber(true);
                setLibraryMode("listening");
              }}
            />
          )}

          {tab === "library" && libraryMode === "listening" && (
            <DuaListeningEmbed onBack={() => { setReturnToEzber(true); setLibraryMode("hub"); }} />
          )}

          {tab === "library" && libraryMode === "read" && selectedItem && (
            <ReaderView
              item={selectedItem}
              initialFocusIndex={initialSegmentIndex}
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
