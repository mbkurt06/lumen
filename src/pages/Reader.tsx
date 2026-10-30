import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AskDialog } from "../components/Dialog";
import { supabase } from "../lib/supabase";
import type { Item } from "../lib/library";
import { useTodos, ymd } from "../lib/todo";
import { applyAll, loadRS, resetRS, saveRS, type RSettings } from "../lib/readerSettings";
import { TodoSheet } from "./TodoSheet";

type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  metadata: Record<string, unknown> | null;
};
type Block =
  | { t: "instr" | "fn" | "h2" | "h3" | "p" | "verse" | "custom"; n: Node }
  | { t: "counter"; n: Node; target: number }
  | { t: "quote"; ns: Node[] };
type Note = { id: string; node_id: string | null; note: string; quote: string | null };

const md = (n: Node) => n.metadata ?? {};
const len = (b: Block) => (b.t === "quote" ? b.ns.reduce((a, n) => a + (n.text_content?.length ?? 0), 0) : (b.n.text_content?.length ?? 0) + (b.n.secondary_text?.length ?? 0) + (b.n.translation?.length ?? 0)) + 40;

function toBlocks(nodes: Node[]): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    const m = md(n);
    if (n.kind === "phrase") {
      const target = Number(m.target ?? 0);
      if (target > 0) { out.push({ t: "counter", n, target }); continue; }
      const last = out[out.length - 1];
      if (last && last.t === "quote") last.ns.push(n);
      else out.push({ t: "quote", ns: [n] });
      continue;
    }
    if (n.kind === "note") { out.push({ t: m.instruction === true ? "instr" : "fn", n }); continue; }
    if (n.kind === "heading") { out.push({ t: Number(m.level ?? 2) <= 2 ? "h2" : "h3", n }); continue; }
    if (n.kind === "verse") { out.push({ t: "verse", n }); continue; }
    if (n.kind === "custom") { out.push({ t: "custom", n }); continue; }
    out.push({ t: "p", n });
  }
  return out;
}

