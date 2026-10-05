import { AuthPanel } from "@/components/AuthPanel";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#f5f6f8",
      }}
    >
      <div style={{ width: "min(760px, 100%)" }}>
        <h1 style={{ marginBottom: 8 }}>Lumen</h1>
        <p style={{ marginTop: 0, color: "#555", marginBottom: 24 }}>
          Web/PWA altyapısı ve merkezi Supabase veritabanı.
        </p>
        <AuthPanel />
      </div>
    </main>
  );
}
