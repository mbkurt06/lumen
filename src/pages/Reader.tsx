import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AskDialog } from "../components/Dialog";
import { supabase } from "../lib/supabase";
import type { Item } from "../lib/library";
import { ensureBookPages, fixedPages } from "../lib/bookPages";
import { goalLabel, goalMode, goalPages, inScope, skippedPages, needsBookPages, nextDay, nextGoalPage, payCtx, periodUnit, readsCache, scopeSize, seqCtx, taskState, useTodos, ymd as ymdToday, type TaskPlace, type Todo as TodoT } from "../lib/todo";
import { rangeStartDoc } from "../lib/taskNav";
import { useCP, buzz } from "../lib/counterPrefs";
import { usePageReads } from "../lib/pageReads";
import { keyAction, loadRSU, pullRS, resetUnit, saveRSU, unitKey, unitOverrides, type KeyAction, type RSettings, type Scope } from "../lib/readerSettings";
import { TodoSheet, type PlacePrefill, type Pos } from "./TodoSheet";
import { BookmarkDialog } from "../components/BookmarkDialog";
import { FloatCounter, FullTasbih } from "../components/FloatCounter";
import { useOffline } from "../lib/online";
import { pickNewer, putCount, todayOnly } from "../lib/countStore";
import { addBookmark, deleteBookmark, listBookmarks, moveBookmark, type Bookmark, type BookmarkDraft } from "../lib/bookmarks";
import { ensureMushafFont, loadMushafPages, type MPage } from "../lib/mushaf";
import { fetchDocNodes, fetchSiblings, fetchSurahNames } from "../lib/loaders";
import { refreshBook } from "../lib/offlineDownload";
import { useCevsenMode } from "../lib/cevsenPref";
import { vibrate } from "../lib/haptic";

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
/* Risale'deki Arapça (âyet, dua) Kur'an'daki yazı tipiyle: fontta olmayan işaretler karşılığına çevrilir
   (esre-i memdûde U+0656 → U+06EA, küçük tı U+0615 → U+06DC). Farsça/Osmanlıca harf içeren parça Kur'an fontunda yok, Nesih kalır. */
