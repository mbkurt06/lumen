"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";
import { FloatingCounterButton } from "@/components/FloatingCounterButton";
import { FullscreenTasbih } from "@/components/FullscreenTasbih";
import { TodoDialog } from "@/components/TodoDialog";
import { EzberSharedHeader } from "@/components/EzberSharedHeader";
import { QuranMushafPageContent } from "@/components/QuranMushafPageContent";
import { RisaleBookView } from "@/components/RisaleBookView";
import { ensureExactMushafFont, loadQuranMushafPage, type QuranMushafPage } from "@/lib/quranMushafDocx";
import { clearTransientCounts, getTransientCounts, setTransientCounts } from "@/lib/transientCounters";
import { getCachedContentByDocument, getCachedQuranNodesByPage, putStaticRows } from "@/lib/localContentDb";
import { readLocalReaderPrefs, scopedBoolean, writeLocalReaderPrefs } from "@/lib/readerPrefs";

type Item = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  metadata: Record<string, unknown> | null;
  sort_order: number;
};

type Todo = {
  id: string;
  notes: string | null;
  related_content_node_id: string | null;
  related_library_item_id: string | null;
};

type TodoInfo = { todo: Todo; meta: TodoMeta; target: number; count: number; done: boolean };

type QuranPosition = {
  nodeId: string;
  page: number;
  juz: number;
  surahTitle: string;
  surahNo: number;
  ayahNo: number;
  updatedAt: string;
};

type QuranBookmark = {
  id: string;
  name: string;
  position: QuranPosition;
};

type QuranTodoChoice = {
  id: string;
  title: string;
  notes: string | null;
  description?: string;
  position?: QuranPosition | null;
};

type BookSelection = {
  text: string;
  nodeId: string | null;
  x: number;
  y: number;
};

type BookBookmark = {
  id: string;
  name: string;
  itemId: string;
  itemTitle: string;
  nodeId: string | null;
  selectedText: string;
  updatedAt: string;
};

type TodoMeta = {
  description?: string;
  quran?: {
    tracking?: boolean;
    position?: QuranPosition;
  };
  schedule?: {
    mode?: "single" | "range" | "days" | "forever";
    startDate?: string;
    endDate?: string | null;
    durationDays?: number | null;
    target?: number;
    history?: Record<string, { count?: number; completedAt?: string | null }>;
  };
};

function parseMeta(notes: string | null): TodoMeta {
  if (!notes) return {};
  try { return JSON.parse(notes) as TodoMeta; } catch { return {}; }
}

function localDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toArabicIndic(value:number) {
  return String(value).replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

function displayQuranPage(page:number | null | undefined) {
  return Math.max(0, Number(page || 1) - 1);
}

function occurs(meta: TodoMeta, key: string) {
  const s = meta.schedule;
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


export function ReaderView({
  item,
  onBack,
  onMenu,
  onMemorize,
  categoryTitle = "",
  initialFocusIndex = 0,
  onPreviousItem,
  onNextItem,
  hasPreviousItem,
  hasNextItem,
  readerScope = "ezber",
}: {
  item: Item;
  onBack?: () => void;
  onMenu?: () => void;
  onMemorize?: (index?: number) => void;
  categoryTitle?: string;
  initialFocusIndex?: number;
  onPreviousItem?: () => void;
  onNextItem?: () => void;
  hasPreviousItem?: boolean;
  hasNextItem?: boolean;
  readerScope?: "ezber" | "risale" | "quran" | "he";
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [todoTarget, setTodoTarget] = useState<{title:string;nodeId?:string;defaultTarget:number;quranPosition?:QuranPosition|null}|null>(null);
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const [documentTodoOpen, setDocumentTodoOpen] = useState(false);
  const [activeDocumentTodoId, setActiveDocumentTodoId] = useState<string | null>(null);
  const [counterArmed, setCounterArmed] = useState(true);
  const [editTodo, setEditTodo] = useState<TodoInfo | null>(null);
  const [editMenu, setEditMenu] = useState<{ todo: TodoInfo; x: number; y: number } | null>(null);
  const [quranSelectedNodeId, setQuranSelectedNodeId] = useState<string | null>(null);
  const [quranPage, setQuranPage] = useState<number | null>(null);
  const [quranPageMin, setQuranPageMin] = useState(1);
  const [quranPageMax, setQuranPageMax] = useState(604);
  const [quranPageLoading, setQuranPageLoading] = useState(false);
  const [quranMushafPage, setQuranMushafPage] = useState<QuranMushafPage | null>(null);
  const [quranBookmarks, setQuranBookmarks] = useState<QuranBookmark[]>([]);
  const [quranBookmarkMenuOpen, setQuranBookmarkMenuOpen] = useState(false);
  const [quranBookmarkName, setQuranBookmarkName] = useState("");
  const [quranTodoMenuOpen, setQuranTodoMenuOpen] = useState(false);
  const [quranTodoChoices, setQuranTodoChoices] = useState<QuranTodoChoice[]>([]);
  const [quranActionFlash, setQuranActionFlash] = useState<"bookmark" | "todo" | "newTodo" | null>(null);
  const [quranActionMessage, setQuranActionMessage] = useState("");
  const [quranDebugOpen, setQuranDebugOpen] = useState(false);
  const [quranDebugBusy, setQuranDebugBusy] = useState(false);
  const [quranDebugSnapshot, setQuranDebugSnapshot] = useState<Record<string, any> | null>(null);
  const [showCounterControl, setShowCounterControl] = useState<boolean | null>(null);
  const [showPlayControl, setShowPlayControl] = useState<boolean | null>(null);
  const [bookSelection, setBookSelection] = useState<BookSelection | null>(null);
  const [bookBookmarks, setBookBookmarks] = useState<BookBookmark[]>([]);
  const [bookBookmarkMenuOpen, setBookBookmarkMenuOpen] = useState(false);
  const [bookBookmarkName, setBookBookmarkName] = useState("");
  const [bookTodoMenuOpen, setBookTodoMenuOpen] = useState(false);
  const [bookTodoExistingOpen, setBookTodoExistingOpen] = useState(false);
  const [bookTodoChoices, setBookTodoChoices] = useState<QuranTodoChoice[]>([]);
  const [bookBookmarkExistingOpen, setBookBookmarkExistingOpen] = useState(false);
  const [bookActionMessage, setBookActionMessage] = useState("");
  const editPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRestored = useRef(false);
  const quranSwipeStartX = useRef<number | null>(null);
  const quranPageCache = useRef<Map<number, Node[]>>(new Map());
  const quranMushafPageCache = useRef<Map<number, QuranMushafPage | null>>(new Map());
  const quranPageRequest = useRef(0);
  const quranPageRef = useRef<HTMLDivElement | null>(null);
  const quranFlowRef = useRef<HTMLDivElement | null>(null);

  const today = localDateKey();

  useEffect(() => {
    let cancelled = false;

    const apply = (preferences: Record<string, unknown>) => {
      if (cancelled) return;
      setShowCounterControl(scopedBoolean(preferences, readerScope, "ShowCounter", true));
      setShowPlayControl(scopedBoolean(preferences, readerScope, "ShowPlay", true));
    };

    const local = readLocalReaderPrefs();
    if (Object.keys(local).length) apply(local);

    void supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle()
      .then(({ data }) => {
        const remote=(data?.preferences ?? {}) as Record<string, unknown>;
        writeLocalReaderPrefs(remote);
        apply(remote);
      })
      .catch(() => {
        if (!Object.keys(local).length && !cancelled) {
          setShowCounterControl(false);
          setShowPlayControl(false);
        }
      });

    const handle = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || detail.scope !== readerScope) return;
      if (typeof detail.showCounter === "boolean") setShowCounterControl(detail.showCounter);
      if (typeof detail.showPlay === "boolean") setShowPlayControl(detail.showPlay);
    };
    window.addEventListener("lumen-library-prefs", handle);
    return () => {
      cancelled = true;
      window.removeEventListener("lumen-library-prefs", handle);
    };
  }, [readerScope]);

  const itemTarget = Number(item.metadata?.target || 0);
  const itemMeta = (item.metadata ?? {}) as Record<string, any>;
  const sourceType = String(itemMeta.source || "");
  const isQuranSurah = sourceType === "quran_seeded";
  const isQuranJuzView = sourceType === "quran_juz_view";
  const isQuranDocument = isQuranSurah || isQuranJuzView;
  const isRisaleDocument = sourceType === "risale_seeded";
  const isBookSelectionDocument = true;
  const isEsmaDetail = itemMeta.category_key === "asma" || String(itemMeta.legacy_id || "").startsWith("esma-");
  const invocation = String(itemMeta.invocation || ((!isQuranDocument && !isRisaleDocument) ? item.subtitle : "") || "");

  useEffect(() => {
    setBookSelection(null);
    setBookBookmarkMenuOpen(false);
    setBookBookmarkExistingOpen(false);
    setBookTodoMenuOpen(false);
    setBookTodoExistingOpen(false);
    setBookActionMessage("");
  }, [item.id, readerScope]);

  useEffect(() => {
    if (!isBookSelectionDocument) {
      setBookSelection(null);
      return;
    }

    const captureSelection = (event: PointerEvent) => {
      // Compact action menu is deliberate: hold Command on macOS or Ctrl elsewhere
      // while selecting text. Normal text selection stays clean and menu-free.
      if (!event.metaKey && !event.ctrlKey) return;

      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (!selection || selection.rangeCount === 0 || !text) return;

      const range = selection.getRangeAt(0);
      const startElement = range.startContainer.nodeType === window.Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement;
      const endElement = range.endContainer.nodeType === window.Node.ELEMENT_NODE
        ? range.endContainer as Element
        : range.endContainer.parentElement;

      const readerSelector = ".legacyReadPage, .risaleBookPage, .quranPage";
      const reader = startElement?.closest(readerSelector);
      if (!reader || !endElement?.closest(readerSelector)) return;

      const nodeElement = startElement?.closest("[data-node-id]") as HTMLElement | null;
      const rect = range.getBoundingClientRect();
      const x = Math.max(110, Math.min(window.innerWidth - 110, rect.left + rect.width / 2));
      const y = Math.max(52, rect.top - 8);

      setBookSelection({
        text: text.slice(0, 1200),
        nodeId: nodeElement?.dataset.nodeId || null,
        x,
        y,
      });
      setBookBookmarkMenuOpen(false);
      setBookBookmarkExistingOpen(false);
      setBookTodoMenuOpen(false);
      setBookTodoExistingOpen(false);
      setBookActionMessage("");
    };

    document.addEventListener("pointerup", captureSelection);
    return () => {
      document.removeEventListener("pointerup", captureSelection);
    };
  }, [isBookSelectionDocument, item.id]);

  useEffect(() => {
    if (!isBookSelectionDocument) return;
    void supabase.from("user_preferences").select("preferences").maybeSingle().then(({data}) => {
      const prefs=(data?.preferences ?? {}) as Record<string,unknown>;
      const key=readerScope+"Bookmarks";
      const rows=Array.isArray(prefs[key]) ? prefs[key] as BookBookmark[] : [];
      setBookBookmarks(rows.filter(row=>row?.itemId===item.id));
    });
  }, [isBookSelectionDocument, item.id, readerScope]);

  const saveBookBookmark = useCallback(async (existingId?:string) => {
    if (!bookSelection) return;
    const {data,error}=await supabase.from("user_preferences").select("preferences").maybeSingle();
    if(error){setBookActionMessage(error.message);return;}
    const prefs=(data?.preferences ?? {}) as Record<string,unknown>;
    const key=readerScope+"Bookmarks";
    const all=Array.isArray(prefs[key]) ? prefs[key] as BookBookmark[] : [];
    const existing=existingId ? all.find(row=>row.id===existingId) : null;
    const fallback=existing?.name || `Ayraç ${all.filter(row=>row.itemId===item.id).length+1}`;
    const name=(bookBookmarkName || fallback).trim() || fallback;
    const nextBookmark:BookBookmark={
      id:existing?.id || `${readerScope}-bookmark-${Date.now()}`,
      name,
      itemId:item.id,
      itemTitle:item.title,
      nodeId:bookSelection.nodeId,
      selectedText:bookSelection.text,
      updatedAt:new Date().toISOString(),
    };
    const next=existing
      ? all.map(row=>row.id===existing.id ? nextBookmark : row)
      : [...all,nextBookmark];
    const {error:saveError}=await supabase.from("user_preferences").upsert({
      preferences:{...prefs,[key]:next},
      updated_at:new Date().toISOString(),
    });
    if(saveError){setBookActionMessage(saveError.message);return;}
    setBookBookmarks(next.filter(row=>row.itemId===item.id));
    setBookBookmarkName("");
    setBookBookmarkMenuOpen(false);
    setBookActionMessage(`Ayraç kaydedildi: ${name}`);
  }, [bookSelection,bookBookmarkName,item.id,item.title,readerScope]);

  const loadBookTodoChoices = useCallback(async () => {
    const {data,error}=await supabase.from("todos")
      .select("id,title,notes")
      .eq("related_library_item_id",item.id)
      .order("created_at",{ascending:true});
    if(error){setBookActionMessage(error.message);return;}
    setBookTodoChoices((data ?? []).map(todo=>({
      id:todo.id,
      title:todo.title,
      notes:todo.notes,
      description:parseMeta(todo.notes).description || "",
      position:null,
    })));
    setBookTodoMenuOpen(true);
    setBookTodoExistingOpen(true);
  }, [item.id]);

  const updateBookTodoPosition = useCallback(async (todo:QuranTodoChoice) => {
    if(!bookSelection) return;
    let meta:any={};
    try{meta=JSON.parse(todo.notes || "{}");}catch{}
    const nextMeta={
      ...meta,
      readerPosition:{
        scope:readerScope,
        itemId:item.id,
        itemTitle:item.title,
        nodeId:bookSelection.nodeId,
        selectedText:bookSelection.text,
        updatedAt:new Date().toISOString(),
      },
    };
    const {error}=await supabase.from("todos").update({
      notes:JSON.stringify(nextMeta),
      related_library_item_id:item.id,
      related_content_node_id:bookSelection.nodeId,
    }).eq("id",todo.id);
    if(error){setBookActionMessage(error.message);return;}
    setBookTodoMenuOpen(false);
    setBookActionMessage(`${todo.title} seçili konuma güncellendi.`);
    window.dispatchEvent(new CustomEvent("lumen-todos-changed"));
  }, [bookSelection,item.id,item.title,readerScope]);

  const clearBookSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setBookSelection(null);
    setBookBookmarkMenuOpen(false);
    setBookBookmarkExistingOpen(false);
    setBookTodoMenuOpen(false);
    setBookTodoExistingOpen(false);
  }, []);

  useEffect(() => {
    if (!bookSelection) return;

    const onOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".bookSelectionPopover")) return;
      if (target?.closest(".modalBackdrop")) return;

      if (bookTodoMenuOpen || bookBookmarkMenuOpen) {
        setBookTodoMenuOpen(false);
        setBookTodoExistingOpen(false);
        setBookBookmarkMenuOpen(false);
        setBookBookmarkExistingOpen(false);
        return;
      }

      clearBookSelection();
    };

    document.addEventListener("pointerdown", onOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
  }, [
    bookSelection,
    bookTodoMenuOpen,
    bookBookmarkMenuOpen,
    clearBookSelection,
  ]);

  const fitQuranTextToPage = useCallback(() => {
    if (!isQuranDocument) return;
    if (quranMushafPage && quranMushafPage.metadata?.exactWordCharacters !== true) return;
    const page = quranPageRef.current;
    const flow = quranFlowRef.current;
    if (!page || !flow) return;

    flow.style.setProperty("--quran-fit-scale", "1");
    const styles = getComputedStyle(page);
    const bottomPadding = Number.parseFloat(styles.paddingBottom || "0") || 0;
    const available = Math.max(40, page.clientHeight - flow.offsetTop - bottomPadding);

    if (flow.scrollHeight <= available + 1) return;

    let low = 0.45;
    let high = 1;
    for (let i = 0; i < 9; i += 1) {
      const mid = (low + high) / 2;
      flow.style.setProperty("--quran-fit-scale", String(mid));
      // Reading scrollHeight forces layout, which is intentional for the short fitting loop.
      if (flow.scrollHeight <= available + 1) low = mid;
      else high = mid;
    }
    flow.style.setProperty("--quran-fit-scale", String(low));
  }, [isQuranDocument]);

  useEffect(() => {
    if (!isQuranDocument) return;
    let frame = requestAnimationFrame(() => fitQuranTextToPage());
    const rerun = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitQuranTextToPage());
    };
    window.addEventListener("resize", rerun);
    window.addEventListener("lumen-library-prefs", rerun as EventListener);
    void document.fonts?.ready?.then(rerun);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", rerun);
      window.removeEventListener("lumen-library-prefs", rerun as EventListener);
    };
  }, [isQuranDocument, quranPage, nodes, fitQuranTextToPage]);

  const quranPositionFor = useCallback((node: Node | null): QuranPosition | null => {
    if (!node) return null;
    const m = (node.metadata ?? {}) as Record<string, any>;
    const page = Number(m.page || quranPage || 0);
    const ayahNo = Number(m.ayah_no || node.sort_order || 0);
    const surahNo = Number(m.surah_no || 0);
    if (!page || !ayahNo || !surahNo) return null;
    return {
      nodeId: node.id,
      page,
      juz: Number(m.juz || 0),
      surahTitle: String(m.surah_title || item.title),
      surahNo,
      ayahNo,
      updatedAt: new Date().toISOString(),
    };
  }, [item.title, quranPage]);

  const flashQuranAction = useCallback((action:"bookmark" | "todo" | "newTodo") => {
    setQuranActionFlash(action);
    window.setTimeout(() => setQuranActionFlash(current => current === action ? null : current), 650);
  }, []);

  const persistQuranBookmarks = useCallback(async (next: QuranBookmark[]) => {
    const { data, error } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    if (error) throw error;
    const preferences = (data?.preferences ?? {}) as Record<string, unknown>;
    const { error: saveError } = await supabase.from("user_preferences").upsert({
      preferences: {
        ...preferences,
        quranBookmarks: next,
        quranBookmark: null,
      },
      updated_at: new Date().toISOString(),
    });
    if (saveError) throw saveError;
    setQuranBookmarks(next);
    window.dispatchEvent(new CustomEvent("lumen-quran-bookmarks-changed", { detail: next }));
  }, []);

  const saveQuranBookmark = useCallback(async (
    node: Node | null,
    options: { id?: string; name?: string } = {}
  ) => {
    const position = quranPositionFor(node);
    if (!position) return;
    try {
      const existing = options.id ? quranBookmarks.find(bookmark => bookmark.id === options.id) : null;
      const fallbackName = existing?.name || `Ayraç ${quranBookmarks.length + 1}`;
      const name = (options.name || fallbackName).trim() || fallbackName;
      const bookmark: QuranBookmark = {
        id: existing?.id || options.id || `quran-bookmark-${Date.now()}`,
        name,
        position,
      };
      const next = existing
        ? quranBookmarks.map(item => item.id === bookmark.id ? bookmark : item)
        : [...quranBookmarks, bookmark];
      await persistQuranBookmarks(next);
      setQuranBookmarkName("");
      setQuranBookmarkMenuOpen(false);
      flashQuranAction("bookmark");
      setQuranActionMessage(
        `${existing ? "Ayraç güncellendi" : "Yeni ayraç eklendi"}: ${name} · Sayfa ${displayQuranPage(position.page)} · ${position.surahTitle} ${position.ayahNo}. ayet`
      );
    } catch(error) {
      setQuranActionMessage(error instanceof Error ? error.message : "Ayraç kaydedilemedi.");
    }
  }, [quranPositionFor, quranBookmarks, persistQuranBookmarks, flashQuranAction]);

  const loadQuranTodoChoices = useCallback(async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("id,title,notes")
      .order("created_at", { ascending: true });
    if (error) {
      setQuranActionMessage(error.message);
      return;
    }
    const choices = (data ?? []).flatMap(todo => {
      let meta: TodoMeta = {};
      try { meta = JSON.parse(todo.notes || "{}") as TodoMeta; } catch {}
      if (!meta.quran?.tracking) return [];
      return [{
        id: todo.id,
        title: todo.title,
        notes: todo.notes,
        description: meta.description || "",
        position: meta.quran.position ?? null,
      }];
    });
    setQuranTodoChoices(choices);
    setQuranTodoMenuOpen(true);
  }, []);

  const updateQuranTodoPosition = useCallback(async (todo: QuranTodoChoice, node: Node | null) => {
    const position = quranPositionFor(node);
    if (!position) return;
    let meta: TodoMeta = {};
    try { meta = JSON.parse(todo.notes || "{}") as TodoMeta; } catch {}
    const nextMeta = {
      ...meta,
      quran: {
        ...meta.quran,
        tracking: true,
        position,
      },
    };
    const { error } = await supabase.from("todos").update({ notes: JSON.stringify(nextMeta) }).eq("id", todo.id);
    if (error) {
      setQuranActionMessage(error.message);
      return;
    }
    setQuranTodoMenuOpen(false);
    flashQuranAction("todo");
    setQuranActionMessage(
      `${todo.title} güncellendi: Sayfa ${displayQuranPage(position.page)} · ${position.surahTitle} ${position.ayahNo}. ayet`
    );
    window.dispatchEvent(new CustomEvent("lumen-todos-changed"));
  }, [quranPositionFor, flashQuranAction]);


  const targetForIntrinsic = useCallback((node: Node) => {
    const own = Number(node.metadata?.target || 0);
    return own > 0 ? own : (nodes.length === 1 && itemTarget > 0 ? itemTarget : 0);
  }, [itemTarget, nodes.length]);

  const loadTodos = useCallback(async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("id,notes,related_content_node_id,related_library_item_id")
      .eq("related_library_item_id", item.id);

    if (error) {
      setMessage(error.message);
      return;
    }
    setTodos(data ?? []);
  }, [item.id]);

  const focusQuranNode = useCallback((nodeId:string | null) => {
    if (!nodeId) return;
    setQuranSelectedNodeId(nodeId);
    setActiveNodeId(nodeId);
    setActiveTodoId(null);
    setActiveDocumentTodoId(null);
    setCounterArmed(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`quran-ayah-${nodeId}`)?.scrollIntoView({
          behavior:"smooth",
          block:"center",
        });
      });
    });
  }, []);

  const fetchQuranPage = useCallback(async (page:number) => {
    const memoryCached = quranPageCache.current.get(page);
    if (memoryCached) return memoryCached;

    const localCached = await getCachedQuranNodesByPage(page).catch(() => []);
    if (localCached.length) {
      const loaded = localCached as Node[];
      quranPageCache.current.set(page, loaded);
      return loaded;
    }

    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,owner_id,document_id,parent_id,kind,title,text_content,secondary_text,translation,metadata,sort_order,created_at,updated_at")
      .eq("metadata->>source", "quran_seeded")
      .eq("metadata->>page", String(page));

    if (error) throw error;
    if (data?.length) void putStaticRows("content_nodes",data).catch(() => {});

    const loaded = (data ?? []).sort((a,b) => {
      const am=(a.metadata ?? {}) as Record<string,any>;
      const bm=(b.metadata ?? {}) as Record<string,any>;
      return Number(am.surah_no || 0) - Number(bm.surah_no || 0)
        || Number(am.ayah_no || a.sort_order || 0) - Number(bm.ayah_no || b.sort_order || 0);
    }) as Node[];

    quranPageCache.current.set(page, loaded);
    return loaded;
  }, []);

  const fetchQuranMushafPage = useCallback(async (page:number) => {
    if (quranMushafPageCache.current.has(page)) {
      return quranMushafPageCache.current.get(page) ?? null;
    }
    const loaded = await loadQuranMushafPage(page);
    quranMushafPageCache.current.set(page, loaded);
    return loaded;
  }, []);

  const loadQuranPage = useCallback(async (page:number, focusNodeId:string | null = null) => {
    const safePage = Math.max(quranPageMin, Math.min(quranPageMax, page));
    const requestId = ++quranPageRequest.current;
    const cached = quranPageCache.current.has(safePage);
    if (!cached) setQuranPageLoading(true);
    setMessage("");

    try {
      const [loaded, wordPage] = await Promise.all([
        fetchQuranPage(safePage),
        fetchQuranMushafPage(safePage).catch(() => null),
      ]);
      if (requestId !== quranPageRequest.current) return;

      setNodes(loaded);
      setQuranMushafPage(wordPage);
      setQuranPage(safePage);
      try { localStorage.setItem("lumen-quran-page:" + item.id, String(safePage)); } catch {}
      setQuranBookmarkMenuOpen(false);
      setQuranTodoMenuOpen(false);
      setQuranSelectedNodeId(null);
      setActiveNodeId(loaded[0]?.id ?? null);
      setActiveTodoId(null);
      setActiveDocumentTodoId(null);
      setCounterArmed(false);
      scrollRestored.current = true;

      if (focusNodeId && loaded.some(node => node.id === focusNodeId)) {
        focusQuranNode(focusNodeId);
      } else {
        window.scrollTo({top:0,behavior:"auto"});
      }

      // Komşu sayfaları arka planda önbelleğe al; sonraki/önceki geçiş anlık olsun.
      if (safePage < quranPageMax) {
        void fetchQuranPage(safePage + 1).catch(() => {});
        void fetchQuranMushafPage(safePage + 1).catch(() => {});
      }
      if (safePage > quranPageMin) {
        void fetchQuranPage(safePage - 1).catch(() => {});
        void fetchQuranMushafPage(safePage - 1).catch(() => {});
      }
    } catch(error) {
      if (requestId !== quranPageRequest.current) return;
      setNodes([]);
      setMessage(error instanceof Error ? error.message : "Kur’an sayfası yüklenemedi.");
    } finally {
      if (requestId === quranPageRequest.current) setQuranPageLoading(false);
    }
  }, [quranPageMin, quranPageMax, focusQuranNode, fetchQuranPage, fetchQuranMushafPage]);

  const load = useCallback(async () => {
    setMessage("");

    if (isQuranDocument) {
      const startPage = Math.max(1, Number(itemMeta.start_page || 1));
      const endPage = Math.min(605, Math.max(startPage, Number(itemMeta.end_page || startPage)));
      setQuranPageMin(startPage);
      setQuranPageMax(endPage);

      let initialPage = startPage;
      const explicitNode = String(itemMeta.initial_node_id || "");
      if (!explicitNode) {
        try {
          const savedPage = Number(localStorage.getItem("lumen-quran-page:" + item.id) || 0);
          if (savedPage >= startPage && savedPage <= endPage) initialPage = savedPage;
        } catch {}
      }

      let loaded: Node[] = [];
      let wordPage: QuranMushafPage | null = null;
      try {
        [loaded, wordPage] = await Promise.all([
          fetchQuranPage(initialPage),
          fetchQuranMushafPage(initialPage).catch(() => null),
        ]);
      } catch(error) {
        setMessage(error instanceof Error ? error.message : "Kur’an sayfası yüklenemedi.");
        setNodes([]);
        return;
      }

      setNodes(loaded);
      setQuranMushafPage(wordPage);
      setQuranPage(initialPage);
      try { localStorage.setItem("lumen-quran-page:" + item.id, String(initialPage)); } catch {}
      setQuranSelectedNodeId(null);
      setLocalCounts(getTransientCounts(item.id));
      setActiveNodeId(loaded[0]?.id ?? null);
      setActiveTodoId(null);
      setActiveDocumentTodoId(null);
      setCounterArmed(false);
      scrollRestored.current = true;
      const initialNodeId = String(itemMeta.initial_node_id || "");
      if (initialNodeId && loaded.some(node => node.id === initialNodeId)) {
        focusQuranNode(initialNodeId);
      }
      if (initialPage < endPage) {
        void fetchQuranPage(initialPage + 1).catch(() => {});
        void fetchQuranMushafPage(initialPage + 1).catch(() => {});
      }
      await loadTodos();
      return;
    }

    let loaded = await getCachedContentByDocument(item.id).catch(() => []) as Node[];
    if (!loaded.length) {
      const { data, error } = await supabase
        .from("content_nodes")
        .select("id,owner_id,document_id,parent_id,kind,title,text_content,secondary_text,translation,metadata,sort_order,created_at,updated_at")
        .eq("document_id", item.id)
        .order("sort_order");

      if (error) {
        setMessage(error.message);
        setNodes([]);
        return;
      }

      loaded = (data ?? []) as Node[];
      if (data?.length) void putStaticRows("content_nodes",data).catch(() => {});
    }
    setNodes(loaded);
    setLocalCounts(getTransientCounts(item.id));

    const firstTargeted = loaded.find(node => {
      const own = Number(node.metadata?.target || 0);
      return own > 0 || (loaded.length === 1 && itemTarget > 0);
    });

    const focused = loaded[Math.min(initialFocusIndex, Math.max(0, loaded.length - 1))];
    setActiveNodeId(focused?.id ?? firstTargeted?.id ?? loaded[0]?.id ?? null);
    setActiveTodoId(null);
    scrollRestored.current = false;

    if (!loaded.length) {
      setMessage(isRisaleDocument ? "Bu Risale bölümünün veritabanı içeriği bulunamadı." : "");
    }

    await loadTodos();
  }, [item.id, itemTarget, loadTodos, initialFocusIndex, isQuranDocument, isRisaleDocument, itemMeta.start_page, itemMeta.end_page, itemMeta.initial_node_id, focusQuranNode, fetchQuranPage, fetchQuranMushafPage]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isQuranDocument) return;
    const refreshImportedMushaf = () => {
      quranPageCache.current.clear();
      quranMushafPageCache.current.clear();
      void loadQuranPage(quranPage || Math.max(1, Number(itemMeta.start_page || 1)));
    };
    window.addEventListener("lumen-quran-mushaf-imported", refreshImportedMushaf);
    return () => window.removeEventListener("lumen-quran-mushaf-imported", refreshImportedMushaf);
  }, [isQuranDocument, quranPage, itemMeta.start_page, loadQuranPage]);

  useEffect(() => {
    if (!isQuranDocument) return;
    void (async () => {
      const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
      const preferences = (data?.preferences ?? {}) as Record<string, any>;
      let bookmarks = Array.isArray(preferences.quranBookmarks)
        ? preferences.quranBookmarks as QuranBookmark[]
        : [];
      if (!bookmarks.length && preferences.quranBookmark?.nodeId) {
        bookmarks = [{
          id:"quran-bookmark-main",
          name:"Kaldığım yer",
          position:preferences.quranBookmark as QuranPosition,
        }];
      }
      setQuranBookmarks(bookmarks.filter(bookmark => bookmark?.position?.nodeId && bookmark?.position?.page));
    })();
  }, [isQuranDocument, item.id]);

  useEffect(() => {
    if (!isQuranDocument || !quranMushafPage) return;
    void ensureExactMushafFont().then(loaded => {
      if (loaded) requestAnimationFrame(() => fitQuranTextToPage());
    });
  }, [isQuranDocument, quranMushafPage, fitQuranTextToPage]);

  useEffect(() => {
    if (!isQuranDocument) return;
    const handleImported = () => {
      quranMushafPageCache.current.clear();
      if (quranPage) void loadQuranPage(quranPage, quranSelectedNodeId);
    };
    window.addEventListener("lumen-quran-mushaf-imported", handleImported);
    return () => window.removeEventListener("lumen-quran-mushaf-imported", handleImported);
  }, [isQuranDocument, quranPage, quranSelectedNodeId, loadQuranPage]);

  useEffect(() => {
    if (!isQuranDocument) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && quranPage && quranPage < quranPageMax) {
        event.preventDefault();
        void loadQuranPage(quranPage + 1);
      }
      if (event.key === "ArrowRight" && quranPage && quranPage > quranPageMin) {
        event.preventDefault();
        void loadQuranPage(quranPage - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isQuranDocument, quranPage, quranPageMin, quranPageMax, loadQuranPage]);

  function todosForNode(node: Node) {
    return todos
      .filter(todo => todo.related_content_node_id === node.id)
      .map(todo => {
        const meta = parseMeta(todo.notes);
        if (!occurs(meta, today)) return null;
        const target = Math.max(1, Number(meta.schedule?.target || 1));
        const count = Math.min(target, Number(meta.schedule?.history?.[today]?.count || 0));
        return { todo, meta, target, count, done: count >= target };
      })
      .filter((value): value is TodoInfo => value !== null);
  }

  function documentTodoInfos() {
    return todos
      .filter(todo => !todo.related_content_node_id)
      .map(todo => {
        const meta = parseMeta(todo.notes);
        if (!occurs(meta, today)) return null;
        const target = Math.max(1, Number(meta.schedule?.target || 1));
        const count = Math.min(target, Number(meta.schedule?.history?.[today]?.count || 0));
        return { todo, meta, target, count, done: count >= target };
      })
      .filter((value): value is TodoInfo => value !== null);
  }

  const activeNode = useMemo(
    () => nodes.find(node => node.id === activeNodeId) ?? null,
    [nodes, activeNodeId]
  );

  useEffect(() => {
    if (!activeNode) {
      setActiveTodoId(null);
      setCounterArmed(false);
      return;
    }
    const active = todosForNode(activeNode).filter(info => !info.done);
    if (active.length) {
      if (!activeTodoId || !active.some(info => info.todo.id === activeTodoId)) {
        setActiveTodoId(active[0].todo.id);
      }
      setCounterArmed(true);
      return;
    }
    setActiveTodoId(null);
    setCounterArmed(targetForIntrinsic(activeNode) > 0);
  }, [activeNodeId, todos]);

  const activeTodos = activeNode ? todosForNode(activeNode).filter(todo => !todo.done) : [];
  const selectedTodo = activeTodoId
    ? activeTodos.find(info => info.todo.id === activeTodoId) ?? null
    : null;
  const selectedDocumentTodo = activeDocumentTodoId
    ? documentTodoInfos().find(info => info.todo.id === activeDocumentTodoId && !info.done) ?? null
    : null;
  const activeIntrinsicTarget = activeNode ? targetForIntrinsic(activeNode) : 0;
  const activeTarget = selectedDocumentTodo ? selectedDocumentTodo.target : (selectedTodo ? selectedTodo.target : activeIntrinsicTarget);
  const activeCount = selectedDocumentTodo
    ? selectedDocumentTodo.count
    : selectedTodo
      ? selectedTodo.count
      : (activeNode ? (localCounts[activeNode.id] ?? 0) : 0);

  const activeTitle = activeNode
    ? (item.subtitle || activeNode.text_content || activeNode.title || item.title)
    : (item.subtitle || item.title);

  async function updateTodoCount(todoInfo: ReturnType<typeof todosForNode>[number], nextCount: number) {
    const history = { ...(todoInfo.meta.schedule?.history || {}) };
    const count = Math.min(todoInfo.target, Math.max(0, nextCount));
    history[today] = {
      count,
      completedAt: count >= todoInfo.target ? new Date().toISOString() : null,
    };

    const nextMeta = {
      ...todoInfo.meta,
      schedule: {
        ...todoInfo.meta.schedule,
        history,
      },
    };

    setTodos(current =>
      current.map(todo =>
        todo.id === todoInfo.todo.id
          ? { ...todo, notes: JSON.stringify(nextMeta) }
          : todo
      )
    );

    const { error } = await supabase
      .from("todos")
      .update({ notes: JSON.stringify(nextMeta) })
      .eq("id", todoInfo.todo.id);

    if (error) setMessage(error.message);
  }

  async function incrementActive() {
    if (activeTarget > 0 && !counterArmed) return;
    if (selectedDocumentTodo) {
      await updateTodoCount(selectedDocumentTodo, selectedDocumentTodo.count + 1);
      return;
    }
    if (!activeNode) return;

    if (selectedTodo) {
      await updateTodoCount(selectedTodo, selectedTodo.count + 1);
      return;
    }

    setLocalCounts(current => {
      const currentCount = current[activeNode.id] ?? 0;
      const next = activeIntrinsicTarget > 0
        ? Math.min(activeIntrinsicTarget, currentCount + 1)
        : currentCount + 1;
      const value = { ...current, [activeNode.id]: next };
      setTransientCounts(item.id, value);
      return value;
    });
  }

  async function decrementActive() {
    if (selectedDocumentTodo) {
      await updateTodoCount(selectedDocumentTodo, selectedDocumentTodo.count - 1);
      return;
    }
    if (!activeNode) return;

    if (selectedTodo) {
      await updateTodoCount(selectedTodo, selectedTodo.count - 1);
      return;
    }

    setLocalCounts(current => {
      const value = {
        ...current,
        [activeNode.id]: Math.max(0, (current[activeNode.id] ?? 0) - 1),
      };
      setTransientCounts(item.id, value);
      return value;
    });
  }

  async function resetActive() {
    if (selectedDocumentTodo) {
      await updateTodoCount(selectedDocumentTodo, 0);
      return;
    }
    if (!activeNode) return;

    if (selectedTodo) {
      await updateTodoCount(selectedTodo, 0);
      return;
    }

    setLocalCounts(current => {
      const value = { ...current, [activeNode.id]: 0 };
      setTransientCounts(item.id, value);
      return value;
    });
  }

  useEffect(() => {
    if (!nodes.length || scrollRestored.current) return;
    scrollRestored.current = true;
    requestAnimationFrame(() => {
      document.querySelector(`[data-reader-index="${initialFocusIndex}"]`)?.scrollIntoView({ block: "center" });
    });
  }, [nodes, initialFocusIndex]);

  const documentTodos = documentTodoInfos();

  function leaveDocument(action?: () => void) {
    clearTransientCounts(item.id);
    action?.();
  }

  function startTodoEditPress(info: TodoInfo, e: React.PointerEvent<HTMLButtonElement>) {
    if (editPressTimer.current) clearTimeout(editPressTimer.current);
    editPressTimer.current = setTimeout(() => {
      setEditMenu({ todo: info, x: e.clientX, y: e.clientY });
    }, 650);
  }

  function endTodoEditPress() {
    if (editPressTimer.current) clearTimeout(editPressTimer.current);
    editPressTimer.current = null;
  }

  function debugElement(el: HTMLElement | null) {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      className: el.className,
      textLength: el.textContent?.length ?? 0,
      textSample: (el.textContent || "").slice(0, 800),
      childCount: el.childElementCount,
      rect: { x:r.x, y:r.y, width:r.width, height:r.height, top:r.top, bottom:r.bottom },
      box: {
        clientWidth:el.clientWidth, clientHeight:el.clientHeight,
        scrollWidth:el.scrollWidth, scrollHeight:el.scrollHeight,
        offsetWidth:el.offsetWidth, offsetHeight:el.offsetHeight,
      },
      style: {
        display:s.display, visibility:s.visibility, opacity:s.opacity,
        color:s.color, backgroundColor:s.backgroundColor,
        fontFamily:s.fontFamily, fontSize:s.fontSize, fontWeight:s.fontWeight,
        lineHeight:s.lineHeight, whiteSpace:s.whiteSpace,
        direction:s.direction, unicodeBidi:s.unicodeBidi,
        overflow:s.overflow, overflowX:s.overflowX, overflowY:s.overflowY,
        position:s.position, transform:s.transform,
        clip:s.clip, clipPath:s.clipPath,
        zIndex:s.zIndex,
      },
      inlineStyle: el.getAttribute("style"),
    };
  }

  async function collectQuranDebug() {
    if (!isQuranDocument) return;
    setQuranDebugBusy(true);
    try {
      const requestedWordPage = quranPage ?? Number(itemMeta.start_page || 1);
      const { data: dbPage, error: dbError } = await supabase
        .from("quran_mushaf_pages")
        .select("word_page,display_page,juz,surah_numbers,plain_text,rich_content,metadata,source_key,source_sha256")
        .eq("source_key","istanbul_mushaf_docx")
        .eq("word_page",requestedWordPage)
        .maybeSingle();

      const rawEl = document.querySelector("[data-quran-test-plain='true']") as HTMLElement | null;
      const fonts = [
        "LumenExactMushaf","Shaikh Hamdullah Mushaf","Noto Naskh Arabic",
        "Geeza Pro","Traditional Arabic","Arial"
      ];
      const fontChecks:Record<string,boolean> = {};
      for (const font of fonts) {
        fontChecks[font] = document.fonts?.check(`24px "${font}"`) ?? false;
      }

      const snapshot = {
        exportedAt:new Date().toISOString(),
        href:window.location.href,
        userAgent:navigator.userAgent,
        viewport:{width:window.innerWidth,height:window.innerHeight,devicePixelRatio:window.devicePixelRatio},
        item:{
          id:item.id,title:item.title,kind:item.kind,metadata:itemMeta,
          sourceType,isQuranSurah,isQuranJuzView,isQuranDocument,
        },
        readerState:{
          quranPage,quranPageMin,quranPageMax,quranPageLoading,
          nodesLength:nodes.length,
          nodes:nodes.slice(0,8).map(node=>({
            id:node.id,title:node.title,sort_order:node.sort_order,
            secondaryLength:node.secondary_text?.length ?? 0,
            secondarySample:(node.secondary_text || "").slice(0,240),
            metadata:node.metadata,
          })),
          mushafStatePresent:!!quranMushafPage,
          mushafState:quranMushafPage ? {
            word_page:quranMushafPage.word_page,
            display_page:quranMushafPage.display_page,
            juz:quranMushafPage.juz,
            surah_numbers:quranMushafPage.surah_numbers,
            plainLength:quranMushafPage.plain_text?.length ?? 0,
            plainSample:(quranMushafPage.plain_text || "").slice(0,1200),
            metadata:quranMushafPage.metadata,
            paragraphCount:quranMushafPage.rich_content?.paragraphs?.length ?? 0,
          } : null,
        },
        directDatabase:{
          requestedWordPage,
          error:dbError?.message ?? null,
          found:!!dbPage,
          row:dbPage ? {
            ...dbPage,
            plain_text_length:dbPage.plain_text?.length ?? 0,
            plain_text_sample:(dbPage.plain_text || "").slice(0,1600),
            rich_content_summary:{
              version:dbPage.rich_content?.version,
              paragraphCount:dbPage.rich_content?.paragraphs?.length ?? 0,
              firstRunTextLength:dbPage.rich_content?.paragraphs?.[0]?.runs?.[0]?.text?.length ?? 0,
              firstRunTextSample:(dbPage.rich_content?.paragraphs?.[0]?.runs?.[0]?.text || "").slice(0,1000),
            },
            plain_text:undefined,
            rich_content:undefined,
          } : null,
        },
        dom:{
          page:debugElement(quranPageRef.current),
          flow:debugElement(quranFlowRef.current),
          rawTest:debugElement(rawEl),
          rawExists:!!rawEl,
          flowInnerHTML:(quranFlowRef.current?.innerHTML || "").slice(0,5000),
          bodyClass:document.body.className,
          bodyDataset:{...document.body.dataset},
          rootCssVars:{
            quranFontScale:getComputedStyle(document.documentElement).getPropertyValue("--quran-font-scale"),
            quranFitScale:quranFlowRef.current?.style.getPropertyValue("--quran-fit-scale") || "",
            quranFontFamily:getComputedStyle(document.documentElement).getPropertyValue("--quran-font-family"),
            quranExactFontFamily:getComputedStyle(document.documentElement).getPropertyValue("--quran-exact-font-family"),
            quranFontWeight:getComputedStyle(document.documentElement).getPropertyValue("--quran-font-weight"),
          },
        },
        fonts:fontChecks,
        message,
      };
      setQuranDebugSnapshot(snapshot);
    } catch (error) {
      setQuranDebugSnapshot({
        exportedAt:new Date().toISOString(),
        fatalError:error instanceof Error ? {message:error.message,stack:error.stack} : String(error),
      });
    } finally {
      setQuranDebugBusy(false);
    }
  }

  function exportQuranDebug() {
    if (!quranDebugSnapshot) return;
    const blob = new Blob([JSON.stringify(quranDebugSnapshot,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quran-reader-debug-page-${quranPage ?? "unknown"}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="legacyReadPage"
      onPointerDown={e => {
        if (e.target === e.currentTarget) {
          setActiveTodoId(null);
          setActiveDocumentTodoId(null);
          setCounterArmed(false);
          setEditMenu(null);
        }
      }}
    >
      <EzberSharedHeader
        title={isEsmaDetail ? (categoryTitle || item.title) : item.title}
        invocation={!isEsmaDetail ? invocation || null : null}
        showTodo={true}
        showMemorize={true}
        onMenu={() => leaveDocument(onMenu)}
        onBack={() => leaveDocument(onBack)}
        onTodo={() => setDocumentTodoOpen(true)}
        onMemorize={() => onMemorize?.(initialFocusIndex)}
        showFullscreen={true}
        onFullscreen={() => window.dispatchEvent(new Event("lumen-open-fullscreen-tasbih"))}
        onSettings={() => window.dispatchEvent(new Event("lumen-open-library-settings"))}
      />

      {isQuranDocument && !quranMushafPage && (
        <div className="quranWordSourceWarning">
          Şu anda Word Mushaf kaynağı yüklü değil; eski Kur’an veritabanı metni gösteriliyor.
          Birebir Word karakterleri için ⚙️ Ayarlar → “DOCX'i birebir içe aktar” ile Mushaf DOCX dosyasını bir kez yükle.
        </div>
      )}

      {isQuranDocument && quranPage && (
        <div className="quranPageMetaBar">
          <strong>{String((nodes[0]?.metadata as Record<string,any> | null)?.surah_title || item.title)}</strong>
          <span>Sayfa {displayQuranPage(quranPage)} / Cüz {String((nodes[0]?.metadata as Record<string,any> | null)?.juz || itemMeta.juz_no || "")}</span>
        </div>
      )}
      {isRisaleDocument && nodes.length > 0 && (
        <div className="readerSourceNote">
          Kaynak: Risale-i-Nur Diyanet Asıl Nüsha metin arşivi · CC BY-ND 4.0 · içerik Lumen veritabanından okunur.
        </div>
      )}

      {isEsmaDetail && (
        <div className="v2EsmaIdentity v2EsmaReadIdentity">
          <div className="v2EsmaName">{item.title}</div>
          {invocation && <div className="v2EsmaInvocation">{invocation}</div>}
        </div>
      )}

      {!!documentTodos.length && (
        <div className="documentTodoTargets">
          {documentTodos.filter(x => !x.done).map(info => (
            <button
              key={info.todo.id}
              className={"segmentTargetButton documentTodoTarget " + (activeDocumentTodoId === info.todo.id ? " active" : "")}
              onPointerDown={e => startTodoEditPress(info, e)}
              onPointerUp={endTodoEditPress}
              onPointerCancel={endTodoEditPress}
              onContextMenu={e => e.preventDefault()}
              onClick={() => { setActiveTodoId(null); setActiveDocumentTodoId(info.todo.id); setCounterArmed(true); }}
            >
              {info.target}/{info.count}
            </button>
          ))}
        </div>
      )}
      {itemTarget > 0 && (
        <div className="legacyInvocation inlineInvocationTarget">
          <b>{itemTarget}</b>
        </div>
      )}

      {isBookSelectionDocument && bookSelection && !todoTarget && !documentTodoOpen && (
        <div
          className="bookSelectionPopover"
          style={{left:bookSelection.x, top:bookSelection.y}}
        >
          <div className="bookSelectionMiniBar">
            <button
              className={"bookMiniAction primary " + (bookTodoMenuOpen ? "pressed" : "")}
              onClick={() => {
                setBookBookmarkMenuOpen(false);
                setBookBookmarkExistingOpen(false);
                setBookTodoExistingOpen(false);
                setBookTodoMenuOpen(open=>!open);
              }}
            >
              + Todo
            </button>
            <button
              className={"bookMiniAction iconOnly " + (bookBookmarkMenuOpen ? "pressed" : "")}
              title="Ayraç"
              aria-label="Ayraç"
              onClick={() => {
                setBookTodoMenuOpen(false);
                setBookTodoExistingOpen(false);
                setBookBookmarkExistingOpen(false);
                setBookBookmarkMenuOpen(open=>!open);
              }}
            >
              🔖
            </button>
          </div>

          {bookTodoMenuOpen && (
            <div className="bookMiniChooser">
              {!bookTodoExistingOpen ? (
                <>
                  <button
                    onClick={() => {
                      setBookTodoMenuOpen(false);
                      setBookTodoExistingOpen(false);
                      const selectedNode = nodes.find(node => node.id === bookSelection.nodeId);
                      setTodoTarget({
                        title:bookSelection.text || item.title,
                        nodeId:bookSelection.nodeId || undefined,
                        defaultTarget:selectedNode ? (targetForIntrinsic(selectedNode) || 1) : 1,
                      });
                    }}
                  >
                    Yeni oluştur
                  </button>
                  <button onClick={() => void loadBookTodoChoices()}>
                    Var olanı güncelle
                  </button>
                </>
              ) : (
                <>
                  <button className="bookMiniBack" onClick={()=>setBookTodoExistingOpen(false)}>‹ Geri</button>
                  {bookTodoChoices.length ? bookTodoChoices.map(todo=>(
                    <button key={todo.id} onClick={()=>void updateBookTodoPosition(todo)}>
                      <b>{todo.title}</b>
                      {todo.description && <small>{todo.description}</small>}
                    </button>
                  )) : <small>Bu kitap için kayıtlı Todo yok.</small>}
                </>
              )}
            </div>
          )}

          {bookBookmarkMenuOpen && (
            <div className="bookMiniChooser">
              {!bookBookmarkExistingOpen ? (
                <>
                  <button onClick={() => void saveBookBookmark()}>Yeni oluştur</button>
                  <button onClick={() => setBookBookmarkExistingOpen(true)}>Var olanı güncelle</button>
                </>
              ) : (
                <>
                  <button className="bookMiniBack" onClick={()=>setBookBookmarkExistingOpen(false)}>‹ Geri</button>
                  {bookBookmarks.length ? bookBookmarks.map(bookmark=>(
                    <button key={bookmark.id} onClick={()=>void saveBookBookmark(bookmark.id)}>
                      <b>{bookmark.name}</b>
                      <small>{bookmark.selectedText}</small>
                    </button>
                  )) : <small>Bu kitap için kayıtlı ayraç yok.</small>}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {isQuranDocument ? (
        <div className="quranReaderShell">
          <div
            ref={quranPageRef}
            className={"quranPage " + (quranMushafPage ? "quranWordPage " : "") + (quranPageLoading ? "loading" : "")}
            onClick={() => setQuranSelectedNodeId(null)}
            onTouchStart={e => { quranSwipeStartX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={e => {
              const startX = quranSwipeStartX.current;
              const endX = e.changedTouches[0]?.clientX ?? null;
              quranSwipeStartX.current = null;
              if (startX == null || endX == null || Math.abs(endX - startX) < 55 || !quranPage) return;
              if (endX < startX && quranPage < quranPageMax) void loadQuranPage(quranPage + 1);
              if (endX > startX && quranPage > quranPageMin) void loadQuranPage(quranPage - 1);
            }}
          >
            <div className="quranPageTopLine">
              <span>{String((nodes[0]?.metadata as Record<string,any> | null)?.surah_title || item.title)}</span>
              <span>{quranPage ? `Sayfa ${displayQuranPage(quranPage)}` : ""}</span>
              <span>{String((nodes[0]?.metadata as Record<string,any> | null)?.juz ? `Cüz ${(nodes[0]?.metadata as Record<string,any>).juz}` : "")}</span>
            </div>
            <div
              ref={quranFlowRef}
              className={
                "quranFlow"
                + (quranMushafPage ? " quranWordSourceActive" : "")
                + (quranMushafPage?.metadata?.exactWordCharacters === true ? " quranExactWordFont" : "")
              }
              dir="rtl"
            >
              {quranMushafPage ? (
                quranMushafPage.metadata?.exactWordCharacters === true ? (
                  <QuranMushafPageContent
                    page={quranMushafPage}
                    selectedNodeId={quranSelectedNodeId}
                    onSelectNode={nodeId => {
                      setQuranBookmarkMenuOpen(false);
                      setQuranTodoMenuOpen(false);
                      setQuranSelectedNodeId(nodeId);
                      setActiveNodeId(nodeId);
                      setActiveDocumentTodoId(null);
                      setActiveTodoId(null);
                      setCounterArmed(true);
                    }}
                  />
                ) : (
                  <pre
                    className="quranReaderRawDebugText"
                    dir="rtl"
                    data-quran-test-plain="true"
                  >
                    {quranMushafPage.plain_text || "(Veritabanındaki plain_text boş)"}
                  </pre>
                )
              ) : (
                nodes.map((node, index) => {
                  const selected = quranSelectedNodeId === node.id;
                  return (
                    <span
                      key={node.id}
                      id={"quran-ayah-" + node.id}
                      role="button"
                      tabIndex={0}
                      className={"quranAyahInline" + (selected ? " selected" : "")}
                      data-node-id={node.id}
                      data-reader-index={index}
                      onClick={e => {
                        e.stopPropagation();
                        setQuranBookmarkMenuOpen(false);
                        setQuranTodoMenuOpen(false);
                        setQuranSelectedNodeId(node.id);
                        setActiveNodeId(node.id);
                        setActiveDocumentTodoId(null);
                        setActiveTodoId(null);
                        setCounterArmed(true);
                      }}
                    >
                      <span className="quranAyahText">{node.secondary_text}</span><span className="quranAyahNo" aria-label={`Ayet ${node.sort_order}`}>{toArabicIndic(node.sort_order)}</span>{" "}
                    </span>
                  );
                })
              )}
            </div>
          </div>

          <nav className="quranPagePager quranPagePagerRtl" aria-label="Kur’an sayfası">
            <button disabled={!quranPage || quranPage >= quranPageMax} onClick={() => quranPage && void loadQuranPage(quranPage + 1)}>‹ Sonraki sayfa</button>
            <span>{quranPage ? displayQuranPage(quranPage) : "—"} / 604</span>
            <button disabled={!quranPage || quranPage <= quranPageMin} onClick={() => quranPage && void loadQuranPage(quranPage - 1)}>Önceki sayfa ›</button>
          </nav>

          {(quranBookmarks.length > 0 || quranActionMessage) && (
            <div className="quranReadingStatus">
              {quranBookmarks.map(bookmark => (
                <div key={bookmark.id} className="quranBookmarkStatusItem">
                  <button
                    className="quranBookmarkJump"
                    onClick={() => void loadQuranPage(bookmark.position.page, bookmark.position.nodeId)}
                  >
                    🔖 {bookmark.name}: Sayfa {displayQuranPage(bookmark.position.page)} · {bookmark.position.surahTitle} {bookmark.position.ayahNo}. ayet
                  </button>
                  <button
                    className="quranBookmarkTodoButton"
                    onClick={() => setTodoTarget({
                      title: bookmark.name || "Kur’an okuma",
                      nodeId: bookmark.position.nodeId,
                      defaultTarget: 1,
                      quranPosition: bookmark.position,
                    })}
                  >
                    + Todo
                  </button>
                </div>
              ))}
              {quranActionMessage && <small>{quranActionMessage}</small>}
            </div>
          )}

          <div className="quranSupplement quranTranslationBlock">
            <h3>Türkçe meal</h3>
            {nodes.map(node => (
              <p key={"meal-" + node.id}>
                <b>{node.sort_order}.</b> {node.translation}
              </p>
            ))}
          </div>
        </div>
      ) : isRisaleDocument ? (
        <RisaleBookView
          itemId={item.id}
          title={item.title}
          bookTitle={String(itemMeta.book_title || "")}
          nodes={nodes}
          hasPreviousDocument={Boolean(hasPreviousItem)}
          hasNextDocument={Boolean(hasNextItem)}
          onPreviousDocument={onPreviousItem}
          onNextDocument={onNextItem}
        />
      ) : (
      <div className={"legacyReadContent unifiedBookReader " + (readerScope === "ezber" ? "ezberBookReader" : "heBookReader")}>
        <section className="unifiedBookPage">
          <header className="unifiedBookPageHead">
            <strong>{item.title}</strong>
            <span>{categoryTitle || (readerScope === "ezber" ? "Ezber" : "Kitap")}</span>
          </header>

          <div className="unifiedBookPageBody">
            {nodes.map((node, index) => {
              const todoInfos = todosForNode(node);
              const activeTodoInfos = todoInfos.filter(info => !info.done);
              const intrinsicTarget = targetForIntrinsic(node);
              const intrinsicCount = localCounts[node.id] ?? 0;
              const intrinsicDone = intrinsicTarget > 0 && intrinsicCount >= intrinsicTarget;
              const active = activeNodeId === node.id;
              const note = String((node.metadata as Record<string,unknown> | null)?.note || "");
              const isInstruction = Boolean((node.metadata as Record<string,unknown> | null)?.instruction);

              return (
                <article
                  className={
                    "unifiedBookBlock "
                    + (note ? "unifiedBookSectionStart " : "")
                    + (isInstruction ? "unifiedBookInstructionBlock " : "")
                    + (active ? "counterActiveItem" : "")
                  }
                  key={node.id}
                  data-node-id={node.id}
                  data-reader-index={index}
                >
                  {note && <div className="unifiedBookSectionNote">{note}</div>}
                  {node.title && <h3>{node.title}</h3>}

                  <div className="unifiedBookBlockContent">
                    <div className="unifiedBookText">
                      {node.secondary_text && <div className="legacyArabic unifiedBookArabic" dir="rtl">{node.secondary_text}</div>}
                      {node.text_content && (
                        <div className={isInstruction ? "legacyInstruction unifiedBookInstruction" : "legacySegment unifiedBookLatin"}>
                          {node.text_content}
                        </div>
                      )}
                      {node.translation && <div className="legacyTurkish unifiedBookTurkish">{node.translation}</div>}
                    </div>

                    {(activeTodoInfos.length > 0 || intrinsicTarget > 0) && (
                      <div className="unifiedBookCounters">
                        {Object.values(activeTodoInfos.reduce((groups, info) => {
                          const key = info.target + "/" + info.count;
                          (groups[key] ||= []).push(info);
                          return groups;
                        }, {} as Record<string, typeof activeTodoInfos>)).map(group => {
                          const info = group[0];
                          const selected = active && group.some(x => x.todo.id === activeTodoId);
                          return (
                            <button
                              key={info.todo.id}
                              className={"segmentTargetButton todoTarget " + (selected ? " active" : "")}
                              onPointerDown={e => startTodoEditPress(info, e)}
                              onPointerUp={endTodoEditPress}
                              onPointerCancel={endTodoEditPress}
                              onContextMenu={e => e.preventDefault()}
                              onClick={e => {
                                e.stopPropagation();
                                setActiveNodeId(node.id);
                                setActiveDocumentTodoId(null);
                                setActiveTodoId(info.todo.id);
                                setCounterArmed(true);
                              }}
                            >
                              {info.target}/{info.count}
                              {group.length > 1 && <span className="targetMultiplicity">{group.length}</span>}
                            </button>
                          );
                        })}

                        {!activeTodoInfos.length && intrinsicTarget > 0 && (
                          <button
                            className={"segmentTargetButton " + (intrinsicDone ? "done" : "") + (active && !activeTodoId ? " active" : "")}
                            onClick={e => {
                              e.stopPropagation();
                              setActiveNodeId(node.id);
                              setActiveDocumentTodoId(null);
                              setActiveTodoId(null);
                              setCounterArmed(true);
                            }}
                          >
                            {intrinsicTarget}/{intrinsicCount}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {!nodes.length && !message && <p className="muted">Henüz içerik yok.</p>}
          </div>

          <footer className="unifiedBookPageFoot">
            <span>{item.title}</span>
          </footer>
        </section>
      </div>
      )}

      {!isQuranDocument && !isRisaleDocument && (
        <nav className="contentPager">
          <button className="secondary" disabled={!hasPreviousItem} onClick={() => leaveDocument(onPreviousItem)}>‹ Önceki</button>
          <button className="secondary" disabled={!hasNextItem} onClick={() => leaveDocument(onNextItem)}>Sonraki ›</button>
        </nav>
      )}

      {showPlayControl === true && <FloatingPlaybackButton />}

      {showCounterControl === true && (
        <FloatingCounterButton
          key={item.id}
          title={activeTitle}
          target={activeTarget}
          count={activeCount}
          onIncrement={incrementActive}
          onDecrement={decrementActive}
          onReset={resetActive}
          positionKey={readerScope}
        />
      )}

      <FullscreenTasbih
        title={activeTitle}
        count={activeCount}
        target={activeTarget}
        onIncrement={() => void incrementActive()}
        onDecrement={() => void decrementActive()}
      />

      <TodoDialog
        open={documentTodoOpen}
        onClose={() => setDocumentTodoOpen(false)}
        onSaved={loadTodos}
        title={isQuranDocument ? "Kur’an okuma" : item.title}
        defaultTarget={1}
        libraryItemId={item.id}
        contentNodeId={null}
        extraMeta={isQuranDocument ? {
          quran: {
            tracking: true,
            position: quranPositionFor(nodes.find(node => node.id === quranSelectedNodeId) ?? nodes[0] ?? null),
          },
        } : undefined}
      />

      <TodoDialog
        open={!!todoTarget}
        onClose={() => setTodoTarget(null)}
        onSaved={loadTodos}
        title={todoTarget?.title || ""}
        defaultTarget={todoTarget?.defaultTarget || 1}
        libraryItemId={item.id}
        contentNodeId={todoTarget?.nodeId || null}
        extraMeta={isQuranDocument ? {
          quran: {
            tracking: true,
            position: todoTarget?.quranPosition
              ?? quranPositionFor(nodes.find(node => node.id === (todoTarget?.nodeId || quranSelectedNodeId)) ?? nodes[0] ?? null),
          },
          selection: bookSelection ? {
            scope: readerScope,
            text: bookSelection.text,
            nodeId: bookSelection.nodeId,
          } : undefined,
        } : bookSelection ? {
          selection: {
            scope: readerScope,
            text: bookSelection.text,
            nodeId: bookSelection.nodeId,
          },
          readerPosition: {
            scope: readerScope,
            itemId: item.id,
            itemTitle: item.title,
            nodeId: bookSelection.nodeId,
            selectedText: bookSelection.text,
            updatedAt: new Date().toISOString(),
          },
        } : undefined}
      />

      {editMenu && (
        <button
          className="counterResetPopover todoEditPopover"
          style={{ left: Math.max(8, editMenu.x - 42), top: Math.max(8, editMenu.y - 58), right: "auto", bottom: "auto" }}
          onClick={() => {
            setEditTodo(editMenu.todo);
            setEditMenu(null);
          }}
        >
          Düzenle
        </button>
      )}

      {editTodo && (
        <TodoDialog
          open={true}
          onClose={() => setEditTodo(null)}
          onSaved={async () => { await loadTodos(); setEditTodo(null); }}
          title={item.title}
          defaultTarget={editTodo.target}
          libraryItemId={item.id}
          contentNodeId={editTodo.todo.related_content_node_id}
          editTodo={{ id: editTodo.todo.id, notes: editTodo.todo.notes }}
        />
      )}

      {message && <div className="legacyMessage">{message}</div>}

      {isQuranDocument && (
        <button
          type="button"
          onClick={() => {
            setQuranDebugOpen(true);
            void collectQuranDebug();
          }}
          style={{
            position:"fixed", right:18, bottom:18, zIndex:9998,
            border:"1px solid #7d6952", borderRadius:999,
            background:"#1f241f", color:"#fff", padding:"9px 13px",
            fontSize:12, fontWeight:800, boxShadow:"0 6px 22px #0005", cursor:"pointer"
          }}
        >
          🐞 Kur’an Debug
        </button>
      )}

      {isQuranDocument && quranDebugOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position:"fixed", inset:0, zIndex:9999, background:"#0009",
            display:"grid", placeItems:"center", padding:18
          }}
          onMouseDown={e => { if (e.target === e.currentTarget) setQuranDebugOpen(false); }}
        >
          <div style={{
            width:"min(1100px,96vw)", maxHeight:"92vh", overflow:"auto",
            background:"#171a17", color:"#f5f2e9", border:"1px solid #555",
            borderRadius:14, boxShadow:"0 18px 60px #0009", padding:16
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,position:"sticky",top:0,background:"#171a17",paddingBottom:10,zIndex:2}}>
              <strong style={{fontSize:16}}>Kur’an Okuyucu Debug</strong>
              <span style={{opacity:.65,fontSize:11}}>Sayfa {quranPage ?? "—"}</span>
              <span style={{flex:1}} />
              <button onClick={() => void collectQuranDebug()} disabled={quranDebugBusy}>
                {quranDebugBusy ? "Toplanıyor…" : "Yeniden ölç"}
              </button>
              <button onClick={exportQuranDebug} disabled={!quranDebugSnapshot}>JSON dışa aktar</button>
              <button onClick={() => setQuranDebugOpen(false)}>Kapat</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8,marginBottom:12}}>
              {[
                ["DB kayıt", quranDebugSnapshot?.directDatabase?.found ? "VAR" : "YOK"],
                ["DB text", String(quranDebugSnapshot?.directDatabase?.row?.plain_text_length ?? "—")],
                ["State Mushaf", quranDebugSnapshot?.readerState?.mushafStatePresent ? "VAR" : "YOK"],
                ["State text", String(quranDebugSnapshot?.readerState?.mushafState?.plainLength ?? "—")],
                ["Flow text", String(quranDebugSnapshot?.dom?.flow?.textLength ?? "—")],
                ["RAW element", quranDebugSnapshot?.dom?.rawExists ? "VAR" : "YOK"],
                ["RAW text", String(quranDebugSnapshot?.dom?.rawTest?.textLength ?? "—")],
                ["Flow height", String(quranDebugSnapshot?.dom?.flow?.rect?.height ?? "—")],
              ].map(([label,value]) => (
                <div key={label} style={{border:"1px solid #444",borderRadius:8,padding:9}}>
                  <div style={{fontSize:10,opacity:.6}}>{label}</div>
                  <b style={{fontSize:13}}>{value}</b>
                </div>
              ))}
            </div>

            <h3 style={{margin:"12px 0 6px"}}>DB’den doğrudan gelen metin</h3>
            <pre dir="rtl" style={{
              whiteSpace:"pre-wrap",unicodeBidi:"plaintext",background:"#fff4c9",color:"#111",
              borderRadius:8,padding:12,fontSize:22,lineHeight:1.7,maxHeight:240,overflow:"auto",
              fontFamily:'Arial,"Geeza Pro","Noto Naskh Arabic",sans-serif'
            }}>
              {quranDebugSnapshot?.directDatabase?.row?.plain_text_sample || "(yok)"}
            </pre>

            <h3 style={{margin:"12px 0 6px"}}>Reader state içindeki metin</h3>
            <pre dir="rtl" style={{
              whiteSpace:"pre-wrap",unicodeBidi:"plaintext",background:"#f6f3ed",color:"#111",
              borderRadius:8,padding:12,fontSize:22,lineHeight:1.7,maxHeight:220,overflow:"auto"
            }}>
              {quranDebugSnapshot?.readerState?.mushafState?.plainSample || "(yok)"}
            </pre>

            <h3 style={{margin:"12px 0 6px"}}>DOM / CSS / State özeti</h3>
            <pre style={{
              whiteSpace:"pre-wrap",background:"#0d0f0d",border:"1px solid #333",
              borderRadius:8,padding:12,fontSize:11,lineHeight:1.5,maxHeight:420,overflow:"auto"
            }}>
              {JSON.stringify(quranDebugSnapshot,null,2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
