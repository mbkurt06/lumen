import { supabase } from "./supabase";
import { deviceId, deviceName } from "./device";

export type Paper = "cream" | "sepia" | "white" | "dark";
export type RSettings = { paper: Paper; theme: "default" | "dark" | "light" | "paper" | "auto"; ar: boolean; latin: boolean; tr: boolean; size: number; light: number; fit: boolean };
export const DEFAULT_RS: RSettings = { paper: "cream", theme: "default", ar: true, latin: true, tr: true, size: 1, light: 1, fit: false };

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
type DevPrefs = { name?: string; lastSeen?: string; reader?: Partial<Record<Scope, Partial<RSettings>>> };

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
