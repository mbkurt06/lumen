import { PageHeader } from "../components/PageHeader";
import { useTheme, type ThemeMode } from "../lib/theme";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "Koyu" },
  { id: "light", label: "Açık" },
  { id: "system", label: "Telefona uy" },
];

export function Settings() {
  const { mode, setMode } = useTheme();
  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Genel" />
      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Tema</div>
        <div className="seg" role="radiogroup" aria-label="Tema">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ margin: "4px 20px" }}>Bildirimler, Namaz, Okuma ve Google ayarları ilgili sayfalar geliştirilirken eklenecek.</p>
    </>
  );
}
