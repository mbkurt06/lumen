import { ensureMushafFont, loadMushafPages } from "./mushaf";
import { fetchDocNodes, fetchSiblings, fetchSurahNames, loadChildrenBySort, loadIbadetExtras, loadItemView, loadKuranItems, loadRootsList, loadTesbihatDocs } from "./loaders";
import type { Item } from "./library";
import { supabase } from "./supabase";
import { setForceNetwork } from "./offlineFetch";

/* Koleksiyonları cihaza indirir: sayfaların kullandığı sorguların hepsini sırayla çalıştırır,
   yanıtlar offlineFetch ile cihazda saklanır. */
export type CollectionKey = "kuran" | "ibadet" | "risale" | "he";
export const COLLECTIONS: { key: CollectionKey; title: string; roots: string[] }[] = [
  { key: "kuran", title: "Kur'an-ı Kerim", roots: ["Kur’an-ı Kerim"] },
  { key: "ibadet", title: "İbadet (tesbihat, dualar, sureler, ilmihal, Cevşen)", roots: ["Dua Ezber", "Tesbihat", "Sûreler", "Namaz Duaları", "Günlük Dualar", "İslam İlmihali", "Esmâü’l-Hüsnâ"] },
  { key: "risale", title: "Risale-i Nur Külliyatı", roots: ["Risale-i Nur"] },
  { key: "he", title: "HE Eserleri", roots: ["HE Eserleri"] },
];

