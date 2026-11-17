import { useState } from "react";
import type { Bookmark } from "../lib/bookmarks";

// Kaldığım yer (ayraç): yeni ayraç (isim isteğe bağlı, istersen göreve bağla) ya da var olanı buraya taşı.
// Ayraç taşınınca ona bağlı görevler de yeni yeri gösterir.
export function BookmarkDialog({ autoTitle, where, list, onNew, onUpdate, onDelete, onClose }: {
  autoTitle: string; where?: string; list: Bookmark[]; onNew: (name: string, alsoTask: boolean) => void; onUpdate: (b: Bookmark) => void; onDelete: (b: Bookmark) => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [task, setTask] = useState(false);
  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="dialog bmdialog">
        <div className="cardtitle">Kaldığım yer</div>
        {where && <div className="small muted" style={{ marginTop: 4 }}>{where}</div>}
        {list.length > 0 && (
          <>
            <div className="lbl" style={{ padding: "14px 0 6px" }}>AYRACI BURAYA TAŞI</div>
            <div className="bmlist">
              {list.map((b) => (
                <div key={b.id} className="bmrow">
                  <div className="bmtxt"><b>{b.title}</b><span>{b.label ?? b.quote ?? ""}</span></div>
                  <button className="bmup" onClick={() => onUpdate(b)}>Buraya taşı</button>
                  <button className="tdel" onClick={() => { if (window.confirm(`“${b.title}” silinsin mi?`)) onDelete(b); }} aria-label="Sil">×</button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="lbl" style={{ padding: "14px 0 6px" }}>YENİ AYRAÇ</div>
        <input className="field" style={{ width: "100%" }} value={name} placeholder={`Ad (ör. ${autoTitle} · sabah)`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onNew(name, task)} />
        <label className="bmrow pick" style={{ border: 0, padding: "10px 0 0" }}>
          <input type="checkbox" checked={task} onChange={(e) => setTask(e.target.checked)} />
          <div className="bmtxt"><b>Göreve de bağla</b><span>Görev bu ayracı gösterir; ayracı taşıdıkça görev de güncellenir</span></div>
        </label>
        <div className="seg">
          <button onClick={onClose}>Vazgeç</button>
          <button className="on" onClick={() => onNew(name, task)}>Yeni ayraç kaydet</button>
        </div>
      </div>
    </>
  );
}
