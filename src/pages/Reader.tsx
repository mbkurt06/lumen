import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import type { Item } from "../lib/library";

type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  metadata: Record<string, unknown> | null;
};

const CHUNK = 250;

export function Reader({ doc, parentTitle }: { doc: Item; parentTitle?: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(CHUNK);
  const [scale, setScale] = useState<number>(() => {
    try { return Number(localStorage.getItem("lumen.fontScale")) || 1; } catch { return 1; }
  });

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const all: Node[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("content_nodes")
          .select("id,kind,title,text_content,secondary_text,translation,metadata")
          .eq("document_id", doc.id)
          .order("sort_order")
          .range(from, from + 999);
        if (error || !data) break;
        all.push(...(data as Node[]));
        if (data.length < 1000) break;
      }
      const { data: rs } = await supabase.from("reading_state").select("last_content_node_id").eq("document_id", doc.id).maybeSingle();
      if (off) return;
      setNodes(all);
      const last = (rs as { last_content_node_id: string | null } | null)?.last_content_node_id;
      const idx = last ? all.findIndex((n) => n.id === last) : -1;
      setShown(Math.max(CHUNK, idx >= 0 ? idx + 50 : 0));
      setLoading(false);
      await supabase.from("reading_state").upsert({ document_id: doc.id, last_content_node_id: last ?? null, last_opened_at: new Date().toISOString() }, { onConflict: "owner_id,document_id" });
      if (idx > 0) setTimeout(() => document.getElementById("n" + last)?.scrollIntoView(), 50);
    })();
    return () => { off = true; };
  }, [doc.id]);

  // Kaydırırken ekranın üstündeki düğümü "kaldığın yer" olarak kaydet.
  useEffect(() => {
    if (loading) return;
    let timer: number | undefined;
    const save = () => {
      const els = document.querySelectorAll<HTMLElement>("[data-nid]");
      let top: string | null = null;
      for (const el of els) { if (el.getBoundingClientRect().top >= 56) { top = el.dataset.nid ?? null; break; } }
      if (top) void supabase.from("reading_state").upsert({ document_id: doc.id, last_content_node_id: top, last_opened_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "owner_id,document_id" });
    };
    const onScroll = () => { window.clearTimeout(timer); timer = window.setTimeout(save, 1200); };
    const sc = document.querySelector(".content");
    sc?.addEventListener("scroll", onScroll);
    return () => { sc?.removeEventListener("scroll", onScroll); window.clearTimeout(timer); };
  }, [loading, doc.id]);

  const setS = (v: number) => {
    const n = Math.min(1.8, Math.max(0.8, v));
    setScale(n);
    try { localStorage.setItem("lumen.fontScale", String(n)); } catch { /* yok say */ }
  };
  const body = useMemo(() => nodes.slice(0, shown), [nodes, shown]);

  return (
    <>
      <PageHeader back title={doc.title} subtitle={parentTitle} />
      <div className="rbar">
        <button onClick={() => setS(scale - 0.1)}>A−</button>
        <button onClick={() => setS(scale + 0.1)}>A+</button>
      </div>
      {loading && <p className="muted" style={{ padding: "12px 20px" }}>Yükleniyor…</p>}
      <div className="reader" style={{ fontSize: `${scale}em` }}>
        {body.map((n) => <NodeView key={n.id} n={n} />)}
        {shown < nodes.length && (<button className="secondary morebtn" onClick={() => setShown(shown + CHUNK)}>Devamını göster ({nodes.length - shown} satır)</button>)}
        {!loading && nodes.length === 0 && <p className="muted">Bu belgenin içeriği henüz yok.</p>}
      </div>
    </>
  );
}

function NodeView({ n }: { n: Node }) {
  const md = n.metadata ?? {};
  const common = { id: "n" + n.id, "data-nid": n.id };
  if (n.kind === "verse") {
    const no = String(n.title ?? "").split(":")[1];
    return (
      <div {...common}>
        {n.secondary_text && <div className="ar">{n.secondary_text}</div>}
        {(n.text_content || n.translation) && <p className="tr"><span className="vno">{no ?? n.title}</span>{n.translation ?? n.text_content}</p>}
      </div>
    );
  }
  if (n.kind === "heading") {
    const lvl = Number(md.level ?? 2);
    return lvl <= 2 ? <h2 {...common}>{n.text_content ?? n.title}</h2> : <h3 {...common}>{n.text_content ?? n.title}</h3>;
  }
  if (n.kind === "note") return <p className="note" {...common}>{n.text_content}</p>;
  if (n.kind === "custom") return <p {...common}><b>{n.title}</b>{n.text_content ? " — " + n.text_content : ""}</p>;
  const arabic = md.lang === "ar" || (n.secondary_text && !n.text_content);
  if (arabic) return <div className="ar" {...common}>{n.text_content ?? n.secondary_text}</div>;
  return (
    <div {...common}>
      {n.secondary_text && <div className="ar">{n.secondary_text}</div>}
      {n.text_content && <p>{n.text_content}</p>}
      {n.translation && <p className="tr">{n.translation}</p>}
    </div>
  );
}
