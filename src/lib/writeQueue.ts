/* İnternetsiz kayıt: görev, ayraç, not, tesbih, namaz kaydı gibi yazma istekleri internet yokken
   (ya da ağ cevap vermezse) cihazda sıraya alınır ve hemen "kaydedildi" denir. Bağlantı gelince
   sırayla hesaba gönderilir. Sırada bekleyen değişiklikler, bu tablolardan okunan listelere
   (cihazdaki kayıttan ya da ağdan gelsin) uygulanır; böylece eklenen ayraç, işaretlenen görev
   internetsiz de ekranda görünür.
   Yeni kayıtlara kimlik cihazda verilir: aynı istek iki kez giderse ikinci kez eklenmez. */

/** Sıraya alınabilen tablolar. Sayfa okuma ve kaza kayıtlarının kendi kuyruğu var. */
const TABLES = ["todos", "reader_bookmarks", "reader_notes", "tesbihs", "prayer_log", "todo_lists", "todo_groups", "user_preferences"];
/** Kimliği (id) olan tablolar: yeni kayda kimlik cihazda verilir */
const WITH_ID = new Set(["todos", "reader_bookmarks", "reader_notes", "tesbihs", "todo_lists", "todo_groups"]);
/** Veri tabanının varsayılanları (internetsiz eklenen kaydın ekranda eksik görünmemesi için) */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  todos: { is_completed: false, sort_order: 0, priority: 0, kind: "normal", per_day: 1, progress: {}, strict: false, laps: [] },
  tesbihs: { target: 33, count: 0, sort_order: 0 },
  todo_lists: { sort_order: 0 },
  todo_groups: { sort_order: 0 },
};

type Row = Record<string, unknown>;
type Filter = { col: string; op: string; val: string };
export type QItem = {
  qid: string; t: number; table: string; method: string; url: string;
  headers: Record<string, string>; body: string | null;
  rows?: Row[]; filters: Filter[]; upsert?: string[] | null;
};

const QK = "lumen.writeq.v1";
const FK = "lumen.writeq.failed.v1";
const EV = "lumen-writeq";
const readQ = (k = QK): QItem[] => { try { return JSON.parse(localStorage.getItem(k) ?? "[]") as QItem[]; } catch { return []; } };
const writeQ = (q: QItem[], k = QK) => {
  try { localStorage.setItem(k, JSON.stringify(q)); } catch { /* yer yok */ }
  if (k === QK && typeof window !== "undefined") window.dispatchEvent(new Event(EV));
};
export const pendingWrites = () => readQ().length;
export const failedWrites = () => readQ(FK);
export const onWritesChange = (fn: () => void) => { window.addEventListener(EV, fn); return () => window.removeEventListener(EV, fn); };

const uuid = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* yok */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });
};

export function tableOf(url: string): string | null {
  const m = /\/rest\/v1\/([a-z_]+)(?:\?|$)/.exec(url);
  return m && TABLES.includes(m[1]) ? m[1] : null;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict", "or", "and"]);
function filtersOf(u: URL): Filter[] {
  const out: Filter[] = [];
  u.searchParams.forEach((v, col) => {
    if (RESERVED.has(col) || col.includes(".")) return; // gömülü tablo süzgeçleri uygulanmaz
    const i = v.indexOf(".");
    if (i < 0) return;
    out.push({ col, op: v.slice(0, i), val: v.slice(i + 1) });
  });
  return out;
}
const str = (x: unknown) => (x === null || x === undefined ? null : typeof x === "object" ? JSON.stringify(x) : String(x));
function matches(row: Row, fs: Filter[]): boolean {
  for (const f of fs) {
    const rv = str(row[f.col]);
    switch (f.op) {
      case "eq": if (rv !== f.val) return false; break;
      case "neq": if (rv === f.val) return false; break;
      case "is": if (f.val === "null" ? rv !== null : rv !== f.val) return false; break;
      case "in": { const list = f.val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")); if (rv === null || !list.includes(rv)) return false; break; }
      case "gt": case "gte": case "lt": case "lte": {
        if (rv === null) return false;
        const a = isNaN(Number(rv)) || isNaN(Number(f.val)) ? rv.localeCompare(f.val) : Number(rv) - Number(f.val);
        if ((f.op === "gt" && !(a > 0)) || (f.op === "gte" && !(a >= 0)) || (f.op === "lt" && !(a < 0)) || (f.op === "lte" && !(a <= 0))) return false;
        break;
      }
      default: break; // bilinmeyen süzgeç: kabul
    }
  }
  return true;
}

function ownerId(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (/^sb-.*-auth-token$/.test(k)) return (JSON.parse(localStorage.getItem(k)!) as { user?: { id?: string } }).user?.id ?? null;
    }
  } catch { /* yok */ }
  return null;
}

