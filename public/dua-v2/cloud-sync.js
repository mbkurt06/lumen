(() => {
  const SUPABASE_URL = "https://nndammodckedypoqrpqa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_QpbA0zWp69BAcgZmYTIyIQ_n1q3KkP6";
  const TABLE = "dua_v2_state";
  const SYNC_KEYS = [
    "duaEzberState",
    "duaTodoState",
    "readHeaderCollapsed",
    "duaCompactPlayerPos",
    "duaPlayerCollapsed",
    "duaCounterPos",
    "listeningPlayerScale",
    "listeningPlayerCompact",
    "tasbihFullscreenTitleSize",
    "duaHomeMenuOrder",
    "duaLibraryOrders",
    "ylp_saved_videos",
    "ylp_presets",
    "ylp_history",
    "ylp_video_links",
    "ylp_selected_video",
    "ylp_selected_preset",
    "ylp_speed"
  ];

  let remoteReady = false;
  let saveTimer = null;
  let auth = null;

  const OFFLINE_DB="lumen-dua-v2-offline";
  const OFFLINE_STORE="cache";

  function openOfflineDb() {
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(OFFLINE_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE,{keyPath:"key"});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  async function cacheContent(value) {
    try{
      const db=await openOfflineDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(OFFLINE_STORE,"readwrite");
        tx.objectStore(OFFLINE_STORE).put({key:"content",value,updatedAt:new Date().toISOString()});
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }catch(error){console.warn("Dua V2 offline cache:",error)}
  }

  async function readCachedContent() {
    try{
      const db=await openOfflineDb();
      const value=await new Promise((resolve,reject)=>{
        const tx=db.transaction(OFFLINE_STORE,"readonly");
        const req=tx.objectStore(OFFLINE_STORE).get("content");
        req.onsuccess=()=>resolve(req.result?.value || null);
        req.onerror=()=>reject(req.error);
      });
      db.close();
      return value;
    }catch{return null}
  }

  function authSession() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (value?.access_token && value?.user?.id) return {...value,__storageKey:key};
      } catch {}
    }
    return null;
  }

  async function refreshAuthSession() {
    const current = auth || authSession();
    if (!current?.refresh_token) return null;

    const response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: current.refresh_token })
    });

    if (!response.ok) return null;
    const fresh = await response.json();
    if (!fresh?.access_token || !fresh?.user?.id) return null;

    const storageKey = current.__storageKey;
    auth = {...fresh,__storageKey:storageKey};
    if (storageKey) {
      const persist = {...fresh};
      delete persist.__storageKey;
      localStorage.setItem(storageKey, JSON.stringify(persist));
    }
    return auth;
  }

  function snapshot() {
    const payload = {};
    for (const key of SYNC_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) payload[key] = value;
    }
    return payload;
  }

  function hydrate(payload) {
    if (!payload || typeof payload !== "object") return;
    for (const [key, value] of Object.entries(payload)) {
      if (!SYNC_KEYS.includes(key) || typeof value !== "string") continue;
      localStorage.setItem(key, value);
    }
  }

  async function request(path, options = {}, retried = false) {
    if (!auth) auth = authSession();
    if (!auth) return null;

    const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + auth.access_token,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (response.status === 401 && !retried) {
      const fresh = await refreshAuthSession();
      if (fresh) return request(path, options, true);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error("Supabase REST " + response.status + ": " + body);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function loadRemote() {
    if(!navigator.onLine) return;
    auth = authSession();
    if (!auth) return;
    const expiresAt = Number(auth.expires_at || 0);
    if (expiresAt && expiresAt - Math.floor(Date.now()/1000) < 120) {
      await refreshAuthSession();
    }
    const rows = await request(
      TABLE + "?owner_id=eq." + encodeURIComponent(auth.user.id) + "&select=payload&limit=1"
    );
    if (Array.isArray(rows) && rows[0]?.payload) hydrate(rows[0].payload);
  }

  async function saveRemote() {
    if (!remoteReady || !auth || !navigator.onLine) return;
    try {
      await request(TABLE + "?on_conflict=owner_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          owner_id: auth.user.id,
          payload: snapshot(),
          updated_at: new Date().toISOString()
        })
      });
    } catch (error) {
      console.warn("Dua V2 cloud sync:", error);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveRemote, 350);
  }

  async function loadAllRows(table, select) {
    const out = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams();
      params.set("select", select);
      params.set("metadata->>source", "eq.dua_v2");
      params.set("order", "sort_order.asc");
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      const rows = await request(table + "?" + params.toString());
      if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  async function loadContent() {
    if(!navigator.onLine){
      const cached=await readCachedContent();
      if(cached) return cached;
      throw new Error("Offline içerik önbelleği henüz hazırlanmadı.");
    }
    if (!auth) auth = authSession();
    if (!auth) {
      const cached=await readCachedContent();
      if(cached) return cached;
      throw new Error("Authenticated session is required.");
    }

    const [items, nodes] = await Promise.all([
      loadAllRows("library_items", "id,parent_id,kind,title,subtitle,sort_order,metadata"),
      loadAllRows("content_nodes", "id,document_id,kind,sort_order,title,text_content,secondary_text,translation,metadata")
    ]);

    const root = items.find(x => x.metadata?.entity === "root");
    if (!root) throw new Error("Content root is missing.");

    const menu = items
      .filter(x => x.parent_id === root.id && x.metadata?.menu_key)
      .sort((a,b) => Number(a.sort_order||0) - Number(b.sort_order||0))
      .map(x => ({
        key: x.metadata.menu_key,
        title: x.title,
        route: x.metadata.route,
        entity: x.metadata.entity,
        metadata: x.metadata || {}
      }));

    const menuByKey = new Map(menu.map(x => [x.key, x]));
    const nodesByDoc = new Map();
    for (const n of nodes) {
      const arr = nodesByDoc.get(n.document_id) || [];
      arr.push(n);
      nodesByDoc.set(n.document_id, arr);
    }
    for (const arr of nodesByDoc.values()) arr.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));

    const duas = items
      .filter(x => x.metadata?.entity === "document")
      .map(x => {
        const meta = x.metadata || {};
        const segments = (nodesByDoc.get(x.id) || []).map(n => ({
          dbNodeId: n.id,
          latin: n.text_content || "",
          arabic: n.secondary_text || "",
          turkish: n.translation || "",
          title: n.title || undefined,
          note: n.metadata?.note || undefined,
          target: n.metadata?.target ?? undefined,
          verseNo: n.metadata?.verse_no ?? undefined
        }));
        return {
          id: meta.legacy_id,
          dbId: x.id,
          title: x.title,
          subtitle: x.subtitle || undefined,
          category: meta.category_key,
          categoryTitle: menuByKey.get(meta.category_key)?.title || "",
          target: meta.target ?? undefined,
          invocation: meta.invocation ?? undefined,
          surahNo: meta.surah_no ?? undefined,
          extra: !!meta.extra,
          featured: !!meta.featured,
          featuredLabel: meta.featured_label || x.title,
          featuredOrder: Number(meta.featured_order ?? 999),
          sortOrder: Number(x.sort_order || 0),
          segments
        };
      });

    const surahMenu = menuByKey.get("surahs");
    const surahCatalog = duas
      .filter(d => d.category === "surahs" && !d.extra)
      .sort((a,b)=>Number(a.surahNo||999)-Number(b.surahNo||999))
      .map(d => ({surahNo:d.surahNo,name:d.title}));

    const ilmihalSections = items
      .filter(x => x.metadata?.entity === "ilmihal_section")
      .sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0))
      .map(sec => {
        const topics = items
          .filter(x => x.parent_id === sec.id && x.metadata?.entity === "ilmihal_topic")
          .sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0))
          .map(topic => {
            const body=[], list=[], steps=[];
            for (const n of nodesByDoc.get(topic.id) || []) {
              const kind = n.metadata?.entity;
              if (kind === "ilmihal_list_item") list.push(n.text_content || "");
              else if (kind === "ilmihal_step") steps.push(n.text_content || "");
              else body.push(n.text_content || "");
            }
            return {
              title: topic.title,
              body,
              ...(list.length ? {list} : {}),
              ...(steps.length ? {steps} : {})
            };
          });
        return {title:sec.title,topics};
      });

    const ilmihalMenu = menuByKey.get("ilmihal");
    const ilmihalTopicItem = items.find(x=>x.metadata?.entity==="ilmihal_topic");
    const ilmihalData = {
      title: ilmihalMenu?.title || "",
      source: ilmihalTopicItem?.metadata?.ilmihal_source || "",
      sections: ilmihalSections
    };

    const result = {
      data: {
        rootTitle: root.title,
        menu,
        duas,
        surahCatalog,
        quranSource: surahMenu?.metadata?.content_source || null,
        surahExtraTitle: surahMenu?.metadata?.extra_section_title || "",
        sourceLabel: surahMenu?.metadata?.source_label || ""
      },
      ilmihalData
    };
    await cacheContent(result);
    return result;
  }


  function parseJson(value, fallback = {}) {
    try { return JSON.parse(value || "") || fallback; } catch { return fallback; }
  }

  function dayCount(startDate, endDate) {
    if (!startDate || !endDate) return 10;
    const a = new Date(startDate + "T00:00:00");
    const b = new Date(endDate + "T00:00:00");
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  }

  async function loadMainTodos(contentData) {
    if(!navigator.onLine){
      try{return JSON.parse(localStorage.getItem("duaTodoState") || "[]")}catch{return []}
    }
    if (!auth) auth = authSession();
    if (!auth) {
      try{return JSON.parse(localStorage.getItem("duaTodoState") || "[]")}catch{return []}
    }

    const rows = await request("todos?select=id,title,notes,related_library_item_id,related_content_node_id&order=created_at.asc");
    const docsByDb = new Map((contentData?.duas || []).map(d => [d.dbId, d]));
    const result = [];

    for (const row of rows || []) {
      const dua = docsByDb.get(row.related_library_item_id);
      if (!dua) continue;

      const notes = parseJson(row.notes, {});
      const schedule = notes.schedule || {};
      let segmentIndex = null;
      if (row.related_content_node_id) {
        const idx = (dua.segments || []).findIndex(s => s.dbNodeId === row.related_content_node_id);
        if (idx >= 0) segmentIndex = idx;
      }

      result.push({
        id: notes.legacyV2Id || ("db-" + row.id),
        remoteId: row.id,
        sourceType: "dua",
        duaId: dua.id,
        segmentIndex,
        title: row.title || (segmentIndex == null ? dua.title : dua.title + " — Bölüm " + (segmentIndex + 1)),
        scopeLabel: segmentIndex == null ? (dua.categoryTitle || "") : "Bölüm " + (segmentIndex + 1),
        description: notes.description || "",
        target: Math.max(1, Number(schedule.target || 1)),
        schedule: {
          mode: schedule.mode || "days",
          startDate: schedule.startDate || new Date().toLocaleDateString("en-CA"),
          endDate: schedule.endDate || null
        },
        history: schedule.history || {},
        createdAt: notes.createdAt || null
      });
    }
    return result;
  }

  async function syncMainTodos(todoList, contentData) {
    if(!navigator.onLine) return;
    if (!auth) auth = authSession();
    if (!auth || !Array.isArray(todoList)) return;

    const docs = contentData?.duas || [];
    const byLegacy = new Map(docs.map(d => [d.id, d]));
    const currentRows = await request("todos?select=id,notes,related_library_item_id&order=created_at.asc");
    const existingByLegacy = new Map();
    const managedRemoteIds = new Set();

    for (const row of currentRows || []) {
      const notes = parseJson(row.notes, {});
      if (notes.legacyV2Id) existingByLegacy.set(notes.legacyV2Id, row);
      if (docs.some(d => d.dbId === row.related_library_item_id)) managedRemoteIds.add(row.id);
    }

    const keptRemoteIds = new Set();
    for (const todo of todoList) {
      if (todo.sourceType === "listening") continue;
      const dua = byLegacy.get(todo.duaId);
      if (!dua?.dbId) continue;
      const segIndex = Number.isInteger(todo.segmentIndex) ? todo.segmentIndex : null;
      const seg = segIndex == null ? null : dua.segments?.[segIndex];
      const startDate = todo.schedule?.startDate || new Date().toLocaleDateString("en-CA");
      const endDate = todo.schedule?.endDate || null;
      const notes = {
        description: todo.description || "",
        schedule: {
          mode: todo.schedule?.mode || "days",
          startDate,
          endDate,
          durationDays: todo.schedule?.mode === "days" ? dayCount(startDate, endDate) : null,
          target: Math.max(1, Number(todo.target || 1)),
          history: todo.history || {}
        },
        source: seg ? "segment" : "document",
        legacyV2Id: todo.id,
        createdAt: todo.createdAt || null
      };
      const payload = {
        title: todo.title || (seg ? dua.title + " — Bölüm " + (segIndex + 1) : dua.title),
        notes: JSON.stringify(notes),
        due_at: startDate + "T00:00:00",
        related_library_item_id: dua.dbId,
        related_content_node_id: seg?.dbNodeId || null
      };

      const existing = todo.remoteId
        ? { id: todo.remoteId }
        : existingByLegacy.get(todo.id);

      if (existing?.id) {
        keptRemoteIds.add(existing.id);
        todo.remoteId = existing.id;
        await request("todos?id=eq." + encodeURIComponent(existing.id), {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(payload)
        });
      } else {
        const created = await request("todos", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(payload)
        });
        const row = Array.isArray(created) ? created[0] : null;
        if (row?.id) {
          keptRemoteIds.add(row.id);
          todo.remoteId = row.id;
        }
      }
    }

    for (const remoteId of managedRemoteIds) {
      if (keptRemoteIds.has(remoteId)) continue;
      const stillPresent = todoList.some(t => t.remoteId === remoteId);
      if (stillPresent) continue;
      await request("todos?id=eq." + encodeURIComponent(remoteId), {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
    }
  }

  window.duaV2Db = { loadContent, loadMainTodos, syncMainTodos };


  window.duaV2CloudReady = (async () => {
    try {
      await loadRemote();
    } catch (error) {
      console.warn("Dua V2 cloud load:", error);
    }

    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);

    localStorage.setItem = function(key, value) {
      originalSetItem(key, value);
      if (SYNC_KEYS.includes(String(key))) scheduleSave();
    };

    localStorage.removeItem = function(key) {
      originalRemoveItem(key);
      if (SYNC_KEYS.includes(String(key))) scheduleSave();
    };

    remoteReady = true;
  })();
})();