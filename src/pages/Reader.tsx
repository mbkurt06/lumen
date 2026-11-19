import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AskDialog } from "../components/Dialog";
import { supabase } from "../lib/supabase";
import type { Item } from "../lib/library";
import { goalCount, goalLabel, goalPeriod, readsCache, useTodos, ymd as ymdToday, type Todo as TodoT } from "../lib/todo";
import { useCP } from "../lib/counterPrefs";
import { usePageReads } from "../lib/pageReads";
import { applyAll, loadRS, pullRS, resetRS, saveRS, type RSettings, type Scope } from "../lib/readerSettings";
import { TodoSheet, type PlacePrefill, type Pos } from "./TodoSheet";
import { BookmarkDialog } from "../components/BookmarkDialog";
import { FloatCounter, FullTasbih } from "../components/FloatCounter";
import { useOffline } from "../lib/online";
import { pickNewer, putCount, todayOnly } from "../lib/countStore";
import { addBookmark, deleteBookmark, listBookmarks, moveBookmark, type Bookmark, type BookmarkDraft } from "../lib/bookmarks";
import { ensureMushafFont, loadMushafPages, type MPage } from "../lib/mushaf";
import { fetchDocNodes, fetchSiblings, fetchSurahNames } from "../lib/loaders";

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
/** Metnin çoğu Arap harfiyse true. */
const isAr = (t: string | null | undefined) => { if (!t) return false; const a = (t.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length; const l = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]/g) ?? []).length; return a > l; };
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

