"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  libraryItemId?: string | null;
  contentNodeId?: string | null;
};

export function TodoDialog({
  open,
  onClose,
  title,
  libraryItemId = null,
  contentNodeId = null,
}: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState(1);
  const [mode, setMode] = useState<"single" | "range" | "days" | "forever">("days");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [durationDays, setDurationDays] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!open) return null;

  async function save() {
    setBusy(true);
    setMessage("");

    const schedule = {
      mode,
      startDate,
      endDate: mode === "range" ? endDate : null,
      durationDays: mode === "days" ? durationDays : null,
      target,
      history: {},
    };

    const { error } = await supabase.from("todos").insert({
      title,
      notes: JSON.stringify({
        description,
        schedule,
        source: contentNodeId ? "segment" : "document",
      }),
      due_at: startDate + "T00:00:00",
      related_library_item_id: libraryItemId,
      related_content_node_id: contentNodeId,
    });

    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }

    onClose();
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modalCard" onMouseDown={e => e.stopPropagation()}>
        <div className="modalHead">
          <strong>Todo&apos;ya ekle</strong>
          <button className="modalClose" onClick={onClose}>×</button>
        </div>

        <div className="todoFormRow">
          <label>Açıklama</label>
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="İsteğe bağlı not..."
          />
        </div>

        <div className="todoFormRow">
          <label>Her gün yapılacak tekrar sayısı</label>
          <input
            className="input"
            type="number"
            min={1}
            value={target}
            onChange={e => setTarget(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <div className="todoFormRow">
          <label>Tekrar planı</label>
          <select className="input" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
            <option value="single">Tek gün</option>
            <option value="range">Tarih aralığı</option>
            <option value="days">Belirli gün sayısı</option>
            <option value="forever">Her gün — süresiz</option>
          </select>
        </div>

        <div className="todoScheduleGrid">
          <div className="todoFormRow">
            <label>Başlangıç</label>
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          {mode === "range" && (
            <div className="todoFormRow">
              <label>Bitiş</label>
              <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          )}

          {mode === "days" && (
            <div className="todoFormRow">
              <label>Kaç gün?</label>
              <input
                className="input"
                type="number"
                min={1}
                value={durationDays}
                onChange={e => setDurationDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          )}
        </div>

        {message && <p className="formError">{message}</p>}

        <button className="primary todoSaveButton" disabled={busy} onClick={save}>
          Todo&apos;ya ekle
        </button>
      </div>
    </div>
  );
}
