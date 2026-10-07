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

const TURKISH_SURAH_NAMES = [
  "Fâtiha","Bakara","Âl-i İmrân","Nisâ","Mâide","En'âm","A'râf","Enfâl","Tevbe","Yûnus",
  "Hûd","Yûsuf","Ra'd","İbrâhîm","Hicr","Nahl","İsrâ","Kehf","Meryem","Tâhâ",
  "Enbiyâ","Hac","Mü'minûn","Nûr","Furkân","Şuarâ","Neml","Kasas","Ankebût","Rûm",
  "Lokmân","Secde","Ahzâb","Sebe'","Fâtır","Yâsîn","Sâffât","Sâd","Zümer","Mü'min",
  "Fussılet","Şûrâ","Zuhruf","Duhân","Câsiye","Ahkâf","Muhammed","Fetih","Hucurât","Kâf",
  "Zâriyât","Tûr","Necm","Kamer","Rahmân","Vâkıa","Hadîd","Mücâdele","Haşr","Mümtehine",
  "Saf","Cuma","Münâfikûn","Tegâbün","Talâk","Tahrîm","Mülk","Kalem","Hâkka","Meâric",
  "Nûh","Cin","Müzzemmil","Müddessir","Kıyâmet","İnsân","Mürselât","Nebe'","Nâziât","Abese",
  "Tekvîr","İnfitâr","Mutaffifîn","İnşikâk","Bürûc","Târık","A'lâ","Gâşiye","Fecr","Beled",
  "Şems","Leyl","Duhâ","İnşirâh","Tîn","Alak","Kadr","Beyyine","Zilzâl","Âdiyât",
  "Kâria","Tekâsür","Asr","Hümeze","Fîl","Kureyş","Mâûn","Kevser","Kâfirûn","Nasr",
  "Tebbet","İhlâs","Felak","Nâs"
];

const RISale_BOOKS = [
  "Asâ-yı Musa",
  "Barla Lâhikası",
  "Kastamonu Lâhikası",
  "Emirdağ Lâhikası I",
  "Emirdağ Lâhikası II",
  "İşârâtü'l-İ'câz",
  "Mesnevî-i Nuriye",
  "Sikke-i Tasdik-i Gaybî",
  "Tarihçe-i Hayat",
  "Muhâkemât",
  "Münâzarât",
  "Hutbe-i Şâmiye",
  "Divan-ı Harb-i Örfî",
  "Sünuhat",
  "Tuluât",
  "İşârât",
  "Rumuz",
  "Nokta",
  "Lemaat",
  "Gençlik Rehberi",
  "Hizmet Rehberi",
];

const RISale_SERIES = [
  { key:"sozler", title:"Sözler", count:33, suffix:"Söz" },
  { key:"mektubat", title:"Mektubat", count:33, suffix:"Mektup" },
  { key:"lemalar", title:"Lem'alar", count:33, suffix:"Lem'a" },
  { key:"sualar", title:"Şualar", count:15, suffix:"Şua" },
];

function sourceSearchUrl(title: string) {
  return "https://risaleinur.hizmetvakfi.org/?s=" + encodeURIComponent(title);
}

function meta(item: CatalogItem) {
  return (item.metadata ?? {}) as Record<string, any>;
}

export function LibraryCatalogView({
  section,
  user,
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

  const ensureRoot = useCallback(async () => {
    const { data: existingRows, error: findError } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata,created_at")
      .contains("metadata", { source, entity: "root" })
      .order("created_at", { ascending: true })
      .limit(1);
    if (findError) throw findError;
    const existing = existingRows?.[0] ?? null;
    if (existing) return existing as CatalogItem;

    const { data, error } = await supabase
      .from("library_items")
      .insert({
        owner_id: user.id,
        kind: "collection",
        title: rootTitle,
        subtitle: section === "quran"
          ? "114 sûre · Arapça Uthmânî metin · Diyanet Türkçe meali"
          : "Risale-i Nur Külliyatı",
        sort_order: section === "quran" ? 20 : 10,
        metadata: { source, entity: "root" },
      })
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .single();
    if (error) throw error;
    return data as CatalogItem;
  }, [rootTitle, section, source, user.id]);

  const seedQuran = useCallback(async (rootItem: CatalogItem) => {
    const existing = await loadChildren(rootItem.id);
    const existingNos = new Set(existing.map(item => Number(meta(item).surah_no || 0)));

    const response = await fetch("/api/library/quran/catalog");
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Kur'an sûre listesi alınamadı.");

    const rows = (json.surahs || [])
      .filter((surah: any) => !existingNos.has(Number(surah.number)))
      .map((surah: any) => {
        const number = Number(surah.number);
        const name = TURKISH_SURAH_NAMES[number - 1] || surah.englishName || ("Sûre " + number);
        const revelation = surah.revelationType === "Medinan" ? "Medenî" : "Mekkî";
        return {
          owner_id: user.id,
          parent_id: rootItem.id,
          kind: "document",
          title: name,
          subtitle: `${Number(surah.numberOfAyahs || 0)} âyet · ${revelation}`,
          sort_order: number,
          metadata: {
            source: "quran_api",
            catalog_source: source,
            surah_no: number,
            ayah_count: Number(surah.numberOfAyahs || 0),
            arabic_name: String(surah.arabicName || ""),
            revelation_type: String(surah.revelationType || ""),
            source_name: "AlQuran Cloud · Diyanet İşleri",
            source_url: "https://kuran.diyanet.gov.tr/",
            arabic_edition: "quran-uthmani",
            translation_edition: "tr.diyanet",
          },
        };
      });

    if (rows.length) {
      const { error } = await supabase.from("library_items").insert(rows);
      if (error) throw error;
    }
  }, [loadChildren, source, user.id]);

  const seedRisale = useCallback(async (rootItem: CatalogItem) => {
    let rootChildren = await loadChildren(rootItem.id);
    const keys = new Set(rootChildren.map(item => String(meta(item).catalog_key || "")));

    for (let index = 0; index < RISale_SERIES.length; index++) {
      const series = RISale_SERIES[index];
      let folder = rootChildren.find(item => meta(item).catalog_key === series.key) ?? null;

      if (!folder) {
        const { data, error } = await supabase.from("library_items").insert({
          owner_id: user.id,
          parent_id: rootItem.id,
          kind: "folder",
          title: series.title,
          subtitle: `${series.count} ana bölüm`,
          sort_order: index + 1,
          metadata: {
            source: "risale_catalog",
            catalog_source: source,
            catalog_key: series.key,
            official_source: "Hizmet Vakfı Risale-i Nur Külliyatı",
            source_url: sourceSearchUrl(series.title),
          },
        }).select("id,parent_id,kind,title,subtitle,sort_order,metadata").single();
        if (error) throw error;
        folder = data as CatalogItem;
        rootChildren = [...rootChildren, folder];
      }

      const chapterChildren = await loadChildren(folder.id);
      const existingNumbers = new Set(chapterChildren.map(item => Number(meta(item).chapter_no || 0)));
      const chapterRows = Array.from({length: series.count}, (_, i) => i + 1)
        .filter(number => !existingNumbers.has(number))
        .map(number => {
          const chapterTitle = `${number}. ${series.suffix}`;
          return {
            owner_id: user.id,
            parent_id: folder!.id,
            kind: "document",
            title: chapterTitle,
            subtitle: "Resmî Risale-i Nur kaynağı",
            sort_order: number,
            metadata: {
              source: "risale_external",
              catalog_source: source,
              catalog_key: `${series.key}-${number}`,
              chapter_no: number,
              book_title: series.title,
              official_source: "Hizmet Vakfı Risale-i Nur Külliyatı",
              source_url: sourceSearchUrl(chapterTitle + " " + series.title),
            },
          };
        });
      if (chapterRows.length) {
        const { error } = await supabase.from("library_items").insert(chapterRows);
        if (error) throw error;
      }
    }

    const staticExisting = new Set(
      (await loadChildren(rootItem.id)).map(item => String(meta(item).catalog_key || ""))
    );
    const staticRows = RISale_BOOKS
      .map((title, index) => ({
        title,
        key: "book-" + index,
        sort: 100 + index,
      }))
      .filter(book => !staticExisting.has(book.key))
      .map(book => ({
        owner_id: user.id,
        parent_id: rootItem.id,
        kind: "document",
        title: book.title,
        subtitle: "Resmî Risale-i Nur kaynağı",
        sort_order: book.sort,
        metadata: {
          source: "risale_external",
          catalog_source: source,
          catalog_key: book.key,
          book_title: book.title,
          official_source: "Hizmet Vakfı Risale-i Nur Külliyatı",
          source_url: sourceSearchUrl(book.title),
        },
      }));

    if (staticRows.length) {
      const { error } = await supabase.from("library_items").insert(staticRows);
      if (error) throw error;
    }
  }, [loadChildren, source, user.id]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const rootItem = await ensureRoot();
      setRoot(rootItem);
      if (section === "quran") await seedQuran(rootItem);
      else await seedRisale(rootItem);
      const children = await loadChildren(rootItem.id);
      setCurrent(rootItem);
      setTrail([]);
      setItems(children);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kütüphane bölümü hazırlanamadı.");
    } finally {
      setLoading(false);
    }
  }, [ensureRoot, loadChildren, section, seedQuran, seedRisale]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  async function open(item: CatalogItem) {
    if (item.kind === "document") {
      const siblings = items.filter(row => row.kind === "document");
      onOpenItem(item, siblings, current);
      return;
    }
    setLoading(true);
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
    if (!previous) {
      if (root && current?.id !== root.id) {
        setCurrent(root);
        setItems(await loadChildren(root.id));
        return;
      }
      onMenu();
      return;
    }
    setTrail(value => value.slice(0, -1));
    setCurrent(previous);
    setItems(await loadChildren(previous.id));
  }

  const sortedItems = useMemo(
    () => [...items].sort((a,b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "tr")),
    [items]
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
        <div className="libraryCatalogSourceNote">
          114 sûre · Uthmânî Arapça metin · Diyanet İşleri Türkçe meali
        </div>
      )}
      {section === "risale" && current?.id === root?.id && (
        <div className="libraryCatalogSourceNote">
          Risale-i Nur metinleri ilk açılışta resmî kaynaktan alınır ve Lumen veritabanına kaydedilir.
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
              {item.kind === "folder" && <span className="ezberRowCount">{meta(item).source === "risale_catalog" ? "Bölümler" : ""}</span>}
              <b>›</b>
            </span>
          </button>
        ))}
        {!loading && !sortedItems.length && <div className="legacyEmptyLine">Bu bölümde içerik bulunamadı.</div>}
      </div>

      {loading && <p className="legacyHomeMessage">İçerik hazırlanıyor…</p>}
      {message && <p className="legacyHomeMessage">{message}</p>}
    </section>
  );
}
