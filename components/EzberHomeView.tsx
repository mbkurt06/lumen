"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export type EzberItem = {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
  metadata?: Record<string, unknown> | null;
};

const knownTitles = [
  "Sûreler",
  "Namaz Duaları",
  "Günlük Dualar",
  "Tesbihat",
  "Esmâü’l-Hüsnâ",
  "İslam İlmihali",
] as const;

type KnownTitle = typeof knownTitles[number];
type MenuEntry =
  | { type: "db"; item: EzberItem }
  | { type: "virtual"; id: "dinleme"; title: "Dinleme" };

type TodoSummary = { id: string; itemId: string; target: number; count: number; done: boolean };

function localDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseTodo(notes: string | null) {
  try { return JSON.parse(notes || "{}"); } catch { return {}; }
}

function todoOccurs(meta: any, key: string) {
  const s = meta?.schedule;
  if (!s?.startDate) return true;
  if (key < s.startDate) return false;
  if (s.mode === "single") return key === s.startDate;
  if (s.mode === "range") return !s.endDate || key <= s.endDate;
  if (s.mode === "days") {
    const start = new Date(s.startDate + "T00:00:00");
    const current = new Date(key + "T00:00:00");
    const diff = Math.floor((current.getTime() - start.getTime()) / 86400000);
    return diff >= 0 && diff < Math.max(1, s.durationDays || 1);
  }
  return true;
}

