"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { getCachedLibraryChildren, getCachedLibraryRoot, putStaticRows } from "@/lib/localContentDb";
import { EzberSharedHeader } from "@/components/EzberSharedHeader";
import type { EzberItem } from "@/components/EzberHomeView";
import { readLocalReaderPrefs } from "@/lib/readerPrefs";

type Section = "quran" | "risale";

type CatalogItem = EzberItem & {
  metadata?: Record<string, any> | null;
};

function meta(item: CatalogItem) {
  return (item.metadata ?? {}) as Record<string, any>;
}

function displayQuranPage(page:number | null | undefined) {
  return Math.max(0, Number(page || 1) - 1);
}

export function LibraryCatalogView({
  section,
  user: _user,
  onOpenItem,
  onMenu,
}: {
  section: Section;
  user: User;
  onOpenItem: (item: EzberItem, siblings: EzberItem[], parent: EzberItem | null) => void;
  onMenu: () => void;
}) {
  const [root, setRoot] = useState<CatalogItem | null>(null);
  const [current, setCurrent] = useState<CatalogItem | null>(null);
  const [trail, setTrail] = useState<CatalogItem[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [quranMode, setQuranMode] = useState<"surah" | "juz">("surah");
  const [quranBookmarks, setQuranBookmarks] = useState<Array<{
    id: string;
    name: string;
    position: {
      nodeId?: string;
      page?: number;
      juz?: number;
      surahTitle?: string;
      surahNo?: number;
      ayahNo?: number;
    };
  }>>([]);

  const source = section === "quran" ? "quran_v1" : "risale_v1";
  const rootTitle = section === "quran" ? "Kur’an-ı Kerim" : "Risale-i Nur";
  const catalogStateKey = "lumen-catalog-state:" + section;

  const loadChildren = useCallback(async (parentId: string) => {
    const cached = await getCachedLibraryChildren(parentId).catch(() => []);
    if (cached.length) return cached as CatalogItem[];

    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata,created_at,updated_at")
      .eq("parent_id", parentId)
      .order("sort_order")
      .order("title");
    if (error) throw error;
    if (data?.length) void putStaticRows("library_items",data).catch(() => {});
    return (data ?? []) as CatalogItem[];
  }, []);

  const loadRoot = useCallback(async () => {
    const cachedRoot = await getCachedLibraryRoot(source).catch(() => null);
    if (cachedRoot) return cachedRoot as CatalogItem;

    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata,created_at,updated_at")
      .contains("metadata", { source, entity: "root" })
      .eq("metadata->>fully_seeded", "true")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    const found = data?.[0] ?? null;
    if (found) void putStaticRows("library_items",[found]).catch(() => {});
    if (!found) {
      throw new Error(
        section === "quran"
          ? "Kur’an veritabanı içeriği bulunamadı."
          : "Risale-i Nur veritabanı içeriği bulunamadı."
      );
    }
    return found as CatalogItem;
  }, [section, source]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const rootItem = await loadRoot();
      let restoredCurrent:CatalogItem = rootItem;
      let restoredTrail:CatalogItem[] = [];
      let restoredMode:"surah"|"juz" = "surah";

      try {
        const saved = JSON.parse(localStorage.getItem(catalogStateKey) || "{}");
        if (saved?.rootId === rootItem.id && saved?.current?.id) {
          restoredCurrent = saved.current as CatalogItem;
          restoredTrail = Array.isArray(saved.trail) ? saved.trail as CatalogItem[] : [];
          restoredMode = saved.quranMode === "juz" ? "juz" : "surah";
        }
      } catch {}

      const children = await loadChildren(restoredCurrent.id);
      setRoot(rootItem);
      setCurrent(restoredCurrent);
      setTrail(restoredTrail);
      setQuranMode(restoredMode);
      setItems(children);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kütüphane bölümü yüklenemedi.");
      setRoot(null);
      setCurrent(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [loadChildren, loadRoot, catalogStateKey]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (!root || !current || loading) return;
    try {
      localStorage.setItem(catalogStateKey, JSON.stringify({
        rootId:root.id,
        current,
        trail,
        quranMode,
      }));
    } catch {}
  }, [catalogStateKey, root, current, trail, quranMode, loading]); // lumen-catalog-state-save

  useEffect(() => {
    if (section !== "quran") return;
    const preferences = readLocalReaderPrefs() as Record<string, any>;
    let bookmarks = Array.isArray(preferences.quranBookmarks) ? preferences.quranBookmarks : [];
    if (!bookmarks.length && preferences.quranBookmark?.page) {
      bookmarks = [{
        id:"quran-bookmark-main",
        name:"Kaldığım yer",
        position:preferences.quranBookmark,
      }];
    }
    setQuranBookmarks(bookmarks);

    const handle = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (Array.isArray(detail)) setQuranBookmarks(detail);
    };
    window.addEventListener("lumen-quran-bookmarks-changed", handle);
    return () => window.removeEventListener("lumen-quran-bookmarks-changed", handle);
  }, [section]);

  async function open(item: CatalogItem) {
    if (item.kind === "document") {
      const siblings = items.filter(row => row.kind === "document");
      onOpenItem(item, siblings, current);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const children = await loadChildren(item.id);
      if (current) setTrail(previous => [...previous, current]);
      setCurrent(item);
      setItems(children);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bölüm açılamadı.");
    } finally {
      setLoading(false);
    }
  }

  async function goBack() {
    const previous = trail[trail.length - 1];
    if (previous) {
      setTrail(value => value.slice(0, -1));
      setCurrent(previous);
      setItems(await loadChildren(previous.id));
      return;
    }

    if (root && current?.id !== root.id) {
      setCurrent(root);
      setItems(await loadChildren(root.id));
      return;
    }

    onMenu();
  }

  const visibleItems = useMemo(() => {
    if (section !== "quran" || current?.id !== root?.id) return items;
    return items.filter(item => {
      const sourceType = String(meta(item).source || "");
      return quranMode === "juz" ? sourceType === "quran_juz_view" : sourceType !== "quran_juz_view";
    });
  }, [items, section, current?.id, root?.id, quranMode]);

  const sortedItems = useMemo(
    () => [...visibleItems].sort((a,b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "tr")),
    [visibleItems]
  );

  return (
    <section className="legacyNestedPage libraryCatalogPage">
      <EzberSharedHeader
        title={current?.title || rootTitle}
        showMenu={true}
        showBack={!!current && current.id !== root?.id}
        onMenu={onMenu}
        onBack={() => void goBack()}
        onSettings={() => window.dispatchEvent(new Event("lumen-open-library-settings"))}
      />

      {section === "quran" && current?.id === root?.id && (
        <>
          {!!quranBookmarks.length && (
            <div className="quranBookmarkCards">
              {quranBookmarks.map(bookmark => (
                <button
                  key={bookmark.id}
                  className="quranBookmarkCard"
                  onClick={() => {
                    const position = bookmark.position;
                    const surahItem = items.find(candidate =>
                      String(meta(candidate).source || "") === "quran_seeded"
                      && Number(meta(candidate).surah_no || 0) === Number(position.surahNo || 0)
                    );
                    if (!surahItem || !position.page) return;
                    onOpenItem(
                      {
                        ...surahItem,
                        metadata: {
                          ...(surahItem.metadata ?? {}),
                          start_page: position.page,
                          initial_node_id: position.nodeId || null,
                        },
                      },
                      items.filter(candidate => String(meta(candidate).source || "") === "quran_seeded"),
                      current
                    );
                  }}
                >
                  <span>🔖 {bookmark.name}</span>
                  <strong>
                    Sayfa {displayQuranPage(bookmark.position.page)} · {bookmark.position.surahTitle || ""} {bookmark.position.ayahNo ? `${bookmark.position.ayahNo}. ayet` : ""}
                  </strong>
                  <small>Buradan devam et ›</small>
                </button>
              ))}
            </div>
          )}

          <div className="quranCatalogTabs" role="tablist" aria-label="Kur’an görünümü">
            <button className={quranMode === "surah" ? "active" : ""} onClick={() => setQuranMode("surah")}>Sûreler</button>
            <button className={quranMode === "juz" ? "active" : ""} onClick={() => setQuranMode("juz")}>Cüzler</button>
          </div>
          <div className="libraryCatalogSourceNote">
            {quranMode === "surah"
              ? "114 sûre · Fâtiha 0. sayfa · standart Mushaf düzeni"
              : "30 cüz · Fâtiha 0. sayfa olacak şekilde Diyanet sayfa düzeni"}
          </div>
        </>
      )}

      {section === "risale" && current?.id === root?.id && (
        <div className="libraryCatalogSourceNote">
          Risale-i Nur Külliyatı tamamen Lumen veritabanında kayıtlıdır. Okuma sırasında dış kaynaktan içerik çekilmez.
        </div>
      )}

      <div className="legacyCategoryList">
        {sortedItems.map(item => (
          <button className="legacyCategoryRow libraryCatalogRow" key={item.id} onClick={() => void open(item)}>
            <span className="ezberRowMain">
              <strong>
                {section === "quran" && meta(item).surah_no
                  ? `${meta(item).surah_no}. ${item.title}`
                  : item.title}
              </strong>
              {item.subtitle && <small className="itemMetaInline"><span>{item.subtitle}</span></small>}
            </span>
            <span className="categoryRowRight">
              {item.kind === "folder" && <span className="ezberRowCount">Bölümler</span>}
              <b>›</b>
            </span>
          </button>
        ))}
        {!loading && !sortedItems.length && !message && (
          <div className="legacyEmptyLine">Bu bölümde içerik bulunamadı.</div>
        )}
      </div>

      {loading && <p className="legacyHomeMessage">Veritabanından yükleniyor…</p>}
      {message && <p className="legacyHomeMessage">{message}</p>}
    </section>
  );
}
