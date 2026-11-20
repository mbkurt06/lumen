import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { ymd } from "./todo";

/* "Okundu" işaretleri sayfa + okuma bağlamına göre tutulur. contextKey görev/ayraç bazlıdır. */
type Op = { op: "add" | "del"; doc_key: string; context_key: string; page: number; scope: string; book_id: string | null; day: string };
const CK = (docKey: string, contextKey: string) => "lumen.reads." + docKey + "." + contextKey;
const QK = "lumen.reads.queue.v1";
const EV = "lumen-reads";
const rd = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const wr = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yer yok */ } };

let flushing = false;
export async function flushReads() {
  if (flushing) return;
  const q = rd<Op[]>(QK, []);
  if (!q.length) return;
  flushing = true;
  try {
    let done = 0;
    for (const o of q) {
      const r = o.op === "add"
        ? await supabase.from("page_reads").upsert({ scope: o.scope, doc_key: o.doc_key, context_key: o.context_key, book_id: o.book_id, page: o.page, day: o.day }, { onConflict: "owner_id,doc_key,page,context_key" })
        : await supabase.from("page_reads").delete().eq("doc_key", o.doc_key).eq("context_key", o.context_key).eq("page", o.page);
      if (r.error) break;
      done++;
    }
    if (done) wr(QK, rd<Op[]>(QK, []).slice(done));
  } catch { /* sonra */ } finally { flushing = false; }
}
if (typeof window !== "undefined") window.addEventListener("online", () => void flushReads());

/** Bu belgede okunan sayfalar (sayfa → gün) ve aç/kapa. */
export function usePageReads(docKey: string, scope: string, bookId: string | null, contextKey = "global") {
  const storageKey = CK(docKey, contextKey);
  const [map, setMap] = useState<Record<number, string>>(() => rd(storageKey, {}));
  useEffect(() => {
    setMap(rd(storageKey, {}));
    const f = () => setMap(rd(storageKey, {}));
    window.addEventListener(EV, f);
    void (async () => {
      await flushReads();
      if (rd<Op[]>(QK, []).some((o) => o.doc_key === docKey && o.context_key === contextKey)) return; // gönderilmemiş varken üzerine yazma
      const { data, error } = await supabase.from("page_reads").select("page,day").eq("doc_key", docKey).eq("context_key", contextKey).limit(2000);
      if (error || !data) return;
      const m: Record<number, string> = {};
      for (const r of data as { page: number; day: string }[]) m[r.page] = r.day;
      wr(storageKey, m);
      setMap(m);
    })();
    return () => window.removeEventListener(EV, f);
  }, [docKey, contextKey, storageKey]);
  const toggle = useCallback((page: number) => {
    const m = { ...rd<Record<number, string>>(storageKey, {}) };
    // daha önceki bir gün okunduysa bugün yeniden "okundu" sayılır (her gün okunan aralıklar için)
    const add = !m[page] || m[page] !== ymd();
    if (add) m[page] = ymd(); else delete m[page];
    wr(storageKey, m);
    setMap(m);
    const q = rd<Op[]>(QK, []);
    q.push({ op: add ? "add" : "del", doc_key: docKey, context_key: contextKey, page, scope, book_id: bookId, day: ymd() });
    wr(QK, q);
    try { window.dispatchEvent(new Event(EV)); } catch { /* yok say */ }
    void flushReads();
    return add;
  }, [docKey, contextKey, scope, bookId]);
  return { read: map, toggle };
}
