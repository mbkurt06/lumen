import { supabase } from "./supabase";
import { deviceId, deviceName } from "./device";

export type Paper = "cream" | "sepia" | "white" | "dark";
export type RSettings = { paper: Paper; theme: "default" | "dark" | "light" | "paper" | "auto"; ar: boolean; latin: boolean; tr: boolean; size: number; light: number; fit: boolean; cnt: number; pill: number };
export const DEFAULT_RS: RSettings = { paper: "cream", theme: "default", ar: true, latin: true, tr: true, size: 1, light: 1, fit: false, cnt: 1, pill: 1 };

/** Okuma ayarları bölüm bölüm ayrı tutulur. */
export type Scope = "he" | "kuran" | "risale" | "diger" | "ibadet";
export const SCOPES: Scope[] = ["he", "kuran", "risale", "diger", "ibadet"];
export function scopeOf(rootTitle?: string | null): Scope {
  if (!rootTitle) return "ibadet";
  if (rootTitle === "HE Eserleri") return "he";
  if (rootTitle.startsWith("Kur")) return "kuran";
  if (rootTitle.startsWith("Risale")) return "risale";
  if (rootTitle.startsWith("Diğer")) return "diger";
  return "ibadet";
}

const LK = (s: Scope) => "lumen.rs2." + s;
const getLocal = (s: Scope): Partial<RSettings> | null => {
  try { const v = localStorage.getItem(LK(s)); return v ? (JSON.parse(v) as Partial<RSettings>) : null; } catch { return null; }
};
const putLocal = (s: Scope, v: RSettings | null) => {
  try { if (v === null) localStorage.removeItem(LK(s)); else localStorage.setItem(LK(s), JSON.stringify(v)); } catch { /* yok say */ }
};

/** Bu cihazdaki kayıt. */
export function loadRS(scope: Scope): RSettings { return { ...DEFAULT_RS, ...(getLocal(scope) ?? {}) }; }

/* Ayarlar CİHAZ BAŞINA tutulur: her cihaz (iPad, iPhone, Android uygulaması, bilgisayar) kendi
   ayarını cihazda saklar; hesapta da yalnız o cihazın kimliği altında yedeklenir, başka cihaza geçmez. */
type DevPrefs = { name?: string; lastSeen?: string; reader?: Partial<Record<Scope, Partial<RSettings>>>; readerUnits?: Units };

/** Bu cihazın hesaptaki yedeği (cihazdaki kayıt silinmişse geri gelir). */
export async function pullRS(scope: Scope): Promise<RSettings | null> {
  if (getLocal(scope)) return null; // cihazdaki kayıt esastır
  const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
  const devs = ((data as { preferences?: Record<string, unknown> } | null)?.preferences?.devices ?? {}) as Record<string, DevPrefs>;
  const r = devs[deviceId()]?.reader?.[scope];
  if (!r) return null;
  const merged = { ...DEFAULT_RS, ...r };
  putLocal(scope, merged);
  return merged;
}

