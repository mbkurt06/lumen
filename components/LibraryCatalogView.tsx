"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { EzberSharedHeader } from "@/components/EzberSharedHeader";
import type { EzberItem } from "@/components/EzberHomeView";

type Section = "quran" | "risale";

type CatalogItem = EzberItem & {
  metadata?: Record<string, any> | null;
};

function meta(item: CatalogItem) {
  return (item.metadata ?? {}) as Record<string, any>;
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
  const [quranBookmark, setQuranBookmark] = useState<{
    nodeId?: string;
    page?: number;
    juz?: number;
    surahTitle?: string;
    surahNo?: number;
    ayahNo?: number;
  } | null>(null);

  const source = section === "quran" ? "quran_v1" : "risale_v1";
  const rootTitle = section === "quran" ? "Kur’an-ı Kerim" : "Risale-i Nur";

  const loadChildren = useCallback(async (parentId: string) => {
    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("parent_id", parentId)
      .order("sort_order")
      .order("title");
    if (error) throw error;
    return (data ?? []) as CatalogItem[];
  }, []);

  const loadRoot = useCallback(async () => {
    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata,created_at")
      .contains("metadata", { source, entity: "root" })
      .eq("metadata->>fully_seeded", "true")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    const found = data?.[0] ?? null;
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
      const children = await loadChildren(rootItem.id);
      setRoot(rootItem);
      setCurrent(rootItem);
      setTrail([]);
      setItems(children);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kütüphane bölümü yüklenemedi.");
      setRoot(null);
      setCurrent(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [loadChildren, loadRoot]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (section !== "quran") return;
    const loadBookmark = async () => {
      const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
      const bookmark = ((data?.preferences ?? {}) as Record<string, any>).quranBookmark;
      setQuranBookmark(bookmark?.page ? bookmark : null);
    };
    void loadBookmark();
    const handle = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.page) setQuranBookmark(detail);
    };
    window.addEventListener("lumen-quran-bookmark-changed", handle);
    return () => window.removeEventListener("lumen-quran-bookmark-changed", handle);
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
          {quranBookmark && (
            <button
              className="quranBookmarkCard"
              onClick={() => {
                const surahItem = items.find(candidate =>
                  String(meta(candidate).source || "") === "quran_seeded"
                  && Number(meta(candidate).surah_no || 0) === Number(quranBookmark.surahNo || 0)
                );
                if (!surahItem || !quranBookmark.page) return;
                onOpenItem(
                  {
                    ...surahItem,
                    metadata: {
                      ...(surahItem.metadata ?? {}),
                      start_page: quranBookmark.page,
                      initial_node_id: quranBookmark.nodeId || null,
                    },
                  },
                  items.filter(candidate => String(meta(candidate).source || "") === "quran_seeded"),
                  current
                );
              }}
            >
              <span>🔖 Kaldığın yer</span>
              <strong>Sayfa {quranBookmark.page} · {quranBookmark.surahTitle || ""} {quranBookmark.ayahNo ? `${quranBookmark.ayahNo}. ayet` : ""}</strong>
              <small>Buradan devam et ›</small>
            </button>
          )}

          <div className="quranCatalogTabs" role="tablist" aria-label="Kur’an görünümü">
            <button className={quranMode === "surah" ? "active" : ""} onClick={() => setQuranMode("surah")}>Sûreler</button>
            <button className={quranMode === "juz" ? "active" : ""} onClick={() => setQuranMode("juz")}>Cüzler</button>
          </div>
          <div className="libraryCatalogSourceNote">
            {quranMode === "surah"
              ? "114 sûre · standart 604 sayfalık Mushaf düzeni"
              : "30 cüz · Diyanet uygulamasındaki standart Mushaf sayfa numaraları"}
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
