"use client";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LibraryView } from "@/components/LibraryView";
import { MemorizationView } from "@/components/MemorizationView";
import { EzberHomeView, type EzberItem } from "@/components/EzberHomeView";
import { TodoList } from "@/components/TodoList";
import { SettingsView } from "@/components/SettingsView";

type Tab = "todos" | "library" | "memorize" | "settings";

export function AppShell({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("memorize");
  const [memorizeItem, setMemorizeItem] = useState<EzberItem | null>(null);

  const labels: Record<Tab, string> = {
    todos: "TODO",
    library: "Kütüphane",
    memorize: "Ezber",
    settings: "Ayarlar",
  };

  function startMemorize(item: EzberItem) {
    setMemorizeItem(item);
    setTab("memorize");
  }

  function openEzberHome() {
    setMemorizeItem(null);
    setTab("memorize");
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
            onClick={() => setTab("library")}
          >
            Kütüphane
          </button>

          <button
            className={"navButton " + (tab === "memorize" ? "active" : "")}
            onClick={openEzberHome}
          >
            Ezber
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
        {tab !== "memorize" && (
          <header className="topbar">
            <h1 className="pageTitle">{labels[tab]}</h1>
            <span className="muted" style={{ fontSize: 13 }}>
              {user.email}
            </span>
          </header>
        )}

        <div className={tab === "memorize" ? "" : "pageWrap"}>
          {tab === "todos" && <TodoList />}

          {tab === "library" && (
            <LibraryView onMemorize={startMemorize} />
          )}

          {tab === "memorize" && !memorizeItem && (
            <EzberHomeView
              onOpenItem={startMemorize}
              onOpenTodo={() => setTab("todos")}
            />
          )}

          {tab === "memorize" && memorizeItem && (
            <MemorizationView
              item={memorizeItem}
              onBack={() => setMemorizeItem(null)}
            />
          )}

          {tab === "settings" && (
            <SettingsView user={user} onSignOut={onSignOut} />
          )}
        </div>
      </main>
    </div>
  );
}
