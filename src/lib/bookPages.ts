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