export type Progress = { done: number; total: number; failed: number };

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>, onTick: () => void) {
  let i = 0;
  const run = async () => { while (i < items.length) { const t = items[i++]; try { await fn(t); } catch { /* sayılır */ } onTick(); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

export async function downloadCollection(key: CollectionKey, onProgress: (p: Progress) => void, signal?: { cancel: boolean }) {
  setForceNetwork(true);
  try { return await downloadCollectionInner(key, onProgress, signal); } finally { setForceNetwork(false); }
}
async function downloadCollectionInner(key: CollectionKey, onProgress: (p: Progress) => void, signal?: { cancel: boolean }) {
  const cfg = COLLECTIONS.find((c) => c.key === key)!;
  const p: Progress = { done: 0, total: 1, failed: 0 };
  const tick = () => { p.done++; onProgress({ ...p }); };
  const rootsList = await loadRootsList();
  const roots: Record<string, Item> = {};
  for (const r of rootsList) roots[r.title] = r;

  // koleksiyon sayfalarının kendi sorguları
  if (key === "kuran" && roots["Kur’an-ı Kerim"]) { await loadKuranItems(roots["Kur’an-ı Kerim"].id); await ensureMushafFont(); }
  if (key === "ibadet") {
    if (roots["Dua Ezber"]) { await loadIbadetExtras(roots["Dua Ezber"].id); await loadTesbihatDocs(roots["Dua Ezber"].id, roots["Tesbihat"]?.id); }
    for (const n of ["Namaz Duaları", "Günlük Dualar"]) if (roots[n]) await loadChildrenBySort(roots[n].id);
  }

  // ağacı gez: klasör görünümü + belgeler
  const folders: string[] = cfg.roots.map((t) => roots[t]?.id).filter((x): x is string => !!x);
  const docs: Item[] = [];
  const seen = new Set<string>();
  while (folders.length) {
    if (signal?.cancel) return p;
    const batch = folders.splice(0, folders.length);
    p.total += batch.length;
    await pool(batch, 6, async (fid) => {
      if (seen.has(fid)) return;
      seen.add(fid);
      const v = await loadItemView(fid);
      for (const k of v.kids) { if (k.kind === "document") docs.push(k); else folders.push(k.id); }
    }, tick);
  }
  const sib = new Set<string>();
  p.total += docs.length;
  onProgress({ ...p });
  await pool(docs, 6, async (d) => {
    if (signal?.cancel) return;
    await loadItemView(d.id);
    const nodes = await fetchDocNodes(d.id);
    if (!nodes.length && !d.metadata?.start_page) p.failed += 0;
    if (d.parent_id && !sib.has(d.parent_id)) {
      sib.add(d.parent_id);
      await fetchSiblings(d.parent_id);
      if (key === "kuran") await fetchSurahNames(d.parent_id);
    }
    const m = (d.metadata ?? {}) as Record<string, unknown>;
    if (key === "kuran" && typeof m.start_page === "number" && typeof m.end_page === "number") await loadMushafPages(m.start_page, m.end_page);
  }, tick);
  p.done = p.total;
  onProgress({ ...p });
  return p;
}

/* ── Farkları indir: son indirmeden beri değişen belgeler ve klasörler ──
   İçerik tablolarındaki "updated_at" zamanına bakılır; yalnız değişenler yeniden çekilir. */
export async function downloadChanges(key: CollectionKey, since: string, onProgress: (p: Progress) => void): Promise<{ changed: number; serverNow: string } | null> {
  setForceNetwork(true);
  try { return await downloadChangesInner(key, since, onProgress); } finally { setForceNetwork(false); }
}
async function downloadChangesInner(key: CollectionKey, since: string, onProgress: (p: Progress) => void): Promise<{ changed: number; serverNow: string } | null> {
  const startedAt = new Date().toISOString();
  const [nodesQ, itemsQ, mushafQ] = await Promise.all([
    supabase.from("content_nodes").select("document_id").gt("updated_at", since).limit(20000),
    supabase.from("library_items").select("id,parent_id,kind,metadata").gt("updated_at", since).limit(5000),
    key === "kuran" ? supabase.from("quran_mushaf_pages").select("display_page").gt("updated_at", since).limit(1) : Promise.resolve({ data: [], error: null }),
  ]);
  if (nodesQ.error || itemsQ.error) return null; // internet yok vb.
  const docIds = new Set(((nodesQ.data ?? []) as { document_id: string }[]).map((r) => r.document_id));
  const items = (itemsQ.data ?? []) as { id: string; parent_id: string | null; kind: string; metadata: Record<string, unknown> | null }[];
  for (const it of items) if (it.kind === "document") docIds.add(it.id);
  const folderIds = new Set<string>();
  for (const it of items) { if (it.kind !== "document") folderIds.add(it.id); if (it.parent_id) folderIds.add(it.parent_id); }

  // değişen belgelerin üst klasörleri de yenilensin (liste ve sıralama)
  const docMeta = new Map<string, { parent_id: string | null; metadata: Record<string, unknown> | null }>();
  const ids = [...docIds];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("library_items").select("id,parent_id,metadata").in("id", ids.slice(i, i + 150));
    for (const r of (data ?? []) as { id: string; parent_id: string | null; metadata: Record<string, unknown> | null }[]) {
      docMeta.set(r.id, r);
      if (r.parent_id) folderIds.add(r.parent_id);
    }
  }
  const p: Progress = { done: 0, total: folderIds.size + docIds.size + 1, failed: 0 };
  const tick = () => { p.done++; onProgress({ ...p }); };
  onProgress({ ...p });

  // koleksiyon sayfalarının kendi listeleri (ucuz, her seferinde yenilenir)
  const rootsList = await loadRootsList();
  const roots: Record<string, Item> = {};
  for (const r of rootsList) roots[r.title] = r;
  if (key === "kuran" && roots["Kur’an-ı Kerim"]) await loadKuranItems(roots["Kur’an-ı Kerim"].id);
  if (key === "ibadet" && roots["Dua Ezber"]) { await loadIbadetExtras(roots["Dua Ezber"].id); await loadTesbihatDocs(roots["Dua Ezber"].id, roots["Tesbihat"]?.id); }
  tick();

  await pool([...folderIds], 6, async (fid) => { await loadItemView(fid); await fetchSiblings(fid); }, tick);
  await pool(ids, 6, async (id) => {
    await loadItemView(id);
    await fetchDocNodes(id);
    const m = docMeta.get(id)?.metadata ?? {};
    if (typeof m.start_page === "number" && typeof m.end_page === "number") await loadMushafPages(m.start_page, m.end_page);
  }, tick);

  // Kur'an sayfalarında değişiklik varsa bütün sure/cüz sayfalarını yenile
  if (key === "kuran" && ((mushafQ.data ?? []) as unknown[]).length && roots["Kur’an-ı Kerim"]) {
    const kids = await loadKuranItems(roots["Kur’an-ı Kerim"].id);
    await pool(kids, 6, async (d) => { const m = d.metadata ?? {}; if (typeof m.start_page === "number" && typeof m.end_page === "number") await loadMushafPages(m.start_page, m.end_page); }, () => {});
  }
  return { changed: docIds.size + folderIds.size, serverNow: startedAt };
}
