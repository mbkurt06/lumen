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

  function authSession() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (value?.access_token && value?.user?.id) return value;
      } catch {}
    }
    return null;
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

  async function request(path, options = {}) {
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
    if (!response.ok) throw new Error(await response.text());
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function loadRemote() {
    auth = authSession();
    if (!auth) return;
    const rows = await request(
      TABLE + "?owner_id=eq." + encodeURIComponent(auth.user.id) + "&select=payload&limit=1"
    );
    if (Array.isArray(rows) && rows[0]?.payload) hydrate(rows[0].payload);
  }

  async function saveRemote() {
    if (!remoteReady || !auth) return;
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
    if (!auth) auth = authSession();
    if (!auth) throw new Error("Authenticated session is required.");

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

    return {
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
  }

  window.duaV2Db = { loadContent };

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