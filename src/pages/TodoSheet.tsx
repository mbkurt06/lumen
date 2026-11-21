import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import type { Bookmark } from "../lib/bookmarks";
import { LibPicker, type Picked } from "../components/LibPicker";
import { loadTP } from "../lib/taskPrefs";
import { SECTION_LABEL, goalMode, pagesText, ymd, type PageGoal, type ReadingRef, type Recurrence, type TaskPlace, type TGroup, type TList, type Todo } from "../lib/todo";

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
  // bağlı yer: okuma görevi (görev kendi yerini tutar, kütüphane ayracı açılmaz) · bu cümle · bağlama
  const [mode, setMode] = useState<"ayrac" | "sabit" | "yok">(place?.mode ?? (edit?.page_goal || edit?.place || edit?.bookmark_id ? "ayrac" : edit?.reading_ref ? "sabit" : "yok"));
  // Yapılacaklar'dan eklerken kütüphaneden seçilen yer (kitaptan açılınca gelen "place" gibi davranır)
  const [picked, setPicked] = useState<PlacePrefill | null>(null);
  const [showPick, setShowPick] = useState(false);
  const pl = place ?? picked;
  const eg = edit?.page_goal ?? null;
  // görev türü: takip / zorunlu
  const [strict, setStrict] = useState<boolean>(edit ? !!edit.strict : loadTP().defaultStrict);
  const unit = eg?.unit ?? pl?.pos.unit ?? "sayfa";
  const Unit = unit[0].toLocaleUpperCase("tr") + unit.slice(1);
  // okuma türü: sırayla oku (kitap gibi) ya da pay (belli sayfalar belli sürede)
  const [gMode, setGMode] = useState<"seq" | "pay">(eg ? goalMode(eg) : "seq");
  // sırayla oku: kapsam (tamamı / aralık / seçili), bitince başa dön, hedef (yok / günde / haftada / ayda / tarihe kadar)
  const [sAll, setSAll] = useState<boolean>(eg ? eg.from == null && !eg.pages?.length : true);
  const [loop, setLoop] = useState<boolean>(eg?.loop ?? (pl?.pos.scope === "ibadet"));
  const [tgt, setTgt] = useState<"none" | "day" | "week" | "month" | "range">(eg && goalMode(eg) === "seq" ? (eg.n ? (eg.per === "pages" ? "day" : eg.per) : "none") : "none");
  const [gN, setGN] = useState(eg && goalMode(eg) === "seq" && eg.n ? eg.n : 5);
  // pay: dönem ve başa dönüş
  const [rEvery, setREvery] = useState<NonNullable<PageGoal["every"]>>(eg?.every ?? "day");
  const [early, setEarly] = useState<boolean>(!!eg?.early);
  const [gFrom, setGFrom] = useState(eg?.from ?? place?.pos.page_no ?? 1);
  const [gTo, setGTo] = useState(eg?.to ?? (place?.pos.page_no ?? 1) + 9);
  const [gPages, setGPages] = useState<number[] | null>(eg?.pages ?? null); // ayrı ayrı seçilen sayfalar
  const canPages = pl?.pos.page_no != null || eg?.from != null || !!eg?.pages?.length;
  // kitabın sınırları (Cevşen 1–100, Tevhidname 0–133, Kur'an 0–604); "Tamamı" için
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(null);
  useEffect(() => {
    const pos = pl?.pos;
    const dk = eg?.doc_key ?? pos?.doc_key ?? eg?.book_id ?? undefined;
    if (!dk) { setBounds(null); return; }
    if (dk === "kuran") { setBounds({ min: 0, max: 604 }); return; }
    if (pos && dk === pos.doc_id) { setBounds(null); return; }
    void supabase.from("library_items").select("metadata").eq("parent_id", dk).not("metadata->>page", "is", null).limit(1000).then(({ data }) => {
      const ps = ((data ?? []) as { metadata: Record<string, unknown> }[]).map((d) => Number(d.metadata.page)).filter(Number.isFinite);
      setBounds(ps.length ? { min: Math.min(...ps), max: Math.max(...ps) } : null);
    });
  }, [pl?.pos.doc_key, eg?.doc_key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const recurring = rec.type !== "once";

  // kütüphaneden seçilince: kapsamın tamamı seçildiyse "sırayla oku", bir kısmı seçildiyse "pay" hazır gelir
  const onPick = async (pk: Picked) => {
    setShowPick(false);
    setPicked({ pos: pk.pos, mode: "ayrac", bookmarks: [] });
    setMode("ayrac");
    if (!title.trim()) setTitle(pk.title);
    if (pk.from != null) setGFrom(pk.from);
    if (pk.to != null) setGTo(pk.to);
    setGPages(pk.pages ?? null);
    setLoop(pk.pos.scope === "ibadet");
    let whole = !pk.range;
    if (pk.range && pk.pos.doc_key && pk.pos.doc_key !== "kuran" && pk.pos.doc_key !== pk.pos.doc_id && !pk.pages) {
      const { data } = await supabase.from("library_items").select("metadata").eq("parent_id", pk.pos.doc_key).not("metadata->>page", "is", null).limit(1000);
      const ps = ((data ?? []) as { metadata: Record<string, unknown> }[]).map((d) => Number(d.metadata.page)).filter(Number.isFinite);
      if (ps.length && pk.from! <= Math.max(1, Math.min(...ps)) && pk.to! >= Math.max(...ps)) whole = true;
    }
    setGMode(whole ? "seq" : "pay");
    setSAll(whole);
  };

  async function save() {
    setErr("");
    const p = pl?.pos;
    const reading = mode === "ayrac" && (!!p || !!eg);
    const name = title.trim() || (reading ? p?.book_title ?? "" : "");
    if (!name) { setErr("Görev adını yaz."); return; }
    if (rec.type === "days" && !(rec.days ?? []).length) { setErr("Hangi günler olduğunu seç."); return; }
    const dated = reading && ((gMode === "pay" && rEvery === "range") || (gMode === "seq" && tgt === "range"));
    if (dated && !end) { setErr("Bitiş tarihini seç."); return; }
    setBusy(true);
    let reading_ref: ReadingRef | null = edit?.reading_ref ?? null;
    let taskPlace: TaskPlace | null = edit?.place ?? null;
    let related = edit?.related_library_item_id ?? null;
    if (!edit && p) {
      reading_ref = { kind: mode === "sabit" ? "konu" : "yer", doc_id: p.doc_id, node_id: p.node_id, book_id: p.book_id, scope: p.scope, label: p.label, quote: p.quote.slice(0, 300), book_title: p.book_title };
      if (mode === "ayrac") taskPlace = { doc_id: p.doc_id, node_id: p.node_id, page: p.page_no ?? p.mushaf_page ?? null, label: p.label };
      if (mode === "yok") reading_ref = null;
      related = p.book_id ?? p.doc_id;
    }
    if (edit && mode === "yok") { reading_ref = null; taskPlace = null; }
    // eski ayraçlı görev düzenlenince: ayracın yeri görevin kendi yeri olur
    if (edit && mode === "ayrac" && !taskPlace && edit.bookmark) taskPlace = { doc_id: edit.bookmark.document_id, node_id: edit.bookmark.node_id, label: edit.bookmark.label ?? edit.bookmark.title };
    const goalBook = eg ? { book_id: eg.book_id, scope: eg.scope } : p ? { book_id: p.scope === "kuran" ? null : p.book_id, scope: p.scope } : null;
    const doc_key = eg?.doc_key ?? p?.doc_key ?? goalBook?.book_id ?? undefined;
    const sel = gPages?.length ? { from: Math.min(...gPages), to: Math.max(...gPages), pages: gPages } : { from: Math.min(gFrom, gTo), to: Math.max(gFrom, gTo) };
    const size = gPages?.length || Math.abs(gTo - gFrom) + 1;
    let page_goal: PageGoal | null = null;
    if (reading && goalBook) {
      if (gMode === "pay") {
        page_goal = { mode: "pay", per: "pages", every: rEvery, early, n: size, ...sel, doc_key, unit, ...goalBook };
      } else {
        const scopeF: { from?: number; to?: number; pages?: number[] } = sAll ? (bounds ? { from: bounds.min, to: bounds.max } : {}) : canPages ? sel : {};
        const scopeN = scopeF.pages?.length ? scopeF.pages.length : scopeF.from != null && scopeF.to != null ? Math.abs(scopeF.to - scopeF.from) + 1 : 0;
        page_goal = { mode: "seq", loop, n: tgt === "none" ? 0 : tgt === "range" && scopeN ? scopeN : Math.max(1, gN), per: tgt === "none" ? "day" : tgt, ...scopeF, doc_key, unit, ...goalBook };
      }
    }
    const row: Record<string, unknown> = {
      title: name, notes: notes.trim() || null, kind: edit?.kind && edit.kind !== "okuma" && edit.kind !== "tekrar" ? edit.kind : "normal",
      list_id: listId || null, recurrence: rec, per_day: recurring ? perDay : 1,
      start_date: recurring || dated ? start : null, end_date: (recurring || dated) && end ? end : null, page_goal,
      due_at: !recurring && due ? new Date(due + "T12:00:00").toISOString() : null,
      bookmark_id: null, reading_ref, place: taskPlace, related_library_item_id: related, strict,
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
  const editPlace = edit && (edit.place || edit.bookmark || edit.reading_ref);
  const showGoal = mode === "ayrac" && (!!p || !!eg);
  const scopeTx = gPages?.length ? pagesText(gPages) : `${Math.min(gFrom, gTo)}–${Math.max(gFrom, gTo)}`;
  const scopeEditor = (
    gPages ? (
      <div className="line"><span>Seçili {unit}lar</span><span style={{ display: "flex", gap: 10, alignItems: "center" }}><b style={{ textAlign: "right" }}>{pagesText(gPages)}</b><button className="link" onClick={() => { setGFrom(Math.min(...gPages)); setGTo(Math.max(...gPages)); setGPages(null); }}>Aralığa çevir</button></span></div>
    ) : (
      <>
        <div className="line"><span>{Unit} (başlangıç)</span><input className="stepinp" type="number" inputMode="numeric" min={0} value={gFrom} onChange={(e) => setGFrom(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></div>
        <div className="line"><span>{Unit} (bitiş)</span><input className="stepinp" type="number" inputMode="numeric" min={gFrom} value={gTo} onChange={(e) => setGTo(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></div>
      </>
    )
  );
  const dates = (
    <>
      <div className="line"><span>Başlangıç</span><input className="dateinp" type="date" value={start} onChange={(e) => setStart(e.target.value || ymd())} /></div>
      <div className="line"><span>Bitiş</span><input className="dateinp" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
    </>
  );
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
              {picked && !place && <span style={{ display: "flex", gap: 14 }}><button className="link" onClick={() => setShowPick(true)}>Değiştir</button><button className="link" onClick={() => { setPicked(null); setGPages(null); setMode("yok"); }}>Kaldır</button></span>}
            </div>
            <div className="posbox"><Icon name="bookmark" size={18} /><div><b>{p.label}</b>{p.quote && <span>“{p.quote.slice(0, 140)}{p.quote.length > 140 ? "…" : ""}”</span>}</div></div>
            <div className="seg3 three">
              <button className={mode === "ayrac" ? "on" : ""} onClick={() => setMode("ayrac")}>Okuma görevi</button>
              <button className={mode === "sabit" ? "on" : ""} onClick={() => setMode("sabit")}>Bu cümle</button>
              <button className={mode === "yok" ? "on" : ""} onClick={() => setMode("yok")}>Bağlama</button>
            </div>
            {mode === "ayrac" && <p className="muted small" style={{ margin: "6px 2px 0" }}>Görev kendi yerini tutar; okundu dedikçe ilerler. Kütüphaneye ayraç eklenmez.</p>}
          </div>
        )}
        {editPlace && (
          <div className="placebox">
            <div className="lbl" style={{ padding: "10px 0 6px" }}>BAĞLI YER</div>
            <div className="posbox"><Icon name="bookmark" size={18} /><div><b>{edit!.place?.label ?? edit!.bookmark?.label ?? edit!.bookmark?.title ?? edit!.reading_ref?.label}</b><span>{edit!.reading_ref?.book_title ?? ""}</span></div></div>
            <label className="bmrow pick" style={{ border: 0, paddingLeft: 0 }}><input type="checkbox" checked={mode !== "yok"} onChange={(e) => setMode(e.target.checked ? (edit!.reading_ref?.kind === "konu" && !eg ? "sabit" : "ayrac") : "yok")} /><div className="bmtxt"><b>Bağlı kalsın</b></div></label>
          </div>
        )}
        {!p && !edit && (
          <button className="libpick" style={{ marginTop: 10 }} onClick={() => setShowPick(true)}><Icon name="library" size={20} /> Kütüphaneden bağla <span className="muted small" style={{ fontWeight: 400 }}>(Kur'an, Cevşen, kitap…)</span></button>
        )}
        {showPick && <LibPicker onPick={(pk) => void onPick(pk)} onClose={() => setShowPick(false)} />}

        {/* Okuma: sırayla oku ya da pay */}
        {showGoal && (
          <>
            <div className="lbl" style={{ padding: "14px 0 6px" }}>OKUMA TÜRÜ</div>
            <div className="seg3 two" style={{ marginBottom: 6 }}>
              <button className={gMode === "seq" ? "on" : ""} onClick={() => setGMode("seq")}>Sırayla oku</button>
              <button className={gMode === "pay" ? "on" : ""} onClick={() => { setGMode("pay"); if (sAll && bounds) { setGFrom(bounds.min); setGTo(bounds.max); } }}>Pay</button>
            </div>
            <p className="muted small" style={{ margin: "0 2px 6px" }}>{gMode === "seq"
              ? "Kitap gibi: kaldığın yerden ilerler, her gün okuduğun üstüne eklenir."
              : `Belli ${unit}lar belli sürede: her dönem payın başından açılır.`}</p>

            {gMode === "seq" ? (
              <>
                {(canPages || bounds) && (
                  <>
                    <div className="lbl" style={{ padding: "10px 0 6px" }}>KAPSAM</div>
                    <div className="chipwrap">
                      <button className={sAll ? "on" : ""} onClick={() => { setSAll(true); setGPages(null); }}>Tamamı{bounds ? ` (${bounds.min}–${bounds.max})` : ""}</button>
                      <button className={!sAll ? "on" : ""} onClick={() => setSAll(false)}>{gPages ? `Seçili ${unit}lar` : `${Unit} aralığı`}</button>
                    </div>
                    {!sAll && scopeEditor}
                  </>
                )}
                <div className="srow" style={{ padding: "12px 0", fontSize: 15, fontWeight: 600 }}>
                  <span>Bitince başa dön (tur)<small className="muted" style={{ display: "block", fontSize: 12, fontWeight: 400, marginTop: 2 }}>{loop ? "Son " + unit + " okununca tur tamamlanır, hemen baştan devam eder" : "Son " + unit + " okununca görev tamamlanır"}</small></span>
                  <button className={"tgl" + (loop ? " on" : "")} onClick={() => setLoop(!loop)} aria-pressed={loop}><i /></button>
                </div>
                <div className="lbl" style={{ padding: "6px 0 6px" }}>HEDEF (İSTEĞE BAĞLI)</div>
                <div className="chipwrap">
                  {([["none", "Yok"], ["day", "Günde"], ["week", "Haftada"], ["month", "Ayda"], ["range", "Tarihe kadar bitir"]] as [typeof tgt, string][]).map(([k, l]) => (
                    <button key={k} className={tgt === k ? "on" : ""} onClick={() => setTgt(k)}>{l}</button>
                  ))}
                </div>
                {tgt !== "none" && tgt !== "range" && (
                  <div className="line"><span>Kaç {unit}</span>
                    <span className="stepper"><button onClick={() => setGN(Math.max(1, gN - 1))}>−</button>
                      <input className="stepinp" type="number" inputMode="numeric" min={1} value={gN} onChange={(e) => setGN(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                      <button onClick={() => setGN(gN + 1)}>+</button></span>
                  </div>
                )}
                {tgt === "range" && !recurring && dates}
                <p className="muted small" style={{ margin: "4px 2px 0" }}>{tgt === "none" ? `Hedef yok: gün gün kaç ${unit} okuduğun yine kaydedilir.` : tgt === "range" ? "Bitiş tarihine kadar kapsamın tamamı; günlük öneri gösterilir." : `${tgt === "day" ? "Her gün" : tgt === "week" ? "Her hafta" : "Her ay"} ${gN} ${unit}. Her okundu sayılır.`}</p>
              </>
            ) : (
              <>
                <div className="lbl" style={{ padding: "10px 0 6px" }}>PAY</div>
                {scopeEditor}
                <div className="chipwrap" style={{ marginTop: 8 }}>
                  {([["day", "Her gün"], ["week", "Her hafta"], ["month", "Her ay"], ["range", "Tarih aralığında"]] as ["day" | "week" | "month" | "range", string][]).map(([k, l]) => (
                    <button key={k} className={rEvery === k ? "on" : ""} onClick={() => setREvery(k)}>{l}</button>
                  ))}
                </div>
                {rEvery === "range" && !recurring && dates}
                {rEvery !== "range" && (
                  <>
                    <div className="lbl" style={{ padding: "10px 0 6px" }}>BAŞA DÖNÜŞ</div>
                    <div className="seg3 two" style={{ margin: 0 }}>
                      <button className={!early ? "on" : ""} onClick={() => setEarly(false)}>Dönem bitince</button>
                      <button className={early ? "on" : ""} onClick={() => setEarly(true)}>Pay bitince hemen</button>
                    </div>
                  </>
                )}
                <p className="muted small" style={{ margin: "6px 2px 0" }}>{Unit} {scopeTx} ({gPages?.length ?? Math.abs(gTo - gFrom) + 1} {unit}) {rEvery === "day" ? "her gün" : rEvery === "week" ? "her hafta" : rEvery === "month" ? "her ay" : "bu tarih aralığında"}.{rEvery !== "range" ? (early ? " Pay bitince hemen başa döner; sonra okudukların bir sonraki dönemin payına sayılır (en fazla bir dönem ileri)." : " Pay bitince yeni dönemi bekler; yeni dönemde baştan açılır.") : ""}</p>
              </>
            )}
          </>
        )}

        {/* Görev türü */}
        <div className="lbl" style={{ padding: "14px 0 6px" }}>GÖREV TÜRÜ</div>
        <div className="seg3 two">
          <button className={!strict ? "on" : ""} onClick={() => setStrict(false)}>Takip</button>
          <button className={strict ? "on" : ""} onClick={() => setStrict(true)}>Zorunlu</button>
        </div>
        <p className="muted small" style={{ margin: "6px 2px 0" }}>{strict
          ? "Süresi geçen dönem tamamlanmazsa Günüm'de “Tamamlanmamış”ta kalır; oradan açınca kaldığı yerden devam eder."
          : "Kendi hedefin: kaçırılan gün borç olmaz, sadece geçmişe yazılır." + (loadTP().catchUp && gMode === "seq" ? " Dünün eksiği bugüne telafi olarak eklenir (Ayarlar'dan kapatılabilir)." : "")}</p>

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