export function EzberHomeView({
  onOpenItem,
  user,
  initialRoot = null,
}: {
  onOpenItem: (item: EzberItem, siblings: EzberItem[], parent: EzberItem | null) => void;
  user: User;
  initialRoot?: EzberItem | null;
}) {
  const [roots, setRoots] = useState<EzberItem[]>([]);
  const [currentRoot, setCurrentRoot] = useState<EzberItem | null>(null);
  const [children, setChildren] = useState<EzberItem[]>([]);
  const [message, setMessage] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [rootOrder, setRootOrder] = useState<string[]>([]);
  const [todoSummaries, setTodoSummaries] = useState<TodoSummary[]>([]);
  const pressId = useRef<string | null>(null);
  const pressY = useRef(0);
  const moved = useRef(false);

  const loadRoots = useCallback(async () => {
    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .is("parent_id", null)
      .order("sort_order")
      .order("title");

    if (error) {
      setMessage(error.message);
      return;
    }

    setRoots(data ?? []);

    const { data: prefData } = await supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle();

    const prefs = (prefData?.preferences ?? {}) as Record<string, unknown>;
    const saved = prefs.ezberMenuOrder;
    if (Array.isArray(saved)) setRootOrder(saved.filter(x => typeof x === "string") as string[]);
  }, []);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  useEffect(() => {
    if (!initialRoot) return;
    setCurrentRoot(initialRoot);
    supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("parent_id", initialRoot.id)
      .order("sort_order")
      .order("title")
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else setChildren(data ?? []);
      });
  }, [initialRoot]);

  useEffect(() => {
    if (!children.length) {
      setTodoSummaries([]);
      return;
    }
    const ids = children.map(item => item.id);
    supabase
      .from("todos")
      .select("id,notes,related_library_item_id")
      .in("related_library_item_id", ids)
      .then(({ data }) => {
        const today = localDateKey();
        const rows: TodoSummary[] = [];
        for (const todo of data ?? []) {
          if (!todo.related_library_item_id) continue;
          const meta = parseTodo(todo.notes);
          if (!todoOccurs(meta, today)) continue;
          const target = Math.max(1, Number(meta?.schedule?.target || 1));
          const count = Math.min(target, Number(meta?.schedule?.history?.[today]?.count || 0));
          rows.push({ id: todo.id, itemId: todo.related_library_item_id, target, count, done: count >= target });
        }
        setTodoSummaries(rows);
      });
  }, [children]);


  const menuEntries = useMemo<MenuEntry[]>(() => {
    const dbEntries: MenuEntry[] = roots
      .filter(item => knownTitles.includes(item.title as KnownTitle))
      .map(item => ({ type: "db", item }));

    const all: MenuEntry[] = [...dbEntries, { type: "virtual", id: "dinleme", title: "Dinleme" }];
    const idOf = (entry: MenuEntry) => entry.type === "db" ? entry.item.id : entry.id;

    if (!rootOrder.length) return all;

    return [...all].sort((a, b) => {
      const ai = rootOrder.indexOf(idOf(a));
      const bi = rootOrder.indexOf(idOf(b));
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [roots, rootOrder]);

  async function saveRootOrder(entries: MenuEntry[]) {
    const ids = entries.map(entry => entry.type === "db" ? entry.item.id : entry.id);
    setRootOrder(ids);

    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const old = (data?.preferences ?? {}) as Record<string, unknown>;

    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: { ...old, ezberMenuOrder: ids },
    });
  }

  function reorderEntries(overId: string) {
    if (!dragId || dragId === overId) return;
    const current = [...menuEntries];
    const idOf = (entry: MenuEntry) => entry.type === "db" ? entry.item.id : entry.id;
    const from = current.findIndex(entry => idOf(entry) === dragId);
    const to = current.findIndex(entry => idOf(entry) === overId);
    if (from < 0 || to < 0) return;
    const [item] = current.splice(from, 1);
    current.splice(to, 0, item);
    setRootOrder(current.map(idOf));
  }

  async function openRoot(entry: MenuEntry) {
    if (entry.type === "virtual") {
      setMessage("Dinleme ekranını eski uygulamadaki haliyle ayrıca taşıyacağız.");
      return;
    }

    setCurrentRoot(entry.item);

    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("parent_id", entry.item.id)
      .order("sort_order")
      .order("title");

    if (error) {
      setMessage(error.message);
      return;
    }

    setChildren(data ?? []);
    setMessage("");
  }

  async function openChild(item: EzberItem) {
    if (item.kind === "document") {
      onOpenItem(item, children.filter(x => x.kind === "document"), currentRoot);
      return;
    }

    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("parent_id", item.id)
      .order("sort_order")
      .order("title");

    if (error) {
      setMessage(error.message);
      return;
    }

    setCurrentRoot(item);
    setChildren(data ?? []);
  }

  function reorderChildren(overId: string) {
    if (!dragId || dragId === overId) return;
    const from = children.findIndex(item => item.id === dragId);
    const to = children.findIndex(item => item.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...children];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setChildren(next);
  }

  async function persistChildren() {
    const results = await Promise.all(
      children.map((item, index) =>
        supabase.from("library_items").update({ sort_order: index }).eq("id", item.id)
      )
    );
    const failed = results.find(result => result.error);
    if (failed?.error) setMessage(failed.error.message);
  }

  function down(id: string, y: number) {
    pressId.current = id;
    pressY.current = y;
    moved.current = false;
  }

  function movePointer(id: string, y: number, reorder: (id: string) => void) {
    if (!pressId.current) return;
    if (Math.abs(y - pressY.current) < 7 && !moved.current) return;
    moved.current = true;
    if (!dragId) setDragId(pressId.current);
    reorder(id);
  }

  async function finish(persist: () => Promise<void>) {
    if (moved.current) await persist();
    setDragId(null);
    pressId.current = null;
    moved.current = false;
  }

  if (currentRoot) {
    return (
      <section className="legacyNestedPage">
        <div className="legacyListHead">
          <button className="legacyBack" onClick={() => setCurrentRoot(null)}>‹ Geri</button>
          <h2>{currentRoot.title}</h2>
          <span />
        </div>

        <div className="legacyCategoryList">
          {children.map(item => (
            <button
              key={item.id}
              className={"legacyCategoryRow draggableWholeRow " + (dragId === item.id ? "dragging" : "")}
              onPointerDown={e => down(item.id, e.clientY)}
              onPointerMove={e => movePointer(item.id, e.clientY, reorderChildren)}
              onPointerUp={async () => {
                const wasMoved = moved.current;
                await finish(persistChildren);
                if (!wasMoved) openChild(item);
              }}
            >
              <span>
                <strong>{item.title}</strong>
                {(item.subtitle || (currentRoot?.title === "Esmâü’l-Hüsnâ" && Number(item.metadata?.target || 0) > 0)) && (
                  <small className="itemMetaInline">
                    {item.subtitle && <span>{item.subtitle}</span>}
                    {currentRoot?.title === "Esmâü’l-Hüsnâ" && Number(item.metadata?.target || 0) > 0 && (
                      <b>{Number(item.metadata?.target)}</b>
                    )}
                  </small>
                )}
              </span>
              <span className="categoryRowRight">
                {(() => {
                  const active = todoSummaries.filter(t => t.itemId === item.id && !t.done);
                  const groups = Object.values(active.reduce((acc, t) => {
                    const key = t.target + "/" + t.count;
                    (acc[key] ||= []).push(t);
                    return acc;
                  }, {} as Record<string, TodoSummary[]>));
                  return groups.map(group => (
                    <span className="listTodoBadge" key={group[0].id}>
                      {group[0].target}/{group[0].count}
                      {group.length > 1 && <i>{group.length}</i>}
                    </span>
                  ));
                })()}
                <b>›</b>
              </span>
            </button>
          ))}

          {!children.length && <div className="legacyEmptyLine">Bu bölümde içerik bulunamadı.</div>}
        </div>

        {message && <p className="legacyHomeMessage">{message}</p>}
      </section>
    );
  }

  return (
    <section className="legacyNestedPage">
      <div className="legacyHomeHead compact">
        <h1>Ezber</h1>
        
      </div>

      <div className="legacyHomeMenu">
        {menuEntries.map(entry => {
          const id = entry.type === "db" ? entry.item.id : entry.id;
          const title = entry.type === "db"
            ? (entry.item.title === "Tesbihat" ? "Tesbihatlar" : entry.item.title)
            : "🎧 Dinleme";

          return (
            <button
              key={id}
              className={"legacyHomeRow draggableWholeRow " + (dragId === id ? "dragging" : "")}
              onPointerDown={e => down(id, e.clientY)}
              onPointerMove={e => movePointer(id, e.clientY, reorderEntries)}
              onPointerUp={async () => {
                const wasMoved = moved.current;
                await finish(async () => saveRootOrder(menuEntries));
                if (!wasMoved) openRoot(entry);
              }}
            >
              <strong>{title}</strong>
              <span>›</span>
            </button>
          );
        })}
      </div>

      {message && <p className="legacyHomeMessage">{message}</p>}
    </section>
  );
}