/** Yazma isteğini kuyruğa uygun hâle getir: yeni kayıtlara kimlik ver, süzgeçleri çıkar. */
export async function prepare(req: Request, table: string): Promise<QItem> {
  const u = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { if (k !== "authorization") headers[k] = v; });
  let body = req.method === "GET" || req.method === "DELETE" ? null : await req.clone().text();
  const prefer = req.headers.get("prefer") ?? "";
  const upsert = req.method === "POST" && /resolution=/.test(prefer) ? (u.searchParams.get("on_conflict") ?? "id").split(",").filter((c) => c !== "owner_id") : null;
  let rows: Row[] | undefined;
  if (body && (req.method === "POST" || req.method === "PATCH")) {
    try {
      const parsed = JSON.parse(body) as Row | Row[];
      rows = Array.isArray(parsed) ? parsed : [parsed];
      if (req.method === "POST" && !upsert && WITH_ID.has(table)) {
        for (const r of rows) if (!r.id) r.id = uuid();
        body = JSON.stringify(Array.isArray(parsed) ? rows : rows[0]);
        const cols = u.searchParams.get("columns");
        if (cols && !cols.includes('"id"')) u.searchParams.set("columns", cols + ',"id"');
      }
    } catch { /* JSON değil */ }
  }
  return { qid: uuid(), t: Date.now(), table, method: req.method, url: u.toString(), headers, body, rows, filters: req.method === "POST" ? [] : filtersOf(u), upsert };
}

export function enqueue(it: QItem) { const q = readQ(); q.push(it); writeQ(q); }

/** Sıraya alınan istek için sunucu gibi cevap ver */
export function fakeResponse(it: QItem): Response {
  const prefer = it.headers["prefer"] ?? "";
  const single = (it.headers["accept"] ?? "").includes("vnd.pgrst.object");
  if (!/return=representation/.test(prefer)) return new Response(null, { status: it.method === "POST" ? 201 : 204 });
  const now = new Date().toISOString();
  let out: Row[];
  if (it.method === "POST") out = (it.rows ?? []).map((r) => ({ ...DEFAULTS[it.table], owner_id: ownerId(), created_at: now, updated_at: now, ...r }));
  else if (it.method === "PATCH") out = [{ ...Object.fromEntries(it.filters.filter((f) => f.op === "eq").map((f) => [f.col, f.val])), ...(it.rows?.[0] ?? {}) }];
  else out = [Object.fromEntries(it.filters.filter((f) => f.op === "eq").map((f) => [f.col, f.val]))];
  return new Response(JSON.stringify(single ? out[0] ?? null : out), { status: it.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
}

/** Okunan listeye, sırada bekleyen değişiklikleri uygula */
export async function overlay(req: Request, res: Response, table: string): Promise<Response> {
  const q = readQ().filter((x) => x.table === table);
  if (!q.length || !res.ok || req.method !== "GET") return res;
  let data: unknown;
  try { data = await res.clone().json(); } catch { return res; }
  const single = !Array.isArray(data);
  let rows: Row[] = single ? (data ? [data as Row] : []) : (data as Row[]);
  const fs = filtersOf(new URL(req.url));
  const now = new Date().toISOString();
  let added = false;
  for (const it of q) {
    if (it.method === "POST") {
      for (const r of it.rows ?? []) {
        const i = it.upsert ? rows.findIndex((x) => it.upsert!.every((c) => str(x[c]) === str(r[c]))) : rows.findIndex((x) => r.id && x.id === r.id);
        if (i >= 0) { rows[i] = { ...rows[i], ...r }; continue; }
        const full = { ...DEFAULTS[table], owner_id: ownerId(), created_at: now, updated_at: now, ...r };
        if (!single && matches(full, fs)) { rows.push(full); added = true; }
      }
    } else if (it.method === "PATCH") {
      const patch = it.rows?.[0] ?? {};
      rows = rows.map((x) => (matches(x, it.filters) ? { ...x, ...patch } : x));
    } else if (it.method === "DELETE") {
      rows = rows.filter((x) => !matches(x, it.filters));
    }
  }
  // güncellenen satır artık süzgece uymuyorsa çıkar (ör. tamamlanan görev "yapılacaklar" listesinden)
  rows = rows.filter((x) => matches(x, fs));
  const ord = new URL(req.url).searchParams.get("order");
  if (added && ord) {
    const parts = ord.split(",").map((p) => { const [c, d] = p.split("."); return { c, desc: d === "desc" }; });
    rows.sort((a, b) => {
      for (const p of parts) {
        const x = a[p.c], y = b[p.c];
        if (x === y) continue;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return p.desc ? -r : r;
      }
      return 0;
    });
  }
  const outBody = single ? JSON.stringify(rows[0] ?? data) : JSON.stringify(rows);
  const h = new Headers(res.headers);
  h.delete("content-length");
  return new Response(outBody, { status: res.status, statusText: res.statusText, headers: h });
}

/* ── Gönderme ── */
let flushing = false;
export async function flushWrites(send: (url: string, init: RequestInit) => Promise<Response>): Promise<void> {
  if (flushing || !readQ().length) return;
  flushing = true;
  try {
    let token: string | null = null;
    try {
      const { supabase } = await import("./supabase");
      token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    } catch { /* yok */ }
    if (!token) return;
    for (;;) {
      const q = readQ();
      const it = q[0];
      if (!it) break;
      let res: Response;
      try {
        res = await send(it.url, { method: it.method, headers: { ...it.headers, authorization: `Bearer ${token}` }, body: it.body ?? undefined });
      } catch { break; } // ağ yok: sonra tekrar
      if (res.status === 401 || res.status >= 500 || res.status === 429) break; // oturum/ sunucu: sonra tekrar
      const cur = readQ();
      if (!res.ok && res.status !== 409) {
        // kalıcı hata (ör. silinmiş kayda bağlı): kuyruğu tıkamasın, ayrı listede dursun
        const f = readQ(FK); f.unshift({ ...it, headers: { status: String(res.status) } }); writeQ(f.slice(0, 30), FK);
      }
      writeQ(cur.filter((x) => x.qid !== it.qid));
    }
  } finally { flushing = false; }
}
