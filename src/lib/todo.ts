import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Plan = { daily: number; days: number; start: string; done: Record<string, number> };
export type Todo = {
  id: string;
  title: string;
  notes: string | null;
  is_completed: boolean;
  due_at: string | null;
  list_id: string | null;
  kind: string;
  plan: Plan | null;
  parent_todo_id: string | null;
  related_library_item_id: string | null;
  created_at: string;
  completed_at: string | null;
};
export type TList = { id: string; title: string; group_id: string | null; sort_order: number };
export type TGroup = { id: string; title: string; sort_order: number };

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const endOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); };
export const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

export function planDayIndex(p: Plan, today = ymd()) { return dayNum(today) - dayNum(p.start) + 1; }
export function todayCount(t: Todo, today = ymd()) { return t.plan?.done?.[today] ?? 0; }
export function planStats(p: Plan, today = ymd()) {
  const idx = planDayIndex(p, today);
  const dayOf = (i: number) => ymd(new Date((dayNum(p.start) + i - 1) * 86400000 + 12 * 3600000));
  const full = (i: number) => (p.done?.[dayOf(i)] ?? 0) >= p.daily;
  const last = Math.min(idx, p.days);
  let missed = 0;
  for (let i = 1; i < last + (idx > p.days ? 1 : 0); i++) if (!full(i)) missed++;
  let streak = 0;
  for (let i = last; i >= 1; i--) {
    if (full(i)) streak++;
    else if (i !== idx) break;
  }
  return { idx, streak, missed, left: Math.max(0, p.days - idx) };
}

/** Bugün (Günüm) ekranında görünmeli mi? */
export function inToday(t: Todo): boolean {
  if (t.parent_todo_id) return false;
  if (t.kind === "tekrar" && t.plan) {
    const idx = planDayIndex(t.plan);
    return idx >= 1 && idx <= t.plan.days && !t.is_completed;
  }
  if (t.is_completed) return !!t.completed_at && ymd(new Date(t.completed_at)) === ymd();
  if (!t.due_at) return t.kind === "okuma";
  return new Date(t.due_at) < endOfToday();
}
export function isOverdue(t: Todo): boolean {
  return t.kind !== "tekrar" && !t.is_completed && !!t.due_at && new Date(t.due_at) < startOfToday();
}
export function isDoneToday(t: Todo): boolean {
  if (t.kind === "tekrar" && t.plan) return todayCount(t) >= t.plan.daily;
  return t.is_completed;
}

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TList[]>([]);
  const [groups, setGroups] = useState<TGroup[]>([]);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const [t, l, g] = await Promise.all([
      supabase.from("todos").select("id,title,notes,is_completed,due_at,list_id,kind,plan,parent_todo_id,related_library_item_id,created_at,completed_at").order("sort_order").order("created_at", { ascending: true }).limit(1000),
      supabase.from("todo_lists").select("id,title,group_id,sort_order").order("sort_order").order("created_at"),
      supabase.from("todo_groups").select("id,title,sort_order").order("sort_order").order("created_at"),
    ]);
    if (t.error) setErr(t.error.message); else setTodos((t.data ?? []) as Todo[]);
    if (!l.error) setLists((l.data ?? []) as TList[]);
    if (!g.error) setGroups((g.data ?? []) as TGroup[]);
    setLoaded(true);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { todos, lists, groups, err, loaded, reload, setTodos };
}

export async function bumpCount(t: Todo, delta: number): Promise<Plan | null> {
  if (!t.plan) return null;
  const day = ymd();
  const cur = t.plan.done?.[day] ?? 0;
  const next = Math.max(0, cur + delta);
  const plan: Plan = { ...t.plan, done: { ...(t.plan.done ?? {}), [day]: next } };
  await supabase.from("todos").update({ plan, updated_at: new Date().toISOString() }).eq("id", t.id);
  return plan;
}