/* Eski Lumen'deki kitap sayfası bölmesiyle aynı: her sayfa sabit bir metin yükü taşır. */
function nodeWeight(n: Node) {
  const title = (n.title || "").length, text = (n.text_content || "").length;
  const arabic = (n.secondary_text || "").length, tr = (n.translation || "").length;
  return text + tr + Math.round(arabic * 1.25) + title * 2.2 + (n.title ? 180 : 40);
}
// Eski uygulamada senin yazı ölçeğin 0.8 idi: 2250 / 0.8^1.65 ≈ 3250. Örnek gönderdiğin sayfalar bu değerle bölünmüştü;
// artık yazı boyutundan bağımsız sabit tutuluyor.
const PAGE_LOAD = 3250;
function fixedPages(nodes: Node[], target = PAGE_LOAD): Node[][] {
  const pages: Node[][] = [];
  let cur: Node[] = [];
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

const nidsOf = (b: Block) => (b.t === "quote" ? b.ns.map((n) => n.id) : [b.n.id]);

export function Reader({ doc, parentTitle, scope }: { doc: Item; parentTitle?: string; scope: Scope }) {
  // namaz tesbihatı sayaçları her gün sıfırlanır; diğer tesbihler (Esmâ, salavat…) birikir, elle sıfırlanır
  const cumulative = scope === "ibadet" && !/Namazı Tesbihatı/.test(doc.title);
  const nav = useNavigate();
  const loc0 = useLocation();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [mark, setMark] = useState<string | null>(() => (loc0.state as { nid?: string } | null)?.nid ?? null); // ayraçtan açılınca gidilecek yer
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [rs, setRs] = useState<RSettings>(() => loadRS(scope));
  useEffect(() => { void pullRS(scope).then((r) => { if (r) setRs(r); }); }, [scope]);
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; nid: string; text: string } | null>(null);
  const [ask, setAsk] = useState<null | { nid: string; text: string }>(null);
  const [place, setPlace] = useState<PlacePrefill | null>(null); // kitaptan görev (standart form)
  const lastSel = useRef<{ nid: string; text: string; at: number } | null>(null); // ⊞'ye basınca seçim kaybolsa da kullanılır
  const [taskT, setTaskT] = useState<TodoT | null>(null); // görevden açıldıysa o görev
  const [pmenu, setPmenu] = useState(false); // başlıktaki + menüsü
  const [editNote, setEditNote] = useState<Note | null>(null);
  const focusTaskId = (loc0.state as { taskId?: string } | null)?.taskId ?? null; // görevden açıldıysa
  const [toast, setToast] = useState("");
  const { lists, groups, todos } = useTodos();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fsT, setFsT] = useState(false);

  // Ayraçlar (çoklu, isimli). Kur'an'da tüm Kur'an ayraçları, diğerlerinde bu kitabınkiler.
  const [bms, setBms] = useState<Bookmark[]>([]);
  const bookId = scope === "kuran" ? null : doc.parent_id;
  const reloadBms = useCallback(async () => { setBms(await listBookmarks(scope, bookId)); }, [scope, bookId]);
  useEffect(() => { void reloadBms(); }, [reloadBms]);
  const markedIds = useMemo(() => new Set(bms.filter((b) => b.node_id && (scope === "kuran" || b.document_id === doc.id)).map((b) => b.node_id as string)), [bms, scope, doc.id]);
  const isMarked = (id?: string | null) => !!id && markedIds.has(id);
  const [bmDraft, setBmDraft] = useState<BookmarkDraft | null>(null);

  // içerik + kaldığım yer + sayaçlar + notlar
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      let all = (await fetchDocNodes(doc.id)) as Node[];
      if (off) return;
      // Esmâü'l-Hüsnâ gibi tek isimli belgelerde çekilecek sayı belgenin kendisinde tutulur
      const dmeta = (doc.metadata ?? {}) as Record<string, unknown>;
      const dt = Number(dmeta.target ?? 0);
      if (dt > 0 && !all.some((n) => Number(md(n).target ?? 0) > 0)) {
        const i = all.findIndex((n) => n.kind === "phrase");
        if (i >= 0) all = all.map((n, j) => (j === i ? { ...n, metadata: { ...(n.metadata ?? {}), target: dt } } : n));
      }
      // Esmâü'l-Hüsnâ: başlık ismin kendisi (Er-Rahmân), büyük yazı listedeki gibi "Yâ Rahmân"
      if (String(dmeta.legacy_id ?? "").startsWith("esma-")) {
        const sub = (doc.subtitle ?? "").normalize("NFC").trim();
        const ya = /^Y[aâ]\s/i.test(sub) ? sub : "Yâ " + doc.title.replace(/^[A-ZÂÎÛa-zâîû]{1,3}-/, "");
        const i = all.findIndex((n) => n.kind === "phrase");
        if (i >= 0 && dt > 0) all = all.map((n, j) => (j === i ? { ...n, text_content: ya } : n));
      }
      setNodes(all);
      setLoading(false); // metin hazır: sayfa hemen açılsın; notlar ve sayaçlar arkadan
      const counterIds = all.filter((n) => n.kind === "phrase" && Number(md(n).target ?? 0) > 0).map((n) => n.id);
      const [msq, nq] = await Promise.all([
        counterIds.length ? supabase.from("memorization_state").select("content_node_id,repeat_count,last_practiced_at").in("content_node_id", counterIds) : Promise.resolve({ data: [] as unknown[] }),
        supabase.from("reader_notes").select("id,node_id,note,quote").eq("document_id", doc.id).order("created_at"),
      ]);
      if (off) return;
      // hesaptaki ile cihazdaki kayıttan yenisi; namaz tesbihatı her gün sıfırdan, diğerleri birikir
      const srv = new Map<string, { v: number; at: string | null }>();
      for (const r of (msq.data ?? []) as { content_node_id: string; repeat_count: number; last_practiced_at: string | null }[]) srv.set(r.content_node_id, { v: r.repeat_count, at: r.last_practiced_at });
      const c: Record<string, number> = {};
      for (const id of counterIds) { const r = pickNewer(id, srv.get(id) ?? null); c[id] = cumulative ? r.v : todayOnly(r); }
      setCounts(c);
      setNotes((nq.data ?? []) as Note[]);
    })();
    return () => { off = true; };
  }, [doc.id]);

  const isDua = useMemo(() => nodes.some((n) => n.kind === "phrase"), [nodes]);
  const pages = useMemo(() => paginate(toBlocks(nodes), isDua ? 650 : 2200), [nodes, isDua]);

  /* ── Sabit kitap sayfası: Kur'an (mushaf sayfası), Risale, HE, diğer kitaplar ──
     Sayfa sınırları içerikten bir kez hesaplanır; yazı boyutu, ekran ya da cihaz değişse de
     aynı sayfada aynı metin kalır. Sayfa sığmazsa aşağı kayar, metin sonraki sayfaya taşmaz. */
  // Kur'an: Word (Diyanet) dosyasındaki sayfa düzeni ve yazı tipi
  const qm = (doc.metadata ?? {}) as Record<string, unknown>;
  const qRange = typeof qm.start_page === "number" && typeof qm.end_page === "number" && String(qm.arabic_source ?? "").includes("mushaf")
    ? [qm.start_page as number, qm.end_page as number] as const : null;
  const isQuran = !!qRange;
  const [mpages, setMpages] = useState<MPage[] | null>(null);
  const [fontOk, setFontOk] = useState(false);
  useEffect(() => {
    void ensureMushafFont().then(setFontOk); // Kur'an yazı tipi bütün kütüphanedeki Arapça için
    if (!qRange) return;
    void loadMushafPages(qRange[0], qRange[1]).then(setMpages);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kitap bölümleri yüklenirken de kâğıt sayfa görünür (arada koyu ekran yanıp sönmesin)
  const paged = !isDua && (loading ? scope !== "ibadet" : nodes.length > 0 || isQuran);
  const [surahNames, setSurahNames] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!isQuran || !doc.parent_id) return;
    void fetchSurahNames(doc.parent_id).then(setSurahNames);
  }, [isQuran, doc.parent_id]);
  const articleRef = useRef<HTMLElement>(null);
  const [fitSize, setFitSize] = useState<number | null>(null);

  const loc = useLocation();
  const [pp, setPp] = useState(0);
  const [siblings, setSiblings] = useState<string[]>([]);
  const bookPages = useMemo(() => fixedPages(nodes), [nodes]);
  const pc = isQuran ? Math.max(1, mpages?.length ?? 1) : bookPages.length;
  // "Okundu" işaretleri (kitapta belge içi sayfa no, Kur'an'da mushaf sayfası)
  const [cp, setCp] = useCP();
  // numaralı sayfa belgeleri (Tevhidname gibi: her sayfa ayrı belge) → kitap klasörü + sayfa no
  const pageNo = Number(((doc.metadata ?? {}) as Record<string, unknown>).page ?? NaN);
  const numbered = Number.isFinite(pageNo) && !!doc.parent_id;
  const unit = String(((doc.metadata ?? {}) as Record<string, unknown>).unit ?? "sayfa"); // sayfa / bab
  const unitLabel = (n: number) => (unit === "bab" ? `${n}. Bab` : n ? `Sayfa ${n}` : "Giriş");
  const reads = usePageReads(isQuran ? "kuran" : numbered ? doc.parent_id! : doc.id, scope, scope === "kuran" ? null : doc.parent_id);
  const pageKey = (i: number) => (numbered ? pageNo : isQuran ? mpages?.[i]?.display_page ?? i + 1 : i + 1);
  // bu kitabın okuma hedefi olan görevi: "Hedef 1/5" (diğer bölümler + bu bölümdeki işaretler)
  const goalTask = todos.find((t) => t.page_goal && !t.is_completed && (t.page_goal.book_id ? t.page_goal.book_id === bookId : t.page_goal.scope === scope) && (!focusTaskId || t.id === focusTaskId))
    ?? todos.find((t) => t.page_goal && !t.is_completed && (t.page_goal.book_id ? t.page_goal.book_id === bookId : t.page_goal.scope === scope));
  const goalNow = (() => {
    if (!goalTask) return 0;
    const [a, b] = goalPeriod(goalTask);
    const live = numbered && goalTask.page_goal!.per === "pages"
      ? Object.entries(reads.read).filter(([pg, d]) => Number(pg) >= (goalTask.page_goal!.from ?? 0) && Number(pg) <= (goalTask.page_goal!.to ?? 1e9) && (!goalTask.recurrence || goalTask.recurrence.type === "once" || d === ymdToday())).length
      : Object.values(reads.read).filter((d) => d >= a && d <= b).length;
    return goalCount(goalTask, readsCache(), isQuran ? "kuran" : numbered ? doc.parent_id! : doc.id) + live;
  })();
  // okundu deyince ilerleyecek ayraç: görevin ayracı, ayraçtan açıldıysa o, kitapta tek ayraç varsa o
  const stateBm = (loc0.state as { bmId?: string } | null)?.bmId ?? null;
  const pageLabel = (i: number) => (isQuran ? String(mpages?.[i]?.display_page ?? "") : String(i + 1));

  useEffect(() => {
    if (!doc.parent_id) return;
    void fetchSiblings(doc.parent_id).then(setSiblings);
  }, [doc.parent_id]);

  const startedAt = useRef(false);
  useEffect(() => {
    if (!paged || loading || startedAt.current) return;
    if (isQuran && !mpages) return;
    startedAt.current = true;
    const st = loc.state as { atEnd?: boolean } | null;
    if (st?.atEnd) { setPp(pc - 1); return; }
    if (mark) {
      const i = isQuran
        ? (mpages ?? []).findIndex((pg) => pg.rich_content.paragraphs.some((p) => p.runs.some((r) => r.nodeId === mark)))
        : bookPages.findIndex((pg) => pg.some((n) => n.id === mark));
      if (i >= 0) { setPp(i); setTimeout(() => document.getElementById("n" + mark)?.scrollIntoView({ block: "center" }), 80); }
    }
  }, [paged, loading, mpages]); // eslint-disable-line react-hooks/exhaustive-deps

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
    document.querySelector(".content")?.scrollTo(0, 0);
  };
  // okundu: işaretle; görevden açıldıysa bağlı ayracı sonraki sayfanın başına taşı; ayara göre sonraki sayfaya geç
  const markRead = () => {
    const added = reads.toggle(pageKey(pp));
    if (!added) return;
    try { navigator.vibrate?.(15); } catch { /* yok say */ }
    const bmToMove = taskT?.bookmark_id ?? stateBm ?? (bms.length === 1 ? bms[0].id : null);
    if (bmToMove) {
      const nextFirst = isQuran ? mpages?.[pp + 1]?.rich_content.paragraphs.flatMap((p) => p.runs).find((r) => r.nodeId)?.nodeId : bookPages[pp + 1]?.[0]?.id;
      const curLast = isQuran ? mpages?.[pp]?.rich_content.paragraphs.flatMap((p) => p.runs).filter((r) => r.nodeId).pop()?.nodeId : bookPages[pp]?.[bookPages[pp].length - 1]?.id;
      const nid = nextFirst ?? curLast;
      if (nid) {
        const w = where(nid);
        void moveBookmark(bmToMove, { scope, book_id: bookId, document_id: doc.id, node_id: nid, mushaf_page: w.page, quote: textOf(nid), autoTitle: w.label, label: w.label }).then(() => void reloadBms());
      }
    }
    if (cp.readNext && pp < pc - 1) setTimeout(() => turn(1), 180);
  };
  // numaralı belgede okundu: işaretle, bağlı ayracı sonraki sayfaya taşı, ayara göre sonrakine geç
  const markReadDoc = () => {
    const added = reads.toggle(pageNo);
    if (!added) return;
    try { navigator.vibrate?.(15); } catch { /* yok say */ }
    const bmToMove = taskT?.bookmark_id ?? stateBm ?? (bms.length === 1 ? bms[0].id : null);
    if (bmToMove && nextDoc) void moveBookmark(bmToMove, { scope, book_id: bookId, document_id: nextDoc, node_id: null, mushaf_page: null, quote: "", autoTitle: `${parentTitle ?? ""} · ${unitLabel(pageNo + 1)}`, label: unitLabel(pageNo + 1) });
    if (cp.readNext && nextDoc) setTimeout(() => nav(`/kutuphane/${nextDoc}`, { replace: true, state: { taskId: focusTaskId, bmId: stateBm } }), 200);
  };
  const touchX = useRef<number | null>(null);
  useEffect(() => {
    if (!paged) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") turn(1); else if (e.key === "ArrowLeft") turn(-1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  // "Sayfayı ekrana sığdır": yazı boyutunu sayfa tek ekrana sığacak şekilde ayarla
  useLayoutEffect(() => {
    if (!paged || !rs.fit) { setFitSize(null); return; }
    const art = articleRef.current, body = bodyRef.current;
    if (!art || !body) return;
    const sc = document.querySelector(".content");
    const limit = () => window.innerHeight - (focus ? 56 : 80);
    const run = () => {
      let f = rs.size;
      body.style.fontSize = `${f}em`;
      for (let i = 0; i < 6; i++) {
        const r = art.getBoundingClientRect();
        const top = r.top + (sc?.scrollTop ?? 0);
        const over = top + r.height - limit();
        if (Math.abs(over) < 4) break;
        const bh = body.getBoundingClientRect().height || 1;
        f = Math.max(0.3, Math.min(SIZES[SIZES.length - 1], f * ((bh - over) / bh)));
        body.style.fontSize = `${f}em`;
      }
      setFitSize(Math.round(f * 100) / 100);
    };
    run();
    void document.fonts?.ready.then(run);
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  }, [paged, rs.fit, rs.size, pp, mpages, nodes, focus, fontOk]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // önce cihaza yazılır, internet varsa hesaba gönderilir (yoksa bağlantı gelince)
  const saveCount = useCallback((nid: string, target: number, value: number) => { putCount(nid, target, value); }, []);

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
      lastSel.current = { nid: el.dataset.nid, text, at: Date.now() };
      // menü seçimin ALTINDA: telefonun kendi menüsü (Kopyala, Çevir) üstte çıktığı için çakışmasın
      const below = rect.bottom + 14;
      const y = below + 60 < window.innerHeight - 70 ? below : Math.max(rect.top - 64, 60);
      setSel({ x: Math.min(Math.max(rect.left + rect.width / 2, 110), window.innerWidth - 110), y, nid: el.dataset.nid, text });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  // bir yerin adı: "1. Söz · Sayfa 3" / Kur'an: "Nebe 12. âyet · Sayfa 582"
  const where = (nid: string): { label: string; page: number | null } => {
    if (isQuran) {
      for (const pg of mpages ?? []) for (const p of pg.rich_content.paragraphs) for (const r of p.runs) {
        if (r.nodeId === nid) return { page: pg.display_page, label: `${surahNames[r.surahNo ?? 0] ?? doc.title} ${r.ayahNo ?? ""}. âyet · Sayfa ${pg.display_page}` };
      }
      return { page: null, label: doc.title };
    }
    if (paged) { const i = bookPages.findIndex((pg) => pg.some((n) => n.id === nid)); return { page: null, label: `${doc.title} · Sayfa ${(i >= 0 ? i : pp) + 1}` }; }
    return { page: null, label: doc.title };
  };
  // ekranda görünen ilk satır (seçim yapmadan "bu sayfa" için)
  const topNid = (): string | null => {
    const els = bodyRef.current?.querySelectorAll<HTMLElement>("[data-nid]") ?? [];
    const head = (document.querySelector(".rhead")?.getBoundingClientRect().bottom ?? 0) + 4;
    for (const el of Array.from(els)) if (el.getBoundingClientRect().bottom > head && el.dataset.nid) return el.dataset.nid;
    return els[0]?.dataset.nid ?? nodes[0]?.id ?? null;
  };
  const textOf = (nid: string | null) => {
    if (!nid) return "";
    const n = nodes.find((x) => x.id === nid);
    const t = n?.text_content ?? document.querySelector(`[data-nid="${nid}"]`)?.textContent ?? "";
    return t.replace(/\s+/g, " ").trim().slice(0, 160);
  };
  const bookTitle = scope === "kuran" ? "Kur'ân-ı Kerîm" : parentTitle ?? doc.title;
  const posOf = (nid: string | null, quote: string): Pos => {
    const w = nid ? where(nid) : { label: doc.title, page: null };
    return { doc_id: doc.id, node_id: nid, book_id: bookId, scope, label: numbered ? `${bookTitle} · ${unitLabel(pageNo)}` : w.label, quote: quote.slice(0, 300), book_title: bookTitle, mushaf_page: w.page, page_no: numbered ? pageNo : undefined, unit: numbered ? unit : undefined };
  };
  const markAt = (nid: string, quote: string) => {
    const w = where(nid);
    setBmDraft({ scope, book_id: bookId, document_id: doc.id, node_id: nid, mushaf_page: w.page, quote, autoTitle: w.label, label: w.label, book_title: bookTitle });
  };
  // seçili yer (son 30 sn içinde seçildiyse) ya da ekranda görünen ilk satır
  const hereNid = (): { nid: string; text: string; picked: boolean } | null => {
    const ls = lastSel.current;
    if (ls && Date.now() - ls.at < 30000) return { nid: ls.nid, text: ls.text, picked: true };
    const nid = topNid();
    return nid ? { nid, text: textOf(nid), picked: false } : null;
  };
  const openTask = (nid: string, text: string, mode: "ayrac" | "sabit", bookmarkId?: string | null) => {
    setPlace({ pos: posOf(nid, text), mode, bookmarks: bms, bookmarkId: bookmarkId ?? taskT?.bookmark_id ?? null });
  };
  const saveMark = () => {
    if (!sel) return;
    markAt(sel.nid, sel.text);
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };
  const addNote = async (text: string) => {
    if (!ask) return;
    const { data, error } = await supabase.from("reader_notes").insert({ document_id: doc.id, node_id: ask.nid, quote: ask.text.slice(0, 500), note: text }).select("id,node_id,note,quote").single();
    if (error) flash("Not kaydedilemedi: " + error.message);
    else { setNotes((s) => [...s, data as Note]); flash("Not eklendi"); }
  };
  const saveNoteEdit = async (n: Note, text: string) => {
    const { error } = await supabase.from("reader_notes").update({ note: text }).eq("id", n.id);
    if (error) flash("Güncellenemedi: " + error.message); else { setNotes((s) => s.map((x) => (x.id === n.id ? { ...x, note: text } : x))); flash("Not güncellendi"); }
  };
  const delNote = async (n: Note) => {
    const { error } = await supabase.from("reader_notes").delete().eq("id", n.id);
    if (error) flash("Silinemedi: " + error.message); else { setNotes((s) => s.filter((x) => x.id !== n.id)); flash("Not silindi"); }
  };
  // başlıktaki ⊞ menüsü: seçim varsa seçilen yer, yoksa ekranda görünen yer
  const pageAct = (a: "mark" | "task" | "not") => {
    setPmenu(false);
    const h = hereNid();
    if (!h) return;
    lastSel.current = null;
    if (a === "mark") markAt(h.nid, h.text);
    else if (a === "not") setAsk({ nid: h.nid, text: h.picked ? h.text : "" });
    else openTask(h.nid, h.text, h.picked ? "sabit" : "ayrac");
  };
  // görevden açıldıysa: o görevi yükle (alt çubuk için)
  useEffect(() => {
    if (!focusTaskId) return;
    void supabase.from("todos").select("id,title,bookmark_id,per_day,progress,recurrence,is_completed").eq("id", focusTaskId).maybeSingle().then(({ data }) => setTaskT(data as TodoT | null));
  }, [focusTaskId]);

  const setR = (s: RSettings) => { setRs(s); saveRS(scope, s); };
  const sysDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const defTheme = "dark";
  const th = rs.theme === "default" || rs.theme === "paper" ? defTheme : rs.theme;
  const rt = th === "auto" ? (sysDark ? "dark" : "light") : th;

  // okurken alt çubuk ve çevrimdışı şeridi gizlenir (yer açılsın); çevrimdışı bilgisi başlıkta görünür
  useEffect(() => {
    document.body.classList.add("reading");
    return () => document.body.classList.remove("reading");
  }, []);
  const offline = useOffline();
  const offTag = offline ? <em className="offtag"> · çevrimdışı</em> : null;

  useEffect(() => {
    document.body.classList.toggle("focus", focus);
    try {
      if (focus && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
      if (!focus && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    } catch { /* desteklenmiyorsa yalnız arayüz gizlenir */ }
    return () => document.body.classList.remove("focus");
  }, [focus]);
  // Not: tarayıcı kendi tam ekranından çıksa (ör. iPad'de kaydırınca) okuyucu tam sayfada kalır;
  // çıkış yalnız sağ üstteki ✕ ile.

  if (showSettings) return <ReaderSettings title={doc.title} defTheme={defTheme} rs={rs} onChange={setR} onBack={() => setShowSettings(false)} onApplyAll={() => { applyAll(rs); flash("Tüm bölümlere uygulandı"); }} onReset={() => { resetRS(scope); setRs(loadRS(scope)); }} onGeneral={() => nav("/ayarlar")} counters={scope === "ibadet"} />;

  const notesOf = (nid: string) => notes.filter((n) => n.node_id === nid);
  const span = (n: Node, text: ReactNode) => (
    <span key={n.id} id={"n" + n.id} data-nid={n.id} className={isMarked(n.id) ? "mk" : notesOf(n.id).length ? "ul" : undefined}>{text} </span>
  );
  const NoteBoxes = ({ nid }: { nid: string }) => <>{notesOf(nid).map((x) => (<div key={x.id} className="ubox" onClick={() => setEditNote(x)} title="Düzenle / sil">Not: {x.note}</div>))}</>;

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
              {rs.latin && <span className={isMarked(n.id) ? "mk" : undefined}>{n.text_content}</span>}
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
    if ((b.t === "h2" || b.t === "h3") && isAr(n.text_content ?? n.title)) return rs.ar ? <div key={i} className="ar" id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.title}</div> : null;
    if (b.t === "h2") return <h2 key={i} id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.title}</h2>;
    if (b.t === "h3") return <h3 key={i} id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.title}</h3>;
    if (b.t === "verse") {
      const no = String(n.title ?? "").split(":")[1];
      return (
        <div key={i} id={"n" + n.id} data-nid={n.id} className={isMarked(n.id) ? "mk" : undefined}>
          {rs.ar && n.secondary_text && <div className="ar">{n.secondary_text} <span className="vno">﴿{no}﴾</span></div>}
          {rs.tr && (n.translation || n.text_content) && <p className="trn">{no}. {n.translation ?? n.text_content}</p>}
          <NoteBoxes nid={n.id} />
        </div>
      );
    }
    if (b.t === "custom") return <p key={i} id={"n" + n.id} data-nid={n.id}><b>{n.title}</b>{n.text_content ? " — " + n.text_content : ""}</p>;
    const arabic = md(n).lang === "ar" || (n.secondary_text && !n.text_content) || isAr(n.text_content);
    return (
      <div key={i}>
        {arabic ? (rs.ar && <div className="ar" id={"n" + n.id} data-nid={n.id}>{n.text_content ?? n.secondary_text}</div>) : (
          <p id={"n" + n.id} data-nid={n.id} className={isMarked(n.id) ? "mk" : notesOf(n.id).length ? "ul" : undefined}>
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
          <button className="g" onClick={saveMark} aria-label="Kaldığım yer"><Icon name="bookmark" size={20} /><span>Kaldığım yer</span></button>
          <button onClick={() => { setAsk({ nid: sel.nid, text: sel.text }); lastSel.current = null; setSel(null); }} aria-label="Not"><Icon name="pencil" size={20} /><span>Not</span></button>
          <button className="a" onClick={() => { openTask(sel.nid, sel.text, "sabit"); lastSel.current = null; window.getSelection()?.removeAllRanges(); setSel(null); }} aria-label="Görev"><Icon name="plusbox" size={20} /><span>Görev</span></button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {bmDraft && (
        <BookmarkDialog
          autoTitle={bookTitle}
          where={bmDraft.label ?? bmDraft.autoTitle}
          list={bms}
          onClose={() => setBmDraft(null)}
          onNew={async (name, alsoTask) => {
            const d = bmDraft; setBmDraft(null);
            const { data, error } = await addBookmark(d, name);
            if (error) { flash("Kaydedilemedi: " + error.message); return; }
            setMark(d.node_id); flash("Ayraç kaydedildi"); void reloadBms();
            if (alsoTask && d.node_id) { const nb = data as Bookmark; setPlace({ pos: posOf(d.node_id, d.quote), mode: "ayrac", bookmarks: [nb, ...bms], bookmarkId: nb.id }); }
          }}
          onUpdate={async (bm) => { const d = bmDraft; setBmDraft(null); const { error } = await moveBookmark(bm.id, d); if (error) flash("Güncellenemedi: " + error.message); else { flash(`“${bm.title}” güncellendi`); void reloadBms(); } }}
          onDelete={async (bm) => { await deleteBookmark(bm.id); void reloadBms(); }}
        />
      )}
      {ask && <AskDialog title={ask.text ? "Not ekle" : "Bu sayfaya not ekle"} placeholder="Notun" onClose={() => setAsk(null)} onSubmit={(v) => void addNote(v)} />}
      {editNote && <AskDialog title="Notu düzenle" initial={editNote.note} onClose={() => setEditNote(null)} onSubmit={(v) => void saveNoteEdit(editNote, v)} onDelete={() => { if (window.confirm("Not silinsin mi?")) { void delNote(editNote); setEditNote(null); } }} />}
      {place && (
        <TodoSheet place={place} lists={lists} groups={groups} defaultListId={null}
          onClose={() => setPlace(null)} onSaved={(m) => { setPlace(null); flash(m ?? "Görev eklendi"); void reloadBms(); }} />
      )}
      {pmenu && (
        <>
          <div className="scrim show" style={{ zIndex: 40, background: "transparent" }} onClick={() => setPmenu(false)} />
          <div className="pmenu">
            <div className="pmhint">{lastSel.current && Date.now() - lastSel.current.at < 30000 ? `Seçtiğin yer: “${lastSel.current.text.slice(0, 40)}”` : "Ekranda görünen yer için · bir kelime/cümle seçersen o yer için"}</div>
            <button onClick={() => pageAct("mark")}><Icon name="bookmark" size={20} /> Kaldığım yeri kaydet (ayraç)</button>
            <button onClick={() => pageAct("task")}><Icon name="plusbox" size={20} /> Görev ekle</button>
            <button onClick={() => pageAct("not")}><Icon name="pencil" size={20} /> Not ekle</button>
          </div>
        </>
      )}

    </>
  );

  if (paged) {
    const pageNodes = isQuran ? [] : (bookPages[Math.min(pp, pc - 1)] ?? []);
    const mp = isQuran ? mpages?.[Math.min(pp, pc - 1)] : undefined;
    const label = pageLabel(Math.min(pp, pc - 1));
    const surahLabel = mp?.surah_numbers?.length ? mp.surah_numbers.map((n) => surahNames[n]).filter(Boolean).map((t) => t + " Suresi").join(" · ") : doc.title;
    const quranSub = mp ? `${mp.display_page} / Cüz ${mp.juz ?? ""}` : "";
    const size = rs.fit && fitSize ? fitSize : rs.size;
    return (
      <div className="rpage paged" data-rt={rt}>
        {rs.light < 1 && <div className="dim" style={{ opacity: Math.min(0.7, 1 - rs.light) }} />}
        {focus && <button className="fsexit" onClick={() => setFocus(false)} aria-label="Tam sayfadan çık"><Icon name="close" size={18} /></button>}
        {!focus && <header className="rhead">
          <button className="iconbtn" onClick={() => nav(-1)} aria-label="Geri"><Icon name="back" size={24} /></button>
          <div className="rtitle">{isQuran ? surahLabel : doc.title}<span>{isQuran ? quranSub : `${parentTitle ? parentTitle + " · " : ""}Sayfa ${label}`}{offTag}</span></div>
          <button className="iconbtn" onClick={() => setFocus(!focus)} aria-label="Tam ekran"><Icon name="expand" size={22} /></button>
          <button className="iconbtn acc" onClick={() => setPmenu(true)} aria-label="Ayraç, görev, not"><Icon name="plusbox" size={24} /></button>
          <button className="iconbtn" onClick={() => setShowSettings(true)} aria-label="Sayfa ayarları"><Icon name="sliders" size={22} /></button>
        </header>}
        {!focus && <div className="rprog"><i style={{ width: `${((pp + 1) / pc) * 100}%` }} /></div>}
        <div
          className="bookwrap"
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const x0 = touchX.current;
            touchX.current = null;
            if (x0 === null || window.getSelection()?.toString()) return;
            const dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 60) turn(isQuran ? (dx > 0 ? 1 : -1) : (dx < 0 ? 1 : -1));
          }}
        >
          <article className={"bookpage" + (rs.fit ? " fit" : "")} data-pc={rs.paper} ref={articleRef}>
            {isQuran ? (
              <div className="bphead q3">
                <span>{surahLabel}</span>
                <span className="mid">{mp?.juz ? `${mp.juz}. Cüz` : ""}</span>
                <span>{label}</span>
              </div>
            ) : (
              <div className="bphead">
                <span>{parentTitle ?? doc.title}</span>
                <span>{label}</span>
              </div>
            )}
            {isQuran ? (
              <div className={"bpbody mushaf" + (fontOk ? " exact" : "")} dir="rtl" lang="ar" ref={bodyRef} style={{ fontSize: `${size}em` }}>
                {!mp && <p className="muted" style={{ direction: "ltr" }}>Yükleniyor…</p>}
                {mp?.rich_content.paragraphs.map((p, pi) => (
                  <p key={pi} className={"mp mp-" + p.style}>
                    {p.runs.map((r, ri) => (
                      <span key={ri} id={r.nodeId && ri === p.runs.findIndex((x) => x.nodeId === r.nodeId) ? "n" + r.nodeId : undefined} data-nid={r.nodeId} className={[r.runStyle ? "mr-" + r.runStyle : "", isMarked(r.nodeId) ? "mk" : ""].join(" ").trim() || undefined}>{r.text}</span>
                    ))}
                  </p>
                ))}
              </div>
            ) : (
              <div className="bpbody reader2" lang="tr" ref={bodyRef} style={{ fontSize: `${size}em` }}>
                {pp === 0 && <h1 className="bptitle">{doc.title}</h1>}
                {toBlocks(pageNodes).map(renderBlock)}
              </div>
            )}
            <div className="bpfoot">{label}{reads.read[pageKey(Math.min(pp, pc - 1))] ? <span className="readmark"> ✓</span> : null}</div>
          </article>
        </div>
        <div style={{ height: 64 }} />
        <div className="pnav mini">
          <button disabled={pp === 0 && !prevDoc} onClick={() => turn(-1)} aria-label={pp === 0 ? "Önceki bölüm" : "Önceki sayfa"} title={pp === 0 ? "Önceki bölüm" : "Önceki sayfa"}><Icon name="back" size={22} /></button>
          <span className="pmid">
          <button className={"readbtn" + (reads.read[pageKey(pp)] ? " on" : "")} onClick={() => markRead()} aria-label={reads.read[pageKey(pp)] ? "Okundu işaretini kaldır" : "Bu sayfayı okudum"}>
            {reads.read[pageKey(pp)] ? "✓" : "○"} {pp + 1} / {pc}
          </button>
          {goalTask && <span className={"goalchip" + (goalNow >= goalTask.page_goal!.n ? " done" : "")} title={goalTask.title}>{goalLabel(goalTask.page_goal!)} {goalNow}/{goalTask.page_goal!.n}</span>}
          </span>
          <button disabled={pp >= pc - 1 && !nextDoc} onClick={() => turn(1)} aria-label={pp >= pc - 1 ? "Sonraki bölüm" : "Sonraki sayfa"} title={pp >= pc - 1 ? "Sonraki bölüm" : "Sonraki sayfa"}><Icon name="chevron" size={22} /></button>
        </div>
        {overlays}
      </div>
    );
  }

  /* ── Tesbihat / dua: eski Lumen'deki tek parça kâğıt sayfa, blok sayaçları, yüzen sayaç ── */
  const counters = nodes.filter((n) => n.kind === "phrase" && Number(md(n).target ?? 0) > 0);
  const tgt = (n: Node) => Number(md(n).target ?? 0);
  const actNode = cumulative
    ? counters.find((n) => n.id === active) ?? counters.find((n) => (counts[n.id] ?? 0) < tgt(n)) ?? counters[counters.length - 1]
    : counters.find((n) => n.id === active && (counts[n.id] ?? 0) < tgt(n)) ?? counters.find((n) => (counts[n.id] ?? 0) < tgt(n));
  const shown = actNode ?? counters[counters.length - 1];
  const shownT = shown ? tgt(shown) : 0;
  const shownC = shown ? counts[shown.id] ?? 0 : 0;
  const setCount = (n: Node, v: number) => {
    const t = tgt(n);
    const val = Math.max(0, Math.min(t, v)); // hedefe gelince durur
    setCounts((s) => ({ ...s, [n.id]: val }));
    void saveCount(n.id, t, val);
    return val;
  };
  const inc = () => {
    if (!actNode || (counts[actNode.id] ?? 0) >= tgt(actNode)) return; // hedef doldu: saymaz
    const v = setCount(actNode, (counts[actNode.id] ?? 0) + 1);
    try { navigator.vibrate?.(v === tgt(actNode) ? [30, 60, 30] : 12); } catch { /* yok say */ }
    if (v >= tgt(actNode) && !cumulative) setActive(null);
  };
  const dec = () => { if (shown) setCount(shown, (counts[shown.id] ?? 0) - 1); };
  const resetAll = () => {
    if (!counters.length || !window.confirm("Bu metindeki bütün sayaçlar sıfırlansın mı?")) return;
    for (const n of counters) setCount(n, 0);
    setActive(null);
  };
  return (
    <div className="rpage" data-rt={rt}>
      {rs.light < 1 && <div className="dim" style={{ opacity: Math.min(0.7, 1 - rs.light) }} />}
      {focus && <button className="fsexit" onClick={() => setFocus(false)} aria-label="Tam sayfadan çık"><Icon name="close" size={18} /></button>}
      {!focus && <header className="rhead">
        <button className="iconbtn" onClick={() => nav(-1)} aria-label="Geri"><Icon name="back" size={24} /></button>
        <div className="rtitle">{doc.title}{parentTitle || offTag ? <span>{parentTitle}{offTag}</span> : null}</div>
        {counters.length > 0 && <button className="iconbtn" onClick={resetAll} aria-label="Sayaçları sıfırla"><Icon name="reset" size={22} /></button>}
        {counters.length > 0 && <button className="iconbtn" onClick={() => setFsT(true)} aria-label="Tam ekran tesbih"><Icon name="expand" size={22} /></button>}
        <button className="iconbtn acc" onClick={() => setPmenu(true)} aria-label="Ayraç, görev, not"><Icon name="plusbox" size={24} /></button>
        <button className="iconbtn" onClick={() => setShowSettings(true)} aria-label="Sayfa ayarları"><Icon name="sliders" size={22} /></button>
      </header>}
      <div className="bookwrap">
        <section className="duapage" data-pc={rs.paper}>
          <header className="duahead"><strong>{doc.title}</strong><span>{parentTitle ?? "Tesbihat"}</span></header>
          {loading && <p className="muted">Yükleniyor…</p>}
          <div className="duabody" ref={bodyRef} style={{ fontSize: `${rs.size}em`, ["--cs" as string]: rs.pill }}>
            {nodes.map((n) => {
              const m = md(n);
              const note = typeof m.note === "string" ? m.note : "";
              const instr = m.instruction === true || n.kind === "note";
              const t = tgt(n);
              const c = counts[n.id] ?? 0;
              const isAct = !!actNode && actNode.id === n.id;
              return (
                <article key={n.id} id={"n" + n.id} data-nid={n.id} className={"dblock" + (note ? " dsec" : "") + (instr ? " dinstr" : "") + (isAct ? " act" : "")}>
                  {note && <div className="dnote">{note}</div>}
                  {n.title && n.kind !== "phrase" && <h3>{n.title}</h3>}
                  <div className="dcontent">
                    <div className="dtext">
                      {rs.ar && n.secondary_text && <div className="dar" dir="rtl">{n.secondary_text}</div>}
                      {(rs.latin || instr) && n.text_content && <div className={(instr ? "dins" : "dlat") + (isMarked(n.id) ? " mk" : "")}>{n.text_content}{m.end_symbol === "dua" && <span className="endsym" title="Dua edilir"> 🤲</span>}{m.end_symbol === "face" && <FaceHands />}</div>}
                      {rs.tr && n.translation && <div className="dtr">{n.translation}</div>}
                      <NoteBoxes nid={n.id} />
                    </div>
                    {t > 0 && (
                      <div className="dcnt">
                        <button className={"pill" + (c >= t ? " done" : isAct ? " act" : "")} onClick={() => setActive(n.id)} title="Bu sayacı seç">{t}/{c}</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {!loading && nodes.length === 0 && <p className="muted">Bu metnin içeriği henüz yok.</p>}
          </div>
          <footer className="duafoot">{doc.title}</footer>
        </section>
      </div>
      <nav className="dpager">
        <button disabled={!prevDoc} onClick={() => prevDoc && nav(`/kutuphane/${prevDoc}`, { replace: true })}>‹ Önceki</button>
        {numbered && (
          <button className={"dread" + (reads.read[pageNo] ? " on" : "")} onClick={() => markReadDoc()} aria-label="Bu sayfayı okudum">
            {reads.read[pageNo] ? "✓" : "○"} {unit === "bab" ? `${pageNo}. Bab` : pageNo || "Giriş"}
          </button>
        )}
        <button disabled={!nextDoc} onClick={() => nextDoc && nav(`/kutuphane/${nextDoc}`, { replace: true })}>Sonraki ›</button>
      </nav>
      {numbered && goalTask && <div className="dgoal"><span className={"goalchip" + (goalNow >= goalTask.page_goal!.n ? " done" : "")}>{goalLabel(goalTask.page_goal!)} {goalNow}/{goalTask.page_goal!.n}</span></div>}
      <div style={{ height: 90 }} />
      {counters.length > 0 && shown && <FloatCounter count={shownC} target={shownT} onInc={inc} onReset={() => { if (shown) setCount(shown, 0); }} posKey="dua" scale={rs.cnt} />}
      {fsT && shown && <FullTasbih title={(shown.text_content ?? doc.title).slice(0, 80)} count={shownC} target={shownT} onInc={inc} onDec={dec} onClose={() => setFsT(false)} />}
      {overlays}
    </div>
  );
}

/* Eller yüze sürülür işareti (hazır emoji olmadığı için çizildi): yüz ve iki yanından gelen eller */
function FaceHands() {
  return (
    <span className="endsym" title="Eller yüze sürülür">
      {" "}
      <svg width="1.25em" height="1.1em" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Eller yüze sürülür" style={{ verticalAlign: "-0.18em" }}>
        <ellipse cx="14" cy="11" rx="5.2" ry="6.6" />
        <path d="M2.5 21c1.2-4.2 2.6-7.8 5.6-9.6M4.6 14.2c.9-.9 2-1.5 3.3-1.6" />
        <path d="M25.5 21c-1.2-4.2-2.6-7.8-5.6-9.6M23.4 14.2c-.9-.9-2-1.5-3.3-1.6" />
        <path d="M12 9.6h.01M16 9.6h.01M12.3 13.6c1 .8 2.4.8 3.4 0" />
      </svg>
    </span>
  );
}

/* Sayfa ayarları (tasarım: Sayac) — yalnız bu sayfa için geçerli */
/* Yazı boyutu kademeleri: %80 → %720 (eski en büyük %180'in 4 katı) */
export const SIZES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.65, 1.8, 2, 2.25, 2.5, 2.75, 3, 3.4, 3.8, 4.2, 4.7, 5.2, 5.8, 6.5, 7.2];
/* Sayaç boyutu kademeleri (yüzen sayaç + satırdaki elips sayaçlar) */
const CNT = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.3, 2.6, 3, 3.5, 4];
const cntIdx = (v: number) => CNT.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(CNT[best] - v) ? i : best), 0);
const sizeIdx = (v: number) => SIZES.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(SIZES[best] - v) ? i : best), 0);

