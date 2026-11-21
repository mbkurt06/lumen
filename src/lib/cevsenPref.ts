import { useEffect, useState } from "react";

/* Cevşen görünümü (bu cihazda, bütün bablar için tek ayar):
   "num": kitaptaki gibi numaralı satırlar · "plain": numarasız, düz metin */
export type CevsenMode = "num" | "plain";
const K = "lumen.cevsen.mode.v1";
const EV = "lumen-cevsen-mode";
export const getCevsenMode = (): CevsenMode => { try { return localStorage.getItem(K) === "plain" ? "plain" : "num"; } catch { return "num"; } };
export function setCevsenMode(m: CevsenMode) {
  try { localStorage.setItem(K, m); } catch { /* yok */ }
  window.dispatchEvent(new Event(EV));
}
export function useCevsenMode(): [CevsenMode, (m: CevsenMode) => void] {
  const [m, setM] = useState<CevsenMode>(getCevsenMode);
  useEffect(() => {
    const on = () => setM(getCevsenMode());
    window.addEventListener(EV, on);
    return () => window.removeEventListener(EV, on);
  }, []);
  return [m, setCevsenMode];
}
