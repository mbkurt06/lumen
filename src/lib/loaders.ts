import { supabase } from "./supabase";
import { ITEM_COLS, type Item } from "./library";

/* Sayfaların kullandığı okuma sorguları tek yerde: çevrimdışı indirme aynı sorguları çalıştırır,
   böylece cihazda saklanan yanıtlar sayfaların istediğiyle birebir aynı olur. */

export async function loadRootsList(): Promise<Item[]> {
  const { data } = await supabase.from("library_items").select(ITEM_COLS).is("parent_id", null);
  return (data ?? []) as Item[];
}

/** Hepsi aynı sıradaysa (ör. Esmâü'l-Hüsnâ: hepsi 0) eski uygulamadaki sıraya (legacy_id) göre diz. */
export function legacyOrder<T extends { sort_order?: number | null; metadata?: Record<string, unknown> | null }>(list: T[]): T[] {
  if (list.length < 2 || new Set(list.map((k) => k.sort_order ?? 0)).size > 1) return list;
  if (!list.every((k) => typeof k.metadata?.legacy_id === "string")) return list;
  return [...list].sort((a, b) => String(a.metadata!.legacy_id).localeCompare(String(b.metadata!.legacy_id)));
}

export type ItemView = { item: Item | null; parent: Item | null; root: Item | null; kids: Item[]; counts: Record<string, { folders: number; docs: number }> };
export async function loadItemView(id: string): Promise<ItemView> {
  const { data: me } = await supabase.from("library_items").select(ITEM_COLS).eq("id", id).maybeSingle();
  const cur = me as Item | null;
  let par: Item | null = null;
  if (cur?.parent_id) {
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("id", cur.parent_id).maybeSingle();
    par = data as Item | null;
  }
  let top: Item | null = par ?? cur;
  for (let i = 0; top?.parent_id && i < 6; i++) {
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("id", top.parent_id).maybeSingle();
    if (!data) break;
    top = data as Item;
  }
  let list: Item[] = [];
  const cnt: Record<string, { folders: number; docs: number }> = {};
  if (cur && cur.kind !== "document") {
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", cur.id).order("sort_order").order("title").limit(1000);
    list = legacyOrder((data ?? []) as Item[]);
    const ids = list.filter((k) => k.kind !== "document").map((k) => k.id);
    for (let i = 0; i < ids.length; i += 150) {
      const { data: g } = await supabase.from("library_items").select("parent_id,kind").in("parent_id", ids.slice(i, i + 150)).limit(5000);
      for (const r of (g ?? []) as { parent_id: string; kind: string }[]) {
        const c = (cnt[r.parent_id] ??= { folders: 0, docs: 0 });
        if (r.kind === "document") c.docs++; else c.folders++;
      }
    }
  }
  return { item: cur, parent: par, root: top, kids: list, counts: cnt };
}

export async function loadKuranItems(rootId: string): Promise<Item[]> {
  const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", rootId).order("sort_order").limit(300);
  return (data ?? []) as Item[];
}
export async function loadIbadetExtras(duaEzberId: string): Promise<Item[]> {
  const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", duaEzberId).in("title", ["Cevşen-i Kebîr", "Tevhidname"]);
  return (data ?? []) as Item[];
}
export async function loadChildrenBySort(parentId: string): Promise<Item[]> {
  const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", parentId).order("sort_order");
  return (data ?? []) as Item[];
}

export type DocNode = { id: string; kind: string; title: string | null; text_content: string | null; secondary_text: string | null; translation: string | null; metadata: Record<string, unknown> | null };
export async function fetchDocNodes(docId: string): Promise<DocNode[]> {
  const all: DocNode[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("content_nodes").select("id,kind,title,text_content,secondary_text,translation,metadata").eq("document_id", docId).order("sort_order").range(from, from + 999);
    if (error || !data) break;
    all.push(...(data as DocNode[]));
    if (data.length < 1000) break;
  }
  return all;
}
export async function fetchSiblings(parentId: string): Promise<string[]> {
  const { data } = await supabase.from("library_items").select("id,sort_order,metadata").eq("parent_id", parentId).eq("kind", "document").order("sort_order").order("title").limit(2000);
  return legacyOrder((data ?? []) as { id: string; sort_order: number; metadata: Record<string, unknown> | null }[]).map((r) => r.id);
}
export async function fetchSurahNames(parentId: string): Promise<Record<number, string>> {
  const { data } = await supabase.from("library_items").select("title,sort_order").eq("parent_id", parentId).lt("sort_order", 1000);
  const m: Record<number, string> = {};
  for (const r of (data ?? []) as { title: string; sort_order: number }[]) m[r.sort_order] = r.title;
  return m;
}

/** Tesbihatlar sayfası: Dua Ezber › Tesbihat belgeleri ve bugünkü sayım durumu. */
export type TesbihCounter = { id: string; document_id: string; metadata: { target?: number } };
export async function loadTesbihatDocs(duaEzberId: string, fallbackRootId?: string): Promise<{ docs: Item[]; counters: TesbihCounter[]; states: { content_node_id: string; repeat_count: number; last_practiced_at: string | null }[] }> {
  const { data: f } = await supabase.from("library_items").select("id").eq("parent_id", duaEzberId).eq("title", "Tesbihat").maybeSingle();
  const folderId = (f as { id: string } | null)?.id ?? fallbackRootId;
  if (!folderId) return { docs: [], counters: [], states: [] };
  const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", folderId).order("sort_order");
  const ds = (data ?? []) as Item[];
  const { data: cn } = await supabase.from("content_nodes").select("id,document_id,metadata").in("document_id", ds.map((d) => d.id)).not("metadata->>target", "is", null);
  const counters = (cn ?? []) as TesbihCounter[];
  const { data: ms } = counters.length ? await supabase.from("memorization_state").select("content_node_id,repeat_count,last_practiced_at").in("content_node_id", counters.map((c) => c.id)) : { data: [] };
  return { docs: ds, counters, states: (ms ?? []) as { content_node_id: string; repeat_count: number; last_practiced_at: string | null }[] };
}