export function ReaderSettings({ title, defTheme, rs, onChange, onBack, onApplyAll, onReset, onGeneral, counters }: {
  title: string; defTheme: string; rs: RSettings; onChange: (s: RSettings) => void; onBack: () => void; onApplyAll: () => void; onReset: () => void; onGeneral: () => void; counters?: boolean;
}) {
  const [cp, setCp] = useCP();
  const Tog = ({ k, label }: { k: "ar" | "latin" | "tr" | "fit"; label: string }) => (
    <div className="srow"><span>{label}</span><button className={"tgl" + (rs[k] ? " on" : "")} onClick={() => onChange({ ...rs, [k]: !rs[k] })} aria-pressed={rs[k]}><i /></button></div>
  );
  const CntRow = ({ label, k }: { label: string; k: "cnt" | "pill" }) => (
    <div className="srow col"><span>{label}</span>
      <div className="sl">
        <button className="szb" onClick={() => onChange({ ...rs, [k]: CNT[Math.max(0, cntIdx(rs[k]) - 1)] })} aria-label="Küçült">−</button>
        <input type="range" min={0} max={CNT.length - 1} step={1} value={cntIdx(rs[k])} onChange={(e) => onChange({ ...rs, [k]: CNT[Number(e.target.value)] })} />
        <button className="szb" onClick={() => onChange({ ...rs, [k]: CNT[Math.min(CNT.length - 1, cntIdx(rs[k]) + 1)] })} aria-label="Büyüt">+</button>
      </div>
      <div className="small muted" style={{ textAlign: "center", fontWeight: 400 }}>%{Math.round((rs[k] / CNT[CNT.length - 1]) * 100)}</div>
    </div>
  );
  return (
    <>
      <header className="phead">
        <button className="iconbtn" onClick={onBack} aria-label="Geri"><Icon name="back" size={26} /></button>
        <div className="ptitle"><h1>Ayarlar</h1><p>{title}</p></div>
      </header>
      <div className="infoline">Bu bölümün tüm kitapları için geçerli (ör. HE Eserleri). Diğer bölümler kendi ayarını tutar.</div>
      <div style={{ padding: "0 16px" }}>
        <div className="srow col"><span>Gece modu</span>
          <div className="seg3">
            {(["dark", "light", "auto"] as const).map((t) => (<button key={t} className={rs.theme === t || ((rs.theme === "default" || rs.theme === "paper") && t === defTheme) ? "on" : ""} onClick={() => onChange({ ...rs, theme: t })}>{t === "dark" ? "Koyu" : t === "light" ? "Aydınlık" : "Telefonla aynı"}</button>))}
          </div>
        </div>
        <div className="srow col"><span>Sayfa rengi</span>
          <div className="swatches">
            {([["cream", "Kâğıt"], ["sepia", "Sepya"], ["white", "Beyaz"], ["dark", "Koyu"]] as const).map(([k, l]) => (
              <button key={k} className={"sw" + (rs.paper === k ? " on" : "")} data-pc={k} onClick={() => onChange({ ...rs, paper: k })}><i />{l}</button>
            ))}
          </div>
        </div>
        <Tog k="fit" label="Sayfayı ekrana sığdır" />
        <div className="srow"><span>“Okundu” deyince sonraki sayfaya geç</span><button className={"tgl" + (cp.readNext ? " on" : "")} onClick={() => setCp({ ...cp, readNext: !cp.readNext })} aria-pressed={cp.readNext}><i /></button></div>
        <Tog k="ar" label="Arapça" />
        <Tog k="latin" label="Latin okunuş" />
        <Tog k="tr" label="Türkçe anlam" />
        <div className="srow col"><span>Yazı boyutu</span>
          <div className="sl">
            <button className="szb" onClick={() => onChange({ ...rs, size: SIZES[Math.max(0, sizeIdx(rs.size) - 1)] })} aria-label="Küçült">A−</button>
            <input type="range" min={0} max={SIZES.length - 1} step={1} value={sizeIdx(rs.size)} onChange={(e) => onChange({ ...rs, size: SIZES[Number(e.target.value)] })} />
            <button className="szb" onClick={() => onChange({ ...rs, size: SIZES[Math.min(SIZES.length - 1, sizeIdx(rs.size) + 1)] })} aria-label="Büyüt">A+</button>
          </div>
          <div className="small muted" style={{ textAlign: "center", fontWeight: 400 }}>%{Math.round((rs.size / SIZES[SIZES.length - 1]) * 100)}</div>
        </div>
        {counters && (
          <>
            <CntRow label="Yuvarlak sayaç boyutu" k="cnt" />
            <CntRow label="Satır sayaçları boyutu" k="pill" />
          </>
        )}
        <div className="srow col"><span>Aydınlatma</span>
          <div className="sl"><small>☼</small><input type="range" min={0.4} max={1} step={0.05} value={rs.light} onChange={(e) => onChange({ ...rs, light: Number(e.target.value) })} /><b>☀</b></div>
        </div>
        <button className="secondary" style={{ marginTop: 24 }} onClick={onApplyAll}>⇄ Tüm bölümlere uygula</button>
        <div className="seg" style={{ marginTop: 10 }}>
          <button onClick={onReset}>↺ Sıfırla</button>
          <button onClick={onGeneral}>Genel ayarlar</button>
        </div>
      </div>
    </>
  );
}
