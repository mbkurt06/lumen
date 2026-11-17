import { useCallback, useEffect, useRef, useState } from "react";

/* Sayaç ayarları (bu cihazda): kilit, otomatik kilit süresi, geri al süresi.
   Titreşim ayarları da ileride buraya eklenecek. */
export type CounterPrefs = { autoLockSec: number; lockKaza: boolean; lockTesbih: boolean; undoSec: number };
export const DEFAULT_CP: CounterPrefs = { autoLockSec: 30, lockKaza: true, lockTesbih: false, undoSec: 5 };
const K = "lumen.counterprefs.v1";
const EV = "lumen-counterprefs";

export function loadCP(): CounterPrefs {
  try { return { ...DEFAULT_CP, ...(JSON.parse(localStorage.getItem(K) ?? "{}") as Partial<CounterPrefs>) }; } catch { return DEFAULT_CP; }
}
export function saveCP(p: CounterPrefs) {
  try { localStorage.setItem(K, JSON.stringify(p)); window.dispatchEvent(new Event(EV)); } catch { /* yok say */ }
}
export function useCP(): [CounterPrefs, (p: CounterPrefs) => void] {
  const [p, setP] = useState(loadCP);
  useEffect(() => { const f = () => setP(loadCP()); window.addEventListener(EV, f); return () => window.removeEventListener(EV, f); }, []);
  return [p, (n) => { setP(n); saveCP(n); }];
}

/** Yanlışlıkla basmaya karşı kilit: açık başlar (enabled ise), dokunulmazsa autoLockSec sonra yeniden kilitlenir. */
export function useLock(enabled: boolean, autoLockSec: number) {
  const [locked, setLocked] = useState(enabled);
  const t = useRef<number | undefined>(undefined);
  const arm = useCallback(() => {
    window.clearTimeout(t.current);
    if (enabled && autoLockSec > 0) t.current = window.setTimeout(() => setLocked(true), autoLockSec * 1000);
  }, [enabled, autoLockSec]);
  useEffect(() => { setLocked(enabled); return () => window.clearTimeout(t.current); }, [enabled]);
  const unlock = () => { setLocked(false); arm(); };
  const lock = () => { window.clearTimeout(t.current); setLocked(true); };
  /** bir işlemden önce çağır: kilitliyse false döner; açıksa süreyi yeniler */
  const touch = () => { if (enabled && locked) return false; arm(); return true; };
  return { locked: enabled && locked, unlock, lock, touch };
}
