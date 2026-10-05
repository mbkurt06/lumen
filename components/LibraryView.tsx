"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
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

export function LibraryView() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("document");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order")
      .is("parent_id", null)
      .order("sort_order");

    if (error) {
      setMessage(error.message);
      return;
    }

    setItems(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;

    const { error } = await supabase.from("library_items").insert({
      title: clean,
      kind,
      sort_order: items.length,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setTitle("");
      await load();
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Bu öğe ve alt içeriği silinsin mi?")) return;

    const { error } = await supabase
      .from("library_items")
      .delete()
      .eq("id", id);

    if (error) {
      setMessage(error.message);
    } else {
      if (selected?.id === id) setSelected(null);
      await load();
    }
  }

  return (
    <div className="grid2">
      <section className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0 }}>Kütüphane</h2>

        <form
          onSubmit={add}
          style={{ display: "grid", gap: 10, marginBottom: 16 }}
        >
          <input
            className="input"
            placeholder="Yeni öğe adı"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />

          <div className="toolbar">
            <select
              className="input"
              style={{ width: "auto" }}
              value={kind}
              onChange={e => setKind(e.target.value)}
            >
              <option value="document">Eser</option>
              <option value="collection">Koleksiyon</option>
              <option value="folder">Klasör</option>
            </select>

            <button className="primary">Ekle</button>
          </div>
        </form>

        <div className="list">
          {items.length === 0 && (
            <p className="muted">Henüz içerik yok.</p>
          )}

          {items.map(item => (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
              }}
            >
              <button
                className={
                  "listItem " +
                  (selected?.id === item.id ? "selected" : "")
                }
                onClick={() => setSelected(item)}
              >
                <div style={{ fontWeight: 700 }}>{item.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {item.kind}
                </div>
              </button>

              <button
                className="secondary danger"
                onClick={() => remove(item.id)}
              >
                Sil
              </button>
            </div>
          ))}
        </div>

        {message && <p className="muted">{message}</p>}
      </section>

      <section>
        {selected ? (
          <ReaderView item={selected} />
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <h2>Bir öğe seç</h2>
            <p className="muted">
              Eser veya koleksiyon ayrıntıları burada açılacak.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
