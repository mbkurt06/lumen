import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { ITEM_COLS, useRoots, type Item } from "../lib/library";
import { ymd } from "../lib/todo";
import { loadTesbihatDocs } from "../lib/loaders";

type Tesbih = { id: string; title: string; target: number; count: number; count_date: string | null };
const todayCount = (t: Tesbih) => (t.count_date === ymd() ? t.count : 0);

function TesbihForm({ init, onSave, onDelete, onClose }: { init?: Tesbih; onSave: (title: string, target: number) => void; onDelete?: () => void; onClose: () => void }) {
  const [title, setTitle] = useState(init?.title ?? "");
  const [target, setTarget] = useState(String(init?.target ?? 33));
  const ok = () => { const n = Math.max(1, Number(target) || 0); if (title.trim() && n) { onSave(title.trim(), n); onClose(); } };
  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="dialog">
        <div className="cardtitle">{init ? "Tesbihi düzenle" : "Tesbih ekle"}</div>
        <input className="field" style={{ width: "100%", marginTop: 12 }} placeholder="Ad (ör. Estağfirullah)" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <input className="field" style={{ width: "100%", marginTop: 8 }} type="number" min={1} placeholder="Hedef sayı" value={target} onChange={(e) => setTarget(e.target.value)} />
        <div className="seg">
          {onDelete && <button onClick={() => { if (window.confirm("Silinsin mi?")) { onDelete(); onClose(); } }} style={{ color: "var(--danger)" }}>Sil</button>}
          <button onClick={onClose}>Vazgeç</button>
          <button className="on" onClick={ok}>Kaydet</button>
        </div>
      </div>
    </>
  );
}

