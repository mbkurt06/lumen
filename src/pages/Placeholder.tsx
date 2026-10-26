import { PageHeader } from "../components/PageHeader";

// Tasarımı hazır, henüz geliştirilmemiş sayfalar için geçici içerik.
export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Sırada</div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {note ?? "Bu sayfanın tasarımı hazır; sıradaki adımda geliştirilecek."}
        </p>
      </div>
    </>
  );
}
