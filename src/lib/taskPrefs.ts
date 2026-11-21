import { useEffect, useState } from "react";
import { getShared, setShared } from "./sharedPrefs";

/* Görev ayarları (hesapta saklanır, bütün cihazlarda aynı). Hepsi Ayarlar > Görevler'den açılıp kapanır;
   kullandıkça hangisinin işe yaradığına karar verilecek. */
export type TaskPrefs = {
  /** Zorunlu görevin kaçan dönemleri: tek satırda topla ya da her dönem ayrı satır */
  missedGroup: "tek" | "ayri";
  /** Zorunlu görevde "Atla" düğmesi */
  allowSkip: boolean;
  /** Takip görevinde dünün eksiği bugünün hedefine eklensin */
  catchUp: boolean;
  /** Takip görevinde dünkü sonuç ("dün 3/5") Günüm'de görünsün */
  showYesterday: boolean;
  /** Her gün okunan aralık yarım kalırsa ertesi gün kaldığı yerden devam (kapalı: baştan) */
  resumeRange: boolean;
  /** Günüm'de "Tamamlanmamış" bölümü açık başlasın */
  missedOpen: boolean;
  /** Tarih aralıklı hedefte "yetişmek için günde ~N" önerisi */
  suggestDaily: boolean;
  /** Yeni görevin varsayılan türü */
  defaultStrict: boolean;
};
export const DEFAULT_TP: TaskPrefs = { missedGroup: "tek", allowSkip: true, catchUp: true, showYesterday: true, resumeRange: false, missedOpen: true, suggestDaily: true, defaultStrict: false };
const K = "lumen.taskprefs.v1";
const SK = "taskPrefs";
const EV = "lumen-taskprefs";

export function loadTP(): TaskPrefs {
  try { return { ...DEFAULT_TP, ...(JSON.parse(localStorage.getItem(K) ?? "{}") as Partial<TaskPrefs>) }; } catch { return DEFAULT_TP; }
}
function writeLocal(p: TaskPrefs) {
  try { localStorage.setItem(K, JSON.stringify(p)); window.dispatchEvent(new Event(EV)); } catch { /* yok say */ }
}
export function saveTP(p: TaskPrefs) { writeLocal(p); void setShared(SK, p); }

let pulled = false;
export function useTP(): [TaskPrefs, (p: TaskPrefs) => void] {
  const [p, setP] = useState(loadTP);
  useEffect(() => {
    const f = () => setP(loadTP());
    window.addEventListener(EV, f);
    if (!pulled) { pulled = true; void getShared<Partial<TaskPrefs>>(SK).then((s) => { if (s) writeLocal({ ...DEFAULT_TP, ...s }); }); }
    return () => window.removeEventListener(EV, f);
  }, []);
  return [p, (n) => { setP(n); saveTP(n); }];
}
