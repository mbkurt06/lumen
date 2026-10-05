"use client";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LibraryView } from "@/components/LibraryView";
import { MemorizationView } from "@/components/MemorizationView";
import { TodoList } from "@/components/TodoList";
import { SettingsView } from "@/components/SettingsView";

type Tab = "library" | "memorize" | "todos" | "settings";
type Item = {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
};

export function AppShell({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("library");
  const [memorizeItem, setMemorizeItem] = useState<Item | null>(null);

  const labels: Record<Tab, string> = {
    library: "Kütüphane",
    memorize: "Ezber",
    todos: "Yapılacaklar",
    settings: "Ayarlar",
  };

  function startMemorize(item: Item) {
    setMemorizeItem(item);
    setTab("memorize");
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">Lumen</div>

        <nav className="nav">
          {(["library", "memorize", "todos", "settings"] as Tab[]).map(
            item => (
              <button
                key={item}
                className={"navButton " + (tab === item ? "active" : "")}
                onClick={() => setTab(item)}
              >
                {labels[item]}
              </button>
            )
          )}
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
          {tab === "library" && (
            <LibraryView onMemorize={startMemorize} />
          )}

          {tab === "memorize" && (
            <MemorizationView
              item={memorizeItem}
              onBack={() => setTab("library")}
            />
          )}

          {tab === "todos" && <TodoList />}

          {tab === "settings" && (
            <SettingsView user={user} onSignOut={onSignOut} />
          )}
        </div>
      </main>
    </div>
  );
}
