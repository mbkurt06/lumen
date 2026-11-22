import { supabase } from "./supabase";
import { placeOf, type PageGoal, type Todo } from "./todo";

/** Aralık hedefinin ilk sayfasının bulunduğu belge (her gün baştan okunan aralıklar için).
 *  Kur'an: o sayfayı içeren cüz; numaralı kitap (Cevşen, Tevhidname): o sayfanın belgesi; kitap bölümü: kendisi. */
export async function rangeStartDoc(g: PageGoal, bmDocId: string): Promise<{ docId: string; startPage: number } | null> {
  const p = g.pages?.length ? Math.min(...g.pages) : g.from;
  if (p == null || !g.doc_key) return null;
  if (g.doc_key === bmDocId) return { docId: bmDocId, startPage: p };
  if (g.doc_key === "kuran") {
    const { data: me } = await supabase.from("library_items").select("parent_id").eq("id", bmDocId).maybeSingle();
    const root = (me as { parent_id: string | null } | null)?.parent_id;
    if (!root) return null;
    const { data } = await supabase.from("library_items").select("id,metadata").eq("parent_id", root).gte("sort_order", 1000).order("sort_order");
    const hit = ((data ?? []) as { id: string; metadata: Record<string, unknown> | null }[])
      .find((c) => Number(c.metadata?.start_page) - 1 <= p && p <= Number(c.metadata?.end_page) - 1);
    return hit ? { docId: hit.id, startPage: p } : null;
  }
  const { data } = await supabase.from("library_items").select("id").eq("parent_id", g.doc_key).eq("metadata->>page", String(p)).maybeSingle();
  const id = (data as { id: string } | null)?.id;
  return id ? { docId: id, startPage: p } : null;
}

/** Görevin p. sayfasını açmak için gereken adres ve durum (atlanan/eksik sayfaya dönüş) */
export async function taskPageNav(t: Todo, p: number, ctx: string): Promise<{ to: string; state: Record<string, unknown> } | null> {
  const pl = placeOf(t), g = t.page_goal;
  if (!g || !pl?.docId) return null;
  const r = await rangeStartDoc({ ...g, from: p, pages: undefined }, pl.docId).catch(() => null);
  return { to: `/kutuphane/${r?.docId ?? pl.docId}`, state: { taskId: t.id, ctx, startPage: p } };
}
