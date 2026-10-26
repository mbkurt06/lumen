import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

type Item = { id: string; parent_id: string | null; kind: string; title: string; subtitle: string | null; sort_order: number };
type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  metadata: Record<string, unknown> | null;
};
const ITEM_COLS = "id,parent_id,kind,title,subtitle,sort_order";

function useItem(id: string | undefined) {
  const [item, setItem] = useState<Item | null>(null);
  const [children, setChildren] = useState<Item[]>([]);
  const [trail, setTrail] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      if (!id) {
        const { data } = await supabase.from("library_items").select(ITEM_COLS).is("parent_id", null).order("sort_order");
        if (!off) { setItem(null); setTrail([]); setChildren((data ?? []) as Item[]); setLoading(false); }
        return;
      }
      const { data: me } = await supabase.from("library_items").select(ITEM_COLS).eq("id", id).maybeSingle();
      const cur = me as Item | null;
      const chain: Item[] = [];
      let p = cur?.parent_id ?? null;
      for (let i = 0; p && i < 6; i++) {
        const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("id", p).maybeSingle();
        const it = data as Item | null;
        if (!it) break;
        chain.unshift(it);
        p = it.parent_id;
      }
      let kids: Item[] = [];
      if (cur && cur.kind !== "document") {
        const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", id).order("sort_order").order("title").limit(1000);
        kids = (data ?? []) as Item[];
      }
      if (!off) { setItem(cur); setTrail(chain); setChildren(kids); setLoading(false); }
    })();
    return () => { off = true; };
  }, [id]);
  return { item, children, trail, loading };
}

export function Library() {
  const { id } = useParams();
  const { item, children, trail, loading } = useItem(id);
  const [recent, setRecent] = useState<{ document_id: string; title: string }[]>([]);

  useEffect(() => {
    if (id) return;
    (async () => {
      const { data } = await supabase.from("reading_state").select("document_id,last_opened_at").order("last_opened_at", { ascending: false }).limit(5);
      const rows = (data ?? []) as { document_id: string }[];
      if (!rows.length) return setRecent([]);
      const { data: items } = await supabase.from("library_items").select("id,title").in("id", rows.map((r) => r.document_id));
      const m = new Map(((items ?? []) as { id: string; title: string }[]).map((x) => [x.id, x.title]));
      setRecent(rows.filter((r) => m.has(r.document_id)).map((r) => ({ document_id: r.document_id, title: m.get(r.document_id)! })));
    })();
  }, [id]);

  if (item?.kind === "document") return <Reader doc={item} trail={trail} />;

  return (
    <>
      <PageHeader title={item?.title ?? "Kütüphane"} subtitle={item?.subtitle ?? undefined} />
      {trail.length > 0 && (
        <div className="crumbs">
          <Link to="/kutuphane">Kütüphane</Link>
          {trail.map((t) => (<span key={t.id}> › <Link to={`/kutuphane/${t.id}`}>{t.title}</Link></span>))}
        </div>
      )}
      {!id && recent.length > 0 && (
        <>
          <div className="dsection" style={{ padding: "12px 16px 0" }}>KALDIĞIN YER</div>
          <div className="card" style={{ margin: "6px 16px", padding: 0 }}>
            {recent.map((r) => (<Link key={r.document_id} className="lrow" to={`/kutuphane/${r.document_id}`}>{r.title}</Link>))}
          </div>
        </>
      )}
      {loading && <p className="muted" style={{ padding: "12px 16px" }}>Yükleniyor…</p>}
      {!id ? (
        <div className="lgrid">
          {children.map((c) => (<Link key={c.id} className="lcard" to={`/kutuphane/${c.id}`}><b>{c.title}</b>{c.subtitle && <span className="muted small">{c.subtitle}</span>}</Link>))}
        </div>
      ) : (
        <div className="card" style={{ margin: "10px 16px", padding: 0 }}>
          {!loading && children.length === 0 && <p className="muted" style={{ padding: 14, margin: 0 }}>Bu klasör boş.</p>}
          {children.map((c) => (
            <Link key={c.id} className="lrow" to={`/kutuphane/${c.id}`}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.title}{c.subtitle && <span className="muted small"> · {c.subtitle}</span>}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

const CHUNK = 250;

function Reader({ doc, trail }: { doc: Item; trail: Item[] }) {
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
      <PageHeader title={doc.title} subtitle={trail.map((t) => t.title).join(" › ") || undefined} />
      <div className="rbar">
        <button onClick={() => setS(scale - 0.1)}>A−</button>
        <button onClick={() => setS(scale + 0.1)}>A+</button>
        {trail.length > 0 && <Link to={`/kutuphane/${trail[trail.length - 1].id}`} style={{ marginLeft: "auto", alignSelf: "center", color: "var(--accent)", textDecoration: "none" }}>İçindekiler</Link>}
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
