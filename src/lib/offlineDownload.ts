import { ensureMushafFont, loadMushafPages } from "./mushaf";
import { fetchDocNodes, fetchSiblings, fetchSurahNames, loadChildrenBySort, loadIbadetExtras, loadItemView, loadKuranItems, loadRootsList, loadTesbihatDocs } from "./loaders";
import type { Item } from "./library";

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
