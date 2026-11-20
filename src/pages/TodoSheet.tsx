import { useState } from "react";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { addBookmark, listBookmarks, moveBookmark, type Bookmark, type BookmarkDraft } from "../lib/bookmarks";
import { LibPicker, type Picked } from "../components/LibPicker";
import { SECTION_LABEL, pagesText, ymd, type PageGoal, type ReadingRef, type Recurrence, type TGroup, type TList, type Todo } from "../lib/todo";
import type { Scope } from "../lib/readerSettings";

/** Kitaptaki bir yer (seçilen cümle ya da ekrandaki sayfa). */
/** page_no: numaralı sayfa belgelerinde (Tevhidname, Cevşen…) sayfa numarası */
export type Pos = { doc_id: string; node_id: string | null; book_id: string | null; scope: string; label: string; quote: string; book_title?: string; mushaf_page?: number | null; page_no?: number; unit?: string; doc_key?: string };
/** Kitaptan açılınca: yer + o kitabın ayraçları. mode: başta seçili bağlama biçimi. */
export type PlacePrefill = { pos: Pos; mode: "ayrac" | "sabit"; bookmarks: Bookmark[]; bookmarkId?: string | null };

const REC: { k: Recurrence["type"]; l: string }[] = [
  { k: "once", l: "Bir kez" }, { k: "daily", l: "Her gün" }, { k: "weekdays", l: "Hafta içi" }, { k: "weekend", l: "Hafta sonu" },
  { k: "days", l: "Belirli günler" }, { k: "weekly", l: "Haftalık" }, { k: "monthly", l: "Aylık" }, { k: "every", l: "N günde bir" },
];
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DL = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const addDays = (d: string, n: number) => ymd(new Date(new Date(d + "T12:00:00").getTime() + n * 86400000));

/* Standart görev formu: her yerden (Yapılacaklar, kitap, Kur'an, ibadet) aynı.
   Sıklık · günde kaç kez · başlangıç/bitiş · son tarih · liste · alt görevler · bağlı yer (ayraç / sabit yer / kütüphane). */
export function TodoSheet({ edit, place, lists, groups, defaultListId, initialTitle, onClose, onSaved }: {
  edit?: Todo; place?: PlacePrefill; lists: TList[]; groups: TGroup[]; defaultListId: string | null; initialTitle?: string; onClose: () => void; onSaved: (msg?: string) => void;
}) {
  const [title, setTitle] = useState(edit?.title ?? initialTitle ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [rec, setRec] = useState<Recurrence>(edit?.recurrence ?? { type: "once" });
  const [perDay, setPerDay] = useState(edit?.per_day ?? 1);
  const [start, setStart] = useState(edit?.start_date ?? ymd());
  const [end, setEnd] = useState(edit?.end_date ?? "");
  const [due, setDue] = useState(edit?.due_at ? ymd(new Date(edit.due_at)) : "");
  const [listId, setListId] = useState<string>(edit?.list_id ?? defaultListId ?? "");
  const [subs, setSubs] = useState<string[]>([]);
  // bağlı yer
  const [mode, setMode] = useState<"ayrac" | "sabit" | "yok">(place?.mode ?? "yok");
  const [bmSel, setBmSel] = useState<string>(place?.bookmarkId ?? (place?.bookmarks[0]?.id ?? "new"));
  const [bmName, setBmName] = useState("");
  const [moveHere, setMoveHere] = useState(true);
  // Yapılacaklar'dan eklerken kütüphaneden seçilen yer (kitaptan açılınca gelen "place" gibi davranır)
  const [picked, setPicked] = useState<PlacePrefill | null>(null);
  const [showPick, setShowPick] = useState(false);
  const pl = place ?? picked;
  // okuma hedefi: N sayfa / gün-hafta-ay-aralık
  const [gPer, setGPer] = useState<"none" | PageGoal["per"]>(edit?.page_goal?.per ?? "none"); // hedef isteğe bağlı
  const [gOpen, setGOpen] = useState(!!edit?.page_goal);
  const unit = edit?.page_goal?.unit ?? pl?.pos.unit ?? "sayfa";
  const Unit = unit[0].toLocaleUpperCase("tr") + unit.slice(1);
  const [gN, setGN] = useState(edit?.page_goal?.n ?? 5);
  // dönem (günde/haftada/ayda/tarih aralığında): sayı ve aralık hedefinde ortak; tür değişince korunur
  const [rEvery, setREvery] = useState<NonNullable<PageGoal["every"]>>(
    edit?.page_goal?.every ?? (edit?.page_goal && edit.page_goal.per !== "pages" ? edit.page_goal.per as NonNullable<PageGoal["every"]>
      : edit?.page_goal?.per === "pages" && !(edit.recurrence && edit.recurrence.type !== "once") ? "range" : "day"));
  const [gFrom, setGFrom] = useState(edit?.page_goal?.from ?? place?.pos.page_no ?? 1);
  const [gTo, setGTo] = useState(edit?.page_goal?.to ?? (place?.pos.page_no ?? 1) + 9);
  const [gPages, setGPages] = useState<number[] | null>(edit?.page_goal?.pages ?? null); // ayrı ayrı seçilen sayfalar
  const canPages = pl?.pos.page_no != null || edit?.page_goal?.per === "pages";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const recurring = rec.type !== "once";

  // kütüphaneden seçilince: o kitabın ayraçları; Kur'an cüzü / sayfalı kitapta aralık hedefi hazır gelir
  const onPick = async (pk: Picked) => {
    setShowPick(false);
    const bms = await listBookmarks(pk.pos.scope as Scope, pk.pos.scope === "kuran" ? null : pk.pos.book_id);
    setPicked({ pos: pk.pos, mode: "ayrac", bookmarks: bms });
    setMode("ayrac"); setBmSel("new"); setMoveHere(false);
    if (!title.trim()) setTitle(pk.title);
    if (pk.from != null) setGFrom(pk.from);
    if (pk.to != null) setGTo(pk.to);
    setGPages(pk.pages ?? null);
    if (pk.range && pk.from != null) { setGOpen(true); setGPer("pages"); }
  };

  const draft = (p: Pos): BookmarkDraft => ({
    scope: p.scope as Scope, book_id: p.book_id, document_id: p.doc_id, node_id: p.node_id, mushaf_page: p.mushaf_page ?? null,
    quote: p.quote, autoTitle: p.label, label: p.label, book_title: p.book_title,
  });

  async function save() {
    setErr("");
    const p = pl?.pos;
    const name = title.trim() || (mode === "ayrac" ? p?.book_title ?? "" : "");
    if (!name) { setErr("Görev adını yaz."); return; }
    if (rec.type === "days" && !(rec.days ?? []).length) { setErr("Hangi günler olduğunu seç."); return; }
    if ((gPer === "range" || (gPer === "pages" && rEvery === "range")) && !end) { setErr("Okuma hedefi için bitiş tarihini seç."); return; }
    setBusy(true);
    let bookmark_id: string | null = edit?.bookmark_id ?? null;
    let reading_ref: ReadingRef | null = edit?.reading_ref ?? null;
    let related = edit?.related_library_item_id ?? null;
    if (!edit && p) {
      if (mode === "ayrac") {
        if (bmSel === "new") {
          const { data, error } = await addBookmark(draft(p), bmName);
          if (error) { setErr("Ayraç kaydedilemedi: " + error.message); setBusy(false); return; }
          bookmark_id = (data as { id: string }).id;
        } else {
          bookmark_id = bmSel;
          if (moveHere) await moveBookmark(bmSel, draft(p));
        }
        reading_ref = null;
      } else if (mode === "sabit") {
        reading_ref = { kind: "konu", doc_id: p.doc_id, node_id: p.node_id, book_id: p.book_id, scope: p.scope, label: p.label, quote: p.quote.slice(0, 300), book_title: p.book_title };
      }
      related = p.book_id ?? p.doc_id;
    }
    if (edit && mode === "yok") { bookmark_id = null; reading_ref = null; }
    const goalBook = edit?.page_goal ? { book_id: edit.page_goal.book_id, scope: edit.page_goal.scope }
      : p ? { book_id: p.scope === "kuran" ? null : p.book_id, scope: p.scope } : null;
    const page_goal: PageGoal | null = gPer === "pages" && goalBook
      ? { n: gPages?.length ?? Math.abs(gTo - gFrom) + 1, per: "pages", from: gPages ? Math.min(...gPages) : Math.min(gFrom, gTo), to: gPages ? Math.max(...gPages) : Math.max(gFrom, gTo), ...(gPages ? { pages: gPages } : {}), every: rEvery, doc_key: edit?.page_goal?.doc_key ?? pl?.pos.doc_key ?? goalBook.book_id ?? undefined, unit, ...goalBook }
      : gPer !== "none" && goalBook ? { n: Math.max(1, gN), per: gPer, unit, ...goalBook } : null;
    const row: Record<string, unknown> = {
      title: name, notes: notes.trim() || null, kind: edit?.kind && edit.kind !== "okuma" && edit.kind !== "tekrar" ? edit.kind : "normal",
      list_id: listId || null, recurrence: rec, per_day: recurring ? perDay : 1,
      start_date: recurring || gPer === "range" || (gPer === "pages" && rEvery === "range") ? start : null, end_date: (recurring || gPer === "range" || (gPer === "pages" && rEvery === "range")) && end ? end : null, page_goal,
      due_at: !recurring && due ? new Date(due + "T12:00:00").toISOString() : null,
      bookmark_id, reading_ref, related_library_item_id: related,
      updated_at: new Date().toISOString(),
    };
    const res = edit
      ? await supabase.from("todos").update(row).eq("id", edit.id).select("id").single()
      : await supabase.from("todos").insert(row).select("id").single();
    if (res.error) { setErr(res.error.message); setBusy(false); return; }
    const id = (res.data as { id: string }).id;
    const clean = subs.map((s) => s.trim()).filter(Boolean);
    if (clean.length) await supabase.from("todos").insert(clean.map((s, i) => ({ title: s, parent_todo_id: id, list_id: listId || null, sort_order: i })));
    onSaved(edit ? "Görev güncellendi" : "Görev eklendi");
  }

  const p = pl?.pos;
  const editPlace = edit && (edit.bookmark || edit.reading_ref);
  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Görev">
        <div className="grab" />
        <div className="sheethead"><h2>{edit ? "Görevi düzenle" : "Görev ekle"}</h2><button className="iconbtn" onClick={onClose} aria-label="Kapat"><Icon name="close" size={22} /></button></div>

        <input className="field big" autoFocus={!p} placeholder={mode === "ayrac" && p?.book_title ? p.book_title : "Görev adı"} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="field" rows={2} style={{ width: "100%", marginTop: 8, resize: "vertical" }} placeholder="Not (isteğe bağlı)" value={notes} onChange={(e) => setNotes(e.target.value)} />

        {/* Bağlı yer */}
        {p && !edit && (
          <div className="placebox">
            <div className="lbl" style={{ padding: "10px 0 6px", display: "flex", justifyContent: "space-between" }}>
              <span>BAĞLI YER · {SECTION_LABEL[p.scope] ?? ""}{p.book_title ? " · " + p.book_title : ""}</span>
              {picked && !place && <span style={{ display: "flex", gap: 14 }}><button className="link" onClick={() => setShowPick(true)}>Değiştir</button><button className="link" onClick={() => { setPicked(null); setGPages(null); setMode("yok"); if (gPer === "pages") { setGPer("none"); setGOpen(false); } }}>Kaldır</button></span>}
            </div>
            <div className="posbox"><Icon name="bookmark" size={18} /><div><b>{p.label}</b>{p.quote && <span>“{p.quote.slice(0, 140)}{p.quote.length > 140 ? "…" : ""}”</span>}</div></div>
            <div className="seg3 three">
              <button className={mode === "ayrac" ? "on" : ""} onClick={() => setMode("ayrac")}>Kaldığım yer</button>
              <button className={mode === "sabit" ? "on" : ""} onClick={() => setMode("sabit")}>Bu cümle</button>
              <button className={mode === "yok" ? "on" : ""} onClick={() => setMode("yok")}>Bağlama</button>
            </div>
            {mode === "ayrac" && (
              <div className="bmlist">
                {pl!.bookmarks.map((b) => (
                  <label key={b.id} className={"bmrow pick" + (bmSel === b.id ? " hi" : "")}>
                    <input type="radio" name="bm" checked={bmSel === b.id} onChange={() => setBmSel(b.id)} />
                    <div className="bmtxt"><b>{b.title}</b><span>{b.label ?? b.quote ?? ""}</span></div>
                  </label>
                ))}
                <label className={"bmrow pick" + (bmSel === "new" ? " hi" : "")}>
                  <input type="radio" name="bm" checked={bmSel === "new"} onChange={() => setBmSel("new")} />
                  <div className="bmtxt" style={{ flex: 1 }}><b>Yeni ayraç</b>
                    {bmSel === "new" && <input className="field" style={{ width: "100%", marginTop: 6 }} placeholder={`Ayraç adı (ör. ${p.book_title ?? "sabah okuması"})`} value={bmName} onChange={(e) => setBmName(e.target.value)} />}
                  </div>
                </label>
                {bmSel !== "new" && (
                  <label className="bmrow pick"><input type="checkbox" checked={moveHere} onChange={(e) => setMoveHere(e.target.checked)} /><div className="bmtxt"><b>Ayracı buraya taşı</b><span>Kapalıysa ayraç olduğu yerde kalır</span></div></label>
                )}
              </div>
            )}
            {mode === "ayrac" && <p className="muted small" style={{ margin: "6px 2px 0" }}>Ayraç ilerledikçe görev de yeni yeri gösterir.</p>}
          </div>
        )}
        {editPlace && (
          <div className="placebox">
            <div className="lbl" style={{ padding: "10px 0 6px" }}>BAĞLI YER</div>
            <div className="posbox"><Icon name="bookmark" size={18} /><div><b>{edit!.bookmark ? `Ayraç: ${edit!.bookmark.title}` : edit!.reading_ref!.label}</b><span>{edit!.bookmark?.label ?? edit!.reading_ref?.quote ?? ""}</span></div></div>
            <label className="bmrow pick" style={{ border: 0, paddingLeft: 0 }}><input type="checkbox" checked={mode !== "yok"} onChange={(e) => setMode(e.target.checked ? (edit!.bookmark ? "ayrac" : "sabit") : "yok")} /><div className="bmtxt"><b>Bağlı kalsın</b></div></label>
          </div>
        )}
        {!p && !edit && (
          <button className="libpick" style={{ marginTop: 10 }} onClick={() => setShowPick(true)}><Icon name="library" size={20} /> Kütüphaneden bağla <span className="muted small" style={{ fontWeight: 400 }}>(Kur'an, Cevşen, kitap…)</span></button>
        )}
        {showPick && <LibPicker onPick={(pk) => void onPick(pk)} onClose={() => setShowPick(false)} />}

        {/* Hedef (isteğe bağlı): kitapta sayfa, Cevşen'de bab… Açılınca görünür */}
        {(p || edit?.related_library_item_id || edit?.page_goal) && (gOpen ? (
          <>
            <div className="lbl" style={{ padding: "14px 0 6px", display: "flex", justifyContent: "space-between" }}>
              <span>HEDEF ({unit.toUpperCase()})</span>
              <button className="link" onClick={() => { setGOpen(false); setGPer("none"); }}>Kaldır</button>
            </div>
            {/* önce tür: kaç sayfa mı, sayfa aralığı mı; sonra (sayıda) dönem: günde / haftada / ayda / tarih aralığında */}
            {canPages && (
              <div className="seg3 two" style={{ marginBottom: 8 }}>
                <button className={gPer !== "pages" ? "on" : ""} onClick={() => setGPer(rEvery)}>{Unit} sayısı</button>
                <button className={gPer === "pages" ? "on" : ""} onClick={() => setGPer("pages")}>{Unit} aralığı</button>
              </div>
            )}
            <div className="chipwrap">
              {([["day", "Günde"], ["week", "Haftada"], ["month", "Ayda"], ["range", "Tarih aralığında"]] as ["day" | "week" | "month" | "range", string][]).map(([k, l]) => (
                <button key={k} className={(gPer === "pages" ? rEvery === k : gPer === k) ? "on" : ""} onClick={() => { setREvery(k); if (gPer !== "pages") setGPer(k); }}>{l}</button>
              ))}
            </div>
            {gPer === "pages" && (
              <>
                {gPages ? (
                  <div className="line"><span>Seçili {unit}lar</span><span style={{ display: "flex", gap: 10, alignItems: "center" }}><b style={{ textAlign: "right" }}>{pagesText(gPages)}</b><button className="link" onClick={() => { setGFrom(Math.min(...gPages)); setGTo(Math.max(...gPages)); setGPages(null); }}>Aralığa çevir</button></span></div>
                ) : (
                  <>
                    <div className="line"><span>{Unit} (başlangıç)</span><input className="stepinp" type="number" inputMode="numeric" min={0} value={gFrom} onChange={(e) => setGFrom(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></div>
                    <div className="line"><span>{Unit} (bitiş)</span><input className="stepinp" type="number" inputMode="numeric" min={gFrom} value={gTo} onChange={(e) => setGTo(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></div>
                  </>
                )}
                {rEvery === "range" && !recurring && (
                  <>
                    <div className="line"><span>Başlangıç</span><input className="dateinp" type="date" value={start} onChange={(e) => setStart(e.target.value || ymd())} /></div>
                    <div className="line"><span>Bitiş</span><input className="dateinp" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
                  </>
                )}
                <p className="muted small" style={{ margin: "4px 2px 0" }}>{Unit} {gPages ? pagesText(gPages) : `${Math.min(gFrom, gTo)}–${Math.max(gFrom, gTo)}`} ({gPages?.length ?? Math.abs(gTo - gFrom) + 1} {unit}) {rEvery === "day" ? "her gün" : rEvery === "week" ? "her hafta" : rEvery === "month" ? "her ay" : "bu tarih aralığında"} baştan okunur. Her {unit} sonunda “okundu”ya bastıkça dolar; son {unit} okununca ayraç {gPages ? Math.min(...gPages) : Math.min(gFrom, gTo)}. {unit}ya döner.</p>
              </>
            )}
            {gPer !== "none" && gPer !== "pages" && (
              <>
                <div className="line"><span>Kaç {unit}</span>
                  <span className="stepper"><button onClick={() => setGN(Math.max(1, gN - 1))}>−</button>
                    <input className="stepinp" type="number" inputMode="numeric" min={1} value={gN} onChange={(e) => setGN(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                    <button onClick={() => setGN(gN + 1)}>+</button></span>
                </div>
                {gPer === "range" && !recurring && (
                  <>
                    <div className="line"><span>Başlangıç</span><input className="dateinp" type="date" value={start} onChange={(e) => setStart(e.target.value || ymd())} /></div>
                    <div className="line"><span>Bitiş</span><input className="dateinp" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
                  </>
                )}
                <p className="muted small" style={{ margin: "4px 2px 0" }}>“Okundu”ya bastıkça sayılır ({gPer === "day" ? "her gün" : gPer === "week" ? "her hafta" : gPer === "month" ? "her ay" : "bu aralıkta"} {gN} {unit}). Fazlası da sayılır.</p>
              </>
            )}
          </>
        ) : (
          <button className="addsub" style={{ marginTop: 10 }} onClick={() => { setGOpen(true); setGPer(rEvery); }}><Icon name="plus" size={18} /> Hedef ekle ({unit} sayısı{canPages ? `, ${unit} aralığı` : ""})</button>
        ))}

        {/* Sıklık */}
        <div className="lbl" style={{ padding: "14px 0 6px" }}>SIKLIK</div>
        <div className="chipwrap">
          {REC.map((r) => (<button key={r.k} className={rec.type === r.k ? "on" : ""} onClick={() => setRec({ type: r.k, days: r.k === "days" ? rec.days ?? [] : undefined, n: r.k === "every" ? rec.n ?? 2 : undefined })}>{r.l}</button>))}
        </div>
        {rec.type === "days" && (
          <div className="chipwrap days">
            {DAYS.map((d) => { const on = (rec.days ?? []).includes(d); return (<button key={d} className={on ? "on" : ""} onClick={() => setRec({ ...rec, days: on ? (rec.days ?? []).filter((x) => x !== d) : [...(rec.days ?? []), d] })}>{DL[d]}</button>); })}
          </div>
        )}
        {rec.type === "every" && (
          <div className="line"><span>Kaç günde bir</span><span className="stepper"><button onClick={() => setRec({ ...rec, n: Math.max(2, (rec.n ?? 2) - 1) })}>−</button><b>{rec.n ?? 2} gün</b><button onClick={() => setRec({ ...rec, n: (rec.n ?? 2) + 1 })}>+</button></span></div>
        )}
        {recurring && (
          <>
            <div className="line"><span>Günde kaç kez</span><span className="stepper"><button onClick={() => setPerDay(Math.max(1, perDay - 1))}>−</button><b>{perDay}</b><button onClick={() => setPerDay(perDay + 1)}>+</button></span></div>
            <div className="line"><span>Başlangıç</span><input className="dateinp" type="date" value={start} onChange={(e) => setStart(e.target.value || ymd())} /></div>
            <div className="line"><span>Bitiş</span><input className="dateinp" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            <div className="chipwrap small">
              {[7, 14, 30, 40].map((n) => (<button key={n} className={end === addDays(start, n - 1) ? "on" : ""} onClick={() => setEnd(addDays(start, n - 1))}>{n} gün</button>))}
              <button className={!end ? "on" : ""} onClick={() => setEnd("")}>Süresiz</button>
            </div>
          </>
        )}
        {!recurring && (
          <div className="line"><span><Icon name="calendar" size={20} /> Son tarih</span><input className="dateinp" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        )}
        <div className="line"><span>Liste</span>
          <select className="dateinp" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Listesiz</option>
            {lists.map((l) => (<option key={l.id} value={l.id}>{l.title}</option>))}
          </select>
        </div>
        {!edit && (
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
        )}
        <p className="muted small" style={{ margin: "8px 2px 0" }}>Hatırlatma ve ezber modu sonraki adımda eklenecek.</p>
        {err && <p className="error">{err}</p>}
        <button className="primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => void save()}>{edit ? "Kaydet" : "Ekle"}</button>
      </div>
    </>
  );
}
