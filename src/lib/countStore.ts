import { supabase } from "./supabase";
import { ymd } from "./todo";

/* Sayaçların cihazdaki kaydı + gönderilecekler kuyruğu.
   Her dokunuş önce cihaza yazılır (internetsiz de kaybolmaz), sonra hesaba gönderilir;
   internet yoksa kuyrukta bekler, bağlantı gelince (veya uygulama açılınca) gönderilir.
   Anahtar: içerik sayacı için düğüm kimliği, kendi tesbihlerin için "t:<id>". */
type Rec = { v: number; at: string; target: number };
const K = "lumen.counts.v1";
const Q = "lumen.countq.v1";

const read = (k: string): Record<string, Rec> => {
  try { return JSON.parse(localStorage.getItem(k) ?? "{}") as Record<string, Rec>; } catch { return {}; }
};
const write = (k: string, v: Record<string, Rec>) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yer yok */ } };

export function localCount(key: string): Rec | null { return read(K)[key] ?? null; }

/** Hesaptan gelen değer ile cihazdakini karşılaştır: hangisi daha yeniyse o. */
export function pickNewer(key: string, server: { v: number; at: string | null } | null): { v: number; at: string | null } {
  const l = localCount(key);
  if (!l) return server ?? { v: 0, at: null };
  if (!server?.at) return { v: l.v, at: l.at };
  return new Date(l.at).getTime() >= new Date(server.at).getTime() ? { v: l.v, at: l.at } : server;
}

/** Günlük sayaçlar (namaz tesbihatı) için: bugüne ait değilse 0. */
export const todayOnly = (r: { v: number; at: string | null }) => (r.at && ymd(new Date(r.at)) === ymd() ? r.v : 0);

export function putCount(key: string, target: number, v: number) {
  const rec: Rec = { v, at: new Date().toISOString(), target };
  const all = read(K); all[key] = rec; write(K, all);
  const q = read(Q); q[key] = rec; write(Q, q);
  void flushCounts();
}

let flushing = false;
export async function flushCounts() {
  if (flushing) return;
  flushing = true;
  try {
    const q = read(Q);
    for (const [key, r] of Object.entries(q)) {
      let ok = false;
      try {
        if (key.startsWith("t:")) {
          const { error } = await supabase.from("tesbihs").update({ count: r.v, count_date: ymd(new Date(r.at)) }).eq("id", key.slice(2));
          ok = !error;
        } else {
          const { error } = await supabase.from("memorization_state").upsert(
            { content_node_id: key, repeat_count: r.v, repeat_target: r.target, last_practiced_at: r.at, updated_at: r.at },
            { onConflict: "owner_id,content_node_id" },
          );
          ok = !error;
        }
      } catch { ok = false; }
      if (!ok) break; // bağlantı yok: sonra tekrar
      const cur = read(Q);
      if (cur[key]?.at === r.at) { delete cur[key]; write(Q, cur); } // bu arada yeni dokunuş olduysa onu bırak
    }
  } finally { flushing = false; }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flushCounts(); });
  setTimeout(() => { void flushCounts(); }, 3000);
}
