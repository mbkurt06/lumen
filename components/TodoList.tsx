"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Todo = {
  id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
};

export function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("Yükleniyor...");
  const [busy, setBusy] = useState(false);

  const loadTodos = useCallback(async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("id,title,is_completed,sort_order,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      setMessage("Todo okunamadı: " + error.message);
      return;
    }

    setTodos(data ?? []);
    setMessage("Senkronizasyon hazır.");
  }, []);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  async function addTodo(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;

    setBusy(true);
    const { error } = await supabase.from("todos").insert({
      title: clean,
      sort_order: todos.length
    });

    if (error) {
      setMessage("Eklenemedi: " + error.message);
    } else {
      setTitle("");
      await loadTodos();
    }
    setBusy(false);
  }

  async function toggleTodo(todo: Todo) {
    const { error } = await supabase
      .from("todos")
      .update({ is_completed: !todo.is_completed })
      .eq("id", todo.id);

    if (error) {
      setMessage("Güncellenemedi: " + error.message);
      return;
    }

    await loadTodos();
  }

  async function deleteTodo(id: string) {
    const { error } = await supabase.from("todos").delete().eq("id", id);

    if (error) {
      setMessage("Silinemedi: " + error.message);
      return;
    }

    await loadTodos();
  }

  return (
    <section style={styles.card}>
      <h2 style={styles.heading}>Yapılacaklar</h2>

      <form onSubmit={addTodo} style={styles.form}>
        <input
          style={styles.input}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Yeni görev..."
          maxLength={300}
        />
        <button style={styles.primaryButton} type="submit" disabled={busy || !title.trim()}>
          Ekle
        </button>
      </form>

      <div style={styles.list}>
        {todos.length === 0 ? (
          <p style={styles.empty}>Henüz görev yok.</p>
        ) : (
          todos.map((todo) => (
            <div key={todo.id} style={styles.todoRow}>
              <button
                type="button"
                onClick={() => toggleTodo(todo)}
                style={styles.checkButton}
              >
                {todo.is_completed ? "✓" : ""}
              </button>

              <span
                style={{
                  ...styles.todoTitle,
                  textDecoration: todo.is_completed ? "line-through" : "none",
                  opacity: todo.is_completed ? 0.5 : 1
                }}
              >
                {todo.title}
              </span>

              <button
                type="button"
                onClick={() => deleteTodo(todo.id)}
                style={styles.deleteButton}
              >
                Sil
              </button>
            </div>
          ))
        )}
      </div>

      <p style={styles.status}>{message}</p>
    </section>
  );
}

const styles = {
  card: {
    width: "100%",
    border: "1px solid #ddd",
    borderRadius: 18,
    padding: 24,
    background: "white",
    boxShadow: "0 10px 30px rgba(0,0,0,.06)"
  },
  heading: { marginTop: 0 },
  form: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10
  },
  input: {
    padding: "12px 14px",
    border: "1px solid #ccc",
    borderRadius: 10,
    fontSize: 16
  },
  primaryButton: {
    border: 0,
    borderRadius: 10,
    padding: "11px 18px",
    background: "#2563eb",
    color: "white",
    fontWeight: 650,
    cursor: "pointer"
  },
  list: { display: "grid", gap: 8, marginTop: 18 },
  empty: { color: "#777" },
  todoRow: {
    display: "grid",
    gridTemplateColumns: "34px 1fr auto",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid #eee"
  },
  checkButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px solid #bbb",
    background: "white",
    cursor: "pointer"
  },
  todoTitle: { lineHeight: 1.4 },
  deleteButton: {
    border: 0,
    background: "transparent",
    color: "#b91c1c",
    cursor: "pointer"
  },
  status: { margin: "16px 0 0", fontSize: 14, color: "#666" }
};
