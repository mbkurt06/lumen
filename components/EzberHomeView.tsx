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

function meta(item: EzberItem) {
  return (item.metadata ?? {}) as Record<string, any>;
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
  const [duaRoot, setDuaRoot] = useState<EzberItem | null>(null);
  const [rootChildren, setRootChildren] = useState<EzberItem[]>([]);
  const [currentRoot, setCurrentRoot] = useState<EzberItem | null>(initialRoot);
  const [trail, setTrail] = useState<EzberItem[]>([]);
  const [children, setChildren] = useState<EzberItem[]>([]);
  const [message, setMessage] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [rootOrder, setRootOrder] = useState<string[]>([]);
  const rootOrderRef = useRef<string[]>([]);
  const [todoSummaries, setTodoSummaries] = useState<TodoSummary[]>([]);
  const pressId = useRef<string | null>(null);
  const pressY = useRef(0);
  const moved = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadChildren = useCallback(async (parentId: string) => {
    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .eq("parent_id", parentId)
      .order("sort_order")
      .order("title");

    if (error) {
      setMessage(error.message);
      return [];
    }
    return (data ?? []) as EzberItem[];
  }, []);

  const loadRoot = useCallback(async () => {
    const { data: root, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order,metadata")
      .contains("metadata", { source: "dua_v2", entity: "root" })
      .maybeSingle();

    if (error || !root) {
      setMessage(error?.message || "Ezber veritabanı kökü bulunamadı.");
      return;
    }

    setDuaRoot(root as EzberItem);
    const items = await loadChildren(root.id);
    const filtered = items.filter(item => meta(item).menu_key !== "todo");
    setRootChildren(filtered);

    const { data: prefData } = await supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle();

    const prefs = (prefData?.preferences ?? {}) as Record<string, unknown>;
    const saved = prefs.duaEzberMenuOrder;
    if (Array.isArray(saved)) {
      const ids = saved.filter(x => typeof x === "string") as string[];
      rootOrderRef.current = ids;
      setRootOrder(ids);
    }
  }, [loadChildren]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  useEffect(() => {
    if (!initialRoot) return;
    setCurrentRoot(initialRoot);
    setTrail([]);
    loadChildren(initialRoot.id).then(setChildren);
  }, [initialRoot, loadChildren]);

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
          const todoMeta = parseTodo(todo.notes);
          if (!todoOccurs(todoMeta, today)) continue;
          const target = Math.max(1, Number(todoMeta?.schedule?.target || 1));
          const count = Math.min(target, Number(todoMeta?.schedule?.history?.[today]?.count || 0));
          rows.push({ id: todo.id, itemId: todo.related_library_item_id, target, count, done: count >= target });
        }
        setTodoSummaries(rows);
      });
  }, [children]);

  const orderedRoots = useMemo(() => {
    if (!rootOrder.length) return rootChildren;
    const rank = new Map(rootOrder.map((id, i) => [id, i]));
    return [...rootChildren].sort((a, b) => {
      const ai = rank.has(a.id) ? rank.get(a.id)! : 999999;
      const bi = rank.has(b.id) ? rank.get(b.id)! : 999999;
      return ai - bi || a.sort_order - b.sort_order;
    });
  }, [rootChildren, rootOrder]);

  async function saveRootOrder(ids: string[]) {
    rootOrderRef.current = ids;
    setRootOrder(ids);

    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const old = (data?.preferences ?? {}) as Record<string, unknown>;
    const { error } = await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: { ...old, duaEzberMenuOrder: ids },
    });
    if (error) setMessage(error.message);
  }

  function reorderRoots(overId: string) {
    if (!dragId || dragId === overId) return;
    const next = [...orderedRoots];
    const from = next.findIndex(item => item.id === dragId);
    const to = next.findIndex(item => item.id === overId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    const ids = next.map(x => x.id);
    rootOrderRef.current = ids;
    setRootOrder(ids);
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
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      setDragId(id);
    }, 420);
  }

  function movePointer(id: string, y: number, reorder: (id: string) => void) {
    if (!pressId.current || !dragId) return;
    if (Math.abs(y - pressY.current) < 5 && !moved.current) return;
    moved.current = true;
    reorder(id);
  }

  async function finish(persist: () => Promise<void>) {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (moved.current) await persist();
    setDragId(null);
    pressId.current = null;
    moved.current = false;
  }

  async function openEntry(item: EzberItem) {
    const route = String(meta(item).route || "");
    if (route === "listening") {
      setMessage("Dinleme bölümü bir sonraki taşıma adımında normal arayüze bağlanacak.");
      return;
    }

    if (item.kind === "document") {
      onOpenItem(item, children.filter(x => x.kind === "document"), currentRoot);
      return;
    }

    const next = await loadChildren(item.id);
    if (currentRoot) setTrail(t => [...t, currentRoot]);
    setCurrentRoot(item);
    setChildren(next);
    setMessage("");
  }

  async function goBack() {
    const previous = trail[trail.length - 1];
    if (previous) {
      setTrail(t => t.slice(0, -1));
      setCurrentRoot(previous);
      setChildren(await loadChildren(previous.id));
      return;
    }
    setCurrentRoot(null);
    setChildren([]);
    setMessage("");
  }

  const rows = currentRoot ? children : orderedRoots;

  return (
    <section className="legacyNestedPage duaEzberIntegrated">
      <div className={currentRoot ? "legacyListHead" : "legacyHomeHead compact"}>
        {currentRoot ? (
          <button className="legacyBack" onClick={goBack}>‹ Geri</button>
        ) : <span />}
        <h1>{currentRoot?.title || duaRoot?.title || "Ezber"}</h1>
        <span />
      </div>

      <div className={currentRoot ? "legacyCategoryList" : "legacyHomeMenu"}>
        {rows.map(item => (
          <button
            key={item.id}
            className={(currentRoot ? "legacyCategoryRow " : "legacyHomeRow ") + "draggableWholeRow " + (dragId === item.id ? "dragging" : "")}
            onPointerDown={e => down(item.id, e.clientY)}
            onPointerMove={e => movePointer(item.id, e.clientY, currentRoot ? reorderChildren : reorderRoots)}
            onPointerUp={async () => {
              const wasMoved = moved.current;
              await finish(currentRoot ? persistChildren : async () => {
                const ids = rootOrderRef.current.length ? rootOrderRef.current : orderedRoots.map(x => x.id);
                await saveRootOrder(ids);
              });
              if (!wasMoved) await openEntry(item);
            }}
            onPointerCancel={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              holdTimer.current = null;
              setDragId(null);
              pressId.current = null;
              moved.current = false;
            }}
          >
            <span>
              <strong>{item.title}</strong>
              {(item.subtitle || Number(meta(item).target || 0) > 0) && currentRoot && (
                <small className="itemMetaInline">
                  {item.subtitle && <span>{item.subtitle}</span>}
                  {Number(meta(item).target || 0) > 0 && <b>{Number(meta(item).target)}</b>}
                </small>
              )}
            </span>

            <span className="categoryRowRight">
              {currentRoot && (() => {
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

        {!rows.length && <div className="legacyEmptyLine">Bu bölümde içerik bulunamadı.</div>}
      </div>

      {message && <p className="legacyHomeMessage">{message}</p>}
    </section>
  );
}
