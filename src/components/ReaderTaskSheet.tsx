import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { supabase } from "../lib/supabase";
import { ensureList, type ReadingRef, type TGroup, type TList } from "../lib/todo";

export type Pos = Omit<ReadingRef, "kind">;
type OpenTask = { id: string; title: string; reading_ref: ReadingRef | null; list_id: string | null };

/* Kitaptan görev ekle.
   • Kaldığım yer: yeni okuma görevi olarak kaydet ya da var olan okuma görevinin yerini güncelle.
   • Konu: seçilen cümle/kelime ya da sayfa hakkında görev (araştır, sor…); görevden o yere gidilir. */
export function ReaderTaskSheet({ pos, initialTab, focusTaskId, lists, groups, onClose, onDone }: {
  pos: Pos; initialTab: "yer" | "konu"; focusTaskId?: string | null; lists: TList[]; groups: TGroup[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [listId, setListId] = useState("");
  const [tasks, setTasks] = useState<OpenTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bookTitle = pos.book_title ?? "Okuma";

  useEffect(() => {
    void supabase.from("todos").select("id,title,reading_ref,list_id").eq("kind", "okuma").eq("is_completed", false).is("parent_todo_id", null).order("updated_at", { ascending: false }).limit(100)
      .then(({ data }) => setTasks((data ?? []) as OpenTask[]));
  }, []);

  const sameBook = (t: OpenTask) => !!t.reading_ref && (pos.book_id ? t.reading_ref.book_id === pos.book_id : t.reading_ref.doc_id === pos.doc_id);
  const focused = tasks.find((t) => t.id === focusTaskId);
  const mine = tasks.filter((t) => t.id !== focusTaskId && sameBook(t));
  const others = tasks.filter((t) => t.id !== focusTaskId && !sameBook(t));

  const listFor = async (fallback: string) => listId || (await ensureList(lists, groups, fallback, "Kütüphane"));

  const saveNewYer = async () => {
    setBusy(true); setErr("");
    const ref: ReadingRef = { ...pos, kind: "yer" };
    const { error } = await supabase.from("todos").insert({
      title: name.trim() || bookTitle, kind: "okuma", list_id: await listFor("Okumalarım"),
      related_library_item_id: pos.book_id ?? pos.doc_id, related_content_node_id: pos.node_id, reading_ref: ref,
      due_at: due ? new Date(due + "T12:00:00").toISOString() : null,
    });
    setBusy(false);
    if (error) setErr(error.message); else onDone("Okuma görevi eklendi");
  };
  const moveTo = async (t: OpenTask) => {
    setBusy(true); setErr("");
    const ref: ReadingRef = { ...pos, kind: "yer" };
    const { error } = await supabase.from("todos").update({ reading_ref: ref, related_library_item_id: pos.book_id ?? pos.doc_id, related_content_node_id: pos.node_id, updated_at: new Date().toISOString() }).eq("id", t.id);
    setBusy(false);
    if (error) setErr(error.message); else onDone(`“${t.title}” kaldığın yere güncellendi`);
  };
  const saveKonu = async () => {
    const tt = title.trim();
    if (!tt) { setErr("Görevi yaz (ör. Bu kelimeyi araştır)."); return; }
    setBusy(true); setErr("");
    const ref: ReadingRef = { ...pos, kind: "konu" };
    const { error } = await supabase.from("todos").insert({
      title: tt, kind: "normal", list_id: listId || null, notes: pos.quote || null,
      related_library_item_id: pos.doc_id, related_content_node_id: pos.node_id, reading_ref: ref,
      due_at: due ? new Date(due + "T12:00:00").toISOString() : null,
    });
    setBusy(false);
    if (error) setErr(error.message); else onDone("Görev eklendi");
  };

  const TaskRow = ({ t, hi }: { t: OpenTask; hi?: boolean }) => (
    <div className={"bmrow" + (hi ? " hi" : "")}>
      <div className="bmtxt"><b>{t.title}</b><span>{t.reading_ref?.label ?? "Yer kaydı yok"}</span></div>
      <button className="bmup" disabled={busy} onClick={() => void moveTo(t)}>Güncelle</button>
    </div>
  );

  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Görev ekle">
        <div className="grab" />
        <div className="sheethead"><h2>Görev ekle</h2><button className="iconbtn" onClick={onClose} aria-label="Kapat"><Icon name="close" size={22} /></button></div>
        <div className="seg3 two">
          <button className={tab === "yer" ? "on" : ""} onClick={() => setTab("yer")}>Kaldığım yer</button>
          <button className={tab === "konu" ? "on" : ""} onClick={() => setTab("konu")}>Araştır · Sor · Not</button>
        </div>
        <div className="posbox">
          <Icon name="bookmark" size={18} />
          <div><b>{pos.label}</b>{pos.quote && <span>“{pos.quote.slice(0, 140)}{pos.quote.length > 140 ? "…" : ""}”</span>}</div>
        </div>

        {tab === "yer" ? (
          <>
            {focused && (
              <>
                <div className="lbl" style={{ padding: "12px 0 6px" }}>AÇTIĞIN GÖREV</div>
                <div className="bmlist"><TaskRow t={focused} hi /></div>
              </>
            )}
            {mine.length > 0 && (
              <>
                <div className="lbl" style={{ padding: "12px 0 6px" }}>BU KİTABIN GÖREVİNİ GÜNCELLE</div>
                <div className="bmlist">{mine.map((t) => <TaskRow key={t.id} t={t} />)}</div>
              </>
            )}
            <div className="lbl" style={{ padding: "14px 0 6px" }}>YENİ OKUMA GÖREVİ</div>
            <input className="field" style={{ width: "100%" }} value={name} placeholder={bookTitle} onChange={(e) => setName(e.target.value)} />
            <div className="line"><span><Icon name="calendar" size={20} /> Son tarih</span><input className="dateinp" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            <div className="line"><span>Liste</span>
              <select className="dateinp" value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Okumalarım</option>
                {lists.map((l) => (<option key={l.id} value={l.id}>{l.title}</option>))}
              </select>
            </div>
            {err && <p className="error">{err}</p>}
            <button className="primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void saveNewYer()}>Yeni görev olarak kaydet</button>
            {others.length > 0 && (
              <details className="othertasks">
                <summary>Başka bir okuma görevini buraya taşı · {others.length}</summary>
                <div className="bmlist">{others.map((t) => <TaskRow key={t.id} t={t} />)}</div>
              </details>
            )}
          </>
        ) : (
          <>
            <div className="chips5" style={{ marginTop: 12 }}>
              {["Araştır: ", "Sor: ", "Not al: ", "Tekrar oku: "].map((c) => (
                <button key={c} onClick={() => setTitle(c + (title.replace(/^(Araştır|Sor|Not al|Tekrar oku): /, "")))}>{c.replace(": ", "")}</button>
              ))}
            </div>
            <input className="field big" autoFocus placeholder="Ör. Bu kelimenin anlamını araştır" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="line"><span><Icon name="calendar" size={20} /> Son tarih</span><input className="dateinp" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            <div className="line"><span>Liste</span>
              <select className="dateinp" value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Listesiz</option>
                {lists.map((l) => (<option key={l.id} value={l.id}>{l.title}</option>))}
              </select>
            </div>
            {err && <p className="error">{err}</p>}
            <button className="primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void saveKonu()}>Görevi ekle</button>
          </>
        )}
      </div>
    </>
  );
}
