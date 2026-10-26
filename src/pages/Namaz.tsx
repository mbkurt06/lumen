import { useEffect, useMemo, useState } from "react";
import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";
import { PageHeader } from "../components/PageHeader";

type Place = { name: string; lat: number; lng: number };
const BERLIN: Place = { name: "Berlin", lat: 52.52, lng: 13.405 };
const KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
type Key = (typeof KEYS)[number];
const LABEL: Record<Key | "sunrise", string> = { fajr: "Sabah", sunrise: "Güneş", dhuhr: "Öğle", asr: "İkindi", maghrib: "Akşam", isha: "Yatsı" };

const read = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok say */ } };
const hm = (d: Date) => d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? h + " sa " : ""}${m} dk ${String(sec).padStart(2, "0")} sn`;
}

export function Namaz() {
  const [place, setPlace] = useState<Place>(() => read("lumen.place", BERLIN));
  const [now, setNow] = useState(() => new Date());
  const [offset, setOffset] = useState<number>(() => read("lumen.ihtiyat", 0)); // dakika
  const [done, setDone] = useState<Record<string, Key[]>>(() => read("lumen.kilinan", {}));
  const [msg, setMsg] = useState("");

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const times = useMemo(() => {
    const params = CalculationMethod.Turkey();
    const c = new Coordinates(place.lat, place.lng);
    const today = new PrayerTimes(c, now, params);
    const tomorrow = new PrayerTimes(c, new Date(now.getTime() + 86400000), params);
    return { today, tomorrow };
  }, [place, dayKey(now)]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = (d: Date) => new Date(d.getTime() + offset * 60000);
  const rows: { key: Key | "sunrise"; at: Date }[] = [
    { key: "fajr", at: shift(times.today.fajr) },
    { key: "sunrise", at: times.today.sunrise },
    { key: "dhuhr", at: shift(times.today.dhuhr) },
    { key: "asr", at: shift(times.today.asr) },
    { key: "maghrib", at: shift(times.today.maghrib) },
    { key: "isha", at: shift(times.today.isha) },
  ];
  const next = rows.find((r) => r.at.getTime() > now.getTime()) ?? { key: "fajr" as const, at: shift(times.tomorrow.fajr) };
  const current = [...rows].reverse().find((r) => r.at.getTime() <= now.getTime() && r.key !== "sunrise");
  const todayDone = done[dayKey(now)] ?? [];

  const toggle = (k: Key) => {
    const set = new Set(todayDone);
    if (set.has(k)) set.delete(k); else set.add(k);
    const nd = { ...done, [dayKey(now)]: [...set] };
    setDone(nd); write("lumen.kilinan", nd);
  };
  const locate = () => {
    if (!navigator.geolocation) { setMsg("Konum desteklenmiyor."); return; }
    setMsg("Konum alınıyor…");
    navigator.geolocation.getCurrentPosition(
      (p) => { const pl = { name: "Bulunduğum yer", lat: p.coords.latitude, lng: p.coords.longitude }; setPlace(pl); write("lumen.place", pl); setMsg(""); },
      () => setMsg("Konum alınamadı; Berlin kullanılıyor."),
      { timeout: 10000 },
    );
  };
  const tarih = now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let hijri = "";
  try { hijri = new Intl.DateTimeFormat("tr-TR-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(now); } catch { /* yok say */ }

  return (
    <>
      <PageHeader title="Namaz" subtitle={`${place.name} · ${tarih}${hijri ? " · " + hijri : ""}`} />
      <div className="card" style={{ margin: "10px 16px" }}>
        <div className="muted small">{LABEL[next.key]} vaktine kalan</div>
        <div style={{ fontSize: 34, fontWeight: 700, color: "var(--accent)", margin: "4px 0" }}>{countdown(next.at.getTime() - now.getTime())}</div>
        <div className="muted small">{LABEL[next.key]} {hm(next.at)}</div>
      </div>
      <div className="card" style={{ margin: "10px 16px", padding: "4px 0" }}>
        {rows.map((r) => {
          const isCur = current?.key === r.key;
          const k = r.key as Key;
          return (
            <div key={r.key} className="nrow" style={{ background: isCur ? "var(--highlight)" : undefined }}>
              <span className="nname">{LABEL[r.key]}</span>
              <span className="ntime">{hm(r.at)}</span>
              {r.key === "sunrise" ? <span style={{ width: 28 }} /> : (
                <button className={"ncheck" + (todayDone.includes(k) ? " on" : "")} onClick={() => toggle(k)} aria-label={`${LABEL[r.key]} kılındı`}>{todayDone.includes(k) ? "✓" : ""}</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="card" style={{ margin: "10px 16px" }}>
        <div className="cardtitle">Ayarlar</div>
        <p className="muted small" style={{ margin: "6px 0" }}>Hesaplama: Diyanet (Türkiye) yöntemi. İhtiyat: vakitlere eklenen dakika.</p>
        <div className="seg">
          {[0, 5, 10].map((m) => (
            <button key={m} className={offset === m ? "on" : ""} onClick={() => { setOffset(m); write("lumen.ihtiyat", m); }}>{m === 0 ? "Yok" : `+${m} dk`}</button>
          ))}
        </div>
        <div className="seg">
          <button onClick={locate}>Konumumu kullan</button>
          <button onClick={() => { setPlace(BERLIN); write("lumen.place", BERLIN); }}>Berlin</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </div>
    </>
  );
}
