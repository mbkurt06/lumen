import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Item = { id: string; parent_id: string | null; kind: string; title: string; subtitle: string | null; sort_order: number; metadata: Record<string, unknown> | null };
export const ITEM_COLS = "id,parent_id,kind,title,subtitle,sort_order,metadata";

/** Kök koleksiyonlar (başlığa göre). */
export function useRoots() {
  const [roots, setRoots] = useState<Record<string, Item>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void supabase.from("library_items").select(ITEM_COLS).is("parent_id", null).then(({ data }) => {
      const m: Record<string, Item> = {};
      for (const r of (data ?? []) as Item[]) m[r.title] = r;
      setRoots(m);
      setReady(true);
    });
  }, []);
  return { roots, ready };
}

export type Resume = { docId: string; title: string; parentTitle: string; ancestors: string[] };

/** "Kaldığın yerler": en son açılan belgeler; scopeId verilirse yalnız o klasörün altındakiler. */
export function useResume(scopeId?: string) {
  const [rows, setRows] = useState<Resume[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await supabase.from("reading_state").select("document_id,last_opened_at").order("last_opened_at", { ascending: false }).limit(30);
      const ids = ((data ?? []) as { document_id: string }[]).map((r) => r.document_id);
      if (!ids.length) { if (!off) setRows([]); return; }
      const byId = new Map<string, Item>();
      let frontier = ids;
      for (let d = 0; d < 6 && frontier.length; d++) {
        const { data: its } = await supabase.from("library_items").select(ITEM_COLS).in("id", frontier);
        const got = (its ?? []) as Item[];
        got.forEach((i) => byId.set(i.id, i));
        frontier = [...new Set(got.map((g) => g.parent_id).filter((p): p is string => !!p && !byId.has(p)))];
      }
      const out: Resume[] = [];
      for (const id of ids) {
        const it = byId.get(id);
        if (!it) continue;
        const anc: string[] = [];
        let p = it.parent_id ? byId.get(it.parent_id) : undefined;
        while (p) { anc.push(p.id); p = p.parent_id ? byId.get(p.parent_id) : undefined; }
        if (scopeId && !anc.includes(scopeId)) continue;
        out.push({ docId: id, title: it.title, parentTitle: it.parent_id ? (byId.get(it.parent_id)?.title ?? "") : "", ancestors: anc });
      }
      if (!off) setRows(out.slice(0, 8));
    })();
    return () => { off = true; };
  }, [scopeId]);
  return rows;
}
