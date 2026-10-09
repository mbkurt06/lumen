"use client";
import { useEffect, useState } from "react";

export function SectionHeader({
  title,
  invocation,
  progress,
  showMenu = true,
  showBack = true,
  showTodo = false,
  showMemorize = false,
  memorizeActive = false,
  onMenu,
  onBack,
  onTodo,
  onMemorize,
  showFullscreen = false,
  showSettings = true,
  showSelection = false,
  selectionReady = false,
  onFullscreen,
  onSettings,
  onSelection,
}: {
  title: string;
  invocation?: string | null;
  progress?: string | null;
  showMenu?: boolean;
  showBack?: boolean;
  showTodo?: boolean;
  showMemorize?: boolean;
  memorizeActive?: boolean;
  onMenu?: () => void;
  onBack?: () => void;
  onTodo?: () => void;
  onMemorize?: () => void;
  showFullscreen?: boolean;
  showSettings?: boolean;
  showSelection?: boolean;
  selectionReady?: boolean;
  onFullscreen?: () => void;
  onSettings?: () => void;
  onSelection?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("lumen-ezber-header-collapsed") === "1");
  }, []);

  function toggle() {
    setCollapsed(current => {
      const next = !current;
      localStorage.setItem("lumen-ezber-header-collapsed", next ? "1" : "0");
      window.dispatchEvent(new CustomEvent("lumen-ezber-header", { detail: next }));
      return next;
    });
  }

  useEffect(() => {
    const handler = (event: Event) => setCollapsed(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("lumen-ezber-header", handler);
    return () => window.removeEventListener("lumen-ezber-header", handler);
  }, []);

  return (
    <div className={"v2SharedHeader " + (collapsed ? "collapsed" : "")}>
      <div className="v2HeaderToolbar">
        <div className="v2HeaderGroup">
          {showMenu && <button className="v2HeaderButton v2HeaderMenuButton" onClick={onMenu}>‹ Menü</button>}
          {showBack && <button className="v2HeaderButton" onClick={onBack}>‹ Geri</button>}
        </div>
        <div className="v2HeaderGroup">
          {showTodo && <button className="v2HeaderButton" onClick={onTodo}>+ Todo</button>}
          {showMemorize && (
            <button className={"v2HeaderPrimary " + (memorizeActive ? "active" : "")} onClick={onMemorize}>
              Ezber yap
            </button>
          )}
          {showFullscreen && (
            <button
              className="v2HeaderToolButton"
              onClick={onFullscreen || (() => window.dispatchEvent(new Event("lumen-open-fullscreen-tasbih")))}
              aria-label="Tam ekran tesbih"
              title="Tam ekran tesbih"
            >
              ⛶
            </button>
          )}
          {showSelection && (
            <button
              className={"v2HeaderToolButton v2HeaderSelectionButton " + (selectionReady ? "ready" : "")}
              onPointerDown={event => {
                event.preventDefault();
                onSelection?.();
              }}
              disabled={!selectionReady}
              aria-label="Seçili metin işlemleri"
              title={selectionReady ? "Seçili metin: Todo / Ayraç" : "Önce metin seç"}
            >
              ▣
            </button>
          )}
          {showSettings && (
            <button
              className="v2HeaderToolButton"
              onClick={onSettings || (() => window.dispatchEvent(new Event("lumen-open-library-settings")))}
              aria-label="Okuma ayarları"
              title="Okuma ayarları"
            >
              ⚙
            </button>
          )}
        </div>
      </div>
      {progress && <div className="v2HeaderProgress">{progress}</div>}
      <div className="v2HeaderTitle">{title}</div>
      {invocation && <div className="v2HeaderInvocation">{invocation}</div>}
      <button
        className="v2HeaderCollapse"
        onClick={toggle}
        aria-label={collapsed ? "Üst menüyü göster" : "Üst menüyü gizle"}
        title={collapsed ? "Üst menüyü göster" : "Üst menüyü gizle"}
      >
        {collapsed ? "▾" : "▴"}
      </button>
    </div>
  );
}
