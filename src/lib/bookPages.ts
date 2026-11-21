import { fetchDocNodes, fetchSiblings } from "./loaders";
/* Kitap sayfası bölmesi (okuyucu ve görev formundaki sayfa seçimi aynı sayfaları görsün). */
type PNode = { title?: string | null; text_content?: string | null; secondary_text?: string | null; translation?: string | null };
/* Eski Lumen'deki kitap sayfası bölmesiyle aynı: her sayfa sabit bir metin yükü taşır. */
function nodeWeight(n: PNode) {
  const title = (n.title || "").length, text = (n.text_content || "").length;
  const arabic = (n.secondary_text || "").length, tr = (n.translation || "").length;
  return text + tr + Math.round(arabic * 1.25) + title * 2.2 + (n.title ? 180 : 40);
}
// Eski uygulamada senin yazı ölçeğin 0.8 idi: 2250 / 0.8^1.65 ≈ 3250. Örnek gönderdiğin sayfalar bu değerle bölünmüştü;
// artık yazı boyutundan bağımsız sabit tutuluyor.
const PAGE_LOAD = 3250;
export function fixedPages<T extends PNode>(nodes: T[], target = PAGE_LOAD): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [];
  let w = 0;
  for (const n of nodes) {
    const nw = nodeWeight(n);
    const heading = !!n.title && !n.text_content && !n.secondary_text;
    if (cur.length && (w + nw > target || (heading && w > target * 0.78))) { pages.push(cur); cur = []; w = 0; }
    cur.push(n);
    w += nw;
    if (heading && w > target * 0.9) { pages.push(cur); cur = []; w = 0; }
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}


/* Bir kitabın (bölümlerinden oluşan klasör: Sözler, Mektubat…) toplam sayfa sayısı.
   Okuyucudaki sayfa bölmesiyle aynı hesap; bir kez hesaplanıp bu cihazda saklanır. */
export type BookPagesInfo = { total: number; docs: Record<string, number>; order: string[] };
const BP_KEY = "lumen.bookpages.v1";
let BP: Record<string, BookPagesInfo> = (() => { try { return JSON.parse(localStorage.getItem(BP_KEY) ?? "{}") as Record<string, BookPagesInfo>; } catch { return {}; } })();
const pending = new Map<string, Promise<BookPagesInfo | null>>();
export const bookPagesCached = (bookId: string): BookPagesInfo | undefined => BP[bookId];
export function ensureBookPages(bookId: string): Promise<BookPagesInfo | null> {
  if (BP[bookId]) return Promise.resolve(BP[bookId]);
  const p0 = pending.get(bookId);
  if (p0) return p0;
  const p = (async () => {
    try {
      const order = await fetchSiblings(bookId);
      if (!order.length) return null;
      const docs: Record<string, number> = {};
      for (let i = 0; i < order.length; i += 4) {
        await Promise.all(order.slice(i, i + 4).map(async (id) => { docs[id] = fixedPages(await fetchDocNodes(id)).length; }));
      }
      const info = { total: Object.values(docs).reduce((a, b) => a + b, 0), docs, order };
      BP = { ...BP, [bookId]: info };
      try { localStorage.setItem(BP_KEY, JSON.stringify(BP)); } catch { /* yer yok */ }
      return info;
    } catch { return null; } finally { pending.delete(bookId); }
  })();
  pending.set(bookId, p);
  return p;
}
