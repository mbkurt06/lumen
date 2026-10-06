(() => {
  "use strict";

  const SESSION_MS = 30 * 60 * 1000;
  state.counterSessions = state.counterSessions || {};
  state.lastReader = state.lastReader || null;

  let activeTodoId = state.activeTodoId || null;
  let completedVisibleTodoId = null;
  let counterArmed = true;
  let pendingEditTodoId = null;
  let menuSegmentIndex = null;
  let holdTimer = null;
  let holdFired = false;
  let readScrollTimer = null;

  const originalTodoOccursOn = todoOccursOn;
  const originalOpenTodo = openTodo;
  const originalOpenHome = openHome;
  const originalOpenListening = openListening;
  const originalOpenCategory = openCategory;
  const originalOpenDua = openDua;
  const originalSyncDuaCompactSettings = syncDuaCompactSettings;
  const originalCommitDuaCompactRepeat = commitDuaCompactRepeat;

  function cloudEvent(event) {
    try { window.duaV2Cloud?.logCounterEvent?.(event); } catch {}
  }

  function audit(action, ctx, extra = {}) {
    const event = {
      id: (crypto.randomUUID ? crypto.randomUUID() : "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
      at: new Date().toISOString(),
      action,
      counterType: ctx?.type || "unknown",
      duaId: dua?.id || null,
      segmentIndex: Number.isInteger(ctx?.segmentIndex) ? ctx.segmentIndex : null,
      todoId: ctx?.todo?.id || ctx?.todoId || null,
      value: Number(ctx?.progress ?? 0),
      target: Number(ctx?.target ?? 0),
      ...extra
    };
    try {
      const history = JSON.parse(localStorage.getItem("duaCounterAudit") || "[]");
      history.push(event);
      localStorage.setItem("duaCounterAudit", JSON.stringify(history.slice(-5000)));
    } catch {}
    cloudEvent(event);
  }

  function sessionId(scope, segIndex = index, d = dua) {
    return scope === "dua" ? "dua:" + d.id : "seg:" + d.id + ":" + segIndex;
  }

  function readNormalCount(d = dua) {
    const sid = sessionId("dua", 0, d);
    const raw = Number(state.readCounts[d.id] || 0);
    const meta = state.counterSessions[sid];
    if (!raw) return 0;
    if (!meta) {
      state.counterSessions[sid] = { lastAt: Date.now() };
      save();
      return raw;
    }
    if (Date.now() - Number(meta.lastAt || 0) > SESSION_MS) {
      state.readCounts[d.id] = 0;
      delete state.counterSessions[sid];
      save();
      audit("expire",{type:"normal",segmentIndex:null,progress:0,target:Number(d.target||0)},{previousValue:raw,timeoutMinutes:30});
      return 0;
    }
    return raw;
  }

  function segmentNormalCount(segIndex = index, d = dua) {
    const sid = sessionId("segment", segIndex, d);
    const storageKey = d.id + ":" + segIndex;
    const raw = Number(counts[storageKey] || 0);
    const meta = state.counterSessions[sid];
    if (!raw) return 0;
    if (!meta) {
      state.counterSessions[sid] = { lastAt: Date.now() };
      save();
      return raw;
    }
    if (Date.now() - Number(meta.lastAt || 0) > SESSION_MS) {
      counts[storageKey] = 0;
      delete state.counterSessions[sid];
      save();
      const rawSeg=d.segments[segIndex],seg=typeof rawSeg==="string"?{latin:rawSeg}:rawSeg;
      audit("expire",{type:"normal",segmentIndex:segIndex,progress:0,target:Number(seg?.target||0)},{previousValue:raw,timeoutMinutes:30});
      return 0;
    }
    return raw;
  }

  function setNormalCount(scope, value, segIndex = index, action = "set") {
    const d = dua;
    const sid = sessionId(scope, segIndex, d);
    const now = Date.now();
    let target = 0;
    let finalValue = Math.max(0, Number(value || 0));
    if (scope === "dua") {
      target = Number(d.target || 0);
      if (target) finalValue = Math.min(finalValue, target);
      state.readCounts[d.id] = finalValue;
    } else {
      const raw = d.segments[segIndex];
      const s = typeof raw === "string" ? { latin: raw } : raw;
      target = Number(s?.target || d.target || 0);
      if (target) finalValue = Math.min(finalValue, target);
      counts[d.id + ":" + segIndex] = finalValue;
    }
    state.counterSessions[sid] = { lastAt: now };
    save();
    audit(action, { type: "normal", segmentIndex: scope === "segment" ? segIndex : null, progress: finalValue, target });
    return finalValue;
  }

  function activeNonArchivedTodos(scope, segIndex = index, k = todayKey()) {
    return todos.filter(t => {
      if (t.archivedAt) return false;
      if (t.duaId !== dua?.id) return false;
      if (!originalTodoOccursOn(t, k)) return false;
      return scope === "dua" ? t.segmentIndex == null : t.segmentIndex === segIndex;
    });
  }

  function visibleTodoCandidates(scope, segIndex = index, k = todayKey()) {
    const all = activeNonArchivedTodos(scope, segIndex, k);
    const pending = all.filter(t => !taskDone(t, k));
    if (completedVisibleTodoId) {
      const sticky = all.find(t => t.id === completedVisibleTodoId);
      if (sticky && !pending.some(t => t.id === sticky.id)) pending.unshift(sticky);
    }
    return pending;
  }

  function selectedTodoFor(scope, segIndex = index, k = todayKey()) {
    const list = visibleTodoCandidates(scope, segIndex, k);
    const exact = activeTodoId && list.find(t => t.id === activeTodoId);
    return exact || list.find(t => !taskDone(t, k)) || list[0] || null;
  }

  todoOccursOn = function(t, k) {
    if (t.archivedAt) {
      const archivedDay = dateKey(new Date(t.archivedAt));
      if (k >= archivedDay) return false;
    }
    return originalTodoOccursOn(t, k);
  };

  currentTodoTask = function(scope, segIndex = index, k = todayKey()) {
    const list = activeNonArchivedTodos(scope, segIndex, k);
    const exact = activeTodoId && list.find(t => t.id === activeTodoId);
    return exact || list.find(t => !taskDone(t, k)) || list[0] || null;
  };

  function chooseTodo(todoId, segIndex = index, fromRead = state.settings.mode === "read") {
    if (completedVisibleTodoId && completedVisibleTodoId !== todoId) completedVisibleTodoId = null;
    activeTodoId = todoId;
    state.activeTodoId = todoId;
    counterArmed = true;
    if (fromRead) activeQuickCount = { type: "todoSegment", segmentIndex: segIndex, todoId };
    save();
    renderRead();
    updateCounterDisplay();
    updateTodoProgressDisplay();
  }

  function chooseNormal(segIndex = index, fromRead = state.settings.mode === "read") {
    completedVisibleTodoId = null;
    activeTodoId = null;
    state.activeTodoId = null;
    counterArmed = true;
    if (fromRead) activeQuickCount = { type: "segmentRepeat", segmentIndex: segIndex };
    save();
    renderRead();
    updateCounterDisplay();
    updateTodoProgressDisplay();
  }

  function disarmCounter() {
    counterArmed = false;
    activeQuickCount = null;
    updateCounterDisplay();
    document.querySelectorAll(".segment-repeat-badge.active,.segment-todo-badge.active,.memorize-counter-badge.active").forEach(x => x.classList.remove("active"));
  }

  function normalTargetForSegment(segIndex = index) {
    const raw = dua?.segments?.[segIndex];
    const s = typeof raw === "string" ? { latin: raw } : raw;
    const t = Number(s?.target || 0);
    return t > 1 ? t : 0;
  }

  quickCountInfo = function() {
    if (!activeQuickCount || state.settings.mode !== "read") return null;
    const i = activeQuickCount.segmentIndex;
    if (activeQuickCount.type === "segmentRepeat") {
      const target = normalTargetForSegment(i);
      if (!target) return null;
      const progress = Math.min(segmentNormalCount(i), target);
      return { type: "segmentRepeat", segmentIndex: i, target, progress, done: progress >= target };
    }
    if (activeQuickCount.type === "todoSegment") {
      const list = activeNonArchivedTodos("segment", i);
      const t = list.find(x => x.id === activeQuickCount.todoId) || selectedTodoFor("segment", i);
      if (!t) return null;
      const target = Number(t.target || 0);
      const progress = Math.min(taskProgress(t, todayKey()), target);
      return { type: "todoSegment", segmentIndex: i, target, progress, done: taskDone(t, todayKey()), task: t };
    }
    return null;
  };

  function activeCounterContext() {
    const k = todayKey();
    if (!dua) return { type: "none", target: 0, progress: 0, done: false };
    if (state.settings.mode === "read") {
      const quick = quickCountInfo();
      if (quick) {
        if (quick.type === "todoSegment") return { type: "todo", todo: quick.task, todoId: quick.task.id, segmentIndex: quick.segmentIndex, target: quick.target, progress: quick.progress, done: quick.done };
        return { type: "normal", segmentIndex: quick.segmentIndex, target: quick.target, progress: quick.progress, done: quick.done };
      }
      const docTodo = selectedTodoFor("dua", null, k);
      if (docTodo) return { type: "todo", todo: docTodo, todoId: docTodo.id, segmentIndex: null, target: Number(docTodo.target), progress: Math.min(taskProgress(docTodo,k), Number(docTodo.target)), done: taskDone(docTodo,k) };
      const target = Number(dua.target || 0);
      const progress = readNormalCount();
      return { type: target > 1 ? "normal" : "none", segmentIndex: null, target: target > 1 ? target : 0, progress, done: target > 1 && progress >= target };
    }
    if (activeCounterKind !== "normal") {
      const t = selectedTodoFor("segment", index, k);
      if (t) return { type: "todo", todo: t, todoId: t.id, segmentIndex: index, target: Number(t.target), progress: Math.min(taskProgress(t,k), Number(t.target)), done: taskDone(t,k) };
    }
    const target = normalTargetForSegment(index);
    const progress = segmentNormalCount(index);
    return { type: target ? "normal" : "none", segmentIndex: index, target, progress, done: !!target && progress >= target };
  }

  counterContextInfo = function() {
    const ctx = activeCounterContext();
    const raw = Number.isInteger(ctx.segmentIndex) ? dua?.segments?.[ctx.segmentIndex] : null;
    const seg = typeof raw === "string" ? { latin: raw } : raw;
    return {
      ...ctx,
      title: (seg?.latin || dua?.title || "Tesbih").slice(0,100)
    };
  };

  function incrementTodoExact(t) {
    const k = todayKey();
    t.history = t.history || {};
    const h = t.history[k] || (t.history[k] = { count: 0, completedAt: null });
    if (h.completedAt) return h.count;
    h.count = Math.min(Number(t.target || 1), Number(h.count || 0) + 1);
    if (h.count >= Number(t.target || 1)) {
      h.completedAt = new Date().toISOString();
      completedVisibleTodoId = t.id;
    }
    saveTodos();
    audit("increment", { type: "todo", todo: t, segmentIndex: t.segmentIndex, progress: h.count, target: t.target }, { delta: 1, completedAt: h.completedAt });
    return h.count;
  }

  function decrementTodoExact(t) {
    const k = todayKey();
    t.history = t.history || {};
    const h = t.history[k] || (t.history[k] = { count: 0, completedAt: null });
    h.count = Math.max(0, Number(h.count || 0) - 1);
    if (h.count < Number(t.target || 1)) h.completedAt = null;
    if (completedVisibleTodoId === t.id && !h.completedAt) completedVisibleTodoId = null;
    saveTodos();
    audit("decrement", { type: "todo", todo: t, segmentIndex: t.segmentIndex, progress: h.count, target: t.target }, { delta: -1 });
    return h.count;
  }

  function resetTodoExact(t) {
    const k = todayKey();
    t.history = t.history || {};
    t.history[k] = { count: 0, completedAt: null, resetAt: new Date().toISOString() };
    if (completedVisibleTodoId === t.id) completedVisibleTodoId = null;
    saveTodos();
    audit("reset", { type: "todo", todo: t, segmentIndex: t.segmentIndex, progress: 0, target: t.target });
  }

  incrementActiveCounter = function() {
    if (!counterArmed) return;
    const before = activeCounterContext();
    if (before.type === "none") return;
    if (before.type === "todo" && before.todo) {
      incrementTodoExact(before.todo);
    } else if (before.type === "normal") {
      const next = Number(before.progress || 0) + 1;
      setNormalCount(before.segmentIndex == null ? "dua" : "segment", next, before.segmentIndex ?? index, "increment");
    }
    const after = activeCounterContext();
    if (!before.done && after.done) completionFeedback();
    updateHomeTodoCount();
    if (state.settings.mode === "read") renderRead(); else render();
    updateCounterDisplay();
    updateTodoProgressDisplay();
    renderFullscreenTasbih();
  };

  decrementActiveCounter = function() {
    if (!counterArmed) return;
    const ctx = activeCounterContext();
    if (ctx.type === "todo" && ctx.todo) decrementTodoExact(ctx.todo);
    else if (ctx.type === "normal") setNormalCount(ctx.segmentIndex == null ? "dua" : "segment", Math.max(0, ctx.progress - 1), ctx.segmentIndex ?? index, "decrement");
    updateHomeTodoCount();
    if (state.settings.mode === "read") renderRead(); else render();
    updateCounterDisplay();
    updateTodoProgressDisplay();
    renderFullscreenTasbih();
  };

  resetActiveCounter = function() {
    const ctx = activeCounterContext();
    if (ctx.type === "todo" && ctx.todo) resetTodoExact(ctx.todo);
    else if (ctx.type === "normal") setNormalCount(ctx.segmentIndex == null ? "dua" : "segment", 0, ctx.segmentIndex ?? index, "reset");
    if (state.settings.mode === "read") renderRead(); else render();
    updateCounterDisplay();
    updateTodoProgressDisplay();
    renderFullscreenTasbih();
    hideCounterResetPopover();
  };

  updateCounterDisplay = function() {
    if (!dua || !counter) return;
    const ctx = activeCounterContext();
    counter.classList.remove("todo-task","todo-done","quick-count","quick-done","counter-inactive");
    if (!counterArmed) counter.classList.add("counter-inactive");
    if (ctx.type === "todo") {
      counter.classList.add("todo-task");
      if (ctx.done) counter.classList.add("todo-done");
    } else if (ctx.type === "normal") {
      counter.classList.add("quick-count");
      if (ctx.done) counter.classList.add("quick-done");
    }
    $("#count").textContent = String(ctx.progress || 0);
    counter.querySelector("small").textContent = ctx.target ? "/ " + ctx.target : "";
  };

  function todoBadgeHtml(t, list, i) {
    const p = Math.min(taskProgress(t, todayKey()), Number(t.target || 0));
    const done = taskDone(t, todayKey());
    const active = counterArmed && activeTodoId === t.id && activeQuickCount?.type === "todoSegment" && activeQuickCount.segmentIndex === i;
    const multi = list.length > 1 ? '<span class="todo-multi-count">' + list.length + '</span>' : "";
    return '<button class="segment-todo-badge ' + (done ? "done " : "") + (active ? "active" : "") + '" data-todo-segment="' + i + '" data-todo-id="' + t.id + '" aria-label="Todo sayacını etkinleştir">' + escapeHtml(String(t.target)) + '/' + escapeHtml(String(p)) + multi + '</button>';
  }

  function normalBadgeHtml(s, i) {
    const target = Number(s?.target || 0);
    if (target <= 1) return "";
    const p = Math.min(segmentNormalCount(i), target);
    const done = p >= target;
    const active = counterArmed && activeQuickCount?.type === "segmentRepeat" && activeQuickCount.segmentIndex === i;
    return '<button class="segment-repeat-badge ' + (done ? "done " : "") + (active ? "active" : "") + '" data-repeat-segment="' + i + '" aria-label="Tekrar sayacını etkinleştir">' + target + '/' + p + '</button>';
  }

  function bindPress(el, tap, hold) {
    if (!el) return;
    let timer = null, fired = false, sx = 0, sy = 0;
    el.addEventListener("pointerdown", e => {
      e.stopPropagation();
      fired = false; sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => { timer = null; fired = true; hold?.(e); }, 550);
    });
    el.addEventListener("pointermove", e => {
      if (timer && Math.hypot(e.clientX-sx,e.clientY-sy) > 8) { clearTimeout(timer); timer = null; }
    });
    ["pointerup","pointercancel","pointerleave"].forEach(ev => el.addEventListener(ev, e => {
      e.stopPropagation();
      if (timer) { clearTimeout(timer); timer = null; if (ev === "pointerup") tap?.(e); }
      else if (fired) { e.preventDefault(); fired = false; }
    }));
    el.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
  }

  function ensureCounterMenu() {
    let menu = $("#v2CounterMenu");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "v2CounterMenu";
    menu.className = "v2-counter-menu hidden";
    document.body.appendChild(menu);
    document.addEventListener("pointerdown", e => {
      if (!menu.classList.contains("hidden") && !menu.contains(e.target) && !e.target.closest(".segment-todo-badge,.segment-repeat-badge,.memorize-counter-badge")) menu.classList.add("hidden");
    });
    return menu;
  }

  function placeMenu(menu, anchor) {
    menu.classList.remove("hidden");
    requestAnimationFrame(() => {
      const r = anchor.getBoundingClientRect(), mr = menu.getBoundingClientRect();
      const left = Math.max(8, Math.min(innerWidth - mr.width - 8, r.right - mr.width));
      let top = r.bottom + 8;
      if (top + mr.height > innerHeight - 8) top = Math.max(8, r.top - mr.height - 8);
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    });
  }

  function openCounterMenu(segIndex, anchor) {
    menuSegmentIndex = segIndex;
    const menu = ensureCounterMenu();
    const list = visibleTodoCandidates("segment", segIndex);
    const selected = selectedTodoFor("segment", segIndex);
    const normalTarget = normalTargetForSegment(segIndex);
    let html = '<div class="v2-counter-menu-title">Sayaç seç</div>';
    if (list.length) {
      html += list.map((t,n) => {
        const p = Math.min(taskProgress(t,todayKey()), Number(t.target));
        return '<button data-menu-todo="' + t.id + '" class="' + (selected?.id===t.id ? "selected" : "") + '">Todo ' + (n+1) + '<span>' + p + '/' + t.target + '</span></button>';
      }).join("");
    }
    if (normalTarget) html += '<button data-menu-normal="' + segIndex + '">Normal tekrar<span>' + segmentNormalCount(segIndex) + '/' + normalTarget + '</span></button>';
    html += '<div class="v2-counter-menu-actions"><button data-menu-reset="1">Sıfırla</button>' + (selected ? '<button data-menu-edit="' + selected.id + '">Düzenle</button>' : "") + '</div>';
    menu.innerHTML = html;
    menu.querySelectorAll("[data-menu-todo]").forEach(b => b.onclick = () => { chooseTodo(b.dataset.menuTodo, segIndex, state.settings.mode==="read"); menu.classList.add("hidden"); });
    menu.querySelector("[data-menu-normal]")?.addEventListener("click", () => { chooseNormal(segIndex, state.settings.mode==="read"); menu.classList.add("hidden"); });
    menu.querySelector("[data-menu-reset]")?.addEventListener("click", () => { 
      if (selected && activeTodoId === selected.id) resetTodoExact(selected);
      else setNormalCount("segment",0,segIndex,"reset");
      menu.classList.add("hidden"); if(state.settings.mode==="read")renderRead();else render(); updateCounterDisplay();updateTodoProgressDisplay();
    });
    menu.querySelector("[data-menu-edit]")?.addEventListener("click", e => { menu.classList.add("hidden"); openTodoEditDialog(e.currentTarget.dataset.menuEdit); });
    placeMenu(menu, anchor);
  }

  renderRead = function() {
    if (!dua) return;
    $("#readTitle").textContent = dua.title;
    const inv = dua.invocation || "";
    $("#readInvocation").textContent = inv;
    $("#readInvocation").classList.toggle("hidden", !inv);
    renderDuaListeningPanel();

    const k = todayKey();
    $("#readContent").innerHTML = dua.segments.map((raw,i) => {
      const s = typeof raw === "string" ? {latin:raw} : raw;
      const todoList = visibleTodoCandidates("segment", i, k);
      const normalSelectedHere = activeQuickCount?.type === "segmentRepeat" && activeQuickCount.segmentIndex === i;
      const selected = normalSelectedHere ? null : ((activeTodoId && todoList.find(t=>t.id===activeTodoId)) || todoList[0] || null);
      const todoBadge = selected ? todoBadgeHtml(selected, todoList, i) : "";
      const repeatBadge = selected ? "" : normalBadgeHtml(s,i);
      const addTodo = '<button class="segment-add-todo" data-add-todo-segment="'+i+'" aria-label="Bu bölümü Todo\'ya ekle">+ Todo</button>';
      const linkedPreset = linkedPresetForDuaSegment(dua.id,i+1);
      const listenPlay = linkedPreset ? '<button class="segment-listen-play" data-listen-dua-segment="'+i+'" aria-label="Bu bölümün eşleşen videosunu oynat">▶</button>' : "";
      const badges = (listenPlay||todoBadge||repeatBadge) ? '<div class="segment-badges">'+listenPlay+todoBadge+repeatBadge+'</div>' : "";
      return '<article class="read-item read-item-clickable'+(selected?' read-item-todo':'')+'" data-open-segment="'+i+'"><div class="read-item-number">'+(i+1)+'</div>'+addTodo+badges+(s.note?'<div class="gesture-note '+(state.settings.showNotes?'':'hidden')+'">'+escapeHtml(s.note)+'</div>':'')+'<div class="arabic '+(state.settings.showArabic&&s.arabic?'':'hidden')+'" dir="rtl">'+escapeHtml(s.arabic||"")+'</div><div class="segment '+(state.settings.showLatin&&s.latin?'':'hidden')+'">'+escapeHtml(s.latin||"")+'</div><div class="turkish '+(state.settings.showTurkish&&s.turkish?'':'hidden')+'">'+escapeHtml(s.turkish||"")+'</div></article>';
    }).join("");

    $("#readContent").querySelectorAll("[data-open-segment]").forEach(el => el.onclick = () => openSegmentMemorize(Number(el.dataset.openSegment)));
    $("#readContent").querySelectorAll("[data-add-todo-segment]").forEach(b => b.onclick = e => { e.stopPropagation(); openTodoDialog("segment",Number(b.dataset.addTodoSegment)); });
    $("#readContent").querySelectorAll("[data-listen-dua-segment]").forEach(b => b.onclick = e => { e.stopPropagation(); playDuaLinkedSection(Number(b.dataset.listenDuaSegment)+1); });
    $("#readContent").querySelectorAll("[data-repeat-segment]").forEach(b => bindPress(b, () => chooseNormal(Number(b.dataset.repeatSegment),true), () => openCounterMenu(Number(b.dataset.repeatSegment),b)));
    $("#readContent").querySelectorAll("[data-todo-segment]").forEach(b => bindPress(b, () => chooseTodo(b.dataset.todoId,Number(b.dataset.todoSegment),true), () => openCounterMenu(Number(b.dataset.todoSegment),b)));

    updateDuaPager(); updateCounterDisplay(); updateTodoProgressDisplay(); syncReadHeaderHeight();
    requestAnimationFrame(updateReadProgressFromScroll);
  };

  function renderMemorizeCounterBadge() {
    const host = $("#memorizeTodoProgress");
    if (!host || !dua) return;
    const list = visibleTodoCandidates("segment", index);
    let t = activeCounterKind === "normal" ? null : selectedTodoFor("segment",index);
    const normalTarget = normalTargetForSegment(index);
    if (!t && !normalTarget) { host.classList.add("hidden"); host.innerHTML=""; return; }
    let label="", done=false, multi="";
    if (t) {
      const p = Math.min(taskProgress(t,todayKey()),Number(t.target));
      label = t.target + "/" + p;
      done = taskDone(t,todayKey());
      multi = list.length>1 ? '<span class="todo-multi-count">'+list.length+'</span>' : "";
    } else {
      label = normalTarget + "/" + segmentNormalCount(index);
      done = segmentNormalCount(index) >= normalTarget;
    }
    host.className = "todo-inline-progress memorize-counter-host";
    host.innerHTML = '<button class="memorize-counter-badge '+(done?'done ':'')+(counterArmed?'active':'')+'" type="button">'+label+multi+'</button>';
    const b = host.querySelector("button");
    bindPress(b, () => {
      if (t) chooseTodo(t.id,index,false); else chooseNormal(index,false);
      counterArmed=true; updateCounterDisplay(); renderMemorizeCounterBadge();
    }, () => openCounterMenu(index,b));
  }

  function openDocumentCounterMenu(anchorEl) {
    const menu=ensureCounterMenu(), list=visibleTodoCandidates("dua",null), selected=selectedTodoFor("dua",null);
    let html='<div class="v2-counter-menu-title">Todo seç</div>';
    html+=list.map((t,n)=>'<button data-doc-todo="'+t.id+'" class="'+(selected?.id===t.id?"selected":"")+'">Todo '+(n+1)+'<span>'+Math.min(taskProgress(t,todayKey()),Number(t.target))+'/'+t.target+'</span></button>').join("");
    html+='<div class="v2-counter-menu-actions"><button data-doc-reset="1">Sıfırla</button>'+(selected?'<button data-doc-edit="'+selected.id+'">Düzenle</button>':"")+'</div>';
    menu.innerHTML=html;
    menu.querySelectorAll("[data-doc-todo]").forEach(b=>b.onclick=()=>{completedVisibleTodoId=null;activeTodoId=b.dataset.docTodo;activeCounterKind="todo";state.activeTodoId=activeTodoId;state.activeCounterKind="todo";activeQuickCount=null;counterArmed=true;save();menu.classList.add("hidden");renderRead();updateCounterDisplay();});
    menu.querySelector("[data-doc-reset]")?.addEventListener("click",()=>{if(selected)resetTodoExact(selected);menu.classList.add("hidden");renderRead();updateCounterDisplay();});
    menu.querySelector("[data-doc-edit]")?.addEventListener("click",e=>{menu.classList.add("hidden");openTodoEditDialog(e.currentTarget.dataset.docEdit)});
    placeMenu(menu,anchorEl);
  }

  updateTodoProgressDisplay = function() {
    if (!dua) return;
    if (state.settings.mode !== "read") {
      renderMemorizeCounterBadge();
      return;
    }
    const host = $("#readTodoProgress");
    const list = visibleTodoCandidates("dua",null);
    const t = selectedTodoFor("dua",null);
    if (!host || !t) { if(host){host.classList.add("hidden");host.innerHTML="";} return; }
    const p = Math.min(taskProgress(t,todayKey()),Number(t.target));
    host.className = "todo-inline-progress read-todo-progress" + (taskDone(t,todayKey()) ? " done" : "");
    host.innerHTML = '<button class="doc-todo-badge" type="button">'+t.target+'/'+p+(list.length>1?'<span class="todo-multi-count">'+list.length+'</span>':'')+'</button>';
    host.classList.remove("hidden");
    const b=host.querySelector("button");
    bindPress(b,()=>{activeTodoId=t.id;activeCounterKind="todo";state.activeTodoId=t.id;state.activeCounterKind="todo";activeQuickCount=null;counterArmed=true;save();updateCounterDisplay();},()=>openDocumentCounterMenu(b));
  };

  function rememberReader() {
    if (!dua) return;
    const readView = $("#readView");
    state.lastReader = {
      duaId: dua.id,
      index,
      mode: state.settings.mode,
      scrollTop: state.settings.mode==="read" ? Number(window.scrollY||document.documentElement.scrollTop||0) : Number(state.lastReader?.scrollTop || 0),
      visibleSegment: Number(state.lastVisibleSegment || index || 0)
    };
    save();
  }

  function resumeLastReader() {
    const last = state.lastReader;
    if (!last?.duaId) { originalOpenHome(); updateBottomNav(); return; }
    const d = data.duas.find(x=>x.id===last.duaId);
    if (!d) { originalOpenHome(); updateBottomNav(); return; }
    dua=d; state.duaId=d.id; index=Math.max(0,Math.min(Number(last.index||0),d.segments.length-1));
    state.settings.mode=last.mode==="memorize"?"memorize":"read";
    activeTodoId=null; activeCounterKind=null; completedVisibleTodoId=null; activeQuickCount=null; counterArmed=true;
    render(); applyMode();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(state.settings.mode==="read") window.scrollTo({top:Number(last.scrollTop||0),behavior:"auto"});
      updateReadProgressFromScroll();
    }));
    updateBottomNav();
  }

  function updateReadProgressFromScroll() {
    if (!dua || state.settings.mode!=="read") return;
    const view=$("#readView"), items=[...document.querySelectorAll("#readContent .read-item")];
    if(!view||!items.length)return;
    const top = (document.querySelector(".global-header")?.getBoundingClientRect().bottom||0) + ($("#readView .read-sticky-header")?.getBoundingClientRect().height||0) + 12;
    let best=items[0], bestDist=Infinity;
    for(const item of items){
      const dist=Math.abs(item.getBoundingClientRect().top-top);
      if(dist<bestDist){best=item;bestDist=dist}
    }
    const i=Number(best.dataset.openSegment||0);
    state.lastVisibleSegment=i;
    $("#progress").textContent=(i+1)+" / "+dua.segments.length;
  }

  const persistReadScroll=()=>{
    if(state.currentView!=="dua"||state.settings.mode!=="read")return;
    clearTimeout(readScrollTimer);
    readScrollTimer=setTimeout(()=>{updateReadProgressFromScroll();rememberReader()},120);
  };
  $("#readView")?.addEventListener("scroll",persistReadScroll,{passive:true});
  window.addEventListener("scroll",persistReadScroll,{passive:true});

  openSegmentMemorize = function(i) {
    rememberReader();
    index=Math.max(0,Math.min(i,dua.segments.length-1));
    state.settings.mode="memorize";
    const list=visibleTodoCandidates("segment",index);
    const keep=activeTodoId&&list.find(t=>t.id===activeTodoId);
    activeTodoId=keep?.id || list.find(t=>!taskDone(t,todayKey()))?.id || null;
    activeCounterKind=activeTodoId?"todo":(normalTargetForSegment(index)?"normal":null);
    state.activeTodoId=activeTodoId;state.activeCounterKind=activeCounterKind;
    completedVisibleTodoId=null;
    activeQuickCount=null;
    counterArmed=!!activeTodoId || !!normalTargetForSegment(index);
    render();applyMode();window.scrollTo({top:0,behavior:"auto"});updateBottomNav();
  };

  $("#memorizeBackBtn").onclick=()=>{
    const completedWas=completedVisibleTodoId;
    state.settings.mode="read";
    if(completedWas){activeTodoId=null;state.activeTodoId=null;completedVisibleTodoId=null}
    activeQuickCount=null;counterArmed=true;
    render();applyMode();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{window.scrollTo({top:Number(state.lastReader?.scrollTop||0),behavior:"auto"});updateReadProgressFromScroll()}));
    updateBottomNav();
  };

  $("#memorizeThisBtn").onclick=()=>{
    rememberReader();
    index=Math.max(0,Math.min(Number(state.lastVisibleSegment||0),dua.segments.length-1));
    state.settings.mode="memorize";
    const list=visibleTodoCandidates("segment",index);
    activeTodoId=list.find(t=>!taskDone(t,todayKey()))?.id||null;activeCounterKind=activeTodoId?"todo":(normalTargetForSegment(index)?"normal":null);state.activeTodoId=activeTodoId;state.activeCounterKind=activeCounterKind;
    counterArmed=!!activeTodoId||!!normalTargetForSegment(index);
    activeQuickCount=null;render();applyMode();window.scrollTo({top:0,behavior:"auto"});updateBottomNav();
  };

  $("#memorizeView")?.addEventListener("pointerdown",e=>{
    if(e.target===e.currentTarget){disarmCounter();renderMemorizeCounterBadge()}
  });
  $("#readContent")?.addEventListener("pointerdown",e=>{
    if(e.target===e.currentTarget)disarmCounter();
  });

  function formatCompletedAt(t,k) {
    const h=todoHistory(t,k);
    return h.completedAt ? new Intl.DateTimeFormat("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(h.completedAt)) : "";
  }

  renderTodo = function() {
    const k=state.todoDate||todayKey();
    const scheduled=todos.filter(t=>!t.archivedAt&&todoOccursOn(t,k));
    const pending=scheduled.filter(t=>!taskDone(t,k)), done=scheduled.filter(t=>taskDone(t,k));
    const archived=todos.filter(t=>!!t.archivedAt);
    $("#todoDatePicker").value=k;$("#todoDateTitle").textContent=formatTodoDate(k,true);$("#todoSummary").textContent=done.length+" / "+scheduled.length;updateHomeTodoCount();

    const card=t=>{
      const p=Math.min(taskProgress(t,k),Number(t.target)),ok=taskDone(t,k),completed=formatCompletedAt(t,k);
      return '<article class="todo-card '+(ok?'done ':'')+(t.archivedAt?'archived':'')+'" data-todo-id="'+t.id+'"><button class="todo-open" data-open-todo="'+t.id+'"><div class="todo-check">'+(ok?'✓':'')+'</div><div class="todo-main"><div class="todo-card-date">'+escapeHtml(formatTodoDate(k,false))+'</div><strong>'+escapeHtml(t.title)+'</strong>'+(t.scopeLabel?'<small>'+escapeHtml(t.scopeLabel)+'</small>':'')+(t.description?'<p>'+escapeHtml(t.description)+'</p>':'')+'<div class="todo-progress"><span role="button" tabindex="0" class="todo-count-pill" data-edit-todo="'+t.id+'">'+p+' / '+t.target+'</span><span>'+escapeHtml(scheduleLabel(t))+'</span></div>'+(completed?'<div class="todo-completed-at">✓ '+escapeHtml(completed)+'</div>':'')+'</div></button>'+(t.archivedAt?'':'<button class="todo-delete" data-archive-todo="'+t.id+'" aria-label="Todo arşivle">×</button>')+'</article>';
    };
    $("#todoList").innerHTML=pending.length?pending.map(card).join(""):'<div class="todo-empty compact">Bu tarihte bekleyen görev yok.</div>';
    $("#todoCompletedList").innerHTML=done.map(card).join("");
    $("#todoCompletedSection").classList.toggle("hidden",!done.length);
    const archiveBox=$("#todoArchivedList"),archiveSection=$("#todoArchivedSection");
    if(archiveBox&&archiveSection){archiveBox.innerHTML=archived.map(card).join("");archiveSection.classList.toggle("hidden",!archived.length)}
    document.querySelectorAll("[data-open-todo]").forEach(b=>b.onclick=e=>{if(e.target.closest(".todo-count-pill"))return;openTodoTarget(b.dataset.openTodo)});
    document.querySelectorAll("[data-archive-todo]").forEach(b=>b.onclick=e=>{e.stopPropagation();const t=todos.find(x=>x.id===b.dataset.archiveTodo);if(t){t.archivedAt=new Date().toISOString();saveTodos();window.duaV2Cloud?.syncTodos?.(todos);renderTodo()}});
    document.querySelectorAll(".todo-count-pill").forEach(b=>bindPress(b,()=>openTodoTarget(b.dataset.editTodo),()=>openTodoEditDialog(b.dataset.editTodo)));
  };

  openTodoTarget = function(id) {
    const t=todos.find(x=>x.id===id);if(!t)return;
    if(t.sourceType==="listening"){
      activeTodoId=t.id;state.activeTodoId=t.id;save();
      originalOpenListening();
      setTimeout(()=>{selectListeningVideo(t.videoId,false);if(t.listeningType==="section"&&t.presetId){$("#listeningPresetSelect").value=t.presetId;selectListeningPreset(t.presetId,false)}},120);
      updateBottomNav();return;
    }
    const d=data.duas.find(x=>x.id===t.duaId);if(!d)return;
    rememberReader();
    dua=d;state.duaId=d.id;activeTodoId=t.id;activeCounterKind="todo";state.activeTodoId=t.id;state.activeCounterKind="todo";completedVisibleTodoId=null;counterArmed=true;activeQuickCount=null;
    if(t.segmentIndex==null){index=0;state.settings.mode="read"}else{index=Math.max(0,Math.min(t.segmentIndex,d.segments.length-1));state.settings.mode="memorize"}
    render();applyMode();if(t.segmentIndex!=null)window.scrollTo({top:0,behavior:"auto"});updateBottomNav();
  };

  function openTodoEditDialog(id) {
    const t=todos.find(x=>x.id===id);if(!t)return;
    pendingEditTodoId=id;pendingTodoScope=null;pendingTodoSegmentIndex=null;pendingListeningTodo=null;
    $("#todoDialogTitle").textContent="Todo'yu düzenle";
    $("#todoDescription").value=t.description||"";
    $("#todoTarget").value=Number(t.target||1);
    const s=t.schedule||{mode:"single",startDate:todayKey(),endDate:todayKey()};
    $("#todoScheduleMode").value=s.mode||"single";$("#todoStartDate").value=s.startDate||todayKey();$("#todoEndDate").value=s.endDate||s.startDate||todayKey();
    if(s.mode==="days"&&s.startDate&&s.endDate){$("#todoDurationDays").value=Math.max(1,Math.round((dateFromKey(s.endDate)-dateFromKey(s.startDate))/86400000)+1)}else $("#todoDurationDays").value=10;
    updateTodoScheduleFields();$("#saveTodoBtn").textContent="Değişiklikleri kaydet";$("#todoDialog").showModal();
  }

  const baseOpenTodoDialog = openTodoDialog;
  openTodoDialog = function(scope,segmentIndex=null){
    pendingEditTodoId=null;$("#saveTodoBtn").textContent="Todo'ya ekle";baseOpenTodoDialog(scope,segmentIndex);
  };

  $("#saveTodoBtn").onclick=()=>{
    const target=Math.max(1,parseInt($("#todoTarget").value||"1",10));
    const mode=$("#todoScheduleMode").value,start=$("#todoStartDate").value||todayKey();
    let endDate=start;if(mode==="forever")endDate=null;else if(mode==="days"){const days=Math.max(1,parseInt($("#todoDurationDays").value||"1",10));endDate=addDaysKey(start,days-1)}else if(mode==="range"){endDate=$("#todoEndDate").value||start;if(endDate<start)endDate=start}
    if(pendingEditTodoId){
      const t=todos.find(x=>x.id===pendingEditTodoId);
      if(t){t.description=$("#todoDescription").value.trim();t.target=target;t.schedule={mode,startDate:start,endDate};t.updatedAt=new Date().toISOString()}
      pendingEditTodoId=null;
    }else if(pendingTodoScope==="listeningVideo"||pendingTodoScope==="listeningSection"){
      const v=listeningVideos.find(x=>x.videoId===pendingListeningTodo?.videoId),p=listeningPresets.find(x=>x.id===pendingListeningTodo?.presetId),isSection=pendingTodoScope==="listeningSection";
      todos.push({id:"todo-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),sourceType:"listening",listeningType:isSection?"section":"video",videoId:v?.videoId||pendingListeningTodo?.videoId||"",presetId:isSection?(p?.id||pendingListeningTodo?.presetId||""):"",duaId:null,segmentIndex:null,title:isSection?(v?.title||"Dinleme")+" — Bölüm "+(p?.title||""):(v?.title||"Dinleme videosu"),scopeLabel:isSection?(formatListenTime(p?.a||0)+" – "+formatListenTime(p?.b||0)):"Dinleme · Video",description:$("#todoDescription").value.trim(),target,schedule:{mode,startDate:start,endDate},history:{},createdAt:new Date().toISOString()});
    }else{
      const seg=pendingTodoScope==="segment"?pendingTodoSegmentIndex:null,raw=seg==null?null:dua.segments[seg],s=typeof raw==="string"?{latin:raw}:raw;
      todos.push({id:"todo-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),duaId:dua.id,segmentIndex:seg,title:seg==null?dua.title:dua.title+" — Bölüm "+(seg+1),scopeLabel:seg==null?dua.category:(s?.latin||s?.turkish||"").slice(0,90),description:$("#todoDescription").value.trim(),target,schedule:{mode,startDate:start,endDate},history:{},createdAt:new Date().toISOString()});
    }
    saveTodos();window.duaV2Cloud?.syncTodos?.(todos);$("#todoDialog").close();$("#saveTodoBtn").textContent="Todo'ya ekle";pendingTodoSegmentIndex=null;pendingListeningTodo=null;pendingTodoScope=null;updateHomeTodoCount();
    if(state.currentView==="todo")renderTodo();else if(state.currentView==="dua"&&state.settings.mode==="read")renderRead();else if(state.currentView==="dua")render();else if(state.currentView==="listening")renderListeningAll();
  };

  function expireCurrentNormalCounters() {
    if(!dua)return false;
    let changed=false;
    const now=Date.now();
    const docSid="dua:"+dua.id;
    if(state.counterSessions?.[docSid] && now-Number(state.counterSessions[docSid].lastAt||0)>SESSION_MS){
      if(Number(state.readCounts[dua.id]||0)!==0){const prev=Number(state.readCounts[dua.id]||0);state.readCounts[dua.id]=0;changed=true;audit("expire",{type:"normal",segmentIndex:null,progress:0,target:Number(dua.target||0)},{previousValue:prev,timeoutMinutes:30})}
      delete state.counterSessions[docSid];
    }
    for(let i=0;i<dua.segments.length;i++){
      const sid="seg:"+dua.id+":"+i;
      const meta=state.counterSessions?.[sid];
      if(meta && now-Number(meta.lastAt||0)>SESSION_MS){
        const storageKey=dua.id+":"+i;
        if(Number(counts[storageKey]||0)!==0){const prev=Number(counts[storageKey]||0);counts[storageKey]=0;changed=true;const raw=dua.segments[i],s=typeof raw==="string"?{latin:raw}:raw;audit("expire",{type:"normal",segmentIndex:i,progress:0,target:Number(s?.target||0)},{previousValue:prev,timeoutMinutes:30})}
        delete state.counterSessions[sid];
      }
    }
    if(changed){save();if(state.currentView==="dua"){if(state.settings.mode==="read")renderRead();else render();updateCounterDisplay();updateTodoProgressDisplay()}}
    return changed;
  }

  function leaveCounterScreen() {
    if(completedVisibleTodoId){
      const t=todos.find(x=>x.id===completedVisibleTodoId);
      if(t&&taskDone(t,todayKey())){activeTodoId=null;state.activeTodoId=null;activeCounterKind=null;state.activeCounterKind=null}
    }
    completedVisibleTodoId=null;
    activeQuickCount=null;
    counterArmed=true;
    save();
  }

  function resetCurrentDuaSession() {
    if(!dua)return;
    const prefix="seg:"+dua.id+":";
    for(const key of Object.keys(state.counterSessions||{})){
      if(key===("dua:"+dua.id)||key.startsWith(prefix)) delete state.counterSessions[key];
    }
    state.readCounts[dua.id]=0;
    for(let i=0;i<dua.segments.length;i++){
      const storageKey=dua.id+":"+i;
      if(Number(counts[storageKey]||0)!==0){
        counts[storageKey]=0;
        const raw=dua.segments[i],s=typeof raw==="string"?{latin:raw}:raw;
        audit("reset",{type:"normal",segmentIndex:i,progress:0,target:Number(s?.target||0)},{scope:"dua-session"});
      }
    }
    save();
    if(state.settings.mode==="read")renderRead();else render();
    updateCounterDisplay();updateTodoProgressDisplay();renderFullscreenTasbih();
  }

  function ensureBottomNav() {
    if ($("#v2BottomNav")) return;
    const nav=document.createElement("nav");nav.id="v2BottomNav";nav.className="v2-bottom-nav";
    nav.innerHTML='<button id="v2BottomTodo">TODO</button><button id="v2BottomLibrary">Kütüphane</button><button id="v2BottomSettings">Ayarlar</button>';
    document.body.appendChild(nav);
    $("#v2BottomTodo").onclick=()=>{rememberReader();leaveCounterScreen();originalOpenTodo();updateBottomNav()};
    $("#v2BottomLibrary").onclick=()=>{
      if(state.currentView==="dua"){rememberReader();leaveCounterScreen();originalOpenCategory(dua.category)}
      else if(state.lastReader?.duaId)resumeLastReader();
      else originalOpenHome();
      updateBottomNav();
    };
    $("#v2BottomSettings").onclick=()=>$("#settingsDialog").showModal();
  }

  function updateBottomNav(){
    ensureBottomNav();
    $("#v2BottomTodo")?.classList.toggle("active",state.currentView==="todo");
    $("#v2BottomLibrary")?.classList.toggle("active",state.currentView==="dua"||state.currentView==="library");
    $("#sessionResetBtn")?.classList.toggle("hidden",state.currentView!=="dua");
  }

  openTodo = function(){rememberReader();leaveCounterScreen();originalOpenTodo();updateBottomNav()};
  openHome = function(){rememberReader();leaveCounterScreen();originalOpenHome();updateBottomNav()};
  openListening = function(){rememberReader();leaveCounterScreen();originalOpenListening();updateBottomNav()};
  openCategory = function(cat){rememberReader();leaveCounterScreen();originalOpenCategory(cat);updateBottomNav()};
  openDua = function(d){rememberReader();originalOpenDua(d);counterArmed=true;activeTodoId=null;activeCounterKind=null;state.activeTodoId=null;state.activeCounterKind=null;completedVisibleTodoId=null;updateBottomNav()};

  $("#homeTodoBtn").onclick=openTodo;
  $("#todoMenuBtn").onclick=openHome;
  $("#homeListeningBtn").onclick=openListening;
  $("#listeningMenuBtn").onclick=openHome;
  $("#backContentBtn").onclick=openHome;
  $("#readMenuBtn").onclick=openHome;
  $("#backLibraryBtn").onclick=()=>{rememberReader();leaveCounterScreen();originalOpenCategory(dua.category);updateBottomNav()};

  syncDuaCompactSettings = function(){
    originalSyncDuaCompactSettings();
    const badge=$("#duaPlayRepeatBadge"),n=Math.max(1,Number($("#duaSectionRepeatCount")?.value)||1);
    if(badge)badge.classList.toggle("hidden",n===1);
  };
  commitDuaCompactRepeat = function(){
    originalCommitDuaCompactRepeat();
    syncDuaCompactSettings();
  };

  const originalSetDuaLinkedSpeed = setDuaLinkedSpeed;
  setDuaLinkedSpeed = function(v){const r=originalSetDuaLinkedSpeed(v);syncDuaCompactSettings();return r};

  document.addEventListener("change",e=>{if(e.target?.id==="duaSectionRepeatCount")syncDuaCompactSettings()});

  // Seçili sayaç yokken boş alana dokunmak sayımı kapatır; rozet seçilince tekrar açılır.
  document.addEventListener("pointerdown",e=>{
    if(state.currentView!=="dua")return;
    if(e.target.closest("button,.v2-counter-menu,#duaListeningPanel,dialog"))return;
    if(e.target===document.body||e.target.classList.contains("memorize")||e.target.classList.contains("read-content"))disarmCounter();
  },true);

  // Todo arşiv alanını ekle.
  if(!$("#todoArchivedSection")){
    const section=document.createElement("section");section.id="todoArchivedSection";section.className="todo-completed-section hidden";
    section.innerHTML='<h3 class="todo-section-title">Arşiv</h3><div id="todoArchivedList"></div>';
    $("#todoCompletedSection")?.after(section);
  }

  if($("#resetBtn"))$("#resetBtn").onclick=resetActiveCounter;
  if($("#sessionResetBtn"))$("#sessionResetBtn").onclick=resetCurrentDuaSession;
  ensureCounterMenu();ensureBottomNav();updateBottomNav();
  if($("#sessionResetBtn"))$("#sessionResetBtn").classList.toggle("hidden",state.currentView!=="dua");
  expireCurrentNormalCounters();
  setInterval(expireCurrentNormalCounters,60000);
  requestAnimationFrame(()=>{updateCounterDisplay();updateTodoProgressDisplay();syncDuaCompactSettings();updateReadProgressFromScroll()});
  setTimeout(()=>{
    try{
      if(state.currentView==="dua"){if(state.settings.mode==="read")renderRead();else render()}
      else if(state.currentView==="todo")renderTodo();
      updateBottomNav();syncDuaCompactSettings();
    }catch{}
  },250);
})();