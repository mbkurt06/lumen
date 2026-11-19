import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { supabase } from "../lib/supabase";
import { ITEM_COLS, type Item } from "../lib/library";
import { legacyOrder, loadItemView } from "../lib/loaders";
import { getShared, setShared } from "../lib/sharedPrefs";
import { scopeOf } from "../lib/readerSettings";
import type { Pos } from "../pages/TodoSheet";

/* Görev eklerken "Kütüphaneden bağla": sık kullanılanlar (yıldızlı + en çok seçilen), arama ve gezinme.
   Kur'an seçilince cüz aralığı seçilir; Cevşen/Tevhidname gibi numaralı kitaplarda bab/sayfa hedefi açılır. */

export type Picked = { pos: Pos; title: string; from?: number; to?: number; range?: boolean };
type Fav = { id: string; title: string };
const FAV_KEY = "libFavorites";
const USE_KEY = "libUse";
const LS = "lumen.libfav.v1";

function readLocal(): { fav: Fav[]; use: Record<string, { t: string; n: number }> } {
  try { return JSON.parse(localStorage.getItem(LS) ?? "") as { fav: Fav[]; use: Record<string, { t: string; n: number }> }; } catch { return { fav: [], use: {} }; }
}
function writeLocal(v: ReturnType<typeof readLocal>) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* yok */ } }

const KURAN_ROOT_TITLE = "Kur’an-ı Kerim";
const meta = (i: Item) => (i.metadata ?? {}) as Record<string, unknown>;
const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));

