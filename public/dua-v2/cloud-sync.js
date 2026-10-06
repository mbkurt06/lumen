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