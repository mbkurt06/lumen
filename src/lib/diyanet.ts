import { supabase } from "./supabase";
import { ymd } from "./todo";

/* Diyanet'in yayınladığı namaz vakitleri (ülke → şehir/eyalet → ilçe).
   Supabase'deki "diyanet" fonksiyonu üzerinden alınır, ~30 günlük takvim telefonda saklanır
   (internetsiz de çalışır), azaldıkça yenilenir. */
export type DItem = { id: string; name: string };
export type DDay = { d: string; imsak: string; gunes: string; ogle: string; ikindi: string; aksam: string; yatsi: string; hicri?: string };

async function api<T>(p: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("diyanet", { body: { p } });
  if (error) throw error;
  return (typeof data === "string" ? JSON.parse(data) : data) as T;
}

/** "STUTTGART" → "Stuttgart", "İSTANBUL" → "İstanbul" */
export function niceName(s: string, turkish = false) {
  const loc = turkish ? "tr-TR" : "en-US";
  return s.split(/(\s+|-)/).map((w) => (w.length > 1 ? w[0] + w.slice(1).toLocaleLowerCase(loc) : w)).join("");
}

export const ulkeler = () => api<{ UlkeID: string; UlkeAdi: string }[]>("ulkeler")
  .then((a) => a.map((x) => ({ id: x.UlkeID, name: niceName(x.UlkeAdi, true) })).sort((a, b) => a.name.localeCompare(b.name, "tr")));
export const sehirler = (ulke: string) => api<{ SehirID: string; SehirAdi: string }[]>(`sehirler/${ulke}`)
  .then((a) => a.map((x) => ({ id: x.SehirID, name: niceName(x.SehirAdi, ulke === "2") })));
export const ilceler = (sehir: string, turkish = false) => api<{ IlceID: string; IlceAdi: string }[]>(`ilceler/${sehir}`)
  .then((a) => a.map((x) => ({ id: x.IlceID, name: niceName(x.IlceAdi, turkish) })));

const key = (ilce: string) => `lumen.diyanet.${ilce}`;
export function cachedDays(ilce: string): DDay[] {
  try { const v = localStorage.getItem(key(ilce)); return v ? (JSON.parse(v) as DDay[]) : []; } catch { return []; }
}

type Raw = { MiladiTarihKisa: string; Imsak: string; Gunes: string; Ogle: string; Ikindi: string; Aksam: string; Yatsi: string; HicriTarihUzun?: string };
/** Takvimi indir, telefondakiyle birleştir (son 40 gün + ileri günler kalır). */
export async function fetchDays(ilce: string): Promise<DDay[]> {
  const raw = await api<Raw[]>(`vakitler/${ilce}`);
  const fresh = raw.map((r) => {
    const [dd, mm, yy] = r.MiladiTarihKisa.split(".");
    return { d: `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, imsak: r.Imsak, gunes: r.Gunes, ogle: r.Ogle, ikindi: r.Ikindi, aksam: r.Aksam, yatsi: r.Yatsi, hicri: r.HicriTarihUzun };
  });
  if (!fresh.length) throw new Error("boş takvim");
  const min = ymd(new Date(Date.now() - 40 * 86400000));
  const m = new Map(cachedDays(ilce).filter((x) => x.d >= min).map((x) => [x.d, x]));
  for (const f of fresh) m.set(f.d, f);
  const all = [...m.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  try { localStorage.setItem(key(ilce), JSON.stringify(all)); } catch { /* yer yok */ }
  return all;
}

/** Takvimde bugünden sonra 7 günden az kaldıysa yenilenmeli. */
export function needsRefresh(days: DDay[]) {
  const ahead = ymd(new Date(Date.now() + 7 * 86400000));
  return !days.length || days[days.length - 1].d < ahead;
}

/** "2026-11-22" + "05:50" → yerel Date */
export function at(d: string, hm: string) {
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi);
}
