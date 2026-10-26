"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ReaderView } from "@/components/ReaderView";

type Item = {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
};

export function LibraryView({ onMemorize }: { onMemorize?: (item: Item) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [currentParent, setCurrentParent] = useState<Item | null>(null);
  const [trail, setTrail] = useState<Item[]>([]);
  const [message, setMessage] = useState("");

  const parentId = currentParent?.id ?? null;

  const load = useCallback(async () => {
    let query = supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order")
      .order("sort_order")
      .order("title");

    query = parentId === null
      ? query.is("parent_id", null)
      : query.eq("parent_id", parentId);

    const { data, error } = await query;
    if (error) {
      setMessage(error.message);
      return;
    }
    setItems(data ?? []);
  }, [parentId]);

  useEffect(() => {
    setSelected(null);
    load();
  }, [load]);

  const heading = useMemo(
    () => currentParent?.title ?? "Kütüphane",
    [currentParent]
  );

  function openContainer(item: Item) {
    setTrail(value => currentParent ? [...value, currentParent] : value);
    setCurrentParent(item);
  }

  function goRoot() {
    setTrail([]);
    setCurrentParent(null);
  }

  function goBack() {
    if (!currentParent) return;
    const nextTrail = [...trail];
    const previous = nextTrail.pop() ?? null;
    setTrail(nextTrail);
    setCurrentParent(previous);
  }

  return (
    <div className="grid2">
      <section className="card" style={{ padding: 18 }}>
        <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{heading}</h2>
          </div>
          <div className="toolbar">
            {currentParent && <button className="secondary" onClick={goBack}>← Geri</button>}
            {currentParent && <button className="secondary" onClick={goRoot}>Ana</button>}
          </div>
        </div>

        <div className="list">
          {items.length === 0 && <p className="muted">Henüz içerik yok.</p>}
          {items.map(item => (
            <button
              key={item.id}
              className={"listItem " + (selected?.id === item.id ? "selected" : "")}
              onClick={() => item.kind === "document" ? setSelected(item) : openContainer(item)}
            >
              <div style={{ fontWeight: 700 }}>{item.title}</div>
              {item.subtitle && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{item.subtitle}</div>}
            </button>
          ))}
        </div>

        {message && <p className="muted">{message}</p>}
      </section>

      <section>
        {selected ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="toolbar">
              <button className="primary" onClick={() => onMemorize?.(selected)}>
                Ezber yap
              </button>
            </div>
            <ReaderView item={selected} />
          </div>
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <h2>{currentParent ? currentParent.title : "Bir öğe seç"}</h2>
            <p className="muted">
              {currentParent
                ? "Sol taraftan alt koleksiyona gir veya bir eser seç."
                : "Koleksiyonlara girip eserleri açabilirsin."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
