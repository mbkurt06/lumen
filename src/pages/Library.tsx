import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { ITEM_COLS, useResume, useRoots, type Item } from "../lib/library";
import { Reader } from "./Reader";
import { Tesbihlar } from "./Tesbih";
import { ymd } from "../lib/todo";

/* ── ortak parçalar ── */
function Resume({ scopeId }: { scopeId?: string }) {
  const rows = useResume(scopeId);
  const nav = useNavigate();
  if (!rows.length) return null;
  return (
    <div className="card resume">
      <div className="reshead"><span>KALDIĞIN YERLER</span><span>{rows.length} kayıt</span></div>
      <div className="resbody">
        {rows.map((r, i) => (
          <div key={r.docId} className="resrow">
            <span className="bm"><Icon name="bookmark" size={20} /></span>
            <div className="resmain">
              {r.parentTitle && <div className="small muted">{r.parentTitle} · kaldığım yer</div>}
              <b>{r.title}</b>
            </div>
            <button className={i === 0 ? "devam" : "devam alt"} onClick={() => nav(`/kutuphane/${r.docId}`)}>Devam et</button>
          </div>
        ))}
      </div>
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
  const [bugun, setBugun] = useState<string>("");
  useEffect(() => {
    void supabase.from("todos").select("kind,plan,is_completed").eq("kind", "tekrar").then(({ data }) => {
      const rows = (data ?? []) as { plan: { daily: number; done: Record<string, number> } | null }[];
      const d = ymd();
      const act = rows.filter((r) => r.plan);
      if (!act.length) return;
      setBugun(`Bugün ${act.filter((r) => (r.plan!.done?.[d] ?? 0) >= r.plan!.daily).length}/${act.length}`);
    });
  }, []);
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
  const [rows, setRows] = useState<{ id: string; title: string; plan: { daily: number; days: number; start: string; done: Record<string, number> } | null; is_completed: boolean }[]>([]);
  useEffect(() => {
    void supabase.from("todos").select("id,title,plan,is_completed").eq("kind", "tekrar").is("parent_todo_id", null).order("created_at").then(({ data }) => setRows((data ?? []) as typeof rows));
  }, []);
  const d = ymd();
  const doneToday = rows.filter((r) => r.plan && (r.plan.done?.[d] ?? 0) >= r.plan.daily).length;
  const idxOf = (p: { start: string }) => Math.round((Date.parse(d) - Date.parse(p.start)) / 86400000) + 1;
  return (
    <>
      <PageHeader back title="Ezber" subtitle="Kütüphane" />
      <div className="card" style={{ margin: "8px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><b>Bugün</b><span className="muted">{doneToday} / {rows.length} tamamlandı</span></div>
        <div className="tbar" style={{ marginTop: 10 }}><i style={{ width: `${rows.length ? (doneToday / rows.length) * 100 : 0}%` }} /></div>
      </div>
      <Label>EZBERLERİM</Label>
      <div className="clist">
        {rows.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Henüz ezber planın yok.</p>}
        {rows.map((r) => (
          <CRow key={r.id} icon to={`/yapilacaklar/g/${r.id}`} title={r.title}
            sub={r.plan ? `Gün ${Math.max(1, idxOf(r.plan))} / ${r.plan.days}` : undefined}
            meta={r.plan ? `%${Math.min(100, Math.round((Math.max(0, idxOf(r.plan)) / r.plan.days) * 100))}` : undefined} />
        ))}
      </div>
      <button className="dashed" onClick={() => nav("/yapilacaklar?ekle=tekrar")}>+ Ezbere ekle</button>
    </>
  );
}

function Ibadet() {
  const { roots } = useRoots();
  const [cevsen, setCevsen] = useState<Item[]>([]);
  useEffect(() => {
    if (!roots["Dua Ezber"]) return;
    void supabase.from("library_items").select(ITEM_COLS).eq("parent_id", roots["Dua Ezber"].id).in("title", ["Cevşen-i Kebîr", "Tevhidname"]).then(({ data }) => setCevsen((data ?? []) as Item[]));
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
    void Promise.all(names.map((n) => supabase.from("library_items").select(ITEM_COLS).eq("parent_id", roots[n].id).order("sort_order"))).then((res) =>
      setGroups(res.map((r, i) => ({ title: names[i], items: (r.data ?? []) as Item[] }))));
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
    void supabase.from("library_items").select(ITEM_COLS).eq("parent_id", root.id).order("sort_order").limit(300).then(({ data }) => setItems((data ?? []) as Item[]));
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

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const { data: me } = await supabase.from("library_items").select(ITEM_COLS).eq("id", id!).maybeSingle();
      const cur = me as Item | null;
      let par: Item | null = null;
      if (cur?.parent_id) {
        const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("id", cur.parent_id).maybeSingle();
        par = data as Item | null;
      }
      let list: Item[] = [];
      const cnt: Record<string, { folders: number; docs: number }> = {};
      if (cur && cur.kind !== "document") {
        const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", cur.id).order("sort_order").order("title").limit(1000);
        list = (data ?? []) as Item[];
        const ids = list.filter((k) => k.kind !== "document").map((k) => k.id);
        for (let i = 0; i < ids.length; i += 150) {
          const { data: g } = await supabase.from("library_items").select("parent_id,kind").in("parent_id", ids.slice(i, i + 150)).limit(5000);
          for (const r of (g ?? []) as { parent_id: string; kind: string }[]) {
            const c = (cnt[r.parent_id] ??= { folders: 0, docs: 0 });
            if (r.kind === "document") c.docs++; else c.folders++;
          }
        }
      }
      if (!off) { setItem(cur); setParent(par); setKids(list); setCounts(cnt); setLoading(false); }
    })();
    return () => { off = true; };
  }, [id]);

  if (item?.kind === "document") return <Reader key={item.id} doc={item} parentTitle={parent?.title} />;
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
      <PageHeader back="/kutuphane" title={item?.title ?? (loading ? "Yükleniyor…" : "Bulunamadı")} subtitle={parent?.title ?? "Kütüphane"} />
      {item && <div style={{ padding: "0 16px" }}><Resume scopeId={item.id} /></div>}
      {isRisale && <Label>KİTAPLAR · {kids.length}</Label>}
      <div className="clist" style={{ marginTop: isRisale ? 0 : 8 }}>
        {!loading && kids.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Bu klasör boş.</p>}
        {kids.map((k) => (<CRow key={k.id} to={`/kutuphane/${k.id}`} title={k.title} sub={sub(k)} />))}
      </div>
      <div style={{ height: 24 }} />
    </>
  );
}