const AR_RUN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF](?:[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u200c\u200d\s]*[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF])?/g;
const NON_MUSHAF = /[\u067E\u0686\u0698\u06A4\u06A9\u06AF\u06C0\u06CC\u0671\u0617\u06DE\u06E9\u06FD\u08DE]/;
const arFix = (t: string) => t.replace(/\u0656/g, "\u06EA").replace(/\u0615/g, "\u06DC");
const arClass = (t: string | null | undefined) => (t && NON_MUSHAF.test(t) ? "ar arp" : "ar");
/** Türkçe paragraf içindeki Arapça parçalar Kur'an yazı tipiyle */
function withArabic(text: string | null | undefined): ReactNode {
  if (!text || !AR_RUN.test(text)) return text;
  AR_RUN.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(AR_RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<span key={k++} className={NON_MUSHAF.test(m[0]) ? "ari arp" : "ari"} lang="ar" dir="rtl">{arFix(m[0])}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
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
  const [markWord, setMarkWord] = useState<number | null>(() => (loc0.state as { word?: number } | null)?.word ?? null); // görevde kalınan kelime
  const [hereAsk, setHereAsk] = useState<null | { nid: string; word: number; wtext: string; quote: string }>(null); // "Burada kaldım": hangi göreve / ayraca
  const [counts, setCounts] = useState<Record<string, number>>({});
  const zikirSeen = useRef<Record<string, number>>({}); // sayaçların bugünkü değeri (zikir görevi geride kaldıysa yetişsin)
  const [cntTick, setCntTick] = useState(0); // sayaçlar hesaptan yüklenince artar (zikir görevi kendi sayısını üstüne yazar)
  const [active, setActive] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  // ayarlar kitaba / sayfaya özgü: Kur'an tek; Cevşen, Tevhidname, Esmâ dizinin tamamı; diğer dua ve tesbihatlar tek tek; kitaplarda kitap
  const dm = (doc.metadata ?? {}) as Record<string, unknown>;
  const rsUnit = unitKey(scope, scope === "kuran" ? "kuran"
    : doc.parent_id && (Number.isFinite(Number(dm.page ?? NaN)) && dm.page != null || String(dm.legacy_id ?? "").startsWith("esma-") || parentTitle === "Cevşen-i Kebîr" || parentTitle === "Tevhidname") ? doc.parent_id
    : scope === "ibadet" ? doc.id : doc.parent_id ?? doc.id);
  const [rs, setRs] = useState<RSettings>(() => loadRSU(scope, rsUnit));
  useEffect(() => { void pullRS(scope).then((r) => { if (r) setRs(loadRSU(scope, rsUnit)); }); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; nid: string; text: string } | null>(null);
  const [ask, setAsk] = useState<null | { nid: string; text: string }>(null);
  const [place, setPlace] = useState<PlacePrefill | null>(null); // kitaptan görev (standart form)
  const lastSel = useRef<{ nid: string; text: string; at: number; word?: number; wtext?: string } | null>(null); // ⊞'ye basınca seçim kaybolsa da kullanılır
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
  const markedIds = useMemo(() => {
    const m = new Set(bms.filter((b) => b.node_id && (scope === "kuran" || b.document_id === doc.id)).map((b) => b.node_id as string));
    if (mark && (loc0.state as { taskId?: string } | null)?.taskId) m.add(mark); // görevin kaldığı yer
    return m;
  }, [bms, scope, doc.id, mark]); // eslint-disable-line react-hooks/exhaustive-deps
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
      for (const id of counterIds) { const r = pickNewer(id, srv.get(id) ?? null); c[id] = cumulative ? r.v : todayOnly(r); zikirSeen.current[id] = todayOnly(r); }
      setCounts(c);
      setCntTick((x) => x + 1);
      setNotes((nq.data ?? []) as Note[]);
    })();
    return () => { off = true; };
  }, [doc.id]);

  const isDua = useMemo(() => nodes.some((n) => n.kind === "phrase"), [nodes]);
  const [cvMode] = useCevsenMode();
  const isCevsen = parentTitle === "Cevşen-i Kebîr" && cvMode === "num" && !dm.dua; // Cevşen duası numarasız
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
  const readDocKey = isQuran ? "kuran" : numbered ? doc.parent_id! : doc.id;
  const stateBm = (loc0.state as { bmId?: string } | null)?.bmId ?? null;
  // Görevden açıldıysa okundu işaretleri görevin bağlamına yazılır (tur: todo:<id>#<tur>, pay: todo:<id>@<dönem>).
  // Ayraçtan açıldıysa ayracın bağlamına; normal kütüphane girişinde kalıcı değildir.
  const goalTask = focusTaskId ? todos.find((t) => t.id === focusTaskId && t.page_goal) ?? null : null;
  const tState = goalTask ? taskState(goalTask) : null;
  const [ctxOverride, setCtxOverride] = useState<string | null>(() => (loc0.state as { ctx?: string } | null)?.ctx ?? null);
  const readContextKey = focusTaskId ? ctxOverride ?? tState?.ctx ?? `todo:${focusTaskId}` : stateBm ? `bookmark:${stateBm}` : "global";
  const contextualRead = !!focusTaskId || !!stateBm;
  const reads = usePageReads(readDocKey, scope, scope === "kuran" ? null : doc.parent_id, readContextKey, contextualRead);
  const pageKey = (i: number) => (numbered ? pageNo : isQuran ? mpages?.[i]?.display_page ?? i + 1 : i + 1);
  const navState = (extra?: Record<string, unknown>) => ({ taskId: focusTaskId, bmId: stateBm, ctx: focusTaskId ? readContextKey : undefined, ...extra });
  // görev göstergesi: turda/payda okunan (bu belgedeki canlı işaretler + diğer belgelerdekiler)
  const goalNow = (() => {
    if (!goalTask) return 0;
    const g = goalTask.page_goal!;
    const live = Object.keys(reads.read).map(Number).filter((pg) => inScope(g, pg));
    const other = readsCache().filter((r) => r.context_key === readContextKey && r.doc_key !== readDocKey && inScope(g, r.page)).map((r) => r.doc_key + ":" + r.page);
    return new Set(other).size + live.length;
  })();
  // atlanan sayfalar: okunan en ileri sayfadan geride kalıp işaretlenmemiş olanlar (bu belgedeki canlı işaretlerle)
  /** bu bağlamda okunan sayfalar (bu belgedeki canlı işaretlerle) */
  const readSetNow = (extra?: number) => {
    const set = new Set<number>();
    if (!goalTask) return set;
    const g = goalTask.page_goal!;
    const liveHere = !g.doc_key || g.doc_key === readDocKey;
    for (const r of readsCache()) if (r.context_key === readContextKey && (!g.doc_key || r.doc_key === g.doc_key) && inScope(g, r.page) && !(liveHere && r.doc_key === readDocKey)) set.add(r.page);
    if (liveHere) for (const [k, v] of Object.entries(reads.read)) { const n = Number(k); if (v && inScope(g, n)) set.add(n); }
    if (extra != null) set.add(extra);
    return set;
  };
  // önceki bir turun eksiklerini tamamlama: görev o turun bağlamıyla açıldı
  const oldLapN = goalTask?.page_goal?.loop && tState && readContextKey !== tState.ctx && /#\d+$/.test(readContextKey) ? Number(readContextKey.split("#")[1]) : 0;
  const oldLap = oldLapN > 0 && !!tState && oldLapN < tState.lap ? oldLapN : 0;
  const skipped = (() => {
    if (!goalTask) return [] as number[];
    const g = goalTask.page_goal!;
    const set = readSetNow();
    if (oldLap) { const all = goalPages(g) ?? []; return all.filter((x) => !set.has(x)); }
    return skippedPages(g, set);
  })();
  const skipBar = skipped.length > 0 && (
    <div className="skipbar">
      <span>⚠ {oldLap ? `${oldLap}. turda ${skipped.length} eksik:` : `${skipped.length} sayfa atlandı:`}</span>
      {skipped.slice(0, 8).map((p) => <button key={p} onClick={() => void goToPage(p)}>{p}</button>)}
      {skipped.length > 8 && <span>…</span>}
    </div>
  );
  const goalTotal = goalTask ? scopeSize(goalTask.page_goal!) || (goalMode(goalTask.page_goal!) === "pay" ? goalTask.page_goal!.n : 0) : 0;
  // bölümlü kitapta (Sözler…) toplam sayfa bir kez hesaplanır
  const [, setBpT] = useState(0);
  useEffect(() => {
    const b = goalTask ? needsBookPages(goalTask.page_goal) : null;
    if (b) void ensureBookPages(b).then((r) => { if (r) setBpT((x) => x + 1); });
  }, [goalTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const curLap = goalTask && readContextKey.includes("#") ? Number(readContextKey.split("#")[1]) || 1 : 1;
  const goalChip = (() => {
    if (!goalTask) return "";
    const g = goalTask.page_goal!;
    if (goalMode(g) === "pay") return `${goalLabel(g)} ${goalNow}/${goalTotal}${readContextKey !== tState?.ctx && tState && readContextKey > tState.ctx ? " · sonraki dönem" : ""}`;
    return goalTotal ? `${goalNow}/${goalTotal}${g.loop ? ` · ${curLap}. tur` : ""}` : `Bugün ${tState?.todayCount ?? 0}`;
  })();
  // okundu deyince ilerleyecek ayraç: görevin ayracı, ayraçtan açıldıysa o, kitapta tek ayraç varsa o
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
    const st = loc.state as { atEnd?: boolean; startPage?: number } | null;
    if (st?.atEnd) { setPp(pc - 1); return; }
    // görevden "aralığın başından" açıldı (her gün baştan okunan aralık)
    if (st?.startPage != null && !mark) {
      const i = Array.from({ length: pc }, (_, k) => k).find((k) => pageKey(k) === st.startPage);
      if (i != null) { setPp(i); return; }
    }
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
    if (t < 0) { if (prevDoc) nav(`/kutuphane/${prevDoc}`, { replace: true, state: navState({ atEnd: true }) }); return; }
    if (t >= pc) { if (nextDoc) nav(`/kutuphane/${nextDoc}`, { replace: true, state: navState() }); return; }
    setPp(t);
    document.querySelector(".content")?.scrollTo(0, 0);
  };
  const lapsRef = useRef<NonNullable<TodoT["laps"]> | null>(null); // bu oturumda biten turlar (görev listesi yenilenene kadar)
  const firstNid = (k: number) => (isQuran ? mpages?.[k]?.rich_content.paragraphs.flatMap((p) => p.runs).find((r) => r.nodeId)?.nodeId : bookPages[k]?.[0]?.id) ?? null;
  const idxOf = (p: number) => Array.from({ length: pc }, (_, k) => k).find((k) => pageKey(k) === p);
  const siblingOfPage = async (p: number) => {
    const { data } = await supabase.from("library_items").select("id").eq("parent_id", doc.parent_id!).eq("metadata->>page", String(p)).maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  /** görevin yeri: p. sayfanın başı */
  const placeFor = async (p: number): Promise<TaskPlace | null> => {
    if (numbered) { const id = p === pageNo ? doc.id : await siblingOfPage(p); return id ? { doc_id: id, node_id: null, page: p, label: unitLabel(p) } : null; }
    const k = idxOf(p);
    if (k != null) { const nid = firstNid(k); return { doc_id: doc.id, node_id: nid, page: p, label: nid ? where(nid).label : `Sayfa ${p}` }; }
    if (isQuran && goalTask) { const r = await rangeStartDoc({ ...goalTask.page_goal!, doc_key: "kuran", from: p, pages: undefined }, doc.id); return r ? { doc_id: r.docId, node_id: null, page: p, label: `Sayfa ${p}` } : null; }
    if (nextDoc && p > pageKey(pc - 1)) return { doc_id: nextDoc, node_id: null, page: 1, label: "" }; // kitap: sonraki bölüm
    return null;
  };
  const savePlace = async (pl: TaskPlace | null) => {
    if (!goalTask || !pl) return;
    await supabase.from("todos").update({ place: pl, updated_at: new Date().toISOString() }).eq("id", goalTask.id);
  };
  /** p. sayfaya git (bu belgedeyse sayfayı çevir, değilse o belgeyi aç) */
  const goToPage = async (p: number, ctx = readContextKey) => {
    const k = numbered ? (p === pageNo ? 0 : undefined) : idxOf(p);
    if (k != null && !numbered) { setPp(k); document.querySelector(".content")?.scrollTo(0, 0); return; }
    const pl = await placeFor(p);
    if (pl && pl.doc_id !== doc.id) nav(`/kutuphane/${pl.doc_id}`, { replace: true, state: { ...navState(), ctx, startPage: pl.page ?? p } });
  };
  const scopeStart = (g: NonNullable<TodoT["page_goal"]>) => (g.pages?.length ? Math.min(...g.pages) : g.from ?? (numbered ? 1 : isQuran ? 0 : 1));
  /** görevde okundu sonrası: sırayla okuda yer ilerler, kapsam bitince tur ya da görev tamam; payda dönem tamam / erken başa dön */
  const taskAfterMark = async (pk: number, added: boolean) => {
    const t = goalTask!, g = t.page_goal!;
    const mode = goalMode(g);
    if (oldLap) {
      // önceki turun eksiği: görevin yeri ve turu değişmez, sadece o turun eksikleri azalır
      if (!added) return;
      try { vibrate(15); } catch { /* yok say */ }
      const set = readSetNow(pk);
      const left = (goalPages(g) ?? []).filter((x) => !set.has(x));
      if (!left.length) flash(`${oldLap}. turun eksikleri tamamlandı`);
      else { flash(`${oldLap}. tur: ${left.length} eksik kaldı`); const np = left.find((x) => x > pk) ?? left[0]; if (cp.readNext) setTimeout(() => void goToPage(np), 180); }
      return;
    }
    if (!added) { void savePlace(await placeFor(pk)); return; } // geri alındı: yer bu sayfaya döner
    try { vibrate(15); } catch { /* yok say */ }
    const liveSet = new Set(Object.keys(reads.read).map(Number)); liveSet.add(pk);
    const other = new Set(readsCache().filter((r) => r.context_key === readContextKey && r.doc_key !== readDocKey && inScope(g, r.page)).map((r) => r.doc_key + ":" + r.page));
    const count = other.size + [...liveSet].filter((x) => inScope(g, x)).length;
    const total = scopeSize(g) || (mode === "pay" ? g.n : 0);
    const done = total > 0 && count >= total;
    const today = ymdToday();
    if (mode === "seq") {
      // son sayfaya gelindi ama arada işaretlenmemiş sayfa var: sor (tur / görev bitsin mi, yoksa eksik sayfaya mı gidilsin)
      const endPage = g.pages?.length ? Math.max(...g.pages) : g.to;
      let finish = done;
      if (!done && total > 0 && endPage != null && pk >= endPage) {
        const missing = total - count;
        const first = other.size === 0 ? (() => { for (let x = scopeStart(g); x <= endPage; x++) if (inScope(g, x) && !liveSet.has(x)) return x; return null; })() : null;
        const what = g.loop ? `${curLap}. tur bitsin mi?` : "Görev tamamlansın mı?";
        const where = first != null ? ` (ilki: ${unitLabel(first)})` : "";
        if (window.confirm(`Son sayfaya geldin ama ${missing} sayfa okundu işaretlenmemiş${where}.\n\n${what}\n\nİptal: eksik sayfaya git`)) finish = true;
        else { if (first != null) { void savePlace(await placeFor(first)); setTimeout(() => void goToPage(first), 180); } return; }
      }
      if (finish) {
        if (g.loop) {
          const lap = curLap;
          const laps = [...(lapsRef.current ?? t.laps ?? [])];
          const a0 = laps.length ? nextDay(laps[laps.length - 1].b) : t.start_date ?? ymdToday(new Date(t.created_at));
          laps.push({ n: lap, a: a0 > today ? today : a0, b: today });
          const days = Math.round((Date.parse(today) - Date.parse(laps[laps.length - 1].a)) / 86400000) + 1;
          const start = scopeStart(g);
          const pl = await placeFor(start);
          lapsRef.current = laps;
          await supabase.from("todos").update({ laps, place: pl, updated_at: new Date().toISOString() }).eq("id", t.id);
          const nctx = seqCtx(t, lap + 1);
          setCtxOverride(nctx);
          flash(`${lap}. tur tamamlandı (${days} günde) · yeni tur başladı`);
          if (cp.readNext) setTimeout(() => void goToPage(start, nctx), 400);
        } else {
          await supabase.from("todos").update({ is_completed: true, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", t.id);
          flash("Kapsam bitti · görev tamamlandı");
        }
        return;
      }
      const np = g.pages?.length ? nextGoalPage(g, pk) : pk + 1;
      const pl = np != null ? await placeFor(np) : null;
      void savePlace(pl ?? (await placeFor(pk)));
      if (cp.readNext && np != null) setTimeout(() => void goToPage(np), 180);
      return;
    }
    // pay
    if (done) {
      const isCur = !!tState && readContextKey === tState.ctx && !tState.ahead;
      if (g.early && periodUnit(t) !== "range" && isCur && tState?.cur) {
        const nctx = payCtx(t, nextDay(tState.cur.b));
        setCtxOverride(nctx);
        flash(`${goalLabel(g)} tamamlandı · sonraki dönemin payı başladı`);
        if (cp.readNext) setTimeout(() => void goToPage(scopeStart(g), nctx), 400);
      } else flash(`${goalLabel(g)} tamamlandı`);
      return;
    }
    // payda okunmamış bir sonraki sayfa
    const all = g.pages?.length ? [...g.pages].sort((x, y) => x - y) : Array.from({ length: Math.abs((g.to ?? pk) - (g.from ?? pk)) + 1 }, (_, i) => (g.from ?? pk) + i);
    const np = all.find((x) => x > pk && !liveSet.has(x)) ?? all.find((x) => !liveSet.has(x));
    if (np != null) void savePlace(await placeFor(np)); // kaldığın yer: payda okunmamış sıradaki sayfa
    if (cp.readNext && np != null) setTimeout(() => void goToPage(np), 180);
  };
  // okundu: işaretle; görevden açıldıysa görevin yeri ilerler; ayraçtan açıldıysa ayraç ilerler; ayara göre sonraki sayfaya geç
  const markRead = () => {
    const pk = pageKey(pp);
    const added = reads.toggle(pk);
    if (goalTask) { void taskAfterMark(pk, added); return; }
    const bmToMove = stateBm;
    if (!added) {
      const first = firstNid(pp);
      if (bmToMove && first) { const w = where(first); void moveBookmark(bmToMove, { scope, book_id: bookId, document_id: doc.id, node_id: first, mushaf_page: w.page, quote: textOf(first), autoTitle: w.label, label: w.label }).then(() => void reloadBms()); }
      return;
    }
    try { vibrate(15); } catch { /* yok say */ }
    if (bmToMove) {
      const nid = firstNid(pp + 1) ?? (isQuran ? mpages?.[pp]?.rich_content.paragraphs.flatMap((p) => p.runs).filter((r) => r.nodeId).pop()?.nodeId : bookPages[pp]?.[bookPages[pp].length - 1]?.id);
      if (nid) { const w = where(nid); void moveBookmark(bmToMove, { scope, book_id: bookId, document_id: doc.id, node_id: nid, mushaf_page: w.page, quote: textOf(nid), autoTitle: w.label, label: w.label }).then(() => void reloadBms()); }
    }
    if (cp.readNext && pp < pc - 1) setTimeout(() => turn(1), 180);
  };
  // numaralı belgede (Cevşen, Tevhidname) okundu
  const markReadDoc = () => {
    const added = reads.toggle(pageNo);
    if (goalTask) { void taskAfterMark(pageNo, added); return; }
    const bmToMove = stateBm ?? (bms.length === 1 ? bms[0].id : null);
    if (!added) {
      if (bmToMove) void moveBookmark(bmToMove, { scope, book_id: bookId, document_id: doc.id, node_id: null, mushaf_page: null, quote: "", autoTitle: `${parentTitle ?? ""} · ${unitLabel(pageNo)}`, label: unitLabel(pageNo) }).then(() => void reloadBms());
      return;
    }
    try { vibrate(15); } catch { /* yok say */ }
    if (bmToMove && nextDoc) void moveBookmark(bmToMove, { scope, book_id: bookId, document_id: nextDoc, node_id: null, mushaf_page: null, quote: "", autoTitle: `${parentTitle ?? ""} · ${unitLabel(pageNo + 1)}`, label: unitLabel(pageNo + 1) });
    if (cp.readNext && nextDoc) setTimeout(() => nav(`/kutuphane/${nextDoc}`, { replace: true, state: navState() }), 200);
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

  // zikir görevi (bu belgeye bağlı, okuma hedefi olmayan görev): sayaç bugünkü sayısını görevden alır, saydıkça görev ilerler
  const zikirTask = todos.find((t) => !t.page_goal && !t.is_completed && t.reading_ref?.doc_id === doc.id && (t.per_day ?? 1) > 1) ?? null;
  const zikirNid = (() => { const zc = nodes.filter((n) => n.kind === "phrase" && Number(md(n).target ?? 0) > 0); return zc.length === 1 ? zc[0].id : null; })();
  const zikirToday = zikirTask?.progress?.[ymdToday()] ?? 0;
  const zikirTarget = (() => { const n = nodes.find((x) => x.id === zikirNid); return n ? Number(md(n).target ?? 0) : 0; })();
  /** bugünkü toplamdan sayaçta görünen: tur dolunca sayaç 0'dan yeni tura başlar */
  const lapShow = (total: number, tg: number) => (total <= 0 || tg <= 0 ? 0 : total % tg);
  const zikirTotal = useRef(0); // bugünkü toplam çekim (turlar dahil)
  useEffect(() => {
    if (!zikirTask || !zikirNid || !zikirTarget) return;
    // sayaç bugün görevden ileri gittiyse (görev kaydedilemeden çıkıldıysa) görev yetişir
    const seen = Math.min(zikirTarget, zikirSeen.current[zikirNid] ?? 0);
    const total = Math.max(zikirToday, seen, zikirVal.current ?? 0);
    if (total > zikirToday && zikirVal.current == null) pushZikir(total);
    zikirTotal.current = total;
    const v = lapShow(total, zikirTarget);
    setCounts((s) => (s[zikirNid] === v ? s : { ...s, [zikirNid]: v }));
  }, [zikirTask?.id, zikirNid, zikirToday, zikirTarget, cntTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const zikirTimer = useRef<number | null>(null);
  const zikirVal = useRef<number | null>(null);
  const pushZikir = (total: number) => {
    if (!zikirTask) return;
    zikirVal.current = total;
    if (zikirTimer.current) window.clearTimeout(zikirTimer.current);
    zikirTimer.current = window.setTimeout(() => {
      const val = zikirVal.current; zikirVal.current = null;
      if (val == null) return;
      const d = ymdToday();
      void supabase.from("todos").update({ progress: { ...(zikirTask.progress ?? {}), [d]: val }, updated_at: new Date().toISOString() }).eq("id", zikirTask.id);
    }, 700);
  };
  const isZikir = (nid: string) => !!zikirTask && nid === zikirNid && zikirTarget > 0;
  /** zikir sayacı: her dokunuş toplamı artırır; tur dolunca sayaç baştan başlar, görev kaçıncı turda olduğunu gösterir */
  const zikirAdd = (delta: number) => {
    const total = Math.max(0, zikirTotal.current + delta);
    zikirTotal.current = total;
    const v = lapShow(total, zikirTarget);
    setCounts((s) => ({ ...s, [zikirNid!]: v }));
    putCount(zikirNid!, zikirTarget, v);
    pushZikir(total);
    if (delta > 0) { const lapDone = total % zikirTarget === 0; buzz(lapDone ? "goal" : "tap", lapDone ? zikirTarget : v); if (lapDone) flash(`${total / zikirTarget}. tur tamam`); }
    return v;
  };
  /** zikir sayacını sıfırla: sadece şu anki tur silinir */
  const zikirResetLap = () => { const cur = lapShow(zikirTotal.current, zikirTarget); if (cur > 0) zikirAdd(-cur); };
  // önce cihaza yazılır, internet varsa hesaba gönderilir (yoksa bağlantı gelince)
  const saveCount = useCallback((nid: string, target: number, value: number) => { putCount(nid, target, value); }, []);

  const tap = (b?: Extract<Block, { t: "counter" }>) => {
    if (!b) { if (page < pages.length - 1) go(page + 1); return; }
    if (isZikir(b.n.id)) { zikirAdd(1); return; }
    const v = Math.min(b.target, (counts[b.n.id] ?? 0) + 1);
    setCounts((s) => ({ ...s, [b.n.id]: v }));
    buzz(v === b.target ? "goal" : "tap", v);
    void saveCount(b.n.id, b.target, v);
  };

  const resetPage = () => {
    if (!pageCounters.length || !window.confirm("Bu sayfadaki sayaçlar sıfırlansın mı?")) return;
    const s = { ...counts };
    for (const b of pageCounters) { if (isZikir(b.n.id)) continue; s[b.n.id] = 0; void saveCount(b.n.id, b.target, 0); }
    setCounts(s);
    if (pageCounters.some((b) => isZikir(b.n.id))) zikirResetLap();
  };

  /* ── Kelime düzeyinde yer ──
     Bir düğümün (cümle / âyet) metni, o düğüme ait bütün öğelerin metni art arda (aralarına boşluk) okunur.
     Kelime sırası bu metne göre; işaretlerken de aynı sıra kullanılır. */
  const nidSegments = (nid: string) => {
    const segs: { node: Text | null; text: string }[] = [];
    const els = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(`[data-nid="${nid}"]`) ?? []);
    for (const e of els) {
      const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let tn: Text | null;
      while ((tn = w.nextNode() as Text | null)) segs.push({ node: tn, text: tn.textContent ?? "" });
      // aynı düğümün parçaları (Kur'an'da bir âyetin satır parçaları) arasına boşluk eklenmez: kelime bölünmesin
    }
    return segs;
  };
  function wordAt(node: ChildNode, offset: number): { nid: string; word: number; wtext: string } | null {
    const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-nid]");
    const nid = el?.dataset.nid;
    if (!nid) return null;
    const segs = nidSegments(nid);
    let prefix = "", full = "", found = false;
    for (const sg of segs) {
      if (!found && sg.node === node) { prefix = full + sg.text.slice(0, offset); found = true; }
      full += sg.text;
    }
    if (!found) prefix = "";
    const toks = prefix.split(/\s+/).filter(Boolean).length;
    const word = !prefix || /\s$/.test(prefix) ? toks : Math.max(0, toks - 1);
    return { nid, word, wtext: full.split(/\s+/).filter(Boolean)[word] ?? "" };
  }
  /** düğümdeki n. kelimeyi işaretle (CSS highlight; yoksa sadece düğüm) ve görünür yap */
  const showWord = (nid: string, word: number) => {
    const segs = nidSegments(nid);
    let wi = -1, inW = false;
    let sNode: Text | null = null, sOff = 0, eNode: Text | null = null, eOff = 0;
    outer: for (const sg of segs) {
      for (let i = 0; i < sg.text.length; i++) {
        const sp = /\s/.test(sg.text[i]);
        if (!sp && !inW) { inW = true; wi++; if (wi === word && sg.node) { sNode = sg.node; sOff = i; } }
        if (sp && inW) { inW = false; if (wi === word) break outer; }
        if (!sp && wi === word && sg.node) { eNode = sg.node; eOff = i + 1; }
      }
    }
    if (!sNode || !eNode) { document.getElementById("n" + nid)?.scrollIntoView({ block: "center" }); return; }
    const range = document.createRange();
    range.setStart(sNode, sOff); range.setEnd(eNode, eOff);
    const H = (window as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (H && reg) reg.set("lumen-word", new H(range));
    const rc = range.getBoundingClientRect();
    const sc = document.querySelector(".content");
    if (sc && rc.height) sc.scrollBy({ top: rc.top - window.innerHeight / 2, behavior: "smooth" });
    else (sNode.parentElement as HTMLElement | null)?.scrollIntoView({ block: "center" });
  };
  useEffect(() => {
    if (!mark || markWord == null || loading) return;
    const t = setTimeout(() => showWord(mark, markWord), 300);
    return () => clearTimeout(t);
  }, [mark, markWord, loading, pp, page, mpages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { (CSS as unknown as { highlights?: Map<string, unknown> }).highlights?.delete("lumen-word"); }, []);

  // "Burada kaldım": görevden açıldıysa görevin yeri; değilse hangi göreve / ayraca kaydedileceği sorulur
  const saveTaskWord = async (taskId: string, nid: string, word: number, wtext: string) => {
    const w = where(nid);
    const bi = paged && !isQuran ? bookPages.findIndex((pg) => pg.some((n) => n.id === nid)) : -1;
    const page = numbered ? pageNo : isQuran ? w.page : bi >= 0 ? bi + 1 : null;
    const label = numbered ? `${unitLabel(pageNo)} · “${wtext}”` : `${w.label} · “${wtext}”`;
    const { error } = await supabase.from("todos").update({ place: { doc_id: doc.id, node_id: nid, word, page, label }, updated_at: new Date().toISOString() }).eq("id", taskId);
    if (error) { flash("Kaydedilemedi: " + error.message); return; }
    setMark(nid); setMarkWord(word);
    window.getSelection()?.removeAllRanges(); setSel(null); lastSel.current = null;
    flash(`Burada kaldın · “${wtext}”`);
  };
  const bookTasks = () => todos.filter((t) => !t.is_completed && !t.parent_todo_id && (
    isQuran ? t.page_goal?.doc_key === "kuran" || t.reading_ref?.scope === "kuran"
      : t.place?.doc_id === doc.id || (!!bookId && (t.page_goal?.book_id === bookId || t.reading_ref?.book_id === bookId))));
  const hereAt = (nid: string, word: number, wtext: string, quote: string) => {
    if (focusTaskId) { void saveTaskWord(focusTaskId, nid, word, wtext); return; }
    if (!bookTasks().length) { markAt(nid, quote); window.getSelection()?.removeAllRanges(); setSel(null); return; }
    window.getSelection()?.removeAllRanges(); setSel(null);
    setHereAsk({ nid, word, wtext, quote });
  };
  const hereRef = useRef<(x: number, y: number, target: Element) => void>(() => {});
  hereRef.current = (x, y, target) => {
    if (target.closest("button, a, input, textarea, .pill, .cpill, .fcnt, .dpager, .pnav")) return;
    if (pageCounters.length) return; // sayaçlı sayfada çift dokunma sayaca ait
    const d = document as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: ChildNode; offset: number } | null };
    const r = d.caretRangeFromPoint?.(x, y);
    const cp = r ? { node: r.startContainer as ChildNode, off: r.startOffset } : (() => { const p = d.caretPositionFromPoint?.(x, y); return p ? { node: p.offsetNode, off: p.offset } : null; })();
    if (!cp) return;
    const wa = wordAt(cp.node, cp.off);
    if (!wa) return;
    try { vibrate(12); } catch { /* yok say */ }
    hereAt(wa.nid, wa.word, wa.wtext, textOf(wa.nid));
  };
  // çift dokunma: dokunulan kelimede "burada kaldım"
  useEffect(() => {
    let last = { t: 0, x: 0, y: 0 };
    const onEnd = (e: TouchEvent) => {
      const tch = e.changedTouches[0];
      if (!tch || e.touches.length || !bodyRef.current?.contains(e.target as ChildNode)) return;
      const now = Date.now();
      if (now - last.t < 320 && Math.abs(tch.clientX - last.x) < 28 && Math.abs(tch.clientY - last.y) < 28) {
        last = { t: 0, x: 0, y: 0 };
        e.preventDefault();
        hereRef.current(tch.clientX, tch.clientY, e.target as Element);
      } else last = { t: now, x: tch.clientX, y: tch.clientY };
    };
    const onDbl = (e: MouseEvent) => { if (bodyRef.current?.contains(e.target as ChildNode)) hereRef.current(e.clientX, e.clientY, e.target as Element); };
    document.addEventListener("touchend", onEnd, { passive: false });
    document.addEventListener("dblclick", onDbl);
    return () => { document.removeEventListener("touchend", onEnd); document.removeEventListener("dblclick", onDbl); };
  }, []);

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
      const wa = wordAt(r.startContainer as ChildNode, r.startOffset);
      lastSel.current = { nid: el.dataset.nid, text, at: Date.now(), word: wa?.word ?? 0, wtext: wa?.wtext ?? text.split(/\s+/)[0] };
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
    // sayfa aralığı hedefi için: hangi sayı dizisi (doc_key) ve bu yerin sayfa numarası
    const bi = paged && !isQuran && nid ? bookPages.findIndex((pg) => pg.some((n) => n.id === nid)) : -1;
    const pno = numbered ? pageNo : isQuran ? w.page ?? undefined : bi >= 0 ? bi + 1 : undefined;
    const dkey = numbered ? doc.parent_id! : isQuran ? "kuran" : doc.id;
    // tek sayaçlı belge (Esmâ'daki bir isim): görev zikir görevi olur, günlük sayı sayaçtaki hedef
    const zc = nodes.filter((n) => n.kind === "phrase" && Number(md(n).target ?? 0) > 0);
    const zikir = zc.length === 1 ? { target: Number(md(zc[0]).target), text: (zc[0].text_content ?? doc.title).trim() } : undefined;
    return { doc_id: doc.id, node_id: nid, book_id: bookId, scope, label: numbered ? `${bookTitle} · ${unitLabel(pageNo)}` : w.label, quote: quote.slice(0, 300), book_title: bookTitle, mushaf_page: w.page, page_no: pno, unit: numbered ? unit : undefined, doc_key: dkey, zikir };
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
    const ls0 = lastSel.current;
    lastSel.current = null;
    if (a === "mark") hereAt(h.nid, h.picked ? ls0?.word ?? 0 : 0, h.picked ? ls0?.wtext ?? "" : textOf(h.nid).split(/\s+/)[0] ?? "", h.text);
    else if (a === "not") setAsk({ nid: h.nid, text: h.picked ? h.text : "" });
    else openTask(h.nid, h.text, h.picked ? "sabit" : "ayrac");
  };
  // Yenile: bu kitabın cihazdaki kopyasını veri tabanındaki güncel hâliyle değiştir
  const refreshThis = async () => {
    if (offline) { flash("İnternet yokken yenilenemez"); return; }
    flash("Güncel hâli alınıyor…");
    try {
      const r = await refreshBook(doc.id);
      if (r.failed && r.failed === r.total) { flash("Yenilenemedi, internet bağlantısını kontrol et"); return; }
      window.location.reload();
    } catch { flash("Yenilenemedi, internet bağlantısını kontrol et"); }
  };
  // görevden açıldıysa: o görevi yükle (alt çubuk için)
  useEffect(() => {
    if (!focusTaskId) return;
    void supabase.from("todos").select("id,title,bookmark_id,per_day,progress,recurrence,is_completed").eq("id", focusTaskId).maybeSingle().then(({ data }) => setTaskT(data as TodoT | null));
  }, [focusTaskId]);

  const setR = (s: RSettings) => { setRs(s); saveRSU(scope, rsUnit, s); };
  const KEY_DONE: Record<KeyAction, string> = { default: "Bu bölümde varsayılan yapıldı", section: "Bu bölümdeki her yere uygulandı", all: "Bütün bölümlere uygulandı", reset: "Bu kitapta varsayılana döndü" };
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

  if (showSettings) return <ReaderSettings title={scope === "kuran" ? "Kur'an-ı Kerim" : rsUnit.endsWith(doc.id) ? doc.title : parentTitle ?? doc.title} defTheme={defTheme} rs={rs} onChange={setR} onBack={() => setShowSettings(false)}
    ov={unitOverrides(rsUnit)} onKey={(k, a) => { keyAction(scope, rsUnit, k, rs[k], a); setRs(loadRSU(scope, rsUnit)); flash(KEY_DONE[a]); }}
    onApplyAll={() => { for (const k of unitOverrides(rsUnit)) keyAction(scope, rsUnit, k, rs[k], "default"); setRs(loadRSU(scope, rsUnit)); flash("Bu kitabın ayarları bu bölümde varsayılan yapıldı"); }}
    onReset={() => { resetUnit(rsUnit); setRs(loadRSU(scope, rsUnit)); flash("Bu kitap varsayılan ayarlara döndü"); }} onGeneral={() => nav("/ayarlar")} counters={scope === "ibadet"} cevsen={parentTitle === "Cevşen-i Kebîr"} />;

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
    if ((b.t === "h2" || b.t === "h3") && isAr(n.text_content ?? n.title)) return rs.ar ? <div key={i} className={arClass(n.text_content ?? n.title)} id={"n" + n.id} data-nid={n.id}>{arFix(n.text_content ?? n.title ?? "")}</div> : null;
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
        {arabic ? (rs.ar && <div className={arClass(n.text_content ?? n.secondary_text)} id={"n" + n.id} data-nid={n.id}>{arFix(n.text_content ?? n.secondary_text ?? "")}</div>) : (
          <p id={"n" + n.id} data-nid={n.id} className={isMarked(n.id) ? "mk" : notesOf(n.id).length ? "ul" : undefined}>
            {rs.ar && n.secondary_text && <span className={arClass(n.secondary_text) + " blk"}>{arFix(n.secondary_text)}</span>}
            {rs.latin && withArabic(n.text_content)}
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
          <button className="g" onClick={() => { const ls = lastSel.current; hereAt(sel.nid, ls?.nid === sel.nid ? ls.word ?? 0 : 0, ls?.nid === sel.nid ? ls.wtext ?? "" : sel.text.split(/\s+/)[0], sel.text); }} aria-label="Burada kaldım"><Icon name="bookmark" size={20} /><span>{focusTaskId ? "Burada kaldım" : "Kaldığım yer"}</span></button>
          <button onClick={() => { setAsk({ nid: sel.nid, text: sel.text }); lastSel.current = null; setSel(null); }} aria-label="Not"><Icon name="pencil" size={20} /><span>Not</span></button>
          <button className="a" onClick={() => { openTask(sel.nid, sel.text, "sabit"); lastSel.current = null; window.getSelection()?.removeAllRanges(); setSel(null); }} aria-label="Görev"><Icon name="plusbox" size={20} /><span>Görev</span></button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {hereAsk && (
        <>
          <div className="scrim show" style={{ zIndex: 44 }} onClick={() => setHereAsk(null)} />
          <div className="sheet" style={{ zIndex: 45 }} role="dialog" aria-label="Burada kaldım">
            <div className="grab" />
            <div className="sheethead"><h2>Burada kaldım</h2><button className="iconbtn" onClick={() => setHereAsk(null)} aria-label="Kapat"><Icon name="close" size={22} /></button></div>
            <p className="muted small" style={{ margin: "0 2px 10px" }}>“{hereAsk.wtext}” · {where(hereAsk.nid).label}. Nereye kaydedilsin?</p>
            <div className="lbl" style={{ padding: "4px 0 6px" }}>GÖREVLER</div>
            <div className="lplist">
              {bookTasks().map((t) => (
                <button key={t.id} className="lprow" style={{ width: "100%", background: "none", border: 0, color: "inherit", textAlign: "left", font: "inherit" }} onClick={() => { const h = hereAsk; setHereAsk(null); void saveTaskWord(t.id, h.nid, h.word, h.wtext); }}>
                  <Icon name="todo" size={18} /><span>{t.title}<small className="muted" style={{ display: "block", fontSize: 12 }}>{t.place?.label ?? t.reading_ref?.label ?? ""}</small></span>
                </button>
              ))}
            </div>
            <button className="addsub" style={{ marginTop: 12 }} onClick={() => { const h = hereAsk; setHereAsk(null); markAt(h.nid, h.quote); }}><Icon name="bookmark" size={18} /> Ayraç olarak kaydet</button>
          </div>
        </>
      )}
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
            <button onClick={() => pageAct("mark")}><Icon name="bookmark" size={20} /> {focusTaskId ? "Görevde burada kaldım" : "Kaldığım yeri kaydet"}</button>
            <button onClick={() => pageAct("task")}><Icon name="plusbox" size={20} /> Görev ekle</button>
            <button onClick={() => pageAct("not")}><Icon name="pencil" size={20} /> Not ekle</button>
            <button onClick={() => { setPmenu(false); void refreshThis(); }}><Icon name="sync" size={20} /> {scope === "kuran" ? "Kur'an'ı yenile" : "Bu kitabı yenile"}</button>
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
            if (isQuran || x0 === null || window.getSelection()?.toString()) return;
            const dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 60) turn(dx < 0 ? 1 : -1);
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
        <div style={{ height: "calc(72px + env(safe-area-inset-bottom))" }} />
        <div className={"pnav mini" + (isQuran ? " quran" : "")}>
          {skipBar}
          <button disabled={pp === 0 && !prevDoc} onClick={() => turn(-1)} aria-label={pp === 0 ? "Önceki bölüm" : "Önceki sayfa"} title={pp === 0 ? "Önceki bölüm" : "Önceki sayfa"}><Icon name={isQuran ? "chevron" : "back"} size={22} /></button>
          <span className="pmid">
          <button className={"readbtn" + (reads.read[pageKey(pp)] ? " on" : "")} onClick={() => markRead()} aria-label={reads.read[pageKey(pp)] ? "Okundu işaretini kaldır" : "Bu sayfayı okudum"}>
            {reads.read[pageKey(pp)] ? "✓" : "○"} {pp + 1} / {pc}
          </button>
          {goalTask && <span className={"goalchip" + (goalTotal && goalNow >= goalTotal ? " done" : "")} title={goalTask.title}>{goalChip}</span>}
          </span>
          <button disabled={pp >= pc - 1 && !nextDoc} onClick={() => turn(1)} aria-label={pp >= pc - 1 ? "Sonraki bölüm" : "Sonraki sayfa"} title={pp >= pc - 1 ? "Sonraki bölüm" : "Sonraki sayfa"}><Icon name={isQuran ? "back" : "chevron"} size={22} /></button>
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
    if (actNode && isZikir(actNode.id)) { zikirAdd(1); return; }
    if (!actNode || (counts[actNode.id] ?? 0) >= tgt(actNode)) return; // hedef doldu: saymaz
    const v = setCount(actNode, (counts[actNode.id] ?? 0) + 1);
    buzz(v === tgt(actNode) ? "goal" : "tap", v);
    if (v >= tgt(actNode) && !cumulative) setActive(null);
  };
  const dec = () => { if (shown && isZikir(shown.id)) { if ((counts[shown.id] ?? 0) > 0) zikirAdd(-1); return; } if (shown) setCount(shown, (counts[shown.id] ?? 0) - 1); };
  const resetAll = () => {
    if (!counters.length || !window.confirm("Bu metindeki bütün sayaçlar sıfırlansın mı?")) return;
    for (const n of counters) { if (isZikir(n.id)) zikirResetLap(); else setCount(n, 0); }
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
                      {isCevsen && !instr ? <CevsenText n={n} rs={rs} marked={isMarked(n.id)} /> : <>
                      {rs.ar && n.secondary_text && <div className="dar" dir="rtl">{n.secondary_text}</div>}
                      {(rs.latin || instr) && n.text_content && <div className={(instr ? "dins" : "dlat") + (isMarked(n.id) ? " mk" : "")}>{n.text_content}{m.end_symbol === "dua" && <span className="endsym" title="Dua edilir"> 🤲</span>}{m.end_symbol === "face" && <FaceHands />}</div>}
                      {rs.tr && n.translation && <div className="dtr">{n.translation}</div>}
                      </>}
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
      <nav className={"dpager" + (numbered ? " fixed" : "")}>
        <button disabled={!prevDoc} onClick={() => prevDoc && nav(`/kutuphane/${prevDoc}`, { replace: true, state: navState() })}>‹ Önceki</button>
        {numbered && (
          <button className={"dread" + (reads.read[pageNo] ? " on" : "")} onClick={() => markReadDoc()} aria-label="Bu sayfayı okudum">
            {reads.read[pageNo] ? "✓" : "○"} {unit === "bab" ? `${pageNo}. Bab` : pageNo || "Giriş"}
          </button>
        )}
        <button disabled={!nextDoc} onClick={() => nextDoc && nav(`/kutuphane/${nextDoc}`, { replace: true, state: navState() })}>Sonraki ›</button>
      </nav>
      {numbered && goalTask && <div className="dgoal fixed">{skipBar}<span className={"goalchip" + (goalTotal && goalNow >= goalTotal ? " done" : "")}>{goalChip}</span></div>}
      {!numbered && skipBar && <div className="skipwrap">{skipBar}</div>}
      <div style={{ height: numbered ? 150 : 90 }} />
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

export function ReaderSettings({ title, defTheme, rs, onChange, onBack, onApplyAll, onReset, onGeneral, counters, ov = [], onKey, cevsen }: {
  title: string; defTheme: string; rs: RSettings; onChange: (s: RSettings) => void; onBack: () => void; onApplyAll: () => void; onReset: () => void; onGeneral: () => void; counters?: boolean; /** Cevşen: sayfa türü seçimi */ cevsen?: boolean;
  /** bu kitapta varsayılandan farklı ayarlar */ ov?: (keyof RSettings)[]; /** tek ayar için: varsayılan yap / uygula / geri dön */ onKey?: (k: keyof RSettings, a: KeyAction) => void;
}) {
  const [cp, setCp] = useCP();
  const [cvMode, setCvMode] = useCevsenMode();
  const [menu, setMenu] = useState<null | { k: keyof RSettings; label: string }>(null);
  // ayarın yanındaki ⋯: bu ayarı varsayılan yap / her yere uygula; nokta: bu kitapta farklı
  const More = ({ k, label }: { k: keyof RSettings; label: string }) => (onKey ? (
    <button className={"kmore" + (ov.includes(k) ? " ov" : "")} onClick={(e) => { e.stopPropagation(); setMenu({ k, label }); }} aria-label={`${label}: varsayılan / uygula`}>{ov.includes(k) && <i />}⋯</button>
  ) : null);
  const Lbl = ({ k, label }: { k: keyof RSettings; label: string }) => <span className="klbl">{label}<More k={k} label={label} /></span>;
  const Tog = ({ k, label }: { k: "ar" | "latin" | "tr" | "fit"; label: string }) => (
    <div className="srow"><Lbl k={k} label={label} /><button className={"tgl" + (rs[k] ? " on" : "")} onClick={() => onChange({ ...rs, [k]: !rs[k] })} aria-pressed={rs[k]}><i /></button></div>
  );
  const CntRow = ({ label, k }: { label: string; k: "cnt" | "pill" }) => (
    <div className="srow col"><Lbl k={k} label={label} />
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
      <div className="infoline">{onKey ? "Bu ayarlar sadece bu kitap için. Bir ayarın yanındaki ⋯ ile onu varsayılan yapabilir ya da her yere uygulayabilirsin. Nokta: bu kitapta varsayılandan farklı." : "Bu bölümün tüm kitapları için geçerli."}</div>
      <div style={{ padding: "0 16px" }}>
        {cevsen && (
          <div className="srow col"><span>Sayfa türü <small className="muted" style={{ fontWeight: 400 }}>· bütün bablar</small></span>
            <CevsenModeSeg mode={cvMode} onMode={setCvMode} />
          </div>
        )}
        <div className="srow col"><Lbl k="theme" label="Gece modu" />
          <div className="seg3">
            {(["dark", "light", "auto"] as const).map((t) => (<button key={t} className={rs.theme === t || ((rs.theme === "default" || rs.theme === "paper") && t === defTheme) ? "on" : ""} onClick={() => onChange({ ...rs, theme: t })}>{t === "dark" ? "Koyu" : t === "light" ? "Aydınlık" : "Telefonla aynı"}</button>))}
          </div>
        </div>
        <div className="srow col"><Lbl k="paper" label="Sayfa rengi" />
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
        <div className="srow col"><Lbl k="size" label="Yazı boyutu" />
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
        <div className="srow col"><Lbl k="light" label="Aydınlatma" />
          <div className="sl"><small>☼</small><input type="range" min={0.4} max={1} step={0.05} value={rs.light} onChange={(e) => onChange({ ...rs, light: Number(e.target.value) })} /><b>☀</b></div>
        </div>
        <button className="secondary" style={{ marginTop: 24 }} onClick={onApplyAll}>{onKey ? "★ Bu kitabın ayarlarını varsayılan yap" : "⇄ Tüm bölümlere uygula"}</button>
        <div className="seg" style={{ marginTop: 10 }}>
          <button onClick={onReset}>{onKey ? "↺ Varsayılana dön" : "↺ Sıfırla"}</button>
          <button onClick={onGeneral}>Genel ayarlar</button>
        </div>
      </div>
      {menu && onKey && (
        <>
          <div className="scrim show" style={{ zIndex: 44 }} onClick={() => setMenu(null)} />
          <div className="sheet" style={{ zIndex: 45 }} role="dialog" aria-label={menu.label}>
            <div className="grab" />
            <div className="sheethead"><h2>{menu.label}</h2><button className="iconbtn" onClick={() => setMenu(null)} aria-label="Kapat"><Icon name="close" size={22} /></button></div>
            <p className="muted small" style={{ margin: "0 2px 10px" }}>{ov.includes(menu.k) ? "Bu kitapta varsayılandan farklı." : "Bu kitapta varsayılan kullanılıyor."}</p>
            <div className="kacts">
              <button onClick={() => { onKey(menu.k, "default"); setMenu(null); }}><b>Varsayılan yap</b><span>Bu bölümde ayarı değiştirilmemiş kitaplar da bunu kullanır</span></button>
              <button onClick={() => { onKey(menu.k, "section"); setMenu(null); }}><b>Bu bölümdeki her yere uygula</b><span>Bu bölümün bütün kitaplarında aynı olur</span></button>
              <button onClick={() => { onKey(menu.k, "all"); setMenu(null); }}><b>Bütün bölümlere uygula</b><span>Kur'an, ibadet, Risale, HE ve diğerlerinde aynı olur</span></button>
              {ov.includes(menu.k) && <button onClick={() => { onKey(menu.k, "reset"); setMenu(null); }}><b>Bu kitapta varsayılana dön</b><span>Bölümün varsayılanı kullanılır</span></button>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ── Cevşen: kitaptaki gibi numaralı satırlar ──
   Giriş ("Allâhümme…", "Ve es'elüke biesmâike") ve "Sübhâneke…" numarasız; aradaki satırlar 1'den başlar.
   Numaralar yazının parçası değil (CSS ile gösterilir): kelime sırası, "burada kaldım" bozulmaz.
   Sadece okunuş açıkken kısa satırlar 2–3 sütun dizilir; Arapça ya da meal açıkken hep alt alta. */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arNo = (k: number) => String(k).split("").map((c) => AR_DIGITS[Number(c)]).join("");
function CevsenText({ n, rs, marked }: { n: { text_content: string | null; secondary_text: string | null; translation: string | null }; rs: RSettings; marked: boolean }) {
  const la = (n.text_content ?? "").split("\n");
  const ar = (n.secondary_text ?? "").split("\n");
  const tr = (n.translation ?? "").split("\n");
  const last = la.length - 1;
  const kind = (i: number): "intro" | "ref" | "line" => (i === 0 && /^(Allâhümme|Ve es)/.test(la[0]) && !/Yâ/.test(la[0]) ? "intro" : i === last && /^Sübhâneke/.test(la[i]) ? "ref" : "line");
  const nums: number[] = [];
  let k = 0;
  la.forEach((_, i) => { nums[i] = kind(i) === "line" ? ++k : 0; });
  const lineIdx = la.map((_, i) => i).filter((i) => nums[i] > 0);
  const onlyLatin = rs.latin && !rs.ar && !rs.tr;
  if (onlyLatin) {
    const lens = lineIdx.map((i) => la[i].length).sort((a, b) => a - b);
    const m = lens.length > 1 ? lens[lens.length - 2] : lens[0] ?? 99;
    const cols = m <= 10 ? 3 : m <= 24 ? 2 : 1;
    const lim = cols === 3 ? 10 : 24;
    return (
      <div className={"cvs dlat" + (marked ? " mk" : "")}>
        {kind(0) === "intro" && <div className="cvi">{la[0]} </div>}
        <div className={"cvg c" + cols}>
          {lineIdx.map((i) => <div key={i} className={"cvl" + (cols > 1 && la[i].length > lim ? " span" : "")} data-no={nums[i] + "."}>{la[i]} </div>)}
        </div>
        {kind(last) === "ref" && <div className="cvr">{la[last]}</div>}
      </div>
    );
  }
  return (
    <div className={"cvs" + (marked ? " mk" : "")}>
      {la.map((_, i) => {
        const kd = kind(i);
        const no = nums[i];
        return (
          <div key={i} className={"cvb " + kd}>
            {rs.ar && ar[i] && <div className="dar cvl" dir="rtl" data-no={no ? arNo(no) + "." : undefined}>{ar[i]} </div>}
            {rs.latin && la[i] && <div className={"dlat cvl" + (kd === "intro" ? " cvi" : kd === "ref" ? " cvr" : "")} data-no={no ? no + "." : undefined}>{la[i]} </div>}
            {rs.tr && tr[i] && <div className={"dtr cvl" + (kd === "ref" ? " cvr" : "")} data-no={no ? no + "." : undefined}>{tr[i]} </div>}
          </div>
        );
      })}
    </div>
  );
}

/** Cevşen sayfa türü: numaralı (kitaptaki gibi) / numarasız */
export function CevsenModeSeg({ mode, onMode }: { mode: "num" | "plain"; onMode: (m: "num" | "plain") => void }) {
  return (
    <div className="seg" style={{ marginTop: 8 }}>
      <button className={mode === "num" ? "on" : ""} onClick={() => onMode("num")}>1. 2. 3. Numaralı</button>
      <button className={mode === "plain" ? "on" : ""} onClick={() => onMode("plain")}>Numarasız</button>
    </div>
  );
}
