import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { supabase } from "../lib/supabase";
import { ITEM_COLS, type Item } from "../lib/library";
import { fetchDocNodes, legacyOrder, loadItemView } from "../lib/loaders";
import { fixedPages } from "../lib/bookPages";
import { getShared, setShared } from "../lib/sharedPrefs";
import { scopeOf } from "../lib/readerSettings";
import { pagesText } from "../lib/todo";
import type { Pos } from "../pages/TodoSheet";

/* Görev eklerken "Kütüphaneden bağla".
   Üstte yıldızladıkların, altta kütüphanenin bütün başlıkları.
   Kur'an: cüz ya da sûre (birden fazla seçilebilir; tek seçilince içinden sayfa seçilir).
   Cevşen, Tevhidname, kitap bölümleri: tek sayfa, aralık ya da ayrı ayrı sayfalar; aralık elle de yazılır. */

export type Picked = { pos: Pos; title: string; from?: number; to?: number; pages?: number[]; range?: boolean };
type Fav = { id: string; title: string };
type PItem = { n: number; label: string };
type View =
  | { k: "browse" }
  | { k: "kuran"; root: Item; cuz: Item[]; sure: Item[] }
  | { k: "pages"; title: string; unit: string; items: PItem[]; pre: number[]; make: (sel: number[]) => Picked | null };

const FAV_KEY = "libFavorites";
const LS = "lumen.libfav.v2";
const readLocal = (): Fav[] => { try { return JSON.parse(localStorage.getItem(LS) ?? "[]") as Fav[]; } catch { return []; } };
const writeLocal = (v: Fav[]) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* yok */ } };

const meta = (i: Item) => (i.metadata ?? {}) as Record<string, unknown>;
const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));
const isKuranRoot = (i: Item) => !i.parent_id && i.title.startsWith("Kur");
const contiguous = (s: number[]) => s.length > 0 && s[s.length - 1] - s[0] + 1 === s.length;
const sorted = (s: Iterable<number>) => [...new Set(s)].sort((a, b) => a - b);
// Kur'an: Word sayfası = gösterilen sayfa + 1
const kFrom = (i: Item) => num(meta(i).start_page) - 1;
const kTo = (i: Item) => num(meta(i).end_page) - 1;

function goalOf(sel: number[]) {
  const s = sorted(sel);
  return { from: s[0], to: s[s.length - 1], pages: contiguous(s) ? undefined : s, range: true };
}

function kuranPick(units: Item[], sel?: number[]): Picked | null {
  if (!units.length) return null;
  const all = sel ?? sorted(units.flatMap((u) => Array.from({ length: kTo(u) - kFrom(u) + 1 }, (_, i) => kFrom(u) + i)));
  if (!all.length) return null;
  const g = goalOf(all);
  const first = [...units].sort((a, b) => kFrom(a) - kFrom(b)).find((u) => g.from >= kFrom(u) && g.from <= kTo(u)) ?? units[0];
  const name = units.length <= 3 ? units.map((u) => u.title).join(", ") : `${units.length} ${units[0].sort_order >= 1000 ? "cüz" : "sûre"}`;
  return {
    title: `Kur'an · ${name}`,
    pos: { doc_id: first.id, node_id: null, book_id: null, scope: "kuran", label: `${first.title} · Sayfa ${g.from}`, quote: "", book_title: "Kur'ân-ı Kerîm", mushaf_page: g.from, page_no: g.from, doc_key: "kuran" },
    ...g,
  };
}

function numberedPick(folder: Item, kids: Item[], scope: string, sel: number[]): Picked | null {
  const g = goalOf(sel);
  const start = kids.find((k) => num(meta(k).page) === g.from) ?? kids[0];
  if (!start) return null;
  const unit = String(meta(start).unit ?? "sayfa");
  const ul = unit === "bab" ? `${g.from}. Bab` : g.from ? `Sayfa ${g.from}` : "Giriş";
  return {
    title: folder.title,
    pos: { doc_id: start.id, node_id: null, book_id: folder.id, scope, label: `${folder.title} · ${ul}`, quote: "", book_title: folder.title, page_no: g.from, unit, doc_key: folder.id },
    ...g,
  };
}