let pending: Partial<Record<Scope, RSettings | null>> = {};
let unitsDirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function pushRemote() {
  const upd = pending;
  pending = {};
  const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
  const prefs = { ...(((data as { preferences?: Record<string, unknown> } | null)?.preferences) ?? {}) } as Record<string, unknown>;
  const devs = { ...((prefs.devices ?? {}) as Record<string, DevPrefs>) };
  const id = deviceId();
  const me: DevPrefs = { ...(devs[id] ?? {}), name: deviceName(), lastSeen: new Date().toISOString() };
  const reader = { ...(me.reader ?? {}) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(upd)) { if (v === null) delete reader[k]; else reader[k] = v; }
  me.reader = reader as DevPrefs["reader"];
  if (unitsDirty) { unitsDirty = false; me.readerUnits = getUnits(); }
  devs[id] = me;
  prefs.devices = devs;
  await supabase.from("user_preferences").upsert({ preferences: prefs, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
}
function queue(scope: Scope, v: RSettings | null) {
  pending[scope] = v;
  clearTimeout(timer);
  timer = setTimeout(() => { void pushRemote(); }, 800);
}

export function saveRS(scope: Scope, s: RSettings) { putLocal(scope, s); queue(scope, s); }
export function applyAll(s: RSettings) { for (const sc of SCOPES) { putLocal(sc, s); queue(sc, s); } }
export function resetRS(scope: Scope) { putLocal(scope, null); queue(scope, null); }

/* ── Kitaba / sayfaya özgü ayarlar ──
   Her kitap (HE'de bir kitap, Risale'de Sözler…), her tesbihat ya da dua, Cevşen, Tevhidname, Kur'an kendi
   ayarını tutar. Sadece değiştirilen ayarlar saklanır; değiştirilmeyenler bölümün varsayılanından gelir.
   Her ayar ayrı ayrı "varsayılan yap" ya da "bu bölümdeki her yere / bütün bölümlere uygula" denebilir. */
type Units = Record<string, Partial<RSettings>>;
const UK = "lumen.rsu.v1";
function getUnits(): Units { try { return JSON.parse(localStorage.getItem(UK) ?? "{}") as Units; } catch { return {}; } }
function putUnits(u: Units) {
  try { localStorage.setItem(UK, JSON.stringify(u)); } catch { /* yok say */ }
  unitsDirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => { void pushRemote(); }, 800);
}
/** Ayar birimi: "<bölüm>:<kitap/belge>" */
export const unitKey = (scope: Scope, id: string) => `${scope}:${id}`;
/** Bu kitabın ayarları: bölümün varsayılanı + bu kitapta değiştirilenler */
export function loadRSU(scope: Scope, unit: string): RSettings { return { ...loadRS(scope), ...(getUnits()[unit] ?? {}) }; }
/** Bu kitapta varsayılandan farklı tutulan ayarlar */
export function unitOverrides(unit: string): (keyof RSettings)[] { return Object.keys(getUnits()[unit] ?? {}) as (keyof RSettings)[]; }
/** Kitapta yapılan değişikliği kaydet (sadece varsayılandan farklı olanlar tutulur) */
export function saveRSU(scope: Scope, unit: string, next: RSettings) {
  const base = loadRS(scope);
  const ov: Partial<RSettings> = {};
  for (const k of Object.keys(next) as (keyof RSettings)[]) if (next[k] !== base[k]) (ov as Record<string, unknown>)[k] = next[k];
  const u = getUnits();
  if (Object.keys(ov).length) u[unit] = ov; else delete u[unit];
  putUnits(u);
}
export type KeyAction = "default" | "section" | "all" | "reset";
/** Tek bir ayar için: varsayılan yap · bu bölümdeki her yere uygula · bütün bölümlere uygula · bu kitapta varsayılana dön */
export function keyAction(scope: Scope, unit: string, k: keyof RSettings, v: RSettings[keyof RSettings], a: KeyAction) {
  const u = getUnits();
  if (a === "reset") { if (u[unit]) { delete u[unit][k]; if (!Object.keys(u[unit]).length) delete u[unit]; } putUnits(u); return; }
  const scopes = a === "all" ? SCOPES : [scope];
  for (const sc of scopes) { const d = { ...loadRS(sc), [k]: v } as RSettings; putLocal(sc, d); queue(sc, d); }
  // varsayılan yap: bu kitap artık varsayılanı kullanır; diğer kitapların kendi ayarı korunur
  // uygula: bölümdeki (ya da her yerdeki) kitapların bu ayardaki farkı silinir, hepsi aynı olur
  for (const key of Object.keys(u)) {
    const inScope = a === "all" || key.startsWith(scope + ":");
    if (key === unit || (a !== "default" && inScope)) { delete u[key][k]; if (!Object.keys(u[key]).length) delete u[key]; }
  }
  putUnits(u);
}
/** Bu kitabın bütün ayarlarını varsayılana döndür */
export function resetUnit(unit: string) { const u = getUnits(); delete u[unit]; putUnits(u); }