/** Seçilen öğeden görev formunun "bağlı yer"ini kurar. */
async function buildPick(item: Item, cuz?: { a: Item; b: Item }): Promise<Picked | null> {
  const v = await loadItemView(item.id);
  const root = v.root ?? item;
  const scope = scopeOf(root.title);
  if (scope === "kuran") {
    // Word sayfası = gösterilen sayfa + 1
    const a = cuz?.a ?? item, b = cuz?.b ?? item;
    const isRoot = !item.parent_id;
    const from = isRoot && !cuz ? 0 : num(meta(a).start_page) - 1;
    const to = isRoot && !cuz ? 603 : num(meta(b).end_page) - 1;
    const label = cuz ? (a.id === b.id ? a.title : `${a.title} – ${b.title}`) : item.title;
    const docId = cuz ? a.id : isRoot ? (v.kids.find((k) => k.sort_order >= 1000) ?? v.kids[0])?.id : item.id;
    if (!docId) return null;
    return {
      title: `Kur'an · ${label}`,
      pos: { doc_id: docId, node_id: null, book_id: null, scope, label: `${label} · Sayfa ${from}`, quote: "", book_title: "Kur'ân-ı Kerîm", mushaf_page: from, page_no: from, doc_key: "kuran" },
      from, to, range: !!cuz || !isRoot,
    };
  }
  // numaralı sayfa/bab kitapları (Cevşen, Tevhidname): klasör ya da içindeki bir sayfa
  const folder = item.kind === "document" && Number.isFinite(num(meta(item).page)) ? v.parent : item.kind !== "document" ? item : null;
  if (folder) {
    const kids = folder.id === item.id ? v.kids : ((await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", folder.id).order("sort_order").limit(1000)).data ?? []) as Item[];
    const numbered = kids.filter((k) => k.kind === "document" && Number.isFinite(num(meta(k).page)));
    if (numbered.length && numbered.length >= kids.length - 1) {
      const pages = numbered.map((k) => num(meta(k).page));
      const max = Math.max(...pages);
      const start = item.kind === "document" ? item : numbered.find((k) => num(meta(k).page) === 1) ?? numbered[0];
      const p = num(meta(start).page);
      const unit = String(meta(start).unit ?? "sayfa");
      const ul = unit === "bab" ? `${p}. Bab` : p ? `Sayfa ${p}` : "Giriş";
      return {
        title: folder.title,
        pos: { doc_id: start.id, node_id: null, book_id: folder.id, scope, label: `${folder.title} · ${ul}`, quote: "", book_title: folder.title, page_no: p, unit, doc_key: folder.id },
        from: Math.max(1, p), to: max,
      };
    }
    if (item.kind !== "document") {
      const first = legacyOrder(kids).find((k) => k.kind === "document");
      if (!first) return null; // içinde klasörler var: gezinmeye devam
      return { title: item.title, pos: { doc_id: first.id, node_id: null, book_id: item.id, scope, label: item.title, quote: "", book_title: item.title } };
    }
  }
  // tek belge (kitap bölümü, dua…)
  const paged = scope !== "ibadet";
  return {
    title: item.title,
    pos: { doc_id: item.id, node_id: null, book_id: item.parent_id, scope, label: item.title, quote: "", book_title: v.parent?.title ?? item.title, page_no: paged ? 1 : undefined, doc_key: item.id },
    from: 1, to: 10,
  };
}

export function LibPicker({ onPick, onClose }: { onPick: (p: Picked) => void; onClose: () => void }) {
  const [store, setStore] = useState(readLocal);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Item[]>([]);
  const [stack, setStack] = useState<Item[]>([]); // gezinme yolu
  const [list, setList] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [defaults, setDefaults] = useState<Fav[]>([]);
  const [kuran, setKuran] = useState<{ root: Item; cuz: Item[] } | null>(null);
  const [ca, setCa] = useState<number | null>(null);
  const [cb, setCb] = useState<number | null>(null);

  // hesaptaki yıldızlılar ve kullanım sayıları (bütün cihazlarda aynı)
  useEffect(() => {
    void Promise.all([getShared<Fav[]>(FAV_KEY), getShared<Record<string, { t: string; n: number }>>(USE_KEY)]).then(([f, u]) => {
      const s = { fav: f ?? readLocal().fav, use: u ?? readLocal().use };
      setStore(s); writeLocal(s);
    });
    // ilk açılışta öneriler: Kur'an, Cevşen, Tevhidname
    void supabase.from("library_items").select("id,title").or(`and(parent_id.is.null,title.eq."${KURAN_ROOT_TITLE}"),title.eq."Cevşen-i Kebîr",title.eq.Tevhidname`).limit(5)
      .then(({ data }) => setDefaults(((data ?? []) as Fav[]).filter((d, i, a) => a.findIndex((x) => x.title === d.title) === i)));
  }, []);

  // gezinme: kökler ya da klasörün içi
  useEffect(() => {
    const top = stack[stack.length - 1];
    const qq = supabase.from("library_items").select(ITEM_COLS);
    void (top ? qq.eq("parent_id", top.id) : qq.is("parent_id", null)).order("sort_order").order("title").limit(400)
      .then(({ data }) => setList(legacyOrder((data ?? []) as Item[])));
  }, [stack]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("library_items").select(ITEM_COLS).ilike("title", `%${q.trim()}%`).order("kind", { ascending: false }).limit(12);
      setHits((data ?? []) as Item[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const favIds = useMemo(() => new Set(store.fav.map((f) => f.id)), [store]);
  const quick = useMemo(() => {
    const used = Object.entries(store.use).sort((a, b) => b[1].n - a[1].n).map(([id, u]) => ({ id, title: u.t })).filter((u) => !favIds.has(u.id)).slice(0, 6);
    const out = [...store.fav, ...used];
    if (out.length < 3) for (const d of defaults) if (!out.some((o) => o.id === d.id)) out.push(d);
    return out;
  }, [store, favIds, defaults]);

  const save = (s: ReturnType<typeof readLocal>, which: "fav" | "use") => {
    setStore(s); writeLocal(s);
    void setShared(which === "fav" ? FAV_KEY : USE_KEY, which === "fav" ? s.fav : s.use);
  };
  const toggleFav = (f: Fav) => save({ ...store, fav: favIds.has(f.id) ? store.fav.filter((x) => x.id !== f.id) : [...store.fav, f] }, "fav");

  const finish = async (item: Item, cuz?: { a: Item; b: Item }) => {
    setBusy(true);
    const p = await buildPick(item, cuz);
    setBusy(false);
    if (!p) { setStack((s) => [...s, item]); return; }
    const u = store.use[item.id];
    save({ ...store, use: { ...store.use, [item.id]: { t: item.title, n: (u?.n ?? 0) + 1 } } }, "use");
    onPick(p);
  };

  const choose = async (id: string) => {
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("id", id).maybeSingle();
    const it = data as Item | null;
    if (!it) return;
    // Kur'an kökü: önce cüz seçimi
    if (!it.parent_id && it.title.startsWith("Kur")) {
      const { data: k } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", it.id).gte("sort_order", 1000).order("sort_order");
      setKuran({ root: it, cuz: (k ?? []) as Item[] }); setCa(null); setCb(null);
      return;
    }
    await finish(it);
  };
  // klasöre gir ya da seç
  const open = async (it: Item) => {
    if (!it.parent_id && it.title.startsWith("Kur")) return void choose(it.id);
    if (it.kind === "document") return void finish(it);
    setStack((s) => [...s, it]);
  };

  const Star = ({ f }: { f: Fav }) => (
    <button className={"lpstar" + (favIds.has(f.id) ? " on" : "")} onClick={(e) => { e.stopPropagation(); toggleFav(f); }} aria-label={favIds.has(f.id) ? "Sık kullanılanlardan çıkar" : "Sık kullanılanlara ekle"}>{favIds.has(f.id) ? "★" : "☆"}</button>
  );
  const top = stack[stack.length - 1];

  return (
    <>
      <div className="scrim show" style={{ zIndex: 42 }} onClick={onClose} />
      <div className="sheet" style={{ zIndex: 43 }} role="dialog" aria-label="Kütüphaneden seç">
        <div className="grab" />
        <div className="sheethead">
          <h2>{kuran ? "Kur'an · cüz seç" : "Kütüphaneden seç"}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Kapat"><Icon name="close" size={22} /></button>
        </div>

        {kuran ? (
          <>
            <p className="muted small" style={{ margin: "4px 2px 10px" }}>Bir cüze dokun; birden fazla cüz için başlangıç ve bitiş cüzüne dokun.</p>
            <div className="cuzgrid">
              {kuran.cuz.map((c, i) => {
                const n = i + 1;
                const inR = ca != null && (cb ?? ca) >= n && Math.min(ca, cb ?? ca) <= n && n <= Math.max(ca, cb ?? ca);
                return <button key={c.id} className={inR ? "on" : ""} onClick={() => { if (ca == null || cb != null) { setCa(n); setCb(null); } else setCb(n); }}>{n}</button>;
              })}
            </div>
            {ca != null && (() => {
              const a = kuran.cuz[Math.min(ca, cb ?? ca) - 1], b = kuran.cuz[Math.max(ca, cb ?? ca) - 1];
              return <p className="muted small" style={{ margin: "8px 2px 0" }}>{a.title}{a.id !== b.id ? ` – ${b.title}` : ""} · Sayfa {num(meta(a).start_page) - 1}–{num(meta(b).end_page) - 1}</p>;
            })()}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button className="lpghost" style={{ flex: 1 }} onClick={() => void finish(kuran.root)}>Tüm Kur'an</button>
              <button className="primary" style={{ flex: 1, marginTop: 0 }} disabled={ca == null || busy} onClick={() => { const a = kuran.cuz[Math.min(ca!, cb ?? ca!) - 1], b = kuran.cuz[Math.max(ca!, cb ?? ca!) - 1]; void finish(a, { a, b }); }}>Seç</button>
            </div>
            <button className="link" style={{ marginTop: 10 }} onClick={() => setKuran(null)}>‹ Geri</button>
          </>
        ) : (
          <>
            <div className="lbl" style={{ padding: "10px 0 6px" }}>SIK KULLANILANLAR</div>
            <div className="chipwrap">
              {quick.map((f) => (
                <span key={f.id} className="lpchip"><button onClick={() => void choose(f.id)} disabled={busy}>{f.title}</button><Star f={f} /></span>
              ))}
            </div>
            <input className="field" style={{ width: "100%", marginTop: 12 }} placeholder="Ara: sure, kitap, dua…" value={q} onChange={(e) => setQ(e.target.value)} />
            {hits.length > 0 && (
              <div className="lplist">
                {hits.map((h) => (
                  <div key={h.id} className="lprow" onClick={() => void open(h)}>
                    <Icon name={h.kind === "document" ? "bookopen" : "library"} size={18} /><span>{h.title}</span><Star f={{ id: h.id, title: h.title }} />
                  </div>
                ))}
              </div>
            )}
            {!q.trim() && (
              <>
                <div className="lbl" style={{ padding: "14px 0 6px", display: "flex", justifyContent: "space-between" }}>
                  <span>{top ? top.title.toUpperCase() : "KÜTÜPHANE"}</span>
                  {top && <button className="link" onClick={() => setStack((s) => s.slice(0, -1))}>‹ Geri</button>}
                </div>
                {top && top.kind !== "document" && (
                  <button className="addsub" style={{ marginBottom: 6 }} disabled={busy} onClick={() => void finish(top)}><Icon name="check" size={18} /> “{top.title}” seç</button>
                )}
                <div className="lplist">
                  {list.map((it) => (
                    <div key={it.id} className="lprow" onClick={() => void open(it)}>
                      <Icon name={it.kind === "document" ? "bookopen" : "library"} size={18} /><span>{it.title}</span><Star f={{ id: it.id, title: it.title }} />
                      {it.kind !== "document" && <Icon name="chevron" size={16} />}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