function docPick(doc: Item, bookTitle: string, scope: string, sel: number[] | null, firstNid: (p: number) => string | null): Picked {
  const g = sel?.length ? goalOf(sel) : null;
  return {
    title: doc.title,
    pos: { doc_id: doc.id, node_id: g ? firstNid(g.from) : null, book_id: doc.parent_id, scope, label: g ? `${doc.title} · Sayfa ${g.from}` : doc.title, quote: "", book_title: bookTitle, page_no: g?.from ?? (scope === "ibadet" ? undefined : 1), doc_key: doc.id },
    ...(g ?? {}),
  };
}

/* ── Sayfa seçici: dokun (tek tek) · aralık (iki uca dokun) · elle aralık yaz ── */
function PageSelect({ v, onBack, onDone }: { v: Extract<View, { k: "pages" }>; onBack: () => void; onDone: (p: Picked) => void }) {
  const [sel, setSel] = useState<Set<number>>(() => new Set(v.pre));
  const [mode, setMode] = useState<"tek" | "aralik">("tek");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const U = v.unit === "bab" ? "Bab" : "Sayfa";
  const ns = v.items.map((i) => i.n);
  const lo = Math.min(...ns), hi = Math.max(...ns);
  const addRange = (x: number, y: number) => {
    const [p, q] = [Math.min(x, y), Math.max(x, y)];
    setSel((s) => { const n = new Set(s); for (const i of ns) if (i >= p && i <= q) n.add(i); return n; });
  };
  const tap = (n: number) => {
    if (mode === "tek") { setSel((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; }); return; }
    if (anchor == null) { setAnchor(n); setSel((s) => new Set(s).add(n)); }
    else { addRange(anchor, n); setAnchor(null); }
  };
  const list = sorted(sel);
  const res = list.length ? v.make(list) : null;
  return (
    <>
      <div className="seg3 two" style={{ marginBottom: 8 }}>
        <button className={mode === "tek" ? "on" : ""} onClick={() => { setMode("tek"); setAnchor(null); }}>Tek tek</button>
        <button className={mode === "aralik" ? "on" : ""} onClick={() => setMode("aralik")}>Aralık</button>
      </div>
      <p className="muted small" style={{ margin: "0 2px 8px" }}>
        {mode === "tek" ? `Okuyacağın ${U.toLocaleLowerCase("tr")}lara dokun (ayrı ayrı seçebilirsin).` : anchor == null ? "Aralığın başına dokun." : `${anchor}. ${U.toLocaleLowerCase("tr")} · şimdi aralığın sonuna dokun.`}
      </p>
      <div className="line">
        <span>Elle aralık</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input className="stepinp" type="number" inputMode="numeric" placeholder={String(lo)} value={a} onChange={(e) => setA(e.target.value)} />
          –
          <input className="stepinp" type="number" inputMode="numeric" placeholder={String(hi)} value={b} onChange={(e) => setB(e.target.value)} />
          <button className="link" disabled={a === "" || b === ""} onClick={() => { addRange(Number(a), Number(b)); setA(""); setB(""); }}>Ekle</button>
        </span>
      </div>
      <div className="pgrid">
        {v.items.map((i) => (
          <button key={i.n} className={(sel.has(i.n) ? "on" : "") + (anchor === i.n ? " anc" : "")} onClick={() => tap(i.n)} title={i.label}>{i.n === 0 && v.unit !== "bab" ? "G" : i.n}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, margin: "10px 2px" }}>
        <button className="link" onClick={() => setSel(new Set(ns))}>Tümü</button>
        <button className="link" onClick={() => { setSel(new Set()); setAnchor(null); }}>Temizle</button>
        <span className="muted small" style={{ marginLeft: "auto" }}>{list.length ? `${U} ${pagesText(list)} · ${list.length}` : "Seçilmedi"}</span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="lpghost" style={{ flex: 1 }} onClick={onBack}>‹ Geri</button>
        <button className="primary" style={{ flex: 2, marginTop: 0 }} disabled={!res} onClick={() => res && onDone(res)}>Seç</button>
      </div>
    </>
  );
}

export function LibPicker({ onPick, onClose }: { onPick: (p: Picked) => void; onClose: () => void }) {
  const [fav, setFav] = useState<Fav[]>(readLocal);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Item[]>([]);
  const [roots, setRoots] = useState<Record<string, Item>>({});
  const [groups, setGroups] = useState<Item[]>([]); // Kütüphane ana sayfasındaki bölümler
  const [vkids, setVkids] = useState<Record<string, Item[]>>({}); // sanal bölümlerin içi (Ezber, İbadet, Diğer)
  const [stack, setStack] = useState<Item[]>([]);
  const [list, setList] = useState<Item[]>([]);
  const [view, setView] = useState<View>({ k: "browse" });
  const [busy, setBusy] = useState(false);
  const [kTab, setKTab] = useState<"cuz" | "sure">("cuz");
  const [kSel, setKSel] = useState<string[]>([]);
  const [back, setBack] = useState<View>({ k: "browse" }); // sayfa seçiciden "Geri"

  useEffect(() => {
    void getShared<Fav[]>(FAV_KEY).then((f) => { if (f) { setFav(f); writeLocal(f); } });
    // Kütüphane ana sayfasındaki düzen: Ezber · İbadet · Kur'an · Risale-i Nur · HE · Diğer
    void (async () => {
      const { data } = await supabase.from("library_items").select(ITEM_COLS).is("parent_id", null);
      const r: Record<string, Item> = {};
      for (const i of (data ?? []) as Item[]) r[i.title] = i;
      setRoots(r);
      const ezber = r["Dua Ezber"] ? legacyOrder((((await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", r["Dua Ezber"].id).order("sort_order").order("title").limit(300)).data) ?? []) as Item[]) : [];
      const cev = ["Cevşen-i Kebîr", "Tevhidname"].map((t) => ezber.find((e) => e.title === t)).filter(Boolean) as Item[];
      const pick = (...ts: string[]) => ts.map((t) => r[t]).filter(Boolean) as Item[];
      const v = (id: string, title: string, subtitle: string): Item => ({ id, parent_id: "v", kind: "virtual", title, subtitle, sort_order: 0, metadata: null });
      setVkids({
        "v:ezber": ezber,
        "v:ibadet": [...pick("Tesbihat", "Sûreler", "Namaz Duaları", "Günlük Dualar", "İslam İlmihali"), ...cev, ...pick("Esmâü’l-Hüsnâ")],
        "v:diger": [],
      });
      setGroups([
        v("v:ibadet", "İbadet", "Tesbihat, dua, sure, ilmihal, Cevşen"),
        ...pick("Kur’an-ı Kerim"),
        ...(r["Risale-i Nur"] ? [{ ...r["Risale-i Nur"], title: "Risale-i Nur Külliyatı" }] : []),
        ...pick("HE Eserleri"),
        v("v:diger", "Diğer Kitaplar", "Roman, hikâye ve diğer okumalar"),
      ]);
    })();
  }, []);

  useEffect(() => {
    const top = stack[stack.length - 1];
    if (!top) { setList([]); return; }
    if (top.kind === "virtual") { setList(vkids[top.id] ?? []); return; }
    void supabase.from("library_items").select(ITEM_COLS).eq("parent_id", top.id).order("sort_order").order("title").limit(1000)
      .then(({ data }) => setList(legacyOrder((data ?? []) as Item[])));
  }, [stack, vkids]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("library_items").select(ITEM_COLS).ilike("title", `%${q.trim()}%`).order("kind", { ascending: false }).limit(15);
      setHits((data ?? []) as Item[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const favIds = useMemo(() => new Set(fav.map((f) => f.id)), [fav]);
  const toggleFav = (f: Fav) => {
    const n = favIds.has(f.id) ? fav.filter((x) => x.id !== f.id) : [...fav, f];
    setFav(n); writeLocal(n); void setShared(FAV_KEY, n);
  };

  const scopeFor = async (it: Item) => {
    if (!it.parent_id) return { scope: scopeOf(it.title), parent: null as Item | null };
    const v = await loadItemView(it.id);
    return { scope: scopeOf((v.root ?? it).title), parent: v.parent };
  };

  const openKuran = async (root: Item) => {
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", root.id).order("sort_order").limit(300);
    const all = (data ?? []) as Item[];
    setKSel([]);
    setView({ k: "kuran", root, cuz: all.filter((i) => i.sort_order >= 1000), sure: all.filter((i) => i.sort_order < 1000) });
  };
  const kuranUnitPages = (u: Item, back: View) => {
    const items = Array.from({ length: kTo(u) - kFrom(u) + 1 }, (_, i) => ({ n: kFrom(u) + i, label: `Sayfa ${kFrom(u) + i}` }));
    setView({ k: "pages", title: `Kur'an · ${u.title}`, unit: "sayfa", items, pre: [], make: (sel) => kuranPick([u], sel) });
    setBack(back);
  };
  // bir başlığa dokununca: Kur'an → cüz/sûre; numaralı kitap → bab/sayfa; kitap bölümü → sayfalar; klasör → içine gir
  const open = async (it: Item) => {
    if (busy) return;
    if (isKuranRoot(it)) return void openKuran(it);
    setBusy(true);
    try {
      const { scope, parent } = await scopeFor(it);
      if (scope === "kuran" && Number.isFinite(kFrom(it))) { kuranUnitPages(it, { k: "browse" }); return; }
      const numberedIn = async (folder: Item) => {
        const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", folder.id).order("sort_order").limit(1000);
        const kids = ((data ?? []) as Item[]).filter((k) => k.kind === "document");
        const nk = kids.filter((k) => Number.isFinite(num(meta(k).page)));
        return nk.length && nk.length >= kids.length - 1 ? nk : null;
      };
      const folder = it.kind !== "document" ? it : Number.isFinite(num(meta(it).page)) ? parent : null;
      if (folder) {
        const nk = await numberedIn(folder);
        if (nk) {
          const unit = String(meta(nk[0]).unit ?? "sayfa");
          const items = nk.map((k) => ({ n: num(meta(k).page), label: k.title })).sort((a, b) => a.n - b.n);
          setBack({ k: "browse" });
          setView({ k: "pages", title: folder.title, unit, items, pre: it.kind === "document" ? [num(meta(it).page)] : [], make: (sel) => numberedPick(folder, nk, scope, sel) });
          return;
        }
        if (it.kind !== "document") { setStack((s) => [...s, it]); return; }
      }
      // tek belge: dua gibi sayfasız ise doğrudan; kitap bölümü ise sayfalarını hesapla
      if (scope === "ibadet") { onPick(docPick(it, parent?.title ?? it.title, scope, null, () => null)); return; }
      const nodes = await fetchDocNodes(it.id);
      const pages = fixedPages(nodes);
      const items = pages.map((_, i) => ({ n: i + 1, label: `Sayfa ${i + 1}` }));
      setBack({ k: "browse" });
      setView({ k: "pages", title: it.title, unit: "sayfa", items, pre: [], make: (sel) => docPick(it, parent?.title ?? it.title, scope, sel, (p) => pages[p - 1]?.[0]?.id ?? null) });
    } finally { setBusy(false); }
  };
  // klasörü olduğu gibi seç (sayfasız)
  const pickFolder = async (it: Item) => {
    setBusy(true);
    const { scope } = await scopeFor(it);
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("parent_id", it.id).eq("kind", "document").order("sort_order").limit(1);
    const first = ((data ?? []) as Item[])[0];
    setBusy(false);
    if (!first) return;
    onPick({ title: it.title, pos: { doc_id: first.id, node_id: null, book_id: it.id, scope, label: it.title, quote: "", book_title: it.title } });
  };
  const openById = async (id: string) => {
    const { data } = await supabase.from("library_items").select(ITEM_COLS).eq("id", id).maybeSingle();
    if (data) void open(data as Item);
  };

  const Star = ({ f }: { f: Fav }) => (
    <button className={"lpstar" + (favIds.has(f.id) ? " on" : "")} onClick={(e) => { e.stopPropagation(); toggleFav(f); }} aria-label={favIds.has(f.id) ? "Sık kullanılanlardan çıkar" : "Sık kullanılanlara ekle"}>{favIds.has(f.id) ? "★" : "☆"}</button>
  );
  // ada dokun: seç (Kur'an → cüz/sûre, Cevşen → bab seçimi…); oka dokun: alt bölümlere gir
  const drill = (it: Item) => { if (isKuranRoot(it)) void openKuran(it); else setStack((s) => [...s, it]); };
  const Row = ({ it }: { it: Item }) => {
    const group = it.kind === "virtual" || (!it.parent_id && !isKuranRoot(it)); // Ezber, İbadet, Risale, HE, Diğer
    return (
      <div className="lprow" onClick={() => (group ? drill(it) : void open(it))}>
        <Icon name={it.kind === "document" ? "bookopen" : "library"} size={18} />
        <span>{it.title}{group && it.subtitle ? <small className="muted" style={{ display: "block", fontSize: 12 }}>{it.subtitle}</small> : null}</span>
        {it.kind !== "virtual" && <Star f={{ id: it.id, title: it.title }} />}
        {it.kind !== "document" && <button className="lpdrill" onClick={(e) => { e.stopPropagation(); drill(it); }} aria-label="Alt bölümler"><Icon name="chevron" size={18} /></button>}
      </div>
    );
  };
  const top = stack[stack.length - 1];
  const head = view.k === "kuran" ? "Kur'an-ı Kerim" : view.k === "pages" ? view.title : "Kütüphaneden seç";

  return (
    <>
      <div className="scrim show" style={{ zIndex: 42 }} onClick={onClose} />
      <div className="sheet" style={{ zIndex: 43 }} role="dialog" aria-label="Kütüphaneden seç">
        <div className="grab" />
        <div className="sheethead">
          <h2 style={{ fontSize: view.k === "browse" ? undefined : 19 }}>{head}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Kapat"><Icon name="close" size={22} /></button>
        </div>

        {view.k === "pages" && <PageSelect key={view.title} v={view} onBack={() => setView(back)} onDone={onPick} />}

        {view.k === "kuran" && (() => {
          const units = kTab === "cuz" ? view.cuz : view.sure;
          const chosen = units.filter((u) => kSel.includes(u.id));
          const pages = chosen.reduce((s, u) => s + kTo(u) - kFrom(u) + 1, 0);
          return (
            <>
              <div className="seg3 two" style={{ marginBottom: 8 }}>
                <button className={kTab === "cuz" ? "on" : ""} onClick={() => { setKTab("cuz"); setKSel([]); }}>Cüz</button>
                <button className={kTab === "sure" ? "on" : ""} onClick={() => { setKTab("sure"); setKSel([]); }}>Sûre</button>
              </div>
              <p className="muted small" style={{ margin: "0 2px 8px" }}>Birden fazla seçebilirsin. Tek {kTab === "cuz" ? "cüz" : "sûre"} seçince içinden sayfa da seçebilirsin.</p>
              {kTab === "cuz" ? (
                <div className="cuzgrid">
                  {view.cuz.map((c, i) => (<button key={c.id} className={kSel.includes(c.id) ? "on" : ""} onClick={() => setKSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}>{i + 1}</button>))}
                </div>
              ) : (
                <div className="lplist" style={{ maxHeight: "42vh", overflowY: "auto" }}>
                  {view.sure.map((u) => (
                    <label key={u.id} className="lprow">
                      <input type="checkbox" checked={kSel.includes(u.id)} onChange={() => setKSel((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} />
                      <span>{u.sort_order}. {u.title}</span><span className="muted small" style={{ flex: "none" }}>{kFrom(u)}–{kTo(u)}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="muted small" style={{ margin: "8px 2px" }}>{chosen.length ? `${chosen.map((c) => c.title).slice(0, 4).join(", ")}${chosen.length > 4 ? "…" : ""} · ${pages} sayfa` : "Seçilmedi"}</p>
              {chosen.length === 1 && (
                <button className="addsub" style={{ marginBottom: 8 }} onClick={() => kuranUnitPages(chosen[0], view)}><Icon name="plus" size={18} /> {chosen[0].title} içinden sayfa seç</button>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="lpghost" style={{ flex: 1 }} onClick={() => setView({ k: "browse" })}>‹ Geri</button>
                <button className="primary" style={{ flex: 2, marginTop: 0 }} disabled={!chosen.length} onClick={() => { const p = kuranPick(chosen); if (p) onPick(p); }}>Seç</button>
              </div>
              <button className="link" style={{ marginTop: 12 }} onClick={() => { const p = kuranPick(view.cuz); if (p) onPick({ ...p, title: "Kur'an-ı Kerim", range: false }); }}>Tüm Kur'an'ı bağla (sayfa seçmeden)</button>
            </>
          );
        })()}

        {view.k === "browse" && (
          <>
            {fav.length > 0 ? (
              <>
                <div className="lbl" style={{ padding: "10px 0 6px" }}>SIK KULLANILANLAR</div>
                <div className="chipwrap">
                  {fav.map((f) => (<span key={f.id} className="lpchip"><button onClick={() => void openById(f.id)} disabled={busy}>{f.title}</button><Star f={f} /></span>))}
                </div>
              </>
            ) : (
              <p className="muted small" style={{ margin: "6px 2px 0" }}>Sık kullandıklarını ☆ ile yıldızla; burada en üstte çıkarlar.</p>
            )}
            <input className="field" style={{ width: "100%", marginTop: 12 }} placeholder="Ara: sure, kitap, dua…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q.trim().length >= 2 ? (
              <div className="lplist">{hits.map((h) => <Row key={h.id} it={h} />)}{!hits.length && <p className="muted small" style={{ padding: 12, margin: 0 }}>Bulunamadı</p>}</div>
            ) : top ? (
              <>
                <div className="lbl" style={{ padding: "14px 0 6px", display: "flex", justifyContent: "space-between" }}>
                  <span>{top.title.toLocaleUpperCase("tr")}</span>
                  <button className="link" onClick={() => setStack((s) => s.slice(0, -1))}>‹ Geri</button>
                </div>
                {top.kind !== "virtual" && top.parent_id && <button className="addsub" style={{ marginBottom: 6 }} disabled={busy} onClick={() => void pickFolder(top)}><Icon name="check" size={18} /> “{top.title}” bağla (bölüm seçmeden)</button>}
                <div className="lplist">{list.map((it) => <Row key={it.id} it={it} />)}{!list.length && top.kind === "virtual" && <p className="muted small" style={{ padding: 12, margin: 0 }}>Henüz kitap yok.</p>}</div>
              </>
            ) : (
              <>
                <div className="lbl" style={{ padding: "14px 0 6px" }}>KÜTÜPHANE</div>
                <div className="lplist">{groups.map((it) => <Row key={it.id} it={it} />)}</div>
              </>
            )}
            {busy && <p className="muted small" style={{ margin: "8px 2px" }}>Yükleniyor…</p>}
            {!Object.keys(roots).length && <p className="muted small">Yükleniyor…</p>}
          </>
        )}
      </div>
    </>
  );
}
