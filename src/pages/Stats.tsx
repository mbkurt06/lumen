import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import {
  SPAN_LABEL, bookKey, bookStat, dayShort, dayStats, getSpan, inSpan, loadBook, loadJuz, loadStatRows, pageCounts, range, setSpan, statText, sureName, surePages, unitStat,
  type BookInfo, type Juz, type PageCount, type SRow, type Span, type UnitStat,
} from "../lib/stats";
import { pageStartLabel } from "../lib/quranPages";

/* İstatistik: genel → kitap (cüz / sûre / bölüm) → bölüm (sayfa sayfa) */
function useRows() {
  const [rows, setRows] = useState<SRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { loadStatRows().then(setRows).catch(() => setErr("Okumalar alınamadı, internet bağlantısını kontrol et.")); }, []);
  return { rows, err };
}
function useSpan(): [Span, (s: Span) => void] {
  const [s, set] = useState<Span>(getSpan());
  return [s, (v) => { setSpan(v); set(v); }];
}
function SpanSeg({ span, onChange }: { span: Span; onChange: (s: Span) => void }) {
  return (
    <div className="seg" style={{ margin: "6px 16px" }}>
      {(Object.keys(SPAN_LABEL) as Span[]).map((k) => <button key={k} className={span === k ? "on" : ""} onClick={() => onChange(k)}>{SPAN_LABEL[k]}</button>)}
    </div>
  );
}
function StatRow({ title, s, unit, onClick }: { title: string; s: UnitStat; unit?: string; onClick?: () => void }) {
  const txt = statText(s, unit);
  const none = !s.times && !s.extra;
  return (
    <button className="strow" onClick={onClick}>
      <span className="stt">{title}</span>
      <span className={"stv" + (none ? " none" : s.times ? " ok" : "")}>{txt}{s.last && !none ? <span className="muted"> · son {dayShort(s.last)}</span> : null}</span>
      {s.size > 0 && <i className="stbar"><b style={{ width: `${Math.min(100, ((s.extra || (s.times ? s.size : 0)) / s.size) * 100)}%` }} /></i>}
      {onClick && <span className="kzgo">›</span>}
    </button>
  );
}
const Loading = ({ err }: { err?: string }) => <p className="muted" style={{ padding: "12px 16px" }}>{err || "Yükleniyor…"}</p>;

/* ── Genel ── */
export function Stats() {
  const nav = useNavigate();
  const { rows, err } = useRows();
  const [span, setSp] = useSpan();
  const [books, setBooks] = useState<BookInfo[]>([]);
  useEffect(() => {
    if (!rows) return;
    const keys = ["kuran", ...[...new Set(rows.map(bookKey))].filter((k) => k !== "kuran")];
    void Promise.all(keys.map((k) => loadBook(k, rows).catch(() => null))).then((b) => setBooks(b.filter(Boolean) as BookInfo[]));
  }, [rows]);
  const r = useMemo(() => (rows ? inSpan(rows, span) : []), [rows, span]);
  const ds = useMemo(() => dayStats(r), [r]);
  return (
    <>
      <PageHeader back title="İstatistik" subtitle="Okuduklarım" />
      <SpanSeg span={span} onChange={setSp} />
      {!rows ? <Loading err={err} /> : (
        <>
          <div className="stats3" style={{ margin: "6px 0" }}>
            <div className="card"><b>{new Set(r.map((x) => x.context_key + "|" + x.doc_key + "|" + x.page)).size}</b><span className="muted small">sayfa / bab</span></div>
            <div className="card"><b>{ds.days}</b><span className="muted small">gün okuma</span></div>
            <div className="card"><b>{ds.best}</b><span className="muted small">en uzun seri</span></div>
          </div>
          <div className="card" style={{ margin: "10px 16px", padding: "4px 0" }}>
            {books.map((b) => <StatRow key={b.key} title={b.title} s={bookStat(b, r)} unit={b.unit} onClick={() => nav(`/istatistik/${b.key}`)} />)}
            {!books.length && <Loading />}
          </div>
          <p className="muted small" style={{ margin: "0 20px 20px" }}>Okundu işaretlediğin sayfalar sayılır. Bir bölüm, bütün sayfaları en az o kadar okunduysa “N kez” okunmuş sayılır; yanındaki sayı sıradaki okuyuşta kaç sayfanın okunduğunu gösterir.</p>
        </>
      )}
    </>
  );
}

