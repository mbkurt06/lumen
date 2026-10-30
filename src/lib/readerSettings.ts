export type RSettings = { theme: "default" | "dark" | "light" | "paper" | "auto"; ar: boolean; latin: boolean; tr: boolean; size: number; light: number };
export const DEFAULT_RS: RSettings = { theme: "default", ar: true, latin: true, tr: true, size: 1, light: 1 };

const get = (k: string): Partial<RSettings> | null => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as Partial<RSettings>) : null; } catch { return null; }
};
const put = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok say */ } };

/** Sayfaya özel ayar > genel okuma ayarı > varsayılan. */
export function loadRS(docId: string): RSettings {
  return { ...DEFAULT_RS, ...(get("lumen.rs") ?? {}), ...(get("lumen.rs." + docId) ?? {}) };
}
export function saveRS(docId: string, s: RSettings) { put("lumen.rs." + docId, s); }
export function applyAll(s: RSettings) { put("lumen.rs", s); }
export function resetRS(docId: string) { put("lumen.rs." + docId, null); }
