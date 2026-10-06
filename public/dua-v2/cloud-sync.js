(() => {
  const SUPABASE_URL = "https://nndammodckedypoqrpqa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_QpbA0zWp69BAcgZmYTIyIQ_n1q3KkP6";
  const TABLE = "dua_v2_state";
  const SYNC_KEYS = [
    "duaEzberState",
    "duaTodoState",
    "duaCounterAudit",
    "readHeaderCollapsed",
    "duaCompactPlayerPos",
    "duaPlayerCollapsed",
    "duaCounterPos",
    "duaListeningLinks",
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
      console.warn("Dua V2 cloud snapshot:", error);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveRemote, 350);
  }

  async function syncTodos(items) {
    if (!auth || !Array.isArray(items) || !items.length) return;
    const rows = items.map(t => ({
      owner_id: auth.user.id,
      id: String(t.id),
      source_type: t.sourceType || "dua",
      listening_type: t.listeningType || null,
      video_id: t.videoId || null,
      preset_id: t.presetId || null,
      dua_id: t.duaId || null,
      segment_index: Number.isInteger(t.segmentIndex) ? t.segmentIndex : null,
      title: t.title || "",
      scope_label: t.scopeLabel || null,
      description: t.description || null,
      target: Number(t.target || 1),
      schedule: t.schedule || {},
      history: t.history || {},
      archived_at: t.archivedAt || null,
      created_at: t.createdAt || new Date().toISOString(),
      updated_at: t.updatedAt || new Date().toISOString(),
      payload: t
    }));
    try {
      await request("dua_v2_todos?on_conflict=owner_id%2Cid", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows)
      });
    } catch (error) { console.warn("Dua V2 todo sync:", error); }
  }

  async function syncListeningVideos(items) {
    if (!auth || !Array.isArray(items) || !items.length) return;
    const rows = items.map(v => ({
      owner_id: auth.user.id,
      video_id: String(v.videoId),
      title: v.title || null,
      url: v.url || null,
      created_at: v.createdAt ? new Date(v.createdAt).toISOString() : new Date().toISOString(),
      updated_at: v.updatedAt ? new Date(v.updatedAt).toISOString() : new Date().toISOString(),
      payload: v
    }));
    try {
      await request("dua_v2_listening_videos?on_conflict=owner_id%2Cvideo_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows)
      });
    } catch (error) { console.warn("Dua V2 video sync:", error); }
  }

  async function syncListeningSections(items) {
    if (!auth || !Array.isArray(items) || !items.length) return;
    const rows = items.map(p => ({
      owner_id: auth.user.id,
      id: String(p.id),
      video_id: String(p.sourceId || p.videoId || ""),
      section_number: Number(String(p.title || "").trim()) || null,
      start_seconds: Number(p.a || 0),
      end_seconds: Number(p.b || 0),
      repeats: Math.max(1, Number(p.repeats || 1)),
      playback_rate: Number(p.rate || 1),
      pause_seconds: Number(p.pause || 0),
      created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
      updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString(),
      payload: p
    }));
    try {
      await request("dua_v2_listening_sections?on_conflict=owner_id%2Cid", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows)
      });
    } catch (error) { console.warn("Dua V2 section sync:", error); }
  }

  async function syncListeningLinks(links) {
    if (!auth || !links || typeof links !== "object") return;
    const rows = Object.entries(links).map(([videoId,link]) => ({
      owner_id: auth.user.id,
      video_id: videoId,
      dua_id: link?.duaId || null,
      linked_at: link?.linkedAt || new Date().toISOString(),
      payload: link || {}
    }));
    if (!rows.length) return;
    try {
      await request("dua_v2_listening_links?on_conflict=owner_id%2Cvideo_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows)
      });
    } catch (error) { console.warn("Dua V2 link sync:", error); }
  }

  async function syncListeningHistory(items) {
    if (!auth || !Array.isArray(items) || !items.length) return;
    const rows = items.map(h => ({
      owner_id: auth.user.id,
      video_id: String(h.videoId || ""),
      title: h.title || null,
      last_played_at: h.playedAt ? new Date(h.playedAt).toISOString() : new Date().toISOString(),
      payload: h
    })).filter(x => x.video_id);
    if (!rows.length) return;
    try {
      await request("dua_v2_listening_history?on_conflict=owner_id%2Cvideo_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows)
      });
    } catch (error) { console.warn("Dua V2 listening history sync:", error); }
  }

  async function logCounterEvent(event) {
    if (!auth || !event) return;
    try {
      await request("dua_v2_counter_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          owner_id: auth.user.id,
          event_id: event.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
          event_at: event.at || new Date().toISOString(),
          action: event.action || "unknown",
          counter_type: event.counterType || "unknown",
          dua_id: event.duaId || null,
          segment_index: Number.isInteger(event.segmentIndex) ? event.segmentIndex : null,
          todo_id: event.todoId || null,
          delta: Number(event.delta || 0),
          value: Number(event.value || 0),
          target: Number(event.target || 0),
          metadata: event
        })
      });
    } catch (error) { console.warn("Dua V2 counter event:", error); }
  }

  function parse(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function syncStructuredKey(key, value) {
    if (!remoteReady || !auth) return;
    if (key === "duaTodoState") syncTodos(parse(value, []));
    else if (key === "ylp_saved_videos") syncListeningVideos(parse(value, []));
    else if (key === "ylp_presets") syncListeningSections(parse(value, []));
    else if (key === "duaListeningLinks" || key === "ylp_video_links") syncListeningLinks(parse(value, {}));
    else if (key === "ylp_history") syncListeningHistory(parse(value, []));
  }

  window.duaV2Cloud = {
    logCounterEvent,
    syncTodos,
    syncListeningVideos,
    syncListeningSections,
    syncListeningLinks,
    syncListeningHistory,
    saveSnapshot: saveRemote
  };

  window.duaV2CloudReady = (async () => {
    try { await loadRemote(); }
    catch (error) { console.warn("Dua V2 cloud load:", error); }

    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);

    localStorage.setItem = function(key, value) {
      originalSetItem(key, value);
      if (SYNC_KEYS.includes(String(key))) {
        scheduleSave();
        syncStructuredKey(String(key), String(value));
      }
    };

    localStorage.removeItem = function(key) {
      originalRemoveItem(key);
      if (SYNC_KEYS.includes(String(key))) scheduleSave();
    };

    remoteReady = true;

    // İlk açılışta mevcut cihaz verisini normalize tablolara da gönder.
    syncTodos(parse(localStorage.getItem("duaTodoState"), []));
    syncListeningVideos(parse(localStorage.getItem("ylp_saved_videos"), []));
    syncListeningSections(parse(localStorage.getItem("ylp_presets"), []));
    syncListeningLinks(parse(localStorage.getItem("duaListeningLinks"), {}));
    syncListeningHistory(parse(localStorage.getItem("ylp_history"), []));
  })();
})();