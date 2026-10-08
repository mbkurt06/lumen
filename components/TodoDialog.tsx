"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { offlineUpdate, offlineUpsert } from "@/lib/offlineDb";
import { getOfflineOwnerId } from "@/lib/offlineIdentity";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  libraryItemId?: string | null;
  contentNodeId?: string | null;
  defaultTarget?: number;
  onSaved?: () => void | Promise<void>;
  editTodo?: { id: string; notes: string | null } | null;
  extraMeta?: Record<string, unknown>;
};

export function TodoDialog({
  open,
  onClose,
  title,
  libraryItemId = null,
  contentNodeId = null,
  defaultTarget = 1,
  onSaved,
  editTodo = null,
  extraMeta = {},
}: Props) {
  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const [description, setDescription] = useState("");
  const [target, setTarget] = useState(Math.max(1, defaultTarget || 1));
  const [mode, setMode] = useState<"single" | "range" | "days" | "forever">("days");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [durationDays, setDurationDays] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editTodo) {
      let meta: any = {};
      try { meta = JSON.parse(editTodo.notes || "{}"); } catch {}
      const schedule = meta.schedule || {};
      setDescription(meta.description || "");
      setTarget(Math.max(1, Number(schedule.target || defaultTarget || 1)));
      setMode(schedule.mode || "days");
      setStartDate(schedule.startDate || today);
      setEndDate(schedule.endDate || today);
      setDurationDays(Math.max(1, Number(schedule.durationDays || 10)));
    } else {
      setTarget(Math.max(1, defaultTarget || 1));
      setDescription("");
      setMode("days");
      setStartDate(today);
      setEndDate(today);
      setDurationDays(10);
    }
    setMessage("");
  }, [open, defaultTarget, today, title, contentNodeId, editTodo]);

  if (!open) return null;

  async function save() {
    setBusy(true);
    setMessage("");

    let oldMeta: any = {};
    if (editTodo) {
      try { oldMeta = JSON.parse(editTodo.notes || "{}"); } catch {}
    }
    const schedule = {
      mode,
      startDate,
      endDate: mode === "range" ? endDate : null,
      durationDays: mode === "days" ? durationDays : null,
      target,
      history: oldMeta.schedule?.history || {},
    };

    const payload = {
      title,
      notes: JSON.stringify({
        ...oldMeta,
        ...extraMeta,
        description,
        schedule,
        source: contentNodeId ? "segment" : "document",
      }),
      due_at: startDate + "T00:00:00",
      related_library_item_id: libraryItemId,
      related_content_node_id: contentNodeId,
    };

    const ownerId = await getOfflineOwnerId();
    if (!ownerId) {
      setBusy(false);
      setMessage("Oturum bilgisi bulunamadı.");
      return;
    }

    const now = new Date().toISOString();
    const result = editTodo
      ? await offlineUpdate("todos", ownerId, { id: editTodo.id }, {
          ...payload,
          updated_at: now,
        })
      : await offlineUpsert("todos", ownerId, {
          id: crypto.randomUUID(),
          owner_id: ownerId,
          ...payload,
          is_completed: false,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        }, { onConflict: "id" });

    setBusy(false);
    if (result.error && navigator.onLine) {
      setMessage(result.error.message);
      return;
    }

    window.dispatchEvent(new CustomEvent("lumen-todos-changed"));
    if (onSaved) await onSaved();
    onClose();
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modalCard" onMouseDown={e => e.stopPropagation()}>
        <div className="modalHead">
          <strong>{editTodo ? "Todo'yu düzenle" : "Todo'ya ekle"}</strong>
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
            onFocus={e => e.currentTarget.select()}
            onClick={e => e.currentTarget.select()}
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
          {editTodo ? "Değişiklikleri kaydet" : "Todo'ya ekle"}
        </button>
      </div>
    </div>
  );
}