function paginate(blocks: Block[], budget: number): Block[][] {
  const pages: Block[][] = [];
  let cur: Block[] = [];
  let size = 0;
  for (const b of blocks) {
    const l = len(b);
    // uzun alıntı bloklarını sayfaya sığacak parçalara böl
    if (b.t === "quote" && l > budget) {
      let part: Node[] = [];
      let ps = 0;
      for (const n of b.ns) {
        const nl = (n.text_content?.length ?? 0) + 20;
        if (size + ps + nl > budget && (cur.length || part.length)) {
          if (part.length) cur.push({ t: "quote", ns: part });
          pages.push(cur); cur = []; size = 0; part = []; ps = 0;
        }
        part.push(n); ps += nl;
      }
      if (part.length) { cur.push({ t: "quote", ns: part }); size += ps; }
      continue;
    }
    if (size + l > budget && cur.length) { pages.push(cur); cur = []; size = 0; }
    cur.push(b); size += l;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

const nidsOf = (b: Block) => (b.t === "quote" ? b.ns.map((n) => n.id) : [b.n.id]);

export function Reader({ doc, parentTitle }: { doc: Item; parentTitle?: string }) {
  const nav = useNavigate();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [mark, setMark] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [rs, setRs] = useState<RSettings>(() => loadRS(doc.id));
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; nid: string; text: string } | null>(null);
  const [ask, setAsk] = useState<null | { nid: string; text: string }>(null);
  const [todo, setTodo] = useState<null | { notes: string }>(null);
  const [toast, setToast] = useState("");
  const { lists, groups } = useTodos();
  const bodyRef = useRef<HTMLDivElement>(null);

  // içerik + kaldığım yer + sayaçlar + notlar
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const all: Node[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("content_nodes").select("id,kind,title,text_content,secondary_text,translation,metadata").eq("document_id", doc.id).order("sort_order").range(from, from + 999);
        if (error || !data) break;
        all.push(...(data as Node[]));
        if (data.length < 1000) break;
      }
      const counterIds = all.filter((n) => n.kind === "phrase" && Number(md(n).target ?? 0) > 0).map((n) => n.id);
      const [rsq, msq, nq] = await Promise.all([
        supabase.from("reading_state").select("last_content_node_id").eq("document_id", doc.id).maybeSingle(),
        counterIds.length ? supabase.from("memorization_state").select("content_node_id,repeat_count,last_practiced_at").in("content_node_id", counterIds) : Promise.resolve({ data: [] as unknown[] }),
        supabase.from("reader_notes").select("id,node_id,note,quote").eq("document_id", doc.id).order("created_at"),
      ]);
      if (off) return;
      const today = ymd();
      const c: Record<string, number> = {};
      for (const r of (msq.data ?? []) as { content_node_id: string; repeat_count: number; last_practiced_at: string | null }[]) {
        if (r.last_practiced_at && ymd(new Date(r.last_practiced_at)) === today) c[r.content_node_id] = r.repeat_count;
      }
      setNodes(all);
      setCounts(c);
      setNotes((nq.data ?? []) as Note[]);
      setMark((rsq.data as { last_content_node_id: string | null } | null)?.last_content_node_id ?? null);
      setLoading(false);
    })();
    return () => { off = true; };
  }, [doc.id]);

  const isDua = useMemo(() => nodes.some((n) => n.kind === "phrase"), [nodes]);
  const pages = useMemo(() => paginate(toBlocks(nodes), isDua ? 650 : 2200), [nodes, isDua]);

  /* ── Sabit sayfa (kitap) düzeni: Risale, HE, diğer düz metinler ── */
  const paged = !loading && !isDua && nodes.length > 0;
  const loc = useLocation();
  const vpRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState({ w: 0, h: 0 });
  const [pp, setPp] = useState(0);
  const [pc, setPc] = useState(1);
  const [siblings, setSiblings] = useState<string[]>([]);
  const GAP = 48;
  const allBlocks = useMemo(() => toBlocks(nodes), [nodes]);

  useEffect(() => {
    if (!doc.parent_id) return;
    void supabase.from("library_items").select("id").eq("parent_id", doc.parent_id).eq("kind", "document").order("sort_order").order("title").limit(2000)
      .then(({ data }) => setSiblings(((data ?? []) as { id: string }[]).map((r) => r.id)));
  }, [doc.parent_id]);

  useLayoutEffect(() => {
    if (!paged) return;
    const measure = () => {
      const vp = vpRef.current;
      if (!vp) return;
      const top = vp.getBoundingClientRect().top;
      const reserve = 122 + (focus ? 0 : 62);
      setGeo({ w: vp.clientWidth, h: Math.max(220, Math.floor(window.innerHeight - top - reserve)) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [paged, focus]);

  const startedAt = useRef(false);
  useLayoutEffect(() => {
    if (!paged || !geo.w) return;
    const calc = () => {
      const f = flowRef.current;
      if (!f) return;
      const n = Math.max(1, Math.round((f.scrollWidth + GAP) / (geo.w + GAP)));
      setPc(n);
      if (!startedAt.current) {
        startedAt.current = true;
        const st = loc.state as { atEnd?: boolean } | null;
        if (st?.atEnd) setPp(n - 1);
        else if (mark) {
          const el = document.getElementById("n" + mark);
          if (el) setPp(Math.min(n - 1, Math.max(0, Math.floor(el.offsetLeft / (geo.w + GAP)))));
        }
      } else setPp((x) => Math.min(x, n - 1));
    };
    calc();
    void document.fonts?.ready.then(calc);
  }, [paged, geo, rs.size, rs.ar, rs.latin, rs.tr, notes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const sIdx = siblings.indexOf(doc.id);
  const prevDoc = sIdx > 0 ? siblings[sIdx - 1] : null;
  const nextDoc = sIdx >= 0 && sIdx < siblings.length - 1 ? siblings[sIdx + 1] : null;
  const turn = (d: number) => {
    const t = pp + d;
    window.getSelection()?.removeAllRanges();
    setSel(null);
    if (t < 0) { if (prevDoc) nav(`/kutuphane/${prevDoc}`, { replace: true, state: { atEnd: true } }); return; }
    if (t >= pc) { if (nextDoc) nav(`/kutuphane/${nextDoc}`, { replace: true }); return; }
    setPp(t);
  };
  const touchX = useRef<number | null>(null);
  useEffect(() => {
    if (!paged) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") turn(1); else if (e.key === "ArrowLeft") turn(-1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // açılışta: kaldığım yer varsa o sayfaya git (yalnızca senin kaydettiğin yer)
  const jumped = useRef(false);
  useEffect(() => {
    if (loading || jumped.current) return;
    jumped.current = true;
    if (!mark) return;
    const p = pages.findIndex((pg) => pg.some((b) => nidsOf(b).includes(mark)));
    if (p >= 0) { setPage(p); setTimeout(() => document.getElementById("n" + mark)?.scrollIntoView({ block: "center" }), 60); }
  }, [loading, mark, pages]);

  const cur = pages[Math.min(page, pages.length - 1)] ?? [];
  const pageCounters = cur.filter((b): b is Extract<Block, { t: "counter" }> => b.t === "counter");
  const firstOpen = pageCounters.find((b) => (counts[b.n.id] ?? 0) < b.target);
  const act = pageCounters.find((b) => b.n.id === active && (counts[b.n.id] ?? 0) < b.target) ?? firstOpen;

  const go = (p: number) => {
    setPage(Math.max(0, Math.min(pages.length - 1, p)));
    setActive(null);
    document.querySelector(".content")?.scrollTo(0, 0);
  };

  const saveCount = useCallback(async (nid: string, target: number, value: number) => {
    await supabase.from("memorization_state").upsert(
      { content_node_id: nid, repeat_count: value, repeat_target: target, last_practiced_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "owner_id,content_node_id" },
    );
  }, []);

  const tap = (b?: Extract<Block, { t: "counter" }>) => {
    if (!b) { if (page < pages.length - 1) go(page + 1); return; }
    const v = Math.min(b.target, (counts[b.n.id] ?? 0) + 1);
    setCounts((s) => ({ ...s, [b.n.id]: v }));
    try { navigator.vibrate?.(v === b.target ? [30, 60, 30] : 12); } catch { /* yok say */ }
    void saveCount(b.n.id, b.target, v);
  };

  const resetPage = () => {
    if (!pageCounters.length || !window.confirm("Bu sayfadaki sayaçlar sıfırlansın mı?")) return;
    const s = { ...counts };
    for (const b of pageCounters) { s[b.n.id] = 0; void saveCount(b.n.id, b.target, 0); }
    setCounts(s);
  };

  // metin seçimi → seçim menüsü (Kaldığım yer · Not · Todo)
  useEffect(() => {
    const onSel = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount || !bodyRef.current) { setSel(null); return; }
      const r = s.getRangeAt(0);
      if (!bodyRef.current.contains(r.commonAncestorContainer)) { setSel(null); return; }
      const start = r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement;
      const el = start?.closest<HTMLElement>("[data-nid]");
      const text = s.toString().trim();
      if (!el?.dataset.nid || !text) { setSel(null); return; }
      const rect = r.getBoundingClientRect();
      setSel({ x: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90), y: Math.max(rect.top - 60, 60), nid: el.dataset.nid, text });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const saveMark = async () => {
    if (!sel) return;
    const { error } = await supabase.from("reading_state").upsert(
      { document_id: doc.id, last_content_node_id: sel.nid, scroll_anchor: sel.text.slice(0, 300), last_opened_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "owner_id,document_id" },
    );
    setMark(sel.nid);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    flash(error ? "Kaydedilemedi: " + error.message : "Kaldığım yer kaydedildi");
  };
  const addNote = async (text: string) => {
    if (!ask) return;
    const { data, error } = await supabase.from("reader_notes").insert({ document_id: doc.id, node_id: ask.nid, quote: ask.text.slice(0, 500), note: text }).select("id,node_id,note,quote").single();
    if (error) flash("Not kaydedilemedi: " + error.message);
    else { setNotes((s) => [...s, data as Note]); flash("Not eklendi"); }
  };

  const setR = (s: RSettings) => { setRs(s); saveRS(doc.id, s); };
  const sysDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const defTheme = isDua ? "dark" : "paper";
  const th = rs.theme === "default" ? defTheme : rs.theme;
  const rt = th === "auto" ? (sysDark ? "dark" : "light") : th;

  useEffect(() => {
    document.body.classList.toggle("focus", focus);
    return () => document.body.classList.remove("focus");
  }, [focus]);

  if (showSettings) return <ReaderSettings title={doc.title} defTheme={defTheme} rs={rs} onChange={setR} onBack={() => setShowSettings(false)} onApplyAll={() => { applyAll(rs); flash("Diğer sayfalara uygulandı"); }} onReset={() => { resetRS(doc.id); setRs(loadRS(doc.id)); }} onGeneral={() => nav("/ayarlar")} />;

  const notesOf = (nid: string) => notes.filter((n) => n.node_id === nid);
  const span = (n: Node, text: ReactNode) => (
    <span key={n.id} id={"n" + n.id} data-nid={n.id} className={n.id === mark ? "mk" : notesOf(n.id).length ? "ul" : undefined}>{text} </span>
  );
  const NoteBoxes = ({ nid }: { nid: string }) => <>{notesOf(nid).map((x) => (<div key={x.id} className="ubox">Not: {x.note}</div>))}</>;

  const renderBlock = (b: Block, i: number): ReactNode => {
    if (b.t === "quote") {
      // amber not kutusu (metadata.note) alıntıyı böler
      const segs: Node[][] = [[]];
      const after: (string | null)[] = [];
      b.ns.forEach((n) => { segs[segs.length - 1].push(n); const nt = md(n).note; if (typeof nt === "string" && nt) { after[segs.length - 1] = nt; segs.push([]); } });
      const clean = segs.filter((s) => s.length);
      return (
        <div key={i}>
          {segs.map((s, si) => !s.length ? null : (
            <div key={si}>
              <p className="q">
                {si === 0 ? "“" : ""}
                {s.map((n) => span(n, <>
                  {rs.ar && n.secondary_text && <span className="ar inl">{n.secondary_text}</span>}
                  {rs.latin && n.text_content}
                  {rs.tr && n.translation && <span className="trn"> ({n.translation})</span>}
                </>))}
                {s === clean[clean.length - 1] ? "”" : ""}
              </p>
              {s.map((n) => <NoteBoxes key={n.id} nid={n.id} />)}
              {after[si] && <div className="abox">({after[si]})</div>}
            </div>
          ))}
        </div>
      );
    }
    const n = b.n;
    if (b.t === "counter") {
      const c = counts[n.id] ?? 0;
      const done = c >= b.target;
      const isAct = act?.n.id === n.id;
      const nt = md(n).note;
      return (
        <div key={i}>
          <div className={"crow2" + (isAct ? " act" : "")} onClick={() => setActive(n.id)}>
            <div className="ctext" id={"n" + n.id} data-nid={n.id}>
              {rs.ar && n.secondary_text && <div className="ar">{n.secondary_text}</div>}
              {rs.latin && <span className={n.id === mark ? "mk" : undefined}>{n.text_content}</span>}
              {rs.tr && n.translation && <div className="trn">{n.translation}</div>}
            </div>
            <button className={"pill" + (done ? " done" : isAct ? " act" : "")} onClick={(e) => { e.stopPropagation(); setActive(n.id); tap(b); }}>{b.target}/{c}</button>
          </div>
          <NoteBoxes nid={n.id} />
          {typeof nt === "string" && nt && <div className="abox">({nt})</div>}
        </div>
      );
    }
    if (b.t === "instr") return <div key={i}><p className="instr" id={"n" + n.id} data-nid={n.id}>{n.text_content}</p><NoteBoxes nid={n.id} /></div>;
    if (b.t === "fn") return <div key={i}><p className="fn" id={"n" + n.id} data-nid={n.id}>{n.text_content}</p><NoteBoxes nid={n.id} /></div>;
    if (b.t === "h2") return <h2 key={i} id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.title}</h2>;
    if (b.t === "h3") return <h3 key={i} id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.title}</h3>;
    if (b.t === "verse") {
      const no = String(n.title ?? "").split(":")[1];
      return (
        <div key={i} id={"n" + n.id} data-nid={n.id} className={n.id === mark ? "mk" : undefined}>
          {rs.ar && n.secondary_text && <div className="ar">{n.secondary_text} <span className="vno">﴿{no}﴾</span></div>}
          {rs.tr && (n.translation || n.text_content) && <p className="trn">{no}. {n.translation ?? n.text_content}</p>}
          <NoteBoxes nid={n.id} />
        </div>
      );
    }
    if (b.t === "custom") return <p key={i} id={"n" + n.id} data-nid={n.id}><b>{n.title}</b>{n.text_content ? " — " + n.text_content : ""}</p>;
    const arabic = md(n).lang === "ar" || (n.secondary_text && !n.text_content);
    return (
      <div key={i}>
        {arabic ? (rs.ar && <div className="ar" id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.secondary_text}</div>) : (
          <p id={"n" + n.id} data-nid={n.id} className={n.id === mark ? "mk" : notesOf(n.id).length ? "ul" : undefined}>
            {rs.ar && n.secondary_text && <span className="ar blk">{n.secondary_text}</span>}
            {rs.latin && n.text_content}
            {rs.tr && n.translation && <span className="trn blk">{n.translation}</span>}
          </p>
        )}
        <NoteBoxes nid={n.id} />
      </div>
    );
  };

  const overlays = (
    <>
      {sel && (
        <div className="selbar" style={{ left: sel.x, top: sel.y }} onMouseDown={(e) => e.preventDefault()} onTouchStart={(e) => e.preventDefault()}>
          <button className="g" onClick={() => void saveMark()} aria-label="Kaldığım yer"><Icon name="bookmark" size={22} /></button>
          <button onClick={() => { setAsk({ nid: sel.nid, text: sel.text }); setSel(null); }} aria-label="Not"><Icon name="pencil" size={22} /></button>
          <button className="a" onClick={() => { setTodo({ notes: sel.text.slice(0, 300) }); setSel(null); }} aria-label="Todo"><Icon name="plusbox" size={22} /></button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {ask && <AskDialog title="Not ekle" placeholder="Notun" onClose={() => setAsk(null)} onSubmit={(v) => void addNote(v)} />}
      {todo && (
        <TodoSheet
          initialTab={isDua ? "tekrar" : "okuma"}
          prefill={{ lib: { id: doc.id, title: doc.title }, notes: todo.notes }}
          lists={lists} groups={groups} defaultListId={null}
          onClose={() => setTodo(null)}
          onSaved={() => { setTodo(null); flash("Todo'ya eklendi"); }}
        />
      )}
    </>
  );

  if (paged) {
    return (
      <div className="rpage paged" data-rt={rt} style={{ filter: rs.light < 1 ? `brightness(${rs.light})` : undefined }}>
        <header className="rhead">
          <button className="iconbtn" onClick={() => nav(-1)} aria-label="Geri"><Icon name="back" size={24} /></button>
          <div className="rtitle">{doc.title}<span>{parentTitle ? parentTitle + " · " : ""}Sayfa {pp + 1}</span></div>
          <button className="iconbtn" onClick={() => setFocus(!focus)} aria-label="Tam ekran"><Icon name="expand" size={22} /></button>
          <button className="iconbtn acc" onClick={() => setTodo({ notes: "" })} aria-label="Todo'ya ekle"><Icon name="plusbox" size={24} /></button>
          <button className="iconbtn" onClick={() => setShowSettings(true)} aria-label="Sayfa ayarları"><Icon name="sliders" size={22} /></button>
        </header>
        <div className="rprog"><i style={{ width: `${((pp + 1) / pc) * 100}%` }} /></div>
        <div className="paper">
          <div className="phd"><span>{parentTitle ?? doc.title}</span><span>{pp + 1}</span></div>
          <div
            className="vp"
            ref={vpRef}
            style={{ height: geo.h || undefined }}
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const x0 = touchX.current;
              touchX.current = null;
              if (x0 === null || window.getSelection()?.toString()) return;
              const dx = e.changedTouches[0].clientX - x0;
              if (dx < -50) turn(1); else if (dx > 50) turn(-1);
            }}
          >
            <div
              className="reader2 flow"
              ref={(el) => { flowRef.current = el; bodyRef.current = el; }}
              style={{ fontSize: `${rs.size}em`, columnWidth: geo.w ? `${geo.w}px` : undefined, columnGap: `${GAP}px`, height: geo.h || undefined, transform: `translateX(-${pp * (geo.w + GAP)}px)` }}
            >
              {allBlocks.map(renderBlock)}
            </div>
          </div>
          <div className="pfoot">{pp + 1}</div>
        </div>
        <div className="pnav">
          <button disabled={pp === 0 && !prevDoc} onClick={() => turn(-1)}>{pp === 0 ? "‹ Önceki bölüm" : "‹ Önceki sayfa"}</button>
          <span className="small muted">{pp + 1} / {pc}</span>
          <button disabled={pp >= pc - 1 && !nextDoc} onClick={() => turn(1)}>{pp >= pc - 1 ? "Sonraki bölüm ›" : "Sonraki sayfa ›"}</button>
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div className="rpage" data-rt={rt} style={{ filter: rs.light < 1 ? `brightness(${rs.light})` : undefined }}>
      <header className="rhead">
        <button className="iconbtn" onClick={() => nav(-1)} aria-label="Geri"><Icon name="back" size={24} /></button>
        <div className="rtitle">{doc.title}{parentTitle && !isDua ? <span>{parentTitle}</span> : null}</div>
        {pageCounters.length > 0 && <button className="iconbtn" onClick={resetPage} aria-label="Sayaçları sıfırla"><Icon name="reset" size={22} /></button>}
        <button className="iconbtn" onClick={() => setFocus(!focus)} aria-label="Tam ekran"><Icon name="expand" size={22} /></button>
        <button className="iconbtn acc" onClick={() => setTodo({ notes: "" })} aria-label="Todo'ya ekle"><Icon name="plusbox" size={24} /></button>
        <button className="iconbtn" onClick={() => setShowSettings(true)} aria-label="Sayfa ayarları"><Icon name="sliders" size={22} /></button>
      </header>
      <div className="rprog"><i style={{ width: `${((page + 1) / pages.length) * 100}%` }} /></div>
      {loading && <p className="muted" style={{ padding: "12px 20px" }}>Yükleniyor…</p>}
      <div className={"reader2" + (isDua ? " dua" : "")} style={{ fontSize: `${rs.size}em` }} ref={bodyRef}>
        {cur.map(renderBlock)}
        {!loading && nodes.length === 0 && <p className="muted">Bu belgenin içeriği henüz yok.</p>}
      </div>
      <div style={{ height: 90 }} />
      {pageCounters.length > 0 && (
        <button className={"cfab" + (act ? "" : " done")} onClick={() => tap(act)} aria-label="Say">
          {act ? (counts[act.n.id] ?? 0) : <Icon name="check" size={34} />}
        </button>
      )}
      <div className="pnav">
        <button disabled={page === 0} onClick={() => go(page - 1)}>‹ Önceki</button>
        <span className="small muted">{page + 1} / {pages.length}</span>
        <button disabled={page >= pages.length - 1} onClick={() => go(page + 1)}>Sonraki ›</button>
      </div>
      {overlays}
    </div>
  );
}

/* Sayfa ayarları (tasarım: Sayac) — yalnız bu sayfa için geçerli */
function ReaderSettings({ title, defTheme, rs, onChange, onBack, onApplyAll, onReset, onGeneral }: {
  title: string; defTheme: string; rs: RSettings; onChange: (s: RSettings) => void; onBack: () => void; onApplyAll: () => void; onReset: () => void; onGeneral: () => void;
}) {
  const Tog = ({ k, label }: { k: "ar" | "latin" | "tr"; label: string }) => (
    <div className="srow"><span>{label}</span><button className={"tgl" + (rs[k] ? " on" : "")} onClick={() => onChange({ ...rs, [k]: !rs[k] })} aria-pressed={rs[k]}><i /></button></div>
  );
  return (
    <>
      <header className="phead">
        <button className="iconbtn" onClick={onBack} aria-label="Geri"><Icon name="back" size={26} /></button>
        <div className="ptitle"><h1>Ayarlar</h1><p>{title}</p></div>
      </header>
      <div className="infoline">Sadece bu sayfa için geçerli.</div>
      <div style={{ padding: "0 16px" }}>
        <div className="srow col"><span>Gece modu</span>
          <div className="seg3">
            {(["dark", "light", "paper", "auto"] as const).map((t) => (<button key={t} className={rs.theme === t || (rs.theme === "default" && t === defTheme) ? "on" : ""} onClick={() => onChange({ ...rs, theme: t })}>{t === "dark" ? "Koyu" : t === "light" ? "Aydınlık" : t === "paper" ? "Kâğıt" : "Telefonla aynı"}</button>))}
          </div>
        </div>
        <Tog k="ar" label="Arapça" />
        <Tog k="latin" label="Latin okunuş" />
        <Tog k="tr" label="Türkçe anlam" />
        <div className="srow col"><span>Yazı boyutu</span>
          <div className="sl"><small>A</small><input type="range" min={0.8} max={1.8} step={0.05} value={rs.size} onChange={(e) => onChange({ ...rs, size: Number(e.target.value) })} /><b>A</b></div>
        </div>
        <div className="srow col"><span>Aydınlatma</span>
          <div className="sl"><small>☼</small><input type="range" min={0.4} max={1} step={0.05} value={rs.light} onChange={(e) => onChange({ ...rs, light: Number(e.target.value) })} /><b>☀</b></div>
        </div>
        <button className="secondary" style={{ marginTop: 24 }} onClick={onApplyAll}>⇄ Diğer sayfalara uygula</button>
        <div className="seg" style={{ marginTop: 10 }}>
          <button onClick={onReset}>↺ Sıfırla</button>
          <button onClick={onGeneral}>Genel ayarlar</button>
        </div>
      </div>
    </>
  );
}
