import { Capacitor } from "@capacitor/core";
import { Haptics } from "@capacitor/haptics";

/* Titreşim: Android uygulamasında telefonun titreşim motoru (WebView navigator.vibrate'i desteklemiyor),
   tarayıcıda navigator.vibrate. Desen: [titre, bekle, titre, …] milisaniye. iPhone tarayıcısı titreşimi desteklemez. */
export function vibrate(p: number | number[]) {
  try {
    if (Capacitor.isNativePlatform()) {
      const arr = Array.isArray(p) ? p : [p];
      let t = 0;
      arr.forEach((ms, i) => {
        if (i % 2 === 0 && ms > 0) { const d = Math.max(15, ms); setTimeout(() => { void Haptics.vibrate({ duration: d }).catch(() => {}); }, t); }
        t += ms;
      });
      return;
    }
    navigator.vibrate?.(p);
  } catch { /* titreşim yok */ }
}
