import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { ymd, type TGroup, type TList } from "../lib/todo";

export type Tab = "tekrar" | "okuma" | "normal";
type Lib = { id: string; title: string };

// "Görev ekle" alt sayfası (tasarım: Ekle / Normal): Tekrar · Okuma · Normal.
export function TodoSheet({ initialTab = "normal", prefill, lists, groups, defaultListId, onClose, onSaved }: {
  initialTab?: Tab; prefill?: { lib: Lib; notes?: string }; lists: TList[]; groups: TGroup[]; defaultListId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [title, setTitle] = useState("");
  const [lib, setLib] = useState<Lib | null>(prefill?.lib ?? null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Lib[]>([]);
  const [daily, setDaily] = useState(1);
  const [days, setDays] = useState(40);
  const [custom, setCustom] = useState(false);
  const [due, setDue] = useState("");
  const [listId, setListId] = useState<string>(defaultListId ?? "");
  const [subs, setSubs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("library_items").select("id,title").eq("kind", "document").ilike("title", `%${q.trim()}%`).limit(8);
      setHits((data ?? []) as Lib[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function ensureList(name: string, groupName: string): Promise<string | null> {
    const found = lists.find((l) => l.title === name);
    if (found) return found.id;
    let gid = groups.find((g) => g.title === groupName)?.id ?? null;
    if (!gid) {
      const { data } = await supabase.from("todo_groups").insert({ title: groupName }).select("id").single();
      gid = (data as { id: string } | null)?.id ?? null;
    }
    const { data } = await supabase.from("todo_lists").insert({ title: name, group_id: gid }).select("id").single();
    return (data as { id: string } | null)?.id ?? null;
  }

  async function save() {
    setErr("");
    const name = tab === "normal" ? title.trim() : (lib?.title ?? title.trim());
    if (!name) { setErr(tab === "normal" ? "Görev adını yaz." : "Kütüphaneden bir içerik seç ya da ad yaz."); return; }
    setBusy(true);
    let lid: string | null = listId || null;
    if (!lid && tab !== "normal") lid = await ensureList(tab === "tekrar" ? "Ezberlerim" : "Okumalarım", "Kütüphane");
    const row: Record<string, unknown> = {
      title: name,
      kind: tab,
      list_id: lid,
      related_library_item_id: lib?.id ?? null,
      notes: prefill?.notes || null,
      due_at: tab !== "tekrar" && due ? new Date(due + "T12:00:00").toISOString() : null,
      plan: tab === "tekrar" ? { daily, days, start: ymd(), done: {} } : null,
    };
    const { data, error } = await supabase.from("todos").insert(row).select("id").single();
    if (error) { setErr(error.message); setBusy(false); return; }
    const id = (data as { id: string }).id;
    const clean = subs.map((s) => s.trim()).filter(Boolean);
    if (clean.length) await supabase.from("todos").insert(clean.map((s, i) => ({ title: s, parent_todo_id: id, list_id: lid, sort_order: i })));
    onSaved();
  }

  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Görev ekle">
        <div className="grab" />
        <div className="sheethead"><h2>Görev ekle</h2><button className="iconbtn" onClick={onClose} aria-label="Kapat"><Icon name="close" size={22} /></button></div>
        <div className="seg3">
          {(["tekrar", "okuma", "normal"] as Tab[]).map((k) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "tekrar" ? "Tekrar" : k === "okuma" ? "Okuma" : "Normal"}</button>
          ))}
        </div>

        {tab === "normal" ? (
          <>
            <input className="field big" autoFocus placeholder="Görev adı" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="subbox">
              {subs.map((s, i) => (
                <div key={i} className="subline">
                  <span className="tcircle small" />
                  <input className="inl" value={s} placeholder="Alt görev" onChange={(e) => setSubs(subs.map((x, j) => (j === i ? e.target.value : x)))} />
                  <button className="tdel" onClick={() => setSubs(subs.filter((_, j) => j !== i))} aria-label="Kaldır">×</button>
                </div>
              ))}
              <button className="addsub" onClick={() => setSubs([...subs, ""])}><Icon name="plus" size={18} /> Alt görev ekle</button>
            </div>
          </>
        ) : (
          <>
            <div className="subbox">
              {lib ? (
                <div className="subline"><Icon name="library" size={22} /><div style={{ flex: 1, fontWeight: 600 }}>{lib.title}</div><button className="link" onClick={() => setLib(null)}>Değiştir</button></div>
              ) : (
                <>
                  <input className="field" placeholder="Kütüphanede ara (tesbihat, sure, kitap…)" value={q} onChange={(e) => setQ(e.target.value)} />
                  {hits.map((h) => (<button key={h.id} className="hit" onClick={() => { setLib(h); setTitle(h.title); }}>{h.title}</button>))}
                </>
              )}
            </div>
            {tab === "tekrar" && (
              <>
                <div className="line"><span>Günlük tekrar</span>
                  <span className="stepper"><button onClick={() => setDaily(Math.max(1, daily - 1))}>−</button><b>{daily} kez</b><button onClick={() => setDaily(daily + 1)}>+</button></span>
                </div>
                <div className="muted" style={{ margin: "8px 0 6px" }}>Kaç gün sürsün</div>
                <div className="chips5">
                  {[7, 14, 30, 40].map((d) => (<button key={d} className={!custom && days === d ? "on" : ""} onClick={() => { setCustom(false); setDays(d); }}>{d}</button>))}
                  <button className={custom ? "on" : ""} onClick={() => setCustom(true)}>Özel</button>
                </div>
                {custom && <input className="field" type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} style={{ marginTop: 8, width: "100%" }} />}
              </>
            )}
          </>
        )}

        {tab !== "tekrar" && (
          <div className="line"><span><Icon name="calendar" size={20} /> Son tarih</span><input className="dateinp" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        )}
        <div className="line"><span>Liste</span>
          <select className="dateinp" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">{tab === "normal" ? "Listesiz" : tab === "tekrar" ? "Ezberlerim" : "Okumalarım"}</option>
            {lists.map((l) => (<option key={l.id} value={l.id}>{l.title}</option>))}
          </select>
        </div>
        {tab === "tekrar" && <p className="muted small" style={{ margin: "6px 0 0" }}>{days} gün, her gün {daily} kez · bugün başlar</p>}
        {err && <p className="error">{err}</p>}
        <button className="primary" style={{ marginTop: 16 }} disabled={busy} onClick={() => void save()}>Ekle</button>
      </div>
    </>
  );
}
