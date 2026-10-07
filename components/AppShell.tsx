"use client";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ReaderView } from "@/components/ReaderView";
import { MemorizationView } from "@/components/MemorizationView";
import { type EzberItem } from "@/components/EzberHomeView";
import { LibraryHubView, type SectionKey } from "@/components/LibraryHubView";
import { LibrarySettingsModal } from "@/components/LibrarySettingsModal";
import { TodoList } from "@/components/TodoList";
import { SettingsView } from "@/components/SettingsView";
import { DuaListeningEmbed } from "@/components/DuaListeningEmbed";
import { CalendarView } from "@/components/CalendarView";
import { CalendarSidePanel } from "@/components/CalendarSidePanel";
import { supabase } from "@/lib/supabase/client";
import { syncStaticContentInBackground } from "@/lib/contentSync";

type Tab = "todos" | "library" | "calendar" | "settings";
type LibraryMode = "hub" | "read" | "memorize" | "listening";
type RightPanelMode = "todo" | "calendar";
type ReaderScope = "ezber" | "risale" | "quran" | "he";

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
  const [returnLibrarySection, setReturnLibrarySection] = useState<SectionKey | null>(null);
  const [restored, setRestored] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("todo");
  const [rightPanelMenuOpen, setRightPanelMenuOpen] = useState(false);

  useEffect(() => {
    const AUTO_SYNC_KEY = "lumen-static-auto-sync";
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) clearInterval(timer);
      timer = null;
      if (localStorage.getItem(AUTO_SYNC_KEY) !== "1") return;
      void syncStaticContentInBackground(user.id);
      timer = setInterval(() => {
        void syncStaticContentInBackground(user.id);
      }, 15 * 60 * 1000);
    };

    const onChanged = () => start();
    start();
    window.addEventListener("lumen-auto-sync-changed", onChanged);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("lumen-auto-sync-changed", onChanged);
    };
  }, [user.id]);

  const readerScope: ReaderScope = useMemo(() => {
    const source = String((selectedItem?.metadata as any)?.source || (selectedItem?.metadata as any)?.catalog_source || "");
    if (source.startsWith("quran")) return "quran";
    if (source.startsWith("risale")) return "risale";
    if (returnLibrarySection === "he") return "he";
    if (returnLibrarySection === "quran") return "quran";
    if (returnLibrarySection === "risale") return "risale";
    return "ezber";
  }, [selectedItem, returnLibrarySection]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lumen-app-state");
      let restoredSidebar = false;
      if (saved) {
        const state = JSON.parse(saved);
        if (state.tab) setTab(state.tab);
        if (state.libraryMode) setLibraryMode(state.libraryMode);
        if (state.selectedItem) setSelectedItem(state.selectedItem);
        if (Array.isArray(state.siblings)) setSiblings(state.siblings);
        if (typeof state.initialSegmentIndex === "number") setInitialSegmentIndex(state.initialSegmentIndex);
        if (state.returnEzberRoot) setReturnEzberRoot(state.returnEzberRoot);
        if (typeof state.returnToEzber === "boolean") setReturnToEzber(state.returnToEzber);
        if (state.returnLibrarySection === "ezber" || state.returnLibrarySection === "risale" || state.returnLibrarySection === "quran" || state.returnLibrarySection === "he") {
          setReturnLibrarySection(state.returnLibrarySection);
        }
        if (typeof state.sidebarOpen === "boolean") {
          setSidebarOpen(state.sidebarOpen);
          restoredSidebar = true;
        }
        if (typeof state.rightPanelOpen === "boolean") setRightPanelOpen(state.rightPanelOpen);
        if (state.rightPanelMode === "todo" || state.rightPanelMode === "calendar") setRightPanelMode(state.rightPanelMode);
      }
      if (!restoredSidebar && window.matchMedia("(max-width: 800px)").matches) setSidebarOpen(false);
    } catch {
      if (window.matchMedia("(max-width: 800px)").matches) setSidebarOpen(false);
    }
    setRestored(true);

    supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle()
      .then(({ data }) => {
        const serverPrefs = (data?.preferences ?? {}) as Record<string, unknown>;
        let localQuran: Record<string, unknown> = {};
        try {
          localQuran = JSON.parse(localStorage.getItem("lumen-quran-page-prefs") || "{}") as Record<string, unknown>;
        } catch {}
        const prefs = { ...serverPrefs, ...localQuran };
        const theme = typeof prefs.theme === "string" ? prefs.theme : "light";
        const fontScale = typeof prefs.fontScale === "number" ? prefs.fontScale : 1;
        const quranFontScale = typeof prefs.quranFontScale === "number" ? prefs.quranFontScale : 1;
        const quranFontWeight = typeof prefs.quranFontWeight === "number" ? prefs.quranFontWeight : 300;
        const quranFontFamily = typeof prefs.quranFontFamily === "string" ? prefs.quranFontFamily : "Shaikh Hamdullah Mushaf";
        const quranPageTheme = typeof prefs.quranPageTheme === "string" ? prefs.quranPageTheme : "paper";
        const risalePageTheme = typeof prefs.risalePageTheme === "string" ? prefs.risalePageTheme : "paper";
        document.documentElement.classList.toggle("pre-dark", theme === "dark");
        document.body.classList.toggle("dark", theme === "dark");
        localStorage.setItem("lumen-theme", theme);
        document.documentElement.style.setProperty("--font-scale", String(fontScale));
        document.documentElement.style.setProperty("--quran-font-scale", String(quranFontScale));
        document.documentElement.style.setProperty("--quran-font-weight", String(quranFontWeight));
        document.documentElement.style.setProperty("--quran-font-family", JSON.stringify(quranFontFamily));
        document.body.dataset.quranPageTheme = quranPageTheme;
        document.body.dataset.risalePageTheme = risalePageTheme;
        document.body.classList.toggle("quranHideLatin", prefs.quranShowLatin !== true);
        document.body.classList.toggle("quranHideTranslation", prefs.quranShowTranslation !== true);
        document.body.classList.remove("quranEasyRead");
        window.dispatchEvent(new CustomEvent("lumen-library-prefs", {
          detail: {
            theme,
            fontScale,
            showArabic: prefs.showArabic !== false,
            showLatin: prefs.showLatin !== false,
            showTurkish: prefs.showTurkish === true,
          }
        }));
      });
  }, []);

  useEffect(() => {
    supabase.from("user_preferences").select("preferences").maybeSingle().then(({ data }) => {
      const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
      const cap = readerScope[0].toUpperCase() + readerScope.slice(1);
      const fontScale = typeof prefs[readerScope + "FontScale"] === "number" ? Number(prefs[readerScope + "FontScale"]) : 1;
      const showArabic = typeof prefs[readerScope + "ShowArabic"] === "boolean" ? Boolean(prefs[readerScope + "ShowArabic"]) : true;
      const showLatin = typeof prefs[readerScope + "ShowLatin"] === "boolean" ? Boolean(prefs[readerScope + "ShowLatin"]) : true;
      const showTurkish = typeof prefs[readerScope + "ShowTurkish"] === "boolean" ? Boolean(prefs[readerScope + "ShowTurkish"]) : false;
      document.body.dataset.readerScope = readerScope;
      document.documentElement.style.setProperty("--font-scale", String(fontScale));
      document.body.classList.toggle("hideArabic", readerScope !== "quran" && !showArabic);
      document.body.classList.toggle("hideLatin", readerScope !== "quran" && !showLatin);
      document.body.classList.toggle("hideTurkish", readerScope !== "quran" && !showTurkish);
      if (readerScope === "quran") {
        document.body.classList.remove("hideArabic","hideLatin","hideTurkish");
      }
    });
  }, [readerScope]);

  useEffect(() => {
    const openSettings = () => setLibrarySettingsOpen(open => !open);
    window.addEventListener("lumen-open-library-settings", openSettings);
    return () => window.removeEventListener("lumen-open-library-settings", openSettings);
  }, []);

  useEffect(() => {
    setRightPanelMode("todo");
    setRightPanelMenuOpen(false);
  }, [tab]);

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
      returnLibrarySection,
      sidebarOpen,
      rightPanelOpen,
      rightPanelMode,
    }));
  }, [restored, tab, libraryMode, selectedItem, siblings, initialSegmentIndex, returnEzberRoot, returnToEzber, returnLibrarySection, sidebarOpen, rightPanelOpen, rightPanelMode]);

  async function openTodoSource(todo: {
    related_library_item_id: string | null;
    related_content_node_id: string | null;
    notes?: string | null;
  }) {
    if (!todo.related_library_item_id) return;

    let todoMeta: any = {};
    try { todoMeta = JSON.parse(todo.notes || "{}"); } catch {}

    let requestedNodeId = todoMeta?.quran?.position?.nodeId || todo.related_content_node_id || null;
    let requestedPage = Number(todoMeta?.quran?.position?.page || 0) || null;

    let { data: item } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("id", todo.related_library_item_id)
      .single();

    if (!item) return;

    const itemSource = String((item.metadata as any)?.source || "");
    if (itemSource.startsWith("quran") && requestedNodeId) {
      const { data: targetNode } = await supabase
        .from("content_nodes")
        .select("id,document_id,metadata")
        .eq("id", requestedNodeId)
        .maybeSingle();

      if (targetNode?.document_id) {
        const { data: targetItem } = await supabase
          .from("library_items")
          .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
          .eq("id", targetNode.document_id)
          .maybeSingle();

        if (targetItem) {
          item = {
            ...targetItem,
            metadata: {
              ...(targetItem.metadata ?? {}),
              start_page: requestedPage || Number((targetNode.metadata as any)?.page || 1),
              initial_node_id: requestedNodeId,
            },
          };
        }
      }
    }

    const resolvedSource = String((item.metadata as any)?.source || "");
    if (resolvedSource.startsWith("quran")) {
      // Kur’an Todo'sunda üst klasör/kardeş/bölüm index sorgularını bekleme.
      // Reader zaten sayfayı ve seçili ayeti metadata üzerinden doğrudan açıyor.
      setSelectedItem(item);
      setReturnLibrarySection("quran");
      setReturnEzberRoot(null);
      setReturnToEzber(false);
      setSiblings([]);
      setInitialSegmentIndex(0);
      setLibraryMode("read");
      setTab("library");
      return;
    }

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
    if (requestedNodeId) {
      const { data: nodes } = await supabase
        .from("content_nodes")
        .select("id")
        .eq("document_id", item.id)
        .order("sort_order");
      const idx = (nodes ?? []).findIndex(node => node.id === requestedNodeId);
      if (idx >= 0) segmentIndex = idx;
    }

    const itemMeta = (item.metadata ?? {}) as Record<string, unknown>;
    const sourceName = String(itemMeta.source || itemMeta.catalog_source || "");
    const targetSection: SectionKey =
      sourceName.startsWith("quran") ? "quran" :
      sourceName.startsWith("risale") ? "risale" :
      "ezber";

    setSelectedItem(item);
    setReturnLibrarySection(targetSection);
    setReturnEzberRoot(targetSection === "ezber" ? parent : null);
    setReturnToEzber(targetSection === "ezber");
    setSiblings(list.filter(x => x.kind === "document"));
    setInitialSegmentIndex(segmentIndex);
    setLibraryMode("read");
    setTab("library");
  }

  function openRead(item: EzberItem, list: EzberItem[], parent: EzberItem | null) {
    const section = returnLibrarySection ?? "ezber";
    setSelectedItem(item);
    setReturnEzberRoot(section === "ezber" ? parent : null);
    setReturnToEzber(section === "ezber");
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
    setReturnLibrarySection(null);
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
    <div className={"appShell " + (sidebarOpen ? "sidebarOpen " : "sidebarClosed ") + (rightPanelOpen ? "rightPanelOpen" : "rightPanelClosed")}>
      {!sidebarOpen && (
        <button className="sidebarReopen" onClick={() => setSidebarOpen(true)} aria-label="Menüyü aç" title="Menüyü aç">☰</button>
      )}
      {sidebarOpen && <button className="sidebarBackdrop" onClick={() => setSidebarOpen(false)} aria-label="Menüyü kapat" />}

      <aside className="sidebar">
        <div className="brandRow">
          <div className="brand">Lumen</div>
          <button className="sidebarCollapseButton" onClick={() => setSidebarOpen(false)} aria-label="Menüyü gizle" title="Menüyü gizle">☰</button>
        </div>

        <nav className="nav">
          <button
            className={"navButton " + (tab === "todos" ? "active" : "")}
            onClick={() => { setTab("todos"); if (window.innerWidth <= 800) setSidebarOpen(false); }}
          >
            <span className="navIcon">✓</span><span>TODO</span>
          </button>

          <button
            className={"navButton " + (tab === "library" ? "active" : "")}
            onClick={() => { openLibraryHome(); if (window.innerWidth <= 800) setSidebarOpen(false); }}
          >
            <span className="navIcon">▤</span><span>Kütüphane</span>
          </button>

          <button
            className={"navButton " + (tab === "calendar" ? "active" : "")}
            onClick={() => { setTab("calendar"); if (window.innerWidth <= 800) setSidebarOpen(false); }}
          >
            <span className="navIcon">▦</span><span>Takvim</span>
          </button>

          <button
            className={"navButton " + (tab === "settings" ? "active" : "")}
            onClick={() => { setTab("settings"); if (window.innerWidth <= 800) setSidebarOpen(false); }}
          >
            <span className="navIcon">⚙</span><span>Ayarlar</span>
          </button>
        </nav>
      </aside>

      <main className="mainPane">
        {tab !== "library" && tab !== "calendar" && (
          <header className="topbar">
            <h1 className="pageTitle">{tab === "todos" ? "TODO" : "Ayarlar"}</h1>
            <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
          </header>
        )}

        {tab === "library" && (
          <button
            className="persistentLibrarySettings"
            onClick={() => setLibrarySettingsOpen(open => !open)}
            aria-label="Kütüphane ayarları"
            title="Kütüphane ayarları"
          >
            ⚙
          </button>
        )}

        <div className={tab === "library" || tab === "calendar" ? "" : "pageWrap"}>
          {tab === "todos" && <TodoList onOpenTodo={openTodoSource} />}

          {tab === "library" && libraryMode === "hub" && (
            <LibraryHubView
              user={user}
              onOpenItem={openRead}
              initialSection={returnLibrarySection ?? ((returnToEzber || returnEzberRoot) ? "ezber" : null)}
              initialEzberRoot={returnLibrarySection === "ezber" || (!returnLibrarySection && (returnToEzber || returnEzberRoot)) ? returnEzberRoot : null}
              onSectionChange={section => {
                setReturnLibrarySection(section);
                setReturnToEzber(section === "ezber");
                if (section !== "ezber") setReturnEzberRoot(null);
              }}
              onOpenListening={() => {
                setReturnEzberRoot(null);
                setReturnLibrarySection("ezber");
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
              categoryTitle={returnEzberRoot?.title || ""}
              initialFocusIndex={initialSegmentIndex}
              onBack={() => setLibraryMode("hub")}
              onMenu={() => {
                if (returnLibrarySection === "ezber") {
                  setReturnEzberRoot(null);
                  setReturnToEzber(true);
                }
                setLibraryMode("hub");
              }}
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
              categoryTitle={returnEzberRoot?.title || ""}
              onMenu={() => {
                if (returnLibrarySection === "ezber") {
                  setReturnEzberRoot(null);
                  setReturnToEzber(true);
                }
                setLibraryMode("hub");
              }}
              onBack={() => setLibraryMode("read")}
            />
          )}

          {tab === "calendar" && <CalendarView user={user} externalSources />}

          {tab === "settings" && (
            <SettingsView user={user} onSignOut={onSignOut} />
          )}
        </div>
      </main>

      <aside className={"globalRightPanel " + (rightPanelOpen ? "open" : "closed")}>
        <button
          className="globalRightPanelToggle"
          onClick={() => setRightPanelOpen(open => !open)}
          aria-label={rightPanelOpen ? "Sağ paneli gizle" : "Sağ paneli aç"}
          title={rightPanelOpen ? "Sağ paneli gizle" : "Sağ paneli aç"}
        >
          {rightPanelOpen ? "›" : "‹"}
        </button>

        {rightPanelOpen && (
          <>
            <div className="globalRightPanelHead">
              <div>
                <strong>{rightPanelMode === "todo" ? "TODO" : "Takvim"}</strong>
                <small>{rightPanelMode === "todo" ? "Günlük görevler ve etkinlikler" : "Takvim kaynakları"}</small>
              </div>
              {tab === "calendar" && (
                <div className="rightPanelMenuWrap">
                  <button
                    className="rightPanelDots"
                    onClick={() => setRightPanelMenuOpen(open => !open)}
                    aria-label="Takvim paneli seçenekleri"
                    title="Takvim paneli seçenekleri"
                  >
                    •••
                  </button>
                  {rightPanelMenuOpen && (
                    <div className="rightPanelMenu">
                      <button onClick={() => { setRightPanelMode("todo"); setRightPanelMenuOpen(false); }}>✓ TODO</button>
                      <button onClick={() => { setRightPanelMode("calendar"); setRightPanelMenuOpen(false); }}>⚙ Takvim ayarları</button>
                      <button onClick={() => { setRightPanelMode("calendar"); setRightPanelMenuOpen(false); }}>＋ Takvim ekle</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="globalRightPanelBody">
              {rightPanelMode === "todo" || tab !== "calendar"
                ? <TodoList compact onOpenTodo={openTodoSource} />
                : <CalendarSidePanel user={user} />
              }
            </div>
          </>
        )}
      </aside>

      <LibrarySettingsModal
        user={user}
        open={librarySettingsOpen}
        onClose={() => setLibrarySettingsOpen(false)}
        scope={readerScope}
      />
    </div>
  );
}