/* Tesbihatlar (tasarım: Tesbihlar) */
export function Tesbihlar() {
  const { roots } = useRoots();
  const nav = useNavigate();
  const [docs, setDocs] = useState<Item[]>([]);
  const [status, setStatus] = useState<Record<string, { sub: string; meta?: string }>>({});
  const [list, setList] = useState<Tesbih[]>([]);
  const [edit, setEdit] = useState<Tesbih | "new" | null>(null);

  const loadT = async () => {
    const { data } = await supabase.from("tesbihs").select("id,title,target,count,count_date").order("sort_order").order("created_at");
    setList((data ?? []) as Tesbih[]);
  };
  useEffect(() => { void loadT(); }, []);

  useEffect(() => {
    // Eski uygulamadaki tesbihat: Dua Ezber › Tesbihat (Arapça, okunuş ve Türkçe anlamlı sürüm)
    const de = roots["Dua Ezber"];
    if (!de) return;
    (async () => {
      const { docs: ds, counters, states: ms } = await loadTesbihatDocs(de.id, roots["Tesbihat"]?.id);
      setDocs(ds);
      const today = ymd();
      const cnt = new Map<string, number>();
      for (const m of (ms ?? []) as { content_node_id: string; repeat_count: number; last_practiced_at: string | null }[]) if (m.last_practiced_at && ymd(new Date(m.last_practiced_at)) === today) cnt.set(m.content_node_id, m.repeat_count);
      const st: Record<string, { sub: string; meta?: string }> = {};
      for (const d of ds) {
        const cs = counters.filter((c) => c.document_id === d.id);
        if (!cs.length) { st[d.id] = { sub: "Okuma" }; continue; }
        const full = cs.filter((c) => (cnt.get(c.id) ?? 0) >= Number(c.metadata.target ?? 0)).length;
        const started = cs.some((c) => (cnt.get(c.id) ?? 0) > 0);
        st[d.id] = full === cs.length ? { sub: "Bugün tamamlandı", meta: "✓" } : started ? { sub: `Bugün ${full} / ${cs.length} sayım`, meta: "Devam" } : { sub: "Bekliyor" };
      }
      setStatus(st);
    })();
  }, [roots]);

  const save = async (title: string, target: number) => {
    if (edit && edit !== "new") await supabase.from("tesbihs").update({ title, target }).eq("id", edit.id);
    else await supabase.from("tesbihs").insert({ title, target, sort_order: list.length + 1 });
    void loadT();
  };
  const del = async () => { if (edit && edit !== "new") { await supabase.from("tesbihs").delete().eq("id", edit.id); void loadT(); } };

  const namaz = docs.filter((d) => /Namazı Tesbihatı/.test(d.title));
  const other = docs.filter((d) => !/Namazı Tesbihatı/.test(d.title));
  const esma = roots["Esmâü’l-Hüsnâ"];
  const Row = ({ d, label }: { d: Item; label?: string }) => (
    <Link to={`/kutuphane/${d.id}`} className="crow">
      <span className="ibox"><Icon name="bookopen" size={22} /></span>
      <span className="cmain"><b>{label ?? d.title}</b><span>{status[d.id]?.sub ?? ""}</span></span>
      {status[d.id]?.meta && <span className="cmeta">{status[d.id]!.meta}</span>}
      <Icon name="chevron" size={18} />
    </Link>
  );
  return (
    <>
      <PageHeader back title="Tesbihatlar" subtitle="İbadet" />
      <div className="lbl">NAMAZ TESBİHATLARI</div>
      <div className="clist">
        {namaz.map((d) => <Row key={d.id} d={d} label={d.title.replace(" Tesbihatı", "").replace("Namazı", "namazı")} />)}
      </div>
      {other.length > 0 && <div className="lbl">DİĞER TESBİHATLAR</div>}
      {other.length > 0 && <div className="clist">{other.map((d) => <Row key={d.id} d={d} />)}</div>}
      <div className="lbl">İSİMLER VE ÇOK ÇEKİLENLER</div>
      {esma && (
        <div className="clist" style={{ marginBottom: 10 }}>
          <Link to={`/kutuphane/${esma.id}`} className="crow">
            <span className="ibox"><Icon name="bookopen" size={22} /></span>
            <span className="cmain"><b>Esmaül Hüsna</b><span>99 isim · her ismin yanında çekilecek sayı</span></span>
            <Icon name="chevron" size={18} />
          </Link>
        </div>
      )}
      <div className="clist">
        {list.map((t) => (
          <div key={t.id} className="crow" onClick={() => nav(`/kutuphane/tesbih/${t.id}`)} style={{ cursor: "pointer" }}>
            <span className="cmain"><b style={{ fontSize: 16 }}>{t.title}</b></span>
            <span className={"pill" + (todayCount(t) >= t.target ? " done" : "")}>{t.target}/{todayCount(t)}</span>
            <button className="tdel" onClick={(e) => { e.stopPropagation(); setEdit(t); }} aria-label="Düzenle"><Icon name="pencil" size={20} /></button>
          </div>
        ))}
      </div>
      <button className="dashed" onClick={() => setEdit("new")}>+ Tesbih ekle</button>
      {edit && <TesbihForm init={edit === "new" ? undefined : edit} onSave={(a, b) => void save(a, b)} onDelete={edit === "new" ? undefined : () => void del()} onClose={() => setEdit(null)} />}
    </>
  );
}

/* Tek tesbih sayacı */
export function TesbihCounter() {
  const { id } = useParams();
  const [t, setT] = useState<Tesbih | null>(null);
  useEffect(() => {
    void supabase.from("tesbihs").select("id,title,target,count,count_date").eq("id", id!).maybeSingle().then(({ data }) => setT(data as Tesbih | null));
  }, [id]);
  if (!t) return <PageHeader back title="Yükleniyor…" />;
  const c = todayCount(t);
  const set = (v: number) => {
    const nt = { ...t, count: Math.max(0, v), count_date: ymd() };
    setT(nt);
    try { navigator.vibrate?.(v === t.target ? [30, 60, 30] : 12); } catch { /* yok say */ }
    void supabase.from("tesbihs").update({ count: nt.count, count_date: nt.count_date }).eq("id", t.id);
  };
  return (
    <>
      <PageHeader back title={t.title} subtitle={`Hedef ${t.target}`} right={<button className="iconbtn" onClick={() => window.confirm("Sayaç sıfırlansın mı?") && set(0)} aria-label="Sıfırla"><Icon name="reset" size={22} /></button>} />
      <div className="tbar" style={{ margin: "8px 16px" }}><i style={{ width: `${Math.min(100, (c / t.target) * 100)}%` }} /></div>
      <button className={"bigcount" + (c >= t.target ? " done" : "")} onClick={() => set(c + 1)}>
        <b>{c}</b><span>/ {t.target}</span>
      </button>
      <div className="seg" style={{ padding: "0 16px" }}><button onClick={() => set(c - 1)}>−1</button></div>
    </>
  );
}
