import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { loadRootsList } from "./loaders";

export type Item = { id: string; parent_id: string | null; kind: string; title: string; subtitle: string | null; sort_order: number; metadata: Record<string, unknown> | null };
export const ITEM_COLS = "id,parent_id,kind,title,subtitle,sort_order,metadata";

/** Kök koleksiyonlar (başlığa göre). */
export function useRoots() {
  const [roots, setRoots] = useState<Record<string, Item>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadRootsList().then((data) => {
      const m: Record<string, Item> = {};
      for (const r of data) m[r.title] = r;
      setRoots(m);
      setReady(true);
    });
  }, []);
  return { roots, ready };
}

export type Resume = { id: string; docId: string; nodeId: string | null; title: string; label: string | null; bookTitle: string | null; docTitle: string; parentTitle: string; ancestors: string[] };

/** "Kaldığın yerler": senin eklediğin ayraçlar (en son güncellenen önce); scopeId verilirse yalnız o klasörün altındakiler. */
export function useResume(scopeId?: string) {
  const [rows, setRows] = useState<Resume[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await supabase.from("reader_bookmarks").select("id,title,document_id,node_id,label,book_title,updated_at").order("updated_at", { ascending: false }).limit(60);
      const bms = (data ?? []) as { id: string; title: string; document_id: string; node_id: string | null; label: string | null; book_title: string | null }[];
      if (!bms.length) { if (!off) setRows([]); return; }
      const byId = new Map<string, Item>();
      let frontier = [...new Set(bms.map((b) => b.document_id))];
      for (let d = 0; d < 6 && frontier.length; d++) {
        const { data: its } = await supabase.from("library_items").select(ITEM_COLS).in("id", frontier);
        const got = (its ?? []) as Item[];
        got.forEach((i) => byId.set(i.id, i));
        frontier = [...new Set(got.map((g) => g.parent_id).filter((p): p is string => !!p && !byId.has(p)))];
      }
      const out: Resume[] = [];
      for (const b of bms) {
        const it = byId.get(b.document_id);
        if (!it) continue;
        const anc: string[] = [];
        let p = it.parent_id ? byId.get(it.parent_id) : undefined;
        while (p) { anc.push(p.id); p = p.parent_id ? byId.get(p.parent_id) : undefined; }
        if (scopeId && !anc.includes(scopeId)) continue;
        out.push({ id: b.id, docId: b.document_id, nodeId: b.node_id, title: b.title, label: b.label, bookTitle: b.book_title, docTitle: it.title, parentTitle: it.parent_id ? (byId.get(it.parent_id)?.title ?? "") : "", ancestors: anc });
      }
      if (!off) setRows(out.slice(0, 20));
    })();
    return () => { off = true; };
  }, [scopeId]);
  return rows;
}
