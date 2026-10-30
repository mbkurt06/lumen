import { useState } from "react";
import type { Bookmark } from "../lib/bookmarks";

// Ayraç ekle: isim (isteğe bağlı) + Kaydet → yeni ayraç; altta mevcutlar: Güncelle (buraya taşı) / Sil.
export function BookmarkDialog({ autoTitle, list, onNew, onUpdate, onDelete, onClose }: {
  autoTitle: string; list: Bookmark[]; onNew: (name: string) => void; onUpdate: (b: Bookmark) => void; onDelete: (b: Bookmark) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="dialog bmdialog">
        <div className="cardtitle">Ayraç ekle</div>
        <input className="field" style={{ width: "100%", marginTop: 12 }} value={name} placeholder={autoTitle} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onNew(name)} />
        <div className="small muted" style={{ marginTop: 6 }}>İsim vermezsen “{autoTitle}” olarak kaydedilir.</div>
        <div className="seg">
          <button onClick={onClose}>Vazgeç</button>
          <button className="on" onClick={() => onNew(name)}>Kaydet</button>
        </div>
        {list.length > 0 && (
          <>
            <div className="lbl" style={{ padding: "16px 0 6px" }}>VAR OLANI GÜNCELLE</div>
            <div className="bmlist">
              {list.map((b) => (
                <div key={b.id} className="bmrow">
                  <div className="bmtxt"><b>{b.title}</b>{b.quote && <span>{b.quote}</span>}</div>
                  <button className="bmup" onClick={() => onUpdate(b)}>Güncelle</button>
                  <button className="tdel" onClick={() => { if (window.confirm(`“${b.title}” silinsin mi?`)) onDelete(b); }} aria-label="Sil">×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
