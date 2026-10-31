import { useEffect, useState } from "react";

/** Tarayıcı/telefon çevrimdışı mı (uçak modu vb.). */
export function useOffline() {
  const [off, setOff] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOff(navigator.onLine === false);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  return off;
}