/* ── Kitap ── */
export function StatsBook() {
  const { book = "", unit } = useParams();
  const nav = useNavigate();
  const { rows, err } = useRows();
  const [span, setSp] = useSpan();
  const [info, setInfo] = useState<BookInfo | null>(null);
  const [juz, setJuz] = useState<Juz[]>([]);
  const [tab, setTab] = useState<"cuz" | "sure">("cuz");
  useEffect(() => { if (rows) void loadBook(book, rows).then(setInfo); }, [rows, book]);
  useEffect(() => { if (book === "kuran") void loadJuz().then(setJuz); }, [book]);
  const mine = useMemo(() => (rows ? inSpan(rows, span).filter((r) => bookKey(r) === book) : []), [rows, span, book]);
  if (!rows || !info) return (<><PageHeader back title="İstatistik" /><Loading err={err} /></>);
  if (unit) return <StatsUnit info={info} unit={unit} mine={mine} juz={juz} span={span} setSpan={setSp} />;
  const bs = bookStat(info, mine);
  const ds = dayStats(mine);
  return (
    <>
      <PageHeader back title={info.title} subtitle="İstatistik" />
      <SpanSeg span={span} onChange={setSp} />
      <div className="card" style={{ margin: "6px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><b>Tamamı</b><b style={{ color: "var(--accent)" }}>{statText(bs, info.unit) || "—"}</b></div>
        <div className="muted small" style={{ marginTop: 4 }}>{bs.read}/{bs.size} {info.unit} en az bir kez okundu · {ds.days} gün okuma{bs.last ? ` · son ${dayShort(bs.last)}` : ""}</div>
      </div>
      {info.kind === "kuran" && (
        <>
          <div className="seg2">
            <button className={tab === "cuz" ? "on" : ""} onClick={() => setTab("cuz")}>Cüz cüz</button>
            <button className={tab === "sure" ? "on" : ""} onClick={() => setTab("sure")}>Sûre sûre</button>
          </div>
          <div className="card" style={{ margin: "6px 16px", padding: "4px 0" }}>
            {tab === "cuz"
              ? juz.map((j) => <StatRow key={j.id} title={j.title} s={unitStat(j.pages, pageCounts(mine))} onClick={() => nav(`/istatistik/kuran/c${j.no}`)} />)
              : surePages().map((ps, i) => <StatRow key={i} title={`${i + 1}. ${sureName(i + 1)}`} s={unitStat(ps, pageCounts(mine))} onClick={() => nav(`/istatistik/kuran/s${i + 1}`)} />)}
          </div>
        </>
      )}
      {info.kind === "sections" && (
        <div className="card" style={{ margin: "10px 16px", padding: "4px 0" }}>
          {(info.sections ?? []).map((s) => <StatRow key={s.id} title={s.title} s={unitStat(range(1, s.size), pageCounts(mine.filter((r) => r.doc_key === s.id)))} onClick={() => nav(`/istatistik/${book}/${s.id}`)} />)}
        </div>
      )}
      {info.kind === "numbered" && (
        <PageGrid pages={(info.units ?? []).map((u) => u.page)} cnt={pageCounts(mine)} label={(p) => String(p)} unit={info.unit}
          open={(p) => { const u = info.units?.find((x) => x.page === p); if (u) nav(`/kutuphane/${u.id}`); }} rows={mine} />
      )}
    </>
  );
}

/* ── Bölüm: sayfa sayfa ── */
function StatsUnit({ info, unit, mine, juz, span, setSpan }: { info: BookInfo; unit: string; mine: SRow[]; juz: Juz[]; span: Span; setSpan: (s: Span) => void }) {
  const nav = useNavigate();
  let title = "", pages: number[] = [], rows = mine;
  let open: (p: number) => void = () => {};
  if (info.kind === "kuran") {
    const isJuz = unit.startsWith("c"), no = Number(unit.slice(1));
    const j = isJuz ? juz.find((x) => x.no === no) : null;
    title = isJuz ? j?.title ?? `${no}. Cüz` : `${no}. ${sureName(no)}`;
    pages = isJuz ? j?.pages ?? [] : surePages()[no - 1] ?? [];
    open = (p) => { const jj = juz.find((x) => x.pages.includes(p)); if (jj) nav(`/kutuphane/${jj.id}`, { state: { startPage: p } }); };
  } else {
    const s = info.sections?.find((x) => x.id === unit);
    title = s?.title ?? "Bölüm";
    pages = range(1, s?.size ?? 0);
    rows = mine.filter((r) => r.doc_key === unit);
    open = (p) => nav(`/kutuphane/${unit}`, { state: { startPage: p } });
  }
  if (info.kind === "kuran") rows = mine.filter((r) => pages.includes(r.page));
  const cnt = pageCounts(rows);
  const s = unitStat(pages, cnt);
  return (
    <>
      <PageHeader back title={title} subtitle={`${info.title} · İstatistik`} />
      <SpanSeg span={span} onChange={setSpan} />
      <div className="card" style={{ margin: "6px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><b>{title}</b><b style={{ color: "var(--accent)" }}>{statText(s, info.unit) || "—"}</b></div>
        <div className="muted small" style={{ marginTop: 4 }}>{s.read}/{s.size} {info.unit} en az bir kez okundu{s.last ? ` · son ${dayShort(s.last)}` : ""}</div>
      </div>
      <PageGrid pages={pages} cnt={cnt} unit={info.unit} open={open} rows={rows}
        label={(p) => String(p)} hint={info.kind === "kuran" ? (p) => pageStartLabel(p) ?? "" : undefined} />
    </>
  );
}

/** Sayfa kareleri (okunma sayısıyla) ve gün gün okuma geçmişi */
function PageGrid({ pages, cnt, label, unit, open, rows, hint }: { pages: number[]; cnt: PageCount; label: (p: number) => string; unit: string; open: (p: number) => void; rows: SRow[]; hint?: (p: number) => string }) {
  const max = Math.max(1, ...pages.map((p) => cnt.get(p)?.n ?? 0));
  const days = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const set = new Set(pages);
    for (const r of rows) if (set.has(r.page)) { const s = m.get(r.day) ?? new Set(); s.add(r.context_key + "|" + r.doc_key + "|" + r.page); m.set(r.day, s); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30);
  }, [rows, pages]);
  return (
    <>
      <div className="card" style={{ margin: "10px 16px" }}>
        <div className="muted small" style={{ marginBottom: 8 }}>Her karede {unit} numarası, altında kaç kez okunduğu. Basınca açılır.</div>
        <div className="pgrid">
          {pages.map((p) => {
            const n = cnt.get(p)?.n ?? 0;
            return (
              <button key={p} className={"pcell" + (n ? "" : " zero")} title={hint?.(p)} onClick={() => open(p)}
                style={n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(25 + (n / max) * 60)}%, var(--card))` } : undefined}>
                <span>{label(p)}</span><b>{n || "·"}</b>
              </button>
            );
          })}
        </div>
      </div>
      {days.length > 0 && (
        <div className="card" style={{ margin: "10px 16px", padding: "4px 0" }}>
          <div className="muted small" style={{ padding: "8px 16px 2px" }}>Okuma geçmişi</div>
          {days.map(([d, s]) => <div key={d} className="prow" style={{ padding: "8px 16px" }}><span>{dayShort(d)} {d.slice(0, 4)}</span><span className="pst ok">{s.size} {unit}</span></div>)}
        </div>
      )}
    </>
  );
}
