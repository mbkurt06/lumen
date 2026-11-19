import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { useResume, useRoots, type Item } from "../lib/library";
import { deleteBookmark } from "../lib/bookmarks";
import { loadChildrenBySort, loadIbadetExtras, loadItemView, loadKuranItems } from "../lib/loaders";
import { Reader, ReaderSettings } from "./Reader";
import { loadRS, pullRS, saveRS, applyAll, resetRS, scopeOf, type RSettings, type Scope } from "../lib/readerSettings";
import { Tesbihlar } from "./Tesbih";
import { doneOn, inToday, isDoneToday, isRecurring, recurrenceText, useTodos } from "../lib/todo";

/* ── ortak parçalar ── */
function Resume({ scopeId }: { scopeId?: string }) {
  const rows0 = useResume(scopeId);
  const [gone, setGone] = useState<string[]>([]);
  const rows = rows0.filter((r) => !gone.includes(r.id));
  const [edit, setEdit] = useState(false);
  const [swiped, setSwiped] = useState<string | null>(null); // sola kaydırılan satır: Sil görünür
  const tx = useRef<{ id: string; x: number; y: number } | null>(null);
  const nav = useNavigate();
  const del = async (id: string, name: string) => {
    if (!window.confirm(`“${name}” ayracı silinsin mi? Bu ayraca bağlı görevler ayracın son yerini korur.`)) return;
    const { error } = await deleteBookmark(id);
    if (error) window.alert("Silinemedi: " + error.message); else setGone((g) => [...g, id]);
  };
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("lumen.resume.open") !== "0"; } catch { return true; } });
  if (!rows.length) return null;
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem("lumen.resume.open", v ? "1" : "0"); } catch { /* yok say */ } };
  return (
    <div className="card resume">
      <div className="reshead">
        <button className="reshbtn" onClick={toggle} aria-expanded={open}>KALDIĞIN YERLER</button>
        {open && <button className={"resedit" + (edit ? " on" : "")} onClick={() => { setEdit(!edit); setSwiped(null); }}>{edit ? "Bitti" : "Sil / düzenle"}</button>}
        <button className="resmeta" onClick={toggle}>{rows.length} kayıt <Icon name={open ? "chevdown" : "chevron"} size={18} /></button>
      </div>
      {open && (
        <div className="resbody">
          {rows.map((r, i) => {
            // tekrar yazmayalım: kitap adı · ayraç adı (kitap adıyla aynıysa gösterme) · yer (bölüm · sayfa)
            const book = r.bookTitle ?? r.parentTitle;
            // eski ayraçlarda yer bilgisi adın içinde ("Bölüm · Sayfa 1")
            const where = r.label ?? (r.title.startsWith(r.docTitle) ? r.title : r.docTitle);
            const name = r.title && r.title !== book && !where.startsWith(r.title) ? r.title : "";
            return (
              <div key={r.id} className={"resrow" + (swiped === r.id ? " swiped" : "")}
                onTouchStart={(e) => { tx.current = { id: r.id, x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                onTouchEnd={(e) => {
                  const t0 = tx.current; tx.current = null;
                  if (!t0 || t0.id !== r.id) return;
                  const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
                  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) setSwiped(dx < 0 ? r.id : null);
                }}>
                <span className="bm"><Icon name="bookmark" size={18} /></span>
                <div className="resmain">
                  <div className="small muted">{book}{name ? " · " + name : ""}</div>
                  <b>{where}</b>
                </div>
                {edit || swiped === r.id
                  ? <button className="resdel" onClick={() => void del(r.id, name || where)} aria-label="Ayracı sil">Sil</button>
                  : <button className={"devam sm" + (i === 0 ? "" : " alt")} onClick={() => nav(`/kutuphane/${r.docId}`, { state: { nid: r.nodeId } })}>Devam</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) { return <div className="lbl">{children}</div>; }

function CRow({ to, title, sub, meta, icon }: { to: string; title: string; sub?: string | null; meta?: string; icon?: boolean }) {
  return (
    <Link to={to} className="crow">
      {icon && <span className="ibox"><Icon name="bookopen" size={22} /></span>}
      <span className="cmain"><b>{title}</b>{sub ? <span>{sub}</span> : null}</span>
      {meta && <span className="cmeta">{meta}</span>}
      <Icon name="chevron" size={18} />
    </Link>
  );
}

/* ── Kütüphane ana sayfa: koleksiyonlar ── */
export function LibraryHome() {
  const { roots } = useRoots();
  const nav = useNavigate();
  const { todos } = useTodos();
  const libToday = todos.filter((t) => !t.parent_todo_id && t.related_library_item_id && isRecurring(t) && inToday(t));
  const bugun = libToday.length ? `Bugün ${libToday.filter(isDoneToday).length}/${libToday.length}` : "";
  const rid = (t: string) => roots[t]?.id;
  return (
    <>
      <PageHeader title="Kütüphane" right={<button className="iconbtn" onClick={() => nav("/ara")} aria-label="Ara"><Icon name="search" size={24} /></button>} />
      <div style={{ padding: "0 16px" }}><Resume /></div>
      <Label>KOLEKSİYONLAR</Label>
      <div className="clist">
        <CRow icon to="/kutuphane/c/ezber" title="Ezber" sub="Ezberlediklerin ve ezber planların" meta={bugun} />
        <CRow icon to="/kutuphane/c/ibadet" title="İbadet" sub="Tesbihat, dua, sure, ilmihal, Cevşen" />
        <CRow icon to="/kutuphane/c/kuran" title="Kur'an-ı Kerim" sub="604 sayfa · 114 sure · 30 cüz" />
        <CRow icon to={rid("Risale-i Nur") ? `/kutuphane/${rid("Risale-i Nur")}` : "/kutuphane"} title="Risale-i Nur Külliyatı" sub="Sözler, Mektubat, Lem'alar, Şuâlar…" />
        <CRow icon to={rid("HE Eserleri") ? `/kutuphane/${rid("HE Eserleri")}` : "/kutuphane"} title="HE Eserleri" sub="Kitaplar" />
        <CRow icon to="/kutuphane/c/diger" title="Diğer Kitaplar" sub="Roman, hikâye ve diğer okumalar" />
      </div>
      <div style={{ height: 24 }} />
    </>
  );
}

/* ── Sanal koleksiyonlar: ezber, ibadet, kuran, dualar, diger ── */
export function Collection() {
  const { col } = useParams();
  switch (col) {
    case "ezber": return <Ezber />;
    case "ibadet": return <Ibadet />;
    case "kuran": return <Kuran />;
    case "dualar": return <Dualar />;
    case "diger": return <Diger />;
    case "tesbihat": return <Tesbihlar />;
    default: return <PageHeader back title="Bulunamadı" />;
  }
}

function Ezber() {
  const nav = useNavigate();
  const { todos } = useTodos();
  // kütüphaneye bağlı tekrarlayan görevler (ezber modu sonraki adımda ayrı işaretlenecek)
  const rows = todos.filter((t) => !t.parent_todo_id && !t.is_completed && t.related_library_item_id && isRecurring(t));
  const todayRows = rows.filter(inToday);
  const doneToday = todayRows.filter(isDoneToday).length;
  return (
    <>
      <PageHeader back title="Ezber" subtitle="Kütüphane" />
      <div className="card" style={{ margin: "8px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><b>Bugün</b><span className="muted">{doneToday} / {todayRows.length} tamamlandı</span></div>
        <div className="tbar" style={{ marginTop: 10 }}><i style={{ width: `${todayRows.length ? (doneToday / todayRows.length) * 100 : 0}%` }} /></div>
      </div>
      <Label>TEKRARLARIM</Label>
      <div className="clist">
        {rows.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Henüz tekrar görevin yok.</p>}
        {rows.map((r) => (
          <CRow key={r.id} icon to={`/yapilacaklar/g/${r.id}`} title={r.title} sub={recurrenceText(r)} meta={r.per_day > 1 ? `${doneOn(r)}/${r.per_day}` : isDoneToday(r) ? "✓" : undefined} />
        ))}
      </div>
      <button className="dashed" onClick={() => nav("/yapilacaklar?ekle=tekrar")}>+ Tekrar görevi ekle</button>
    </>
  );
}

function Ibadet() {
  const { roots } = useRoots();
  const [cevsen, setCevsen] = useState<Item[]>([]);
  useEffect(() => {
    if (!roots["Dua Ezber"]) return;
    void loadIbadetExtras(roots["Dua Ezber"].id).then(setCevsen);
  }, [roots]);
  const r = (t: string) => (roots[t] ? `/kutuphane/${roots[t].id}` : "/kutuphane");
  const c = (t: string) => { const x = cevsen.find((i) => i.title === t); return x ? `/kutuphane/${x.id}` : "/kutuphane"; };
  return (
    <>
      <PageHeader back title="İbadet" subtitle="Kütüphane" />
      <div className="clist" style={{ marginTop: 8 }}>
        <CRow icon to="/kutuphane/c/tesbihat" title="Tesbihatlar" sub="Sabah, öğle, ikindi, akşam, yatsı" />
        <CRow icon to="/kutuphane/c/dualar" title="Dualar" sub="Namaz, sofra, ezan" />
        <CRow icon to={r("Sûreler")} title="Namaz Sureleri" sub="Fâtiha, Fîl'den Nâs'a" />
        <CRow icon to={r("İslam İlmihali")} title="İlmihal" sub="Konu başlıkları" />
        <CRow icon to={c("Cevşen-i Kebîr")} title="Cevşen" sub="100 bölüm" />
        <CRow icon to={c("Tevhidname")} title="Tevhidname" sub="Bölümler" />
        <CRow icon to={r("Esmâü’l-Hüsnâ")} title="Esmâü'l-Hüsnâ" sub="99 isim" />
      </div>
    </>
  );
}

function Dualar() {
  const { roots } = useRoots();
  const [groups, setGroups] = useState<{ title: string; items: Item[] }[]>([]);
  useEffect(() => {
    const names = ["Namaz Duaları", "Günlük Dualar"].filter((n) => roots[n]);
    if (!names.length) return;
    void Promise.all(names.map((n) => loadChildrenBySort(roots[n].id))).then((res) =>
      setGroups(res.map((items, i) => ({ title: names[i], items }))));
  }, [roots]);
  return (
    <>
      <PageHeader back title="Dualar" subtitle="İbadet" />
      {groups.map((g) => (
        <div key={g.title}>
          <Label>{g.title.toUpperCase()}</Label>
          <div className="clist">{g.items.map((i) => (<CRow key={i.id} to={`/kutuphane/${i.id}`} title={i.title} sub={i.subtitle} />))}</div>
        </div>
      ))}
    </>
  );
}

function Kuran() {
  const { roots } = useRoots();
  const [items, setItems] = useState<Item[]>([]);
  const [tab, setTab] = useState<"sure" | "cuz">("sure");
  useEffect(() => {
    const root = roots["Kur’an-ı Kerim"];
    if (!root) return;
    void loadKuranItems(root.id).then(setItems);
  }, [roots]);
  const sures = useMemo(() => items.filter((i) => i.sort_order < 1000), [items]);
  const cuzler = useMemo(() => items.filter((i) => i.sort_order >= 1000), [items]);
  const sureName = (no: number) => sures.find((s) => s.sort_order === no)?.title ?? "";
  return (
    <>
      <PageHeader back title="Kur'an-ı Kerim" subtitle="Kütüphane" />
      <div style={{ padding: "0 16px" }}><Resume scopeId={roots["Kur’an-ı Kerim"]?.id} /></div>
      <div className="seg2">
        <button className={tab === "sure" ? "on" : ""} onClick={() => setTab("sure")}>Sûreler</button>
        <button className={tab === "cuz" ? "on" : ""} onClick={() => setTab("cuz")}>Cüzler</button>
      </div>
      <div className="infoline">{tab === "sure" ? "114 sûre · Fâtiha 0. sayfa · standart Mushaf düzeni" : "30 cüz · cüz başlangıçları Mushaf sayfasına göre"}</div>
      <div className="clist">
        {tab === "sure"
          ? sures.map((s) => (<CRow key={s.id} to={`/kutuphane/${s.id}`} title={`${s.sort_order}. ${s.title}`} sub={s.subtitle} />))
          : cuzler.map((c) => {
              const m = c.metadata ?? {};
              const sub = m.start_surah ? `${sureName(Number(m.start_surah))} ${m.start_ayah}. ayet · ${Math.max(0, Number(m.start_page) - 1)}. sayfa` : c.subtitle;
              return <CRow key={c.id} to={`/kutuphane/${c.id}`} title={c.title} sub={sub} />;
            })}
      </div>
    </>
  );
}

function Diger() {
  return (
    <>
      <PageHeader back title="Diğer Kitaplar" subtitle="Kütüphane" />
      <div className="card" style={{ margin: "12px 16px" }}>
        <b>Henüz kitap yok</b>
        <p className="muted" style={{ margin: "6px 0 0" }}>Roman, hikâye ve diğer okumaların buraya eklenecek. Kitap dosyalarını gönderdiğinde içeri alırız.</p>
      </div>
    </>
  );
}

/* ── Klasör / belge (kök kimliğiyle gezinme) ── */
export function LibraryItem() {
  const { id } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [parent, setParent] = useState<Item | null>(null);
  const [kids, setKids] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, { folders: number; docs: number }>>({});
  const [loading, setLoading] = useState(true);
  const [root, setRoot] = useState<Item | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const v = await loadItemView(id!);
      if (!off) { setItem(v.item); setParent(v.parent); setRoot(v.root); setKids(v.kids); setCounts(v.counts); setLoading(false); }
    })();
    return () => { off = true; };
  }, [id]);

  const scope = scopeOf(root?.title);
  if (item?.kind === "document") return <Reader key={item.id} doc={item} parentTitle={parent?.title} scope={scope} />;
  // geri: bir üst seviyeye (koleksiyon sayfası sanal olanlar için kendi sayfasına)
  const backTo = !parent ? "/kutuphane"
    : parent.title.startsWith("Kur") && !parent.parent_id ? "/kutuphane/c/kuran"
    : parent.title === "Tesbihat" && !parent.parent_id ? "/kutuphane/c/tesbihat"
    : `/kutuphane/${parent.id}`;
  // Kitap (bölümleri belge olan klasör): içindekiler kitap sayfası görünümünde
  if (item && kids.length > 0 && kids.every((k) => k.kind === "document") && scope !== "ibadet") {
    return <BookToc item={item} parentTitle={parent?.title} kids={kids} scope={scope} backTo={backTo} />;
  }
  if (loading && !item) return <div className="rpage" />;
  const isRisale = item?.title === "Risale-i Nur";
  const sub = (k: Item) => {
    if (k.subtitle) return k.subtitle;
    const c = counts[k.id];
    if (!c) return null;
    if (c.folders) return `${c.folders} cilt`;
    if (isRisale && c.docs) return `${c.docs} bölüm`;
    return null;
  };
  return (
    <>
      <PageHeader back={backTo} title={item?.title ?? (loading ? "Yükleniyor…" : "Bulunamadı")} subtitle={parent?.title ?? "Kütüphane"} />
      {item && <div style={{ padding: "0 16px" }}><Resume scopeId={item.id} /></div>}
      {isRisale && <Label>KİTAPLAR · {kids.length}</Label>}
      <div className="clist" style={{ marginTop: isRisale ? 0 : 8 }}>
        {!loading && kids.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Bu klasör boş.</p>}
        {kids.map((k) => {
          const t = Number(((k.metadata ?? {}) as Record<string, unknown>).target ?? 0);
          return <CRow key={k.id} to={`/kutuphane/${k.id}`} title={k.title} sub={sub(k)} meta={t > 0 ? String(t) : undefined} />;
        })}
      </div>
      <div style={{ height: 24 }} />
    </>
  );
}

/* Kitabın içindekiler sayfası: okuyucuyla aynı kâğıt, yazı boyutu ve renk ayarları (bölüme göre) */
function BookToc({ item, parentTitle, kids, scope, backTo }: { item: Item; parentTitle?: string; kids: Item[]; scope: Scope; backTo: string }) {
  const nav = useNavigate();
  const [rs, setRs] = useState<RSettings>(() => loadRS(scope));
  const [show, setShow] = useState(false);
  useEffect(() => { void pullRS(scope).then((r) => { if (r) setRs(r); }); }, [scope]);
  const setR = (s: RSettings) => { setRs(s); saveRS(scope, s); };
  if (show) return <ReaderSettings title={item.title} defTheme="dark" rs={rs} onChange={setR} onBack={() => setShow(false)} onApplyAll={() => applyAll(rs)} onReset={() => { resetRS(scope); setRs(loadRS(scope)); }} onGeneral={() => nav("/ayarlar")} />;
  const rt = rs.theme === "light" ? "light" : "dark";
  return (
    <div className="rpage paged" data-rt={rt}>
      {rs.light < 1 && <div className="dim" style={{ opacity: Math.min(0.7, 1 - rs.light) }} />}
      <header className="rhead">
        <button className="iconbtn" onClick={() => nav(backTo)} aria-label="Geri"><Icon name="back" size={24} /></button>
        <div className="rtitle">{item.title}<span>{parentTitle ?? "Kütüphane"} · İçindekiler</span></div>
        <button className="iconbtn" onClick={() => setShow(true)} aria-label="Sayfa ayarları"><Icon name="sliders" size={22} /></button>
      </header>
      <div className="bookwrap">
        <article className="bookpage" data-pc={rs.paper}>
          <div className="bphead"><span>{parentTitle ?? ""}</span><span>İçindekiler</span></div>
          <div className="bpbody reader2" lang="tr" style={{ fontSize: `${rs.size}em` }}>
            <h1 className="bptitle">{item.title}</h1>
            <ol className="toc">
              {kids.map((k) => (
                <li key={k.id}><Link to={`/kutuphane/${k.id}`}><span className="tt">{k.title}</span><span className="dots" /></Link></li>
              ))}
            </ol>
          </div>
        </article>
      </div>
      <div style={{ height: 24 }} />
    </div>
  );
}
