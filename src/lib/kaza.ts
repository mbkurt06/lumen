import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { ymd } from "./todo";

/* Kaza namazı ve oruç: kıldıkça ARTAN sayaçlar.
   Her dokunuş önce telefona yazılır (internetsiz de çalışır), bağlantı gelince hesaba gönderilir.
   Hesapta her dokunuş bir satır (kaza_log); günlük toplamlar kaza_daily görünümünden okunur. */
export const NAMAZ_KINDS = [
  { k: "sabah", l: "Sabah" },
  { k: "ogle", l: "Öğle" },
  { k: "ikindi", l: "İkindi" },
  { k: "aksam", l: "Akşam" },
  { k: "yatsi", l: "Yatsı" },
  { k: "vitir", l: "Vitir" },
] as const;
export const FARZ = ["sabah", "ogle", "ikindi", "aksam", "yatsi"] as const;
export type KazaKind = (typeof NAMAZ_KINDS)[number]["k"] | "oruc";

type Row = { kind: KazaKind; day: string; total: number };
type Pending = { client_id: string; kind: KazaKind; delta: number; day: string };
const RK = "lumen.kaza.daily.v1";
const QK = "lumen.kaza.queue.v1";
const EV = "lumen-kaza";

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yer yok */ } };
const changed = () => { try { window.dispatchEvent(new Event(EV)); } catch { /* yok say */ } };

/** Telefondaki kayıt + gönderilmeyi bekleyenler → toplamlar. */
export type KazaState = { total: Record<string, number>; today: Record<string, number>; days: { day: string; byKind: Record<string, number> }[]; pending: number };
export function kazaSnapshot(): KazaState {
  const rows = read<Row[]>(RK, []);
  const q = read<Pending[]>(QK, []);
  const total: Record<string, number> = {}, today: Record<string, number> = {};
  const byDay = new Map<string, Record<string, number>>();
  const t = ymd();
  const add = (kind: string, day: string, v: number) => {
    total[kind] = (total[kind] ?? 0) + v;
    if (day === t) today[kind] = (today[kind] ?? 0) + v;
    const d = byDay.get(day) ?? {};
    d[kind] = (d[kind] ?? 0) + v;
    byDay.set(day, d);
  };
  for (const r of rows) add(r.kind, r.day, r.total);
  for (const p of q) add(p.kind, p.day, p.delta);
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, byKind]) => ({ day, byKind }));
  return { total, today, days, pending: q.length };
}

/** Bugün kılınan kaza namazı (vakit) / tutulan kaza orucu sayısı. */
export function kazaToday(what: "namaz" | "oruc") {
  const s = kazaSnapshot();
  if (what === "oruc") return s.today.oruc ?? 0;
  return NAMAZ_KINDS.reduce((a, x) => a + (s.today[x.k] ?? 0), 0);
}

export function addKaza(kind: KazaKind, delta: number) {
  const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const q = read<Pending[]>(QK, []);
  q.push({ client_id: id, kind, delta, day: ymd() });
  write(QK, q);
  changed();
  void flushKaza();
}

let flushing = false;
export async function flushKaza() {
  if (flushing) return;
  const q = read<Pending[]>(QK, []);
  if (!q.length) return;
  flushing = true;
  try {
    const { error } = await supabase.from("kaza_log").upsert(q, { onConflict: "owner_id,client_id", ignoreDuplicates: true });
    if (error) return; // internet yok ya da hata: kuyrukta bekler
    // gönderilenleri telefondaki günlük toplamlara işle, kuyruktan çıkar (bu arada eklenenler kalır)
    const rows = read<Row[]>(RK, []);
    for (const p of q) {
      const r = rows.find((x) => x.kind === p.kind && x.day === p.day);
      if (r) r.total += p.delta; else rows.push({ kind: p.kind, day: p.day, total: p.delta });
    }
    write(RK, rows);
    const sent = new Set(q.map((p) => p.client_id));
    write(QK, read<Pending[]>(QK, []).filter((p) => !sent.has(p.client_id)));
    changed();
  } catch { /* sonra tekrar */ } finally { flushing = false; }
}

/** Hesaptaki günlük toplamları al (internet yoksa telefondaki kayıt kullanılır). */
export async function pullKaza() {
  await flushKaza();
  if (read<Pending[]>(QK, []).length) return; // gönderilemeyenler varken üzerine yazma
  const { data, error } = await supabase.from("kaza_daily").select("kind,day,total").limit(5000);
  if (error || !data) return;
  write(RK, data as Row[]);
  changed();
}

export function useKaza() {
  const [s, setS] = useState<KazaState>(() => kazaSnapshot());
  const refresh = useCallback(() => setS(kazaSnapshot()), []);
  useEffect(() => {
    window.addEventListener(EV, refresh);
    window.addEventListener("online", () => void flushKaza());
    void pullKaza();
    return () => window.removeEventListener(EV, refresh);
  }, [refresh]);
  return s;
}

/** 200 → "6 ay 20 gün", 830 → "2 yıl 3 ay 20 gün" (ay 30 gün, yıl 12 ay). */
export function kazaSure(n: number) {
  if (n <= 0) return "0 gün";
  const y = Math.floor(n / 360), m = Math.floor((n % 360) / 30), d = n % 30;
  return [y ? `${y} yıl` : "", m ? `${m} ay` : "", d ? `${d} gün` : ""].filter(Boolean).join(" ");
}
