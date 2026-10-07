const $=s=>document.querySelector(s);
const state=JSON.parse(localStorage.getItem("duaEzberState")||"{}");
state.settings=Object.assign({dark:false,fontSize:32,showArabic:false,showLatin:true,showTurkish:false,showNotes:true,mode:"memorize"},state.settings||{});state.readCounts=state.readCounts||{};
let data,dua,index=state.index||0;const counts=state.counts||{};
let todos=JSON.parse(localStorage.getItem("duaTodoState")||"[]");
state.todoDate=state.todoDate||null;
let pendingTodoScope=null;
let pendingTodoSegmentIndex=null;
let pendingListeningTodo=null;
let activeQuickCount=null;
let tasbihTitleSize=Math.max(22,Math.min(64,Number(localStorage.getItem("tasbihFullscreenTitleSize"))||36));
let ilmihalData=null;
const save=()=>localStorage.setItem("duaEzberState",JSON.stringify({...state,duaId:dua?.id,index,counts}));
const saveTodos=()=>localStorage.setItem("duaTodoState",JSON.stringify(todos));
const todayKey=()=>new Date().toLocaleDateString("en-CA");
const key=()=>dua.id+":"+index;
const segmentKey=i=>dua.id+":"+i;
async function init(){
  const payload=await window.duaV2Db.loadContent();
  data=payload.data;ilmihalData=payload.ilmihalData;
  migrateLegacyViewState();
  buildHomeMenuFromDb();
  applyDbLabels();
  normalizeTodos();dua=data.duas.find(d=>d.id===state.duaId)||data.duas[0];index=Math.min(index,Math.max(0,dua.segments.length-1));applySettings();setupHomeMenuInteractions();syncGlobalHeaderHeight();setupSharedHeaderCollapse();render();if(state.currentView==="library"&&state.libraryCategory){openCategory(state.libraryCategory)}else if(state.currentView==="ilmihal"){openIlmihal(state.ilmihalTopic||null)}else if(state.currentView==="dua"){applyMode()}else if(state.currentView==="todo"){openTodo()}else if(state.currentView==="listening"){openListening()}else{openHome()}requestAnimationFrame(()=>{syncGlobalHeaderHeight();syncReadHeaderHeight();restoreCounter()});if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=93").then(r=>r.update())
}
function migrateLegacyViewState(){
  const map={
    "Sûreler":"surahs",
    "Namaz Duaları":"prayer_duas",
    "Günlük Dualar":"daily_duas",
    "Tesbihat":"tesbihat",
    "Esmâü’l-Hüsnâ":"asma"
  };
  if(state.libraryCategory&&map[state.libraryCategory])state.libraryCategory=map[state.libraryCategory];
}
function buildHomeMenuFromDb(){
  const menu=document.querySelector(".home-menu");if(!menu)return;
  const countText=$("#homeTodoCount")?.textContent||"0";
  menu.innerHTML="";
  for(const item of (data?.menu||[]).sort((a,b)=>Number(a.metadata?.sort_order||0)-Number(b.metadata?.sort_order||0))){
    const b=document.createElement("button");
    b.className="home-card"+(item.key==="todo"?" home-card-todo":"");
    b.dataset.menuKey=item.key;
    const strong=document.createElement("strong");
    strong.textContent=item.title||"";
    const span=document.createElement("span");
    if(item.key==="todo"){span.id="homeTodoCount";span.textContent=countText}else span.textContent="›";
    b.append(strong,span);
    if(item.route==="category"){
      b.classList.add("category-link");
      b.dataset.category=item.key;
      b.onclick=()=>openCategory(item.key);
    }else if(item.route==="todo"){
      b.id="homeTodoBtn";
      b.onclick=openTodo;
    }else if(item.route==="listening"){
      b.id="homeListeningBtn";
      b.onclick=openListening;
    }else if(item.route==="ilmihal"){
      b.id="homeIlmihalBtn";
      b.onclick=()=>openIlmihal();
    }
    menu.appendChild(b);
  }
}
function menuItem(key){return (data?.menu||[]).find(x=>x.key===key)||null}
function categoryTitle(key){return menuItem(key)?.title||""}
function applyDbLabels(){
  const setStrong=(selector,key)=>{const el=$(selector)?.querySelector("strong");if(el)el.textContent=menuItem(key)?.title||""};
  const root=$("#homeView .home-head h1");if(root)root.textContent=data?.rootTitle||"";
  setStrong("#homeTodoBtn","todo");
  document.querySelectorAll(".category-link").forEach(b=>{const s=b.querySelector("strong");if(s)s.textContent=categoryTitle(b.dataset.category)});
  setStrong("#homeListeningBtn","listening");
  setStrong("#homeIlmihalBtn","ilmihal");
  const th=$("#todoView .todo-page-head h2");if(th)th.textContent=menuItem("todo")?.title||"";
  const lh=$("#listeningView .listening-head h2");if(lh)lh.textContent=menuItem("listening")?.title||"";
}
function isEsmaNameDua(d=dua){return !!d&&d.category==="asma"&&/^esma-\d+$/.test(String(d.id||""))}
function current(){const s=dua.segments[index];return typeof s==="string"?{latin:s}:s}
function render(){
  const s=current(),esmaDetail=isEsmaNameDua()&&state.settings.mode==="memorize";
  $("#title").textContent=esmaDetail?categoryTitle("asma"):dua.title;
  const inv=dua.invocation||"";
  $("#invocation").textContent=esmaDetail?"":inv;
  $("#invocation").classList.toggle("hidden",esmaDetail||!inv);

  const esmaBox=$("#esmaDetailContent"),esmaName=$("#esmaNameTitle"),esmaInv=$("#esmaInvocationText");
  if(esmaBox){
    esmaBox.classList.toggle("hidden",!esmaDetail);
    if(esmaName)esmaName.textContent=esmaDetail?dua.title:"";
    if(esmaInv)esmaInv.textContent=esmaDetail?inv:"";
  }

  $("#segment").textContent=esmaDetail?"":(s.latin||"");
  $("#segment").classList.toggle("hidden",esmaDetail||!state.settings.showLatin||!s.latin);
  $("#arabic").textContent=s.arabic||"";
  $("#arabic").classList.toggle("hidden",!state.settings.showArabic||!s.arabic);
  $("#turkish").textContent=s.turkish||"";
  $("#turkish").classList.toggle("hidden",!state.settings.showTurkish||!s.turkish);
  let note=$("#gestureNote");if(note){note.textContent=s.note||"";note.classList.toggle("hidden",!s.note||!state.settings.showNotes)}
  const memorizePreset=linkedPresetForDuaSegment(dua.id,index+1),memorizeListen=$("#memorizeListenBtn");
  if(memorizeListen){memorizeListen.classList.toggle("hidden",!memorizePreset);memorizeListen.textContent=memorizePreset?"▶ "+(index+1):"▶";memorizeListen.dataset.section=memorizePreset?String(index+1):""}
  $("#progress").textContent=(index+1)+" / "+dua.segments.length;
  $("#count").textContent=counts[key()]||0;
  $("#prevBtn").disabled=index===0;$("#nextBtn").disabled=index===dua.segments.length-1;
  if(isEsmaNameDua())syncMemorizePager();
  applyVisibility();renderRead();updateCounterDisplay();updateTodoProgressDisplay();save()
}
function applySettings(){syncGlobalHeaderHeight();document.documentElement.classList.toggle("dark",state.settings.dark);document.body.classList.toggle("dark",state.settings.dark);document.documentElement.style.setProperty("--segment-size",state.settings.fontSize+"px");document.querySelector('meta[name="theme-color"]').content=state.settings.dark?"#151714":"#f5f1e8";$("#themeToggle").textContent=state.settings.dark?"Açık":"Kapalı";$("#arabicToggle").textContent=state.settings.showArabic?"Açık":"Gizli";$("#latinToggle").textContent=state.settings.showLatin?"Açık":"Gizli";$("#turkishToggle").textContent=state.settings.showTurkish?"Açık":"Gizli";$("#notesToggle").textContent=state.settings.showNotes?"Açık":"Gizli";applyVisibility()}
function applyVisibility(){const s=dua?current():{},esmaDetail=isEsmaNameDua()&&state.settings.mode==="memorize";$("#arabic").classList.toggle("hidden",!state.settings.showArabic||!s.arabic);$("#segment").classList.toggle("hidden",esmaDetail||!state.settings.showLatin||!s.latin);$("#turkish").classList.toggle("hidden",!state.settings.showTurkish||!s.turkish);document.querySelectorAll("#readContent .arabic").forEach(e=>e.classList.toggle("hidden",!state.settings.showArabic||!e.textContent.trim()));document.querySelectorAll("#readContent .segment").forEach(e=>e.classList.toggle("hidden",!state.settings.showLatin||!e.textContent.trim()));document.querySelectorAll("#readContent .turkish").forEach(e=>e.classList.toggle("hidden",!state.settings.showTurkish||!e.textContent.trim()));document.querySelectorAll("#readContent .gesture-note").forEach(e=>e.classList.toggle("hidden",!state.settings.showNotes||!e.textContent.trim()))}
function renderRead(){
  if(!dua)return;
  $("#readTitle").textContent=dua.title;
  const inv=dua.invocation||"";
  $("#readInvocation").textContent=inv;
  $("#readInvocation").classList.toggle("hidden",!inv);
  renderDuaListeningPanel();

  const k=todayKey();
  $("#readContent").innerHTML=dua.segments.map((raw,i)=>{
    const s=typeof raw==="string"?{latin:raw}:raw;
    const t=currentTodoTask("segment",i,k);
    const tp=t?Math.min(taskProgress(t,k),t.target):0;
    const td=t?taskDone(t,k):false;
    const rp=Math.min(counts[segmentKey(i)]||0,Number(s.target||0));
    const rd=!!s.target&&rp>=Number(s.target);
    const repeatActive=activeQuickCount?.type==="segmentRepeat"&&activeQuickCount.segmentIndex===i;
    const todoActive=activeQuickCount?.type==="todoSegment"&&activeQuickCount.segmentIndex===i;
    const repeatBadge=s.target?'<button class="segment-repeat-badge '+(rd?'done ':'')+(repeatActive?'active':'')+'" data-repeat-segment="'+i+'" aria-label="Bu tekrar sayacını etkinleştir">'+escapeHtml(String(s.target))+'/'+escapeHtml(String(rp))+'</button>':"";
    const todoBadge=t?'<button class="segment-todo-badge '+(td?'done ':'')+(todoActive?'active':'')+'" data-todo-segment="'+i+'" aria-label="Bu Todo sayacını etkinleştir">'+escapeHtml(String(t.target))+'/'+escapeHtml(String(tp))+'</button>':"";
    const addTodo='<button class="segment-add-todo" data-add-todo-segment="'+i+'" aria-label="Bu bölümü Todo\'ya tekrar ekle">+ Todo</button>';
    const linkedPreset=linkedPresetForDuaSegment(dua.id,i+1);
    const listenPlay=linkedPreset?'<button class="segment-listen-play" data-listen-dua-segment="'+i+'" aria-label="Bu bölümün eşleşen videosunu oynat">▶ '+(i+1)+'</button>':"";
    const badges=(repeatBadge||todoBadge||listenPlay)?'<div class="segment-badges">'+listenPlay+repeatBadge+todoBadge+'</div>':"";
    return '<article class="read-item read-item-clickable'+(t?' read-item-todo':'')+'" data-open-segment="'+i+'"><div class="read-item-number">'+(i+1)+'</div>'+addTodo+badges+(s.note?'<div class="gesture-note '+(state.settings.showNotes?'':'hidden')+'">'+escapeHtml(s.note)+'</div>':'')+'<div class="arabic '+(state.settings.showArabic&&s.arabic?'':'hidden')+'" dir="rtl">'+escapeHtml(s.arabic||"")+'</div><div class="segment '+(state.settings.showLatin&&s.latin?'':'hidden')+'">'+escapeHtml(s.latin||"")+'</div><div class="turkish '+(state.settings.showTurkish&&s.turkish?'':'hidden')+'">'+escapeHtml(s.turkish||"")+'</div></article>';
  }).join("");

  $("#readContent").querySelectorAll("[data-open-segment]").forEach(el=>el.onclick=()=>openSegmentMemorize(Number(el.dataset.openSegment)));
  $("#readContent").querySelectorAll("[data-repeat-segment]").forEach(b=>bindSmallCounterPress(b,"segmentRepeat",Number(b.dataset.repeatSegment)));
  $("#readContent").querySelectorAll("[data-todo-segment]").forEach(b=>bindSmallCounterPress(b,"todoSegment",Number(b.dataset.todoSegment)));
  $("#readContent").querySelectorAll("[data-add-todo-segment]").forEach(b=>b.onclick=e=>{e.stopPropagation();openTodoDialog("segment",Number(b.dataset.addTodoSegment))});
  $("#readContent").querySelectorAll("[data-listen-dua-segment]").forEach(b=>b.onclick=e=>{e.stopPropagation();playDuaLinkedSection(Number(b.dataset.listenDuaSegment)+1)});
  updateDuaPager();updateCounterDisplay();updateTodoProgressDisplay();syncReadHeaderHeight();
}
function setupSharedHeaderCollapse(){
  const selectors=[
    ".read-sticky-header",
    ".memorize-sticky-header",
    ".library-page-head",
    ".todo-page-head",
    ".ilmihal-page-head",
    ".listening-head"
  ];
  document.querySelectorAll(selectors.join(",")).forEach(head=>{
    head.classList.add("collapsible-page-header");
    let btn=head.querySelector(".page-header-collapse-btn");
    if(!btn){
      const existing=head.querySelector("#readHeaderCollapseBtn");
      if(existing){
        btn=existing;
        btn.classList.add("page-header-collapse-btn");
      }else{
        btn=document.createElement("button");
        btn.type="button";
        btn.className="back-btn page-header-collapse-btn";
        btn.setAttribute("aria-label","Üst menüyü gizle");
        btn.title="Üst menüyü gizle";
        btn.textContent="▴";
        head.appendChild(btn);
      }
    }
    btn.onclick=e=>{
      e.preventDefault();
      e.stopPropagation();
      setReadHeaderCollapsed(!document.body.classList.contains("page-headers-collapsed"));
    };
  });
  setReadHeaderCollapsed(localStorage.getItem("readHeaderCollapsed")==="1",false);
}
function syncReadHeaderHeight(){requestAnimationFrame(()=>{const view=$("#readView"),head=view?.querySelector(".read-sticky-header");if(view&&head&&!view.classList.contains("hidden")){view.style.setProperty("--read-fixed-height",head.offsetHeight+"px");syncDuaPlayerClearance()}})}
function setReadHeaderCollapsed(collapsed,savePref=true){
  const panel=$("#duaListeningPanel");
  const readHead=$("#readView .read-sticky-header");
  const panelVisible=panel&&!panel.classList.contains("hidden");
  const oldPanelRect=panelVisible?panel.getBoundingClientRect():null;
  const value=!!collapsed;

  document.body.classList.toggle("page-headers-collapsed",value);
  document.querySelectorAll(".collapsible-page-header").forEach(head=>head.classList.toggle("collapsed",value));
  document.querySelectorAll(".page-header-collapse-btn,#readHeaderCollapseBtn").forEach(btn=>{
    btn.textContent=value?"▾":"▴";
    btn.setAttribute("aria-label",value?"Üst menüyü göster":"Üst menüyü gizle");
    btn.title=value?"Üst menüyü göster":"Üst menüyü gizle";
  });
  if(savePref)localStorage.setItem("readHeaderCollapsed",value?"1":"0");

  syncReadHeaderHeight();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(panelVisible&&oldPanelRect&&panel.classList.contains("player-collapsed")&&readHead){
      const safeTop=readHead.getBoundingClientRect().bottom+8;
      if(oldPanelRect.top<safeTop)moveDuaCompactPanel(oldPanelRect.left,safeTop,true);
    }else if(panelVisible&&!oldPanelRect){
      restoreDuaCompactPosition();
    }
    syncDuaPlayerClearance();
    restoreCounter();
  }));
}
function syncDuaPlayerClearance(){
  const view=$("#readView"),panel=$("#duaListeningPanel");if(!view)return;
  if(!panel||panel.classList.contains("hidden")||!view.classList.contains("has-dua-listening")){
    view.style.setProperty("--dua-player-clearance","0px");return;
  }
  const h=Math.max(0,Math.min(panel.offsetHeight+14,Math.round(window.innerHeight*.58)));
  view.style.setProperty("--dua-player-clearance",h+"px");
}
function readDuaCompactPosition(){
  try{const p=JSON.parse(localStorage.getItem("duaCompactPlayerPos")||"null");return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null}catch{return null}
}
function storeDuaCompactPosition(x,y){localStorage.setItem("duaCompactPlayerPos",JSON.stringify({x,y}))}
function moveDuaCompactPanel(x,y,savePos=false){
  const panel=$("#duaListeningPanel");if(!panel||!panel.classList.contains("player-collapsed"))return;
  const pad=8,w=panel.offsetWidth||74,h=panel.offsetHeight||92;
  const globalHead=document.querySelector(".global-header");
  const minY=Math.max(8,(globalHead?.getBoundingClientRect().bottom||0)+8);
  const maxY=Math.max(minY,innerHeight-h-8);
  const nx=Math.max(pad,Math.min(innerWidth-w-pad,Number(x)||pad));
  const ny=Math.max(minY,Math.min(maxY,Number(y)||minY));
  panel.style.left=nx+"px";
  panel.style.top=ny+"px";
  panel.style.transform="none";
  if(savePos)storeDuaCompactPosition(nx,ny);
}
function restoreDuaCompactPosition(fallbackTop=null){
  const panel=$("#duaListeningPanel");if(!panel||!panel.classList.contains("player-collapsed"))return;
  const saved=readDuaCompactPosition();
  if(saved){moveDuaCompactPanel(saved.x,saved.y,false);return}
  const w=panel.offsetWidth||74;
  moveDuaCompactPanel((innerWidth-w)/2,Number.isFinite(fallbackTop)?fallbackTop:counterSafeTop()+12,false);
}
function setDuaPlayerCollapsed(_collapsed=true,savePref=true){
  const panel=$("#duaListeningPanel"),repeat=$("#duaSectionRepeatCount");if(!panel)return;
  panel.classList.add("player-collapsed");
  if(repeat)repeat.readOnly=true;
  if(savePref)localStorage.setItem("duaPlayerCollapsed","1");
  requestAnimationFrame(()=>{
    restoreDuaCompactPosition();
    syncDuaPlayerClearance();
    restoreCounter();
  });
}
function syncDuaCompactSettings(){
  const repeat=$("#duaCompactRepeatInput"),sourceRepeat=$("#duaSectionRepeatCount"),speed=$("#duaCompactSpeed"),sourceSpeed=$("#duaLinkedSpeed"),badge=$("#duaPlayRepeatBadge");
  const repeatValue=String(Math.max(1,Math.min(999,parseInt(sourceRepeat?.value,10)||1)));
  if(repeat)repeat.value=repeatValue;
  if(badge)badge.textContent=repeatValue;
  if(speed&&sourceSpeed)speed.value=sourceSpeed.value||"1";
}
function positionDuaCompactSettings(){
  const panel=$("#duaListeningPanel"),box=$("#duaCompactSettings");if(!panel||!box||box.classList.contains("hidden"))return;
  const pr=panel.getBoundingClientRect();
  const vv=window.visualViewport;
  const vw=vv?.width||innerWidth,vh=vv?.height||innerHeight,vo=vv?.offsetTop||0;
  const br=box.getBoundingClientRect(),gap=10,pad=8;
  const left=Math.max(pad,Math.min(vw-br.width-pad,pr.left+pr.width/2-br.width/2));
  const aboveTop=pr.top-gap-br.height;
  const belowTop=pr.bottom+gap;
  const fitsAbove=aboveTop>=vo+pad;
  const top=fitsAbove?aboveTop:Math.min(vo+vh-br.height-pad,belowTop);
  box.style.left=left+"px";
  box.style.top=Math.max(vo+pad,top)+"px";
  box.dataset.placement=fitsAbove?"above":"below";
}
function showDuaCompactSettings(){
  const panel=$("#duaListeningPanel"),box=$("#duaCompactSettings");if(!panel||!box)return;
  syncDuaCompactSettings();
  box.classList.remove("hidden");
  panel.classList.add("settings-open");
  duaCompactHoldOpenedSettings=true;
  requestAnimationFrame(positionDuaCompactSettings);
}
function hideDuaCompactSettings(){
  $("#duaCompactSettings")?.classList.add("hidden");
  $("#duaListeningPanel")?.classList.remove("settings-open");
}
function commitDuaCompactRepeat(){
  const compact=$("#duaCompactRepeatInput"),source=$("#duaSectionRepeatCount");if(!compact||!source)return;
  const n=Math.max(1,Math.min(999,parseInt(compact.value,10)||1));
  compact.value=String(n);source.value=String(n);if($("#duaPlayRepeatBadge"))$("#duaPlayRepeatBadge").textContent=String(n);
}
function beginCompactPlayerHold(e){
  const panel=$("#duaListeningPanel");if(!panel?.classList.contains("player-collapsed"))return;
  if(e.target.closest("#duaCompactSettings"))return;
  clearTimeout(duaCompactDragTimer);
  duaCompactDragging=false;duaCompactEditing=false;duaCompactHoldOpenedSettings=false;duaCompactPointerId=e.pointerId;
  duaCompactStartX=e.clientX;duaCompactStartY=e.clientY;
  const r=panel.getBoundingClientRect();duaCompactOffsetX=e.clientX-r.left;duaCompactOffsetY=e.clientY-r.top;
  duaCompactDragTimer=setTimeout(()=>{duaCompactDragTimer=null;showDuaCompactSettings()},600);
}
function moveCompactPlayerHold(e){
  const panel=$("#duaListeningPanel");if(!panel?.classList.contains("player-collapsed")||e.pointerId!==duaCompactPointerId||duaCompactHoldOpenedSettings)return;
  const dist=Math.hypot(e.clientX-duaCompactStartX,e.clientY-duaCompactStartY);
  if(!duaCompactDragging&&dist>8){
    if(duaCompactDragTimer){clearTimeout(duaCompactDragTimer);duaCompactDragTimer=null}
    hideDuaCompactSettings();
    duaCompactDragging=true;panel.classList.add("compact-dragging");
    try{panel.setPointerCapture(e.pointerId)}catch{}
  }
  if(duaCompactDragging){
    e.preventDefault();
    moveDuaCompactPanel(e.clientX-duaCompactOffsetX,e.clientY-duaCompactOffsetY,false);
  }
}
function endCompactPlayerHold(e){
  const panel=$("#duaListeningPanel");if(e.pointerId!==duaCompactPointerId)return;
  if(duaCompactDragTimer){clearTimeout(duaCompactDragTimer);duaCompactDragTimer=null}
  if(duaCompactDragging&&panel){
    const r=panel.getBoundingClientRect();storeDuaCompactPosition(r.left,r.top);panel.classList.remove("compact-dragging");
    duaCompactSuppressClick=true;setTimeout(()=>duaCompactSuppressClick=false,140);
  }else if(duaCompactHoldOpenedSettings){
    duaCompactSuppressClick=true;setTimeout(()=>duaCompactSuppressClick=false,180);
  }else if(panel?.classList.contains("player-collapsed")){
    duaCompactSuppressClick=true;
    pauseResumeDuaLinkedPlayback();
    setTimeout(()=>duaCompactSuppressClick=false,140);
  }
  try{panel?.releasePointerCapture(e.pointerId)}catch{}
  duaCompactDragging=false;duaCompactPointerId=null;duaCompactHoldOpenedSettings=false;
}

function syncGlobalHeaderHeight(){requestAnimationFrame(()=>{const head=document.querySelector(".global-header");if(head)document.documentElement.style.setProperty("--global-header-height",head.getBoundingClientRect().height+"px")})}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[c]))}
function applyMode(){state.currentView="dua";$("#fullscreenTasbihBtn").classList.remove("hidden");$("#homeView").classList.add("hidden");$("#todoView").classList.add("hidden");$("#ilmihalView").classList.add("hidden");$("#listeningView").classList.add("hidden");const read=state.settings.mode==="read";$("#memorizeView").classList.toggle("hidden",read);$("#memorizeView").classList.toggle("esma-detail",isEsmaNameDua()&&!read);$("#esmaDetailContent")?.classList.toggle("hidden",!(isEsmaNameDua()&&!read));$("#readView").classList.toggle("hidden",!read);$("#libraryView").classList.add("hidden");$(".navigation").classList.toggle("hidden",read);counter.classList.remove("hidden");counter.classList.toggle("selected-counter",isEsmaNameDua()&&!read);renderDuaListeningPanel();updateCounterDisplay();updateTodoProgressDisplay();requestAnimationFrame(()=>requestAnimationFrame(()=>{setReadHeaderCollapsed(localStorage.getItem("readHeaderCollapsed")==="1",false);setDuaPlayerCollapsed(true,false);restoreDuaCompactPosition();restoreCounter()}));save()}
function moveEsmaName(step){
  const items=categoryItems("asma").filter(isEsmaNameDua),i=items.findIndex(d=>d.id===dua.id),n=i+step;
  if(i<0||n<0||n>=items.length)return;
  const d=items[n];dua=d;index=0;state.duaId=d.id;state.settings.mode="memorize";clearQuickCount();render();applyMode();
}
function syncMemorizePager(){
  if(!isEsmaNameDua())return;
  const items=categoryItems("asma").filter(isEsmaNameDua),i=items.findIndex(d=>d.id===dua.id);
  $("#prevBtn").disabled=i<=0;$("#nextBtn").disabled=i<0||i>=items.length-1;
}
$("#prevBtn").onclick=()=>{if(isEsmaNameDua()){moveEsmaName(-1);return}if(index>0){index--;render()}};
$("#nextBtn").onclick=()=>{if(isEsmaNameDua()){moveEsmaName(1);return}if(index<dua.segments.length-1){index++;render()}};

function counterContextInfo(){if(!dua)return{target:0,progress:0,done:false,title:"Tesbih"};const k=todayKey(),read=state.settings.mode==="read",quick=quickCountInfo();if(read&&quick){const s=dua.segments[quick.segmentIndex],seg=typeof s==="string"?{latin:s}:s;return{target:quick.target,progress:quick.progress,done:quick.done,title:(seg?.latin||dua.title||"Tesbih")}}if(read){const t=currentTodoTask("dua",null,k);if(t)return{target:Number(t.target||0),progress:Math.min(taskProgress(t,k),Number(t.target||0)),done:taskDone(t,k),title:dua.title};const target=Number(dua.target||0),progress=state.readCounts[dua.id]||0;return{target,progress,done:!!target&&progress>=target,title:dua.title}}const t=currentTodoTask("segment",index,k);if(t)return{target:Number(t.target||0),progress:Math.min(taskProgress(t,k),Number(t.target||0)),done:taskDone(t,k),title:(current()?.latin||dua.title||"Tesbih")};const target=Number(current()?.target||dua.target||0),progress=counts[key()]||0;return{target,progress,done:!!target&&progress>=target,title:(current()?.latin||dua.title||"Tesbih")}}
function fullscreenTasbihTitle(raw){
  if(isEsmaNameDua()&&dua?.invocation)return String(dua.invocation).trim();
  return String(raw||"Tesbih").trim();
}
function applyFullscreenTasbihTitleSize(){
  const box=$("#tasbihFullscreen");
  if(box)box.style.setProperty("--tasbih-title-size",tasbihTitleSize+"px");
}
function setFullscreenTasbihTitleSize(value){
  tasbihTitleSize=Math.max(22,Math.min(64,Number(value)||36));
  localStorage.setItem("tasbihFullscreenTitleSize",String(tasbihTitleSize));
  applyFullscreenTasbihTitleSize();
  fitFullscreenTasbihLayout();
}
function resetFullscreenTasbihTitleSize(){
  setFullscreenTasbihTitleSize(Math.max(28,Math.min(48,Number(state.settings.fontSize||32)+4)));
}
function fitFullscreenTasbihLayout(){
  const box=$("#tasbihFullscreen"),center=box?.querySelector(".tasbih-fullscreen-center"),title=$("#tasbihFullscreenTitle"),count=$("#tasbihFullscreenCount");
  if(!box||!center||!title||!count)return;
  let size=tasbihTitleSize;
  title.style.fontSize=size+"px";
  count.style.fontSize="";
  box.classList.remove("long-title","very-long-title");
  const len=title.textContent.trim().length;
  if(len>180)box.classList.add("long-title");
  if(len>420)box.classList.add("very-long-title");
  // First let CSS reduce the counter for long texts, then shrink only the title as much as needed.
  requestAnimationFrame(()=>{
    const maxHeight=Math.max(260,box.clientHeight-24);
    while(center.scrollHeight>maxHeight&&size>12){
      size-=1;
      title.style.fontSize=size+"px";
    }
    // Last-resort safety for unusually long text: keep everything inside the viewport.
    if(center.scrollHeight>maxHeight){
      count.style.fontSize="clamp(48px,10vw,86px)";
    }
  });
}
function renderFullscreenTasbih(){
  const box=$("#tasbihFullscreen");if(!box||box.classList.contains("hidden"))return;
  const info=counterContextInfo();
  applyFullscreenTasbihTitleSize();
  $("#tasbihFullscreenTitle").textContent=fullscreenTasbihTitle(info.title);
  $("#tasbihFullscreenCount").textContent=info.target?info.target+"/"+info.progress:String(info.progress);
  box.classList.toggle("done",!!info.done);
  fitFullscreenTasbihLayout();
}
function completionFeedback(){const box=$("#tasbihFullscreen");box?.classList.add("completed-pulse");setTimeout(()=>box?.classList.remove("completed-pulse"),650);if("vibrate"in navigator){try{navigator.vibrate([120,70,180])}catch{}}}
function decrementTodoProgress(scope,segmentIndex=index){const k=todayKey();todos.forEach(t=>{if(t.duaId!==dua.id||!todoOccursOn(t,k))return;if(scope==="dua"&&t.segmentIndex!=null)return;if(scope==="segment"&&t.segmentIndex!==segmentIndex)return;const h=t.history?.[k];if(!h)return;h.count=Math.max(0,Number(h.count||0)-1);if(h.count<Number(t.target||1))h.completedAt=null});saveTodos();updateHomeTodoCount()}
function incrementActiveCounter(){const before=counterContextInfo();const quick=quickCountInfo();if(state.settings.mode==="read"&&quick){if(!quick.done){if(quick.type==="segmentRepeat"){const k=segmentKey(quick.segmentIndex);counts[k]=Math.min((counts[k]||0)+1,quick.target);const oldIndex=index;index=quick.segmentIndex;addTodoProgress("segment");index=oldIndex}else if(quick.type==="todoSegment"){const oldIndex=index;index=quick.segmentIndex;addTodoProgress("segment");index=oldIndex}}renderRead();updateCounterDisplay();updateTodoProgressDisplay();save()}else if(state.settings.mode==="read"){state.readCounts[dua.id]=(state.readCounts[dua.id]||0)+1;addTodoProgress("dua");if(dua.target&&state.readCounts[dua.id]>dua.target)state.readCounts[dua.id]=0;renderRead();updateCounterDisplay();updateTodoProgressDisplay();save()}else{counts[key()]=(counts[key()]||0)+1;addTodoProgress("segment");const target=Number(current()?.target||dua.target||0);if(current()?.target&&target)counts[key()]=Math.min(counts[key()],target);else if(dua.target&&counts[key()]>target)counts[key()]=0;render();updateCounterDisplay();updateTodoProgressDisplay()}const after=counterContextInfo();if(!before.done&&after.done)completionFeedback();renderFullscreenTasbih()}
function decrementActiveCounter(){const quick=quickCountInfo();if(state.settings.mode==="read"&&quick){if(quick.type==="segmentRepeat"){const k=segmentKey(quick.segmentIndex);counts[k]=Math.max(0,(counts[k]||0)-1);decrementTodoProgress("segment",quick.segmentIndex)}else if(quick.type==="todoSegment"){decrementTodoProgress("segment",quick.segmentIndex)}renderRead();updateCounterDisplay();updateTodoProgressDisplay();save()}else if(state.settings.mode==="read"){state.readCounts[dua.id]=Math.max(0,(state.readCounts[dua.id]||0)-1);decrementTodoProgress("dua");renderRead();updateCounterDisplay();updateTodoProgressDisplay();save()}else{counts[key()]=Math.max(0,(counts[key()]||0)-1);decrementTodoProgress("segment",index);render();updateCounterDisplay();updateTodoProgressDisplay()}renderFullscreenTasbih()}
function openFullscreenTasbih(){if(!dua||state.currentView!=="dua")return;const box=$("#tasbihFullscreen");box.classList.remove("hidden");document.body.classList.add("tasbih-mode-open");renderFullscreenTasbih()}
function closeFullscreenTasbih(){$("#tasbihFullscreen").classList.add("hidden");document.body.classList.remove("tasbih-mode-open")}
$("#fullscreenTasbihBtn").onclick=openFullscreenTasbih;
$("#tasbihExitBtn").onclick=e=>{e.stopPropagation();closeFullscreenTasbih()};
$("#tasbihMinusBtn").onclick=e=>{e.stopPropagation()};
$("#tasbihFontDown").onclick=e=>{e.stopPropagation();setFullscreenTasbihTitleSize(tasbihTitleSize-4)};
$("#tasbihFontUp").onclick=e=>{e.stopPropagation();setFullscreenTasbihTitleSize(tasbihTitleSize+4)};
$("#tasbihFontReset").onclick=e=>{e.stopPropagation();resetFullscreenTasbihTitleSize()};
let minusTimer=null;
$("#tasbihMinusBtn").addEventListener("pointerdown",e=>{e.stopPropagation();minusTimer=setTimeout(()=>{decrementActiveCounter();minusTimer=null},550)});
["pointerup","pointercancel","pointerleave"].forEach(ev=>$("#tasbihMinusBtn").addEventListener(ev,e=>{e.stopPropagation();if(minusTimer){clearTimeout(minusTimer);minusTimer=null}}));
$("#tasbihFullscreen").onclick=e=>{if(e.target.closest("#tasbihExitBtn,#tasbihMinusBtn,#tasbihFontControls"))return;incrementActiveCounter()};
$("#settingsBtn").onclick=()=>$("#settingsDialog").showModal();
$("#menuBtn").addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openHome()});
$("#homeTodoBtn").onclick=openTodo;
$("#todoMenuBtn").onclick=openHome;
function hideDuaFloatingPlayer(){hideDuaCompactSettings();$("#duaListeningPanel")?.classList.add("hidden")}
function openHome(){hideDuaFloatingPlayer();$("#fullscreenTasbihBtn").classList.add("hidden");closeFullscreenTasbih();clearQuickCount();state.currentView="home";state.ilmihalTopic=null;$("#homeView").classList.remove("hidden");$("#todoView").classList.add("hidden");$("#listeningView").classList.add("hidden");$("#memorizeView").classList.add("hidden");$("#readView").classList.add("hidden");$("#libraryView").classList.add("hidden");$("#ilmihalView").classList.add("hidden");$(".navigation").classList.add("hidden");counter.classList.add("hidden");$("#progress").textContent="";updateHomeTodoCount();save()}

function dateKey(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return y+"-"+m+"-"+day}
function dateFromKey(k){const [y,m,d]=String(k).split("-").map(Number);return new Date(y,m-1,d,12,0,0)}
function addDaysKey(k,n){const d=dateFromKey(k);d.setDate(d.getDate()+n);return dateKey(d)}
function formatTodoDate(k,weekday=true){return new Intl.DateTimeFormat("tr-TR",{weekday:weekday?"long":undefined,day:"2-digit",month:"long",year:"numeric"}).format(dateFromKey(k))}
function normalizeTodos(){let changed=false;const today=todayKey();todos=todos.map(t=>{if(!t.history)t.history={};if(t.progressDate&&!t.history[t.progressDate]){t.history[t.progressDate]={count:t.progressCount||0,completedAt:t.done?new Date(t.createdAt||Date.now()).toISOString():null};changed=true}if(!t.schedule){const created=(t.createdAt||"").slice(0,10),start=t.progressDate||created||today;t.schedule={mode:t.daily?"forever":"single",startDate:start,endDate:t.daily?null:start};changed=true}if(!t.schedule.startDate){t.schedule.startDate=t.createdAt?.slice(0,10)||today;changed=true}return t});if(changed)saveTodos()}
function todoOccursOn(t,k){const s=t.schedule||{},start=s.startDate||todayKey();if(k<start)return false;if(s.mode==="forever")return true;const end=s.endDate||start;return k<=end}
function todoHistory(t,k){return t.history?.[k]||{count:0,completedAt:null}}
function taskProgress(t,k=state.todoDate||todayKey()){return todoHistory(t,k).count||0}
function taskDone(t,k=state.todoDate||todayKey()){const h=todoHistory(t,k);return !!h.completedAt||Number(h.count||0)>=Number(t.target||1)}
function currentTodoTask(scope,segmentIndex=index,k=todayKey()){const matches=todos.filter(t=>t.duaId===dua?.id&&todoOccursOn(t,k)&&(scope==="dua"?t.segmentIndex==null:t.segmentIndex===segmentIndex));return matches.find(t=>!taskDone(t,k))||matches[0]||null}
function clearQuickCount(){activeQuickCount=null}
function toggleQuickCount(type,segmentIndex){if(activeQuickCount?.type===type&&activeQuickCount.segmentIndex===segmentIndex){clearQuickCount()}else{activeQuickCount={type,segmentIndex}}renderRead();updateCounterDisplay()}
function quickCountInfo(){if(!activeQuickCount||state.settings.mode!=="read")return null;const i=activeQuickCount.segmentIndex,s=dua?.segments?.[i],seg=typeof s==="string"?{latin:s}:s;if(activeQuickCount.type==="segmentRepeat"&&seg?.target){const target=Number(seg.target),progress=Math.min(counts[segmentKey(i)]||0,target);return{type:"segmentRepeat",segmentIndex:i,target,progress,done:progress>=target}}if(activeQuickCount.type==="todoSegment"){const t=currentTodoTask("segment",i,todayKey());if(t){const target=Number(t.target),progress=Math.min(taskProgress(t,todayKey()),target);return{type:"todoSegment",segmentIndex:i,target,progress,done:taskDone(t,todayKey()),task:t}}}return null}
function updateCounterDisplay(){if(!dua||!counter)return;const read=state.settings.mode==="read",quick=quickCountInfo(),segmentTarget=!read?Number(current()?.target||0):0,target=segmentTarget||Number(dua?.target||0);counter.classList.remove("todo-task","todo-done","quick-count","quick-done");if(quick){counter.classList.add("quick-count");if(quick.done)counter.classList.add("quick-done");$("#count").textContent=quick.progress;counter.querySelector("small").textContent="/ "+quick.target;return}$("#count").textContent=read?(state.readCounts[dua.id]||0):(counts[key()]||0);counter.querySelector("small").textContent=target?"/ "+target:(read?"":"tekrar")}
function updateTodoProgressDisplay(){if(!dua)return;const k=todayKey(),read=state.settings.mode==="read",t=read?currentTodoTask("dua",null,k):currentTodoTask("segment",index,k),el=read?$("#readTodoProgress"):$("#memorizeTodoProgress");if(!el)return;if(!t){el.classList.add("hidden");el.textContent="";el.classList.remove("done");return}const p=Math.min(taskProgress(t,k),t.target),done=taskDone(t,k);el.textContent="Todo "+t.target+"/"+p+(done?" ✓":"");el.classList.toggle("done",done);el.classList.remove("hidden")}
function openSegmentMemorize(i){
  state.readerReturn={duaId:dua.id,scrollY:Number(window.scrollY||document.documentElement.scrollTop||0),segmentIndex:i};
  clearQuickCount();
  index=Math.max(0,Math.min(i,dua.segments.length-1));
  state.settings.mode="memorize";
  render();applyMode();save();
}
function scheduleLabel(t){const s=t.schedule||{};if(s.mode==="forever")return "Her gün";if(s.mode==="single")return formatTodoDate(s.startDate,false);if(s.mode==="range")return formatTodoDate(s.startDate,false)+" – "+formatTodoDate(s.endDate,false);if(s.mode==="days"){const days=Math.max(1,Math.round((dateFromKey(s.endDate)-dateFromKey(s.startDate))/86400000)+1);return days+" gün";}return ""}
function updateHomeTodoCount(){const k=todayKey(),todayTasks=todos.filter(t=>todoOccursOn(t,k)),pending=todayTasks.filter(t=>!taskDone(t,k)).length;const el=$("#homeTodoCount");if(el)el.textContent=pending}
function setTodoDate(k){state.todoDate=k||todayKey();renderTodo();save()}
function openTodo(){hideDuaFloatingPlayer();$("#fullscreenTasbihBtn").classList.add("hidden");closeFullscreenTasbih();clearQuickCount();$("#progress").textContent="";state.currentView="todo";state.todoDate=state.todoDate||todayKey();$("#homeView").classList.add("hidden");$("#memorizeView").classList.add("hidden");$("#readView").classList.add("hidden");$("#libraryView").classList.add("hidden");$("#ilmihalView").classList.add("hidden");$("#listeningView").classList.add("hidden");$(".navigation").classList.add("hidden");counter.classList.add("hidden");$("#progress").textContent="";$("#todoView").classList.remove("hidden");renderTodo();save()}
function renderTodo(){const k=state.todoDate||todayKey(),scheduled=todos.filter(t=>todoOccursOn(t,k)),pending=scheduled.filter(t=>!taskDone(t,k)),done=scheduled.filter(t=>taskDone(t,k));$("#todoDatePicker").value=k;$("#todoDateTitle").textContent=formatTodoDate(k,true);$("#todoSummary").textContent=done.length+" / "+scheduled.length;updateHomeTodoCount();const card=t=>{const p=Math.min(taskProgress(t,k),t.target),h=todoHistory(t,k),ok=taskDone(t,k),completed=h.completedAt?new Intl.DateTimeFormat("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(h.completedAt)):"";return '<article class="todo-card '+(ok?'done':'')+'" data-todo-id="'+t.id+'"><button class="todo-open" data-open-todo="'+t.id+'"><div class="todo-check">'+(ok?'✓':'')+'</div><div class="todo-main"><div class="todo-card-date">'+escapeHtml(formatTodoDate(k,false))+'</div><strong>'+escapeHtml(t.title)+'</strong>'+(t.scopeLabel?'<small>'+escapeHtml(t.scopeLabel)+'</small>':'')+(t.description?'<p>'+escapeHtml(t.description)+'</p>':'')+'<div class="todo-progress"><span>'+p+' / '+t.target+'</span><span>'+escapeHtml(scheduleLabel(t))+'</span></div>'+(completed?'<div class="todo-completed-at">✓ '+escapeHtml(completed)+'</div>':'')+'</div></button><button class="todo-delete" data-delete-todo="'+t.id+'" aria-label="Todo sil">×</button></article>'};$("#todoList").innerHTML=pending.length?pending.map(card).join(""):'<div class="todo-empty compact">Bu tarihte bekleyen görev yok.</div>';$("#todoCompletedList").innerHTML=done.map(card).join("");$("#todoCompletedSection").classList.toggle("hidden",!done.length);document.querySelectorAll("[data-open-todo]").forEach(b=>b.onclick=()=>openTodoTarget(b.dataset.openTodo));document.querySelectorAll("[data-delete-todo]").forEach(b=>b.onclick=e=>{e.stopPropagation();todos=todos.filter(t=>t.id!==b.dataset.deleteTodo);saveTodos();renderTodo()})}
$("#todoPrevDayBtn").onclick=()=>setTodoDate(addDaysKey(state.todoDate||todayKey(),-1));
$("#todoNextDayBtn").onclick=()=>setTodoDate(addDaysKey(state.todoDate||todayKey(),1));
$("#todoTodayBtn").onclick=()=>setTodoDate(todayKey());
$("#todoDatePicker").onchange=e=>{if(e.target.value)setTodoDate(e.target.value)};
function openTodoTarget(id){
  const t=todos.find(x=>x.id===id);
  if(!t)return;
  if(t.sourceType==="listening"){
    openListening();
    setTimeout(()=>{
      selectListeningVideo(t.videoId,false);
      if(t.listeningType==="section"&&t.presetId){
        $("#listeningPresetSelect").value=t.presetId;
        selectListeningPreset(t.presetId,false);
      }
    },120);
    return;
  }
  const d=data.duas.find(x=>x.id===t.duaId);
  if(!d)return;
  dua=d;state.duaId=d.id;
  if(t.segmentIndex==null){index=0;state.settings.mode="read"}else{index=Math.max(0,Math.min(t.segmentIndex,d.segments.length-1));state.settings.mode="memorize"}
  render();applyMode()
}
function updateTodoScheduleFields(){const mode=$("#todoScheduleMode").value;$("#todoEndDateRow").classList.toggle("hidden",mode!=="range");$("#todoDurationRow").classList.toggle("hidden",mode!=="days");const start=$("#todoStartDate").value||todayKey();if(mode==="single"){$("#todoSchedulePreview").textContent="Sadece "+formatTodoDate(start,false)}else if(mode==="forever"){$("#todoSchedulePreview").textContent=formatTodoDate(start,false)+" tarihinden itibaren her gün"}else if(mode==="days"){const days=Math.max(1,parseInt($("#todoDurationDays").value||"1",10)),end=addDaysKey(start,days-1);$("#todoSchedulePreview").textContent=days+" gün: "+formatTodoDate(start,false)+" – "+formatTodoDate(end,false)}else{const end=$("#todoEndDate").value||start;$("#todoSchedulePreview").textContent=formatTodoDate(start,false)+" – "+formatTodoDate(end,false)}}
function openTodoDialog(scope,segmentIndex=null){pendingTodoScope=scope;pendingTodoSegmentIndex=scope==="segment"?(segmentIndex==null?index:segmentIndex):null;const isSeg=scope==="segment",today=todayKey(),s=isSeg?dua.segments[pendingTodoSegmentIndex]:null,seg=typeof s==="string"?{latin:s}:s;$("#todoDialogTitle").textContent=isSeg?"Bu bölümü Todo'ya ekle":"Todo'ya ekle";$("#todoDescription").value="";$("#todoTarget").value=Number(seg?.target||dua.target||1);$("#todoScheduleMode").value="days";$("#todoStartDate").value=today;$("#todoEndDate").value=addDaysKey(today,9);$("#todoDurationDays").value=10;updateTodoScheduleFields();$("#todoDialog").showModal()}
$("#todoScheduleMode").onchange=updateTodoScheduleFields;
$("#todoStartDate").onchange=updateTodoScheduleFields;
$("#todoEndDate").onchange=updateTodoScheduleFields;
$("#todoDurationDays").oninput=updateTodoScheduleFields;
$("#addDuaTodoBtn").onclick=()=>openTodoDialog("dua");
$("#memorizeHeaderTodoBtn").onclick=()=>openTodoDialog("segment");
$("#saveTodoBtn").onclick=()=>{
  const target=Math.max(1,parseInt($("#todoTarget").value||"1",10));
  const mode=$("#todoScheduleMode").value,start=$("#todoStartDate").value||todayKey();
  let endDate=start;
  if(mode==="forever")endDate=null;
  else if(mode==="days"){const days=Math.max(1,parseInt($("#todoDurationDays").value||"1",10));endDate=addDaysKey(start,days-1)}
  else if(mode==="range"){endDate=$("#todoEndDate").value||start;if(endDate<start)endDate=start}

  if(pendingTodoScope==="listeningVideo"||pendingTodoScope==="listeningSection"){
    const v=listeningVideos.find(x=>x.videoId===pendingListeningTodo?.videoId);
    const p=listeningPresets.find(x=>x.id===pendingListeningTodo?.presetId);
    const isSection=pendingTodoScope==="listeningSection";
    const title=isSection?(v?.title||"Dinleme")+" — Bölüm "+(p?.title||""):(v?.title||"Dinleme videosu");
    const scopeLabel=isSection?(formatListenTime(p?.a||0)+" – "+formatListenTime(p?.b||0)):"Dinleme · Video";
    todos.push({
      id:"todo-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),
      sourceType:"listening",
      listeningType:isSection?"section":"video",
      videoId:v?.videoId||pendingListeningTodo?.videoId||"",
      presetId:isSection?(p?.id||pendingListeningTodo?.presetId||""):"",
      duaId:null,segmentIndex:null,title,scopeLabel,
      description:$("#todoDescription").value.trim(),target,
      schedule:{mode,startDate:start,endDate},history:{},createdAt:new Date().toISOString()
    });
  }else{
    const seg=pendingTodoScope==="segment"?pendingTodoSegmentIndex:null;
    const raw=seg==null?null:dua.segments[seg],s=typeof raw==="string"?{latin:raw}:raw;
    const title=seg==null?dua.title:dua.title+" — Bölüm "+(seg+1);
    const scopeLabel=seg==null?dua.category:(s?.latin||s?.turkish||"").slice(0,90);
    todos.push({
      id:"todo-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),
      duaId:dua.id,segmentIndex:seg,title,scopeLabel,
      description:$("#todoDescription").value.trim(),target,
      schedule:{mode,startDate:start,endDate},history:{},createdAt:new Date().toISOString()
    });
  }

  saveTodos();$("#todoDialog").close();
  pendingTodoSegmentIndex=null;pendingListeningTodo=null;pendingTodoScope=null;
  updateHomeTodoCount();
  if(state.currentView==="todo")renderTodo();
  else if(state.currentView==="dua"&&state.settings.mode==="read")renderRead();
  else if(state.currentView==="listening")renderListeningAll();
}
function addTodoProgress(scope){const k=todayKey(),now=new Date().toISOString();todos.forEach(t=>{if(t.duaId!==dua.id||!todoOccursOn(t,k))return;if(scope==="dua"&&t.segmentIndex!=null)return;if(scope==="segment"&&t.segmentIndex!==index)return;t.history=t.history||{};const h=t.history[k]||(t.history[k]={count:0,completedAt:null});if(h.completedAt)return;h.count=(h.count||0)+1;if(h.count>=t.target)h.completedAt=now});saveTodos();updateHomeTodoCount();if(state.currentView==="todo")renderTodo()}
if($("#homeListeningBtn"))$("#homeListeningBtn").onclick=openListening;
$("#listeningMenuBtn").onclick=openHome;
if($("#homeIlmihalBtn"))$("#homeIlmihalBtn").onclick=()=>openIlmihal();
$("#ilmihalMenuBackBtn").onclick=openHome;
$("#ilmihalTopicsBtn").onclick=()=>openIlmihal();
$("#ilmihalPrevBtn").onclick=()=>moveIlmihal(-1);
$("#ilmihalNextBtn").onclick=()=>moveIlmihal(1);
function ilmihalTopicList(){const out=[];ilmihalData.sections.forEach((sec,si)=>sec.topics.forEach((t,ti)=>out.push({key:si+":"+ti,sec,item:t})));return out}
function moveIlmihal(step){const all=ilmihalTopicList(),i=all.findIndex(x=>x.key===state.ilmihalTopic),n=i+step;if(i>=0&&n>=0&&n<all.length)openIlmihal(all[n].key)}
function updateIlmihalPager(topic){const pager=$("#ilmihalPager");if(!topic){pager.classList.add("hidden");return}const all=ilmihalTopicList(),i=all.findIndex(x=>x.key===topic);pager.classList.remove("hidden");$("#ilmihalPrevBtn").disabled=i<=0;$("#ilmihalNextBtn").disabled=i<0||i>=all.length-1}
function openIlmihal(topic=null){hideDuaFloatingPlayer();$("#fullscreenTasbihBtn").classList.add("hidden");closeFullscreenTasbih();clearQuickCount();$("#progress").textContent="";state.currentView="ilmihal";state.ilmihalTopic=topic;$("#homeView").classList.add("hidden");$("#todoView").classList.add("hidden");$("#memorizeView").classList.add("hidden");$("#readView").classList.add("hidden");$("#libraryView").classList.add("hidden");$("#listeningView").classList.add("hidden");$(".navigation").classList.add("hidden");counter.classList.add("hidden");$("#ilmihalView").classList.remove("hidden");const box=$("#ilmihalContent");updateIlmihalPager(topic);$("#ilmihalTopicsBtn").classList.toggle("hidden",!topic);if(topic){const [si,ti]=topic.split(":").map(Number),sec=ilmihalData.sections[si],item=sec?.topics?.[ti];$("#ilmihalTitle").textContent=item?.title||sec?.title||ilmihalData.title||"";box.innerHTML='<article class="ilmihal-article">'+(item?.body||[]).map(p=>'<p>'+escapeHtml(p)+'</p>').join("")+(item?.list?'<ul>'+item.list.map(x=>'<li>'+escapeHtml(x)+'</li>').join("")+'</ul>':"")+(item?.steps?'<ol>'+item.steps.map(x=>'<li>'+escapeHtml(x)+'</li>').join("")+'</ol>':"")+'<div class="ilmihal-source">'+escapeHtml(ilmihalData.source)+'</div></article>';}else{$("#ilmihalTitle").textContent=ilmihalData.title;box.innerHTML='<p class="ilmihal-intro">Temel ve ayrıntılı ilmihal konuları</p>'+ilmihalData.sections.map((sec,si)=>'<section class="ilmihal-section"><h3>'+escapeHtml(sec.title)+'</h3>'+sec.topics.map((t,ti)=>'<button class="library-card ilmihal-topic" data-topic="'+si+':'+ti+'"><strong>'+escapeHtml(t.title)+'</strong><span>›</span></button>').join("")+'</section>').join("");box.querySelectorAll(".ilmihal-topic").forEach(b=>b.onclick=()=>openIlmihal(b.dataset.topic));}save()}
const HOME_ORDER_KEY="duaHomeMenuOrder";
const LIBRARY_ORDERS_KEY="duaLibraryOrders";
const HIDDEN_HOME_KEY="duaHiddenHomeMenuItems";
const HIDDEN_LIBRARY_KEY="duaHiddenLibraryItems";

function readJsonStorage(key,fallback){
  try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}
}
function hiddenHomeItems(){return new Set(readJsonStorage(HIDDEN_HOME_KEY,[]))}
function hiddenLibraryItems(){return readJsonStorage(HIDDEN_LIBRARY_KEY,{})||{}}
function saveHiddenHome(set){localStorage.setItem(HIDDEN_HOME_KEY,JSON.stringify([...set]))}
function saveHiddenLibrary(obj){localStorage.setItem(HIDDEN_LIBRARY_KEY,JSON.stringify(obj))}
function isLibraryItemHidden(cat,key){return (hiddenLibraryItems()[cat]||[]).includes(key)}
function setHomeItemHidden(key,hidden){
  const set=hiddenHomeItems();
  if(hidden)set.add(key);else set.delete(key);
  saveHiddenHome(set);
}
function setLibraryItemHidden(cat,key,hidden){
  const all=hiddenLibraryItems(),set=new Set(all[cat]||[]);
  if(hidden)set.add(key);else set.delete(key);
  all[cat]=[...set];
  saveHiddenLibrary(all);
}
function closeOtherSwipeRows(except=null){
  document.querySelectorAll(".swipe-row.swipe-open").forEach(row=>{
    if(row===except)return;
    row.classList.remove("swipe-open");
    const item=row.querySelector(".swipe-main");
    if(item)item.style.transform="";
  });
}
function showMenuUndo(label,undo){
  let bar=$("#menuUndoBar");
  if(!bar){
    bar=document.createElement("div");
    bar.id="menuUndoBar";
    bar.className="menu-undo-bar";
    document.body.appendChild(bar);
  }
  clearTimeout(showMenuUndo.timer);
  bar.innerHTML='<span>'+escapeHtml(label)+' gizlendi</span><button type="button">Geri al</button>';
  bar.classList.add("show");
  bar.querySelector("button").onclick=()=>{bar.classList.remove("show");undo?.()};
  showMenuUndo.timer=setTimeout(()=>bar.classList.remove("show"),4500);
}
function wrapSwipeRows(container,selector,keyFn,onHide){
  if(!container)return;
  [...container.querySelectorAll(selector)].forEach(item=>{
    if(item.closest(".swipe-row"))return;
    const key=String(keyFn(item)||"");
    if(!key)return;
    const row=document.createElement("div");
    row.className="swipe-row";
    row.dataset.menuKey=key;
    const label=item.querySelector("strong")?.textContent?.trim()||item.textContent.trim();
    item.parentNode.insertBefore(row,item);
    row.appendChild(item);
    item.classList.add("swipe-main");

    const del=document.createElement("button");
    del.type="button";
    del.className="swipe-delete-action";
    del.setAttribute("aria-label",label+" menüden gizle");
    del.innerHTML='<span aria-hidden="true">🗑</span>';
    row.appendChild(del);

    let pointer=null,startX=0,startY=0,swiping=false,moved=false;
    item.addEventListener("pointerdown",e=>{
      if(e.button!=null&&e.button!==0)return;
      pointer=e.pointerId;startX=e.clientX;startY=e.clientY;swiping=false;moved=false;
      closeOtherSwipeRows(row);
    });
    item.addEventListener("pointermove",e=>{
      if(e.pointerId!==pointer)return;
      const dx=e.clientX-startX,dy=e.clientY-startY;
      if(!swiping&&Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.25)swiping=true;
      if(!swiping)return;
      moved=true;
      e.preventDefault();
      const x=Math.max(-78,Math.min(0,dx));
      item.style.transform="translateX("+x+"px)";
    });
    const finish=e=>{
      if(e.pointerId!==pointer)return;
      const dx=e.clientX-startX;
      if(swiping&&dx<-38){
        row.classList.add("swipe-open");
        item.style.transform="translateX(-78px)";
      }else{
        row.classList.remove("swipe-open");
        item.style.transform="";
      }
      if(moved){
        item.dataset.suppressClick="1";
        setTimeout(()=>item.dataset.suppressClick="0",160);
      }
      pointer=null;swiping=false;moved=false;
    };
    item.addEventListener("pointerup",finish);
    item.addEventListener("pointercancel",e=>{
      if(e.pointerId!==pointer)return;
      row.classList.remove("swipe-open");item.style.transform="";
      pointer=null;swiping=false;moved=false;
    });
    item.addEventListener("click",e=>{
      if(item.dataset.suppressClick==="1"){e.preventDefault();e.stopImmediatePropagation()}
    },true);
    del.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      onHide(key,row,item,label);
    };
  });
}
function homeMenuKey(el){return el.dataset.category?"cat:"+el.dataset.category:(el.id||el.textContent.trim())}
function applyHomeMenuOrder(){
  const menu=document.querySelector(".home-menu");if(!menu)return;
  let order=[];try{order=JSON.parse(localStorage.getItem(HOME_ORDER_KEY)||"[]")}catch{}
  const items=[...menu.querySelectorAll(".home-card")],byKey=new Map(items.map(el=>[homeMenuKey(el),el]));
  const move=el=>menu.appendChild(el.closest(".swipe-row")||el);
  for(const key of order){const el=byKey.get(key);if(el){move(el);byKey.delete(key)}}
  for(const el of items){if(byKey.has(homeMenuKey(el)))move(el)}
}
function saveHomeMenuOrder(){
  const menu=document.querySelector(".home-menu");if(!menu)return;
  const cards=[...menu.querySelectorAll(":scope > .swipe-row > .home-card, :scope > .home-card")];
  localStorage.setItem(HOME_ORDER_KEY,JSON.stringify(cards.map(homeMenuKey)))
}
function libraryOrders(){try{return JSON.parse(localStorage.getItem(LIBRARY_ORDERS_KEY)||"{}")||{}}catch{return{}}}
function saveLibraryOrder(cat,list){
  const all=libraryOrders();all[cat]=[...list.querySelectorAll(".library-card[data-dua-id]")].map(el=>el.dataset.duaId);
  localStorage.setItem(LIBRARY_ORDERS_KEY,JSON.stringify(all))
}
function saveLibraryMenuOrder(cat,list){
  const all=libraryOrders();
  all[cat]=[...list.querySelectorAll(":scope > .swipe-row")].map(row=>row.dataset.menuKey).filter(Boolean);
  localStorage.setItem(LIBRARY_ORDERS_KEY,JSON.stringify(all));
}
function applyLibraryMenuOrder(cat,list){
  const order=libraryOrders()[cat]||[],rank=new Map(order.map((key,i)=>[key,i]));
  const rows=[...list.querySelectorAll(":scope > .swipe-row")];
  rows.sort((a,b)=>(rank.has(a.dataset.menuKey)?rank.get(a.dataset.menuKey):999999)-(rank.has(b.dataset.menuKey)?rank.get(b.dataset.menuKey):999999));
  rows.forEach(row=>list.appendChild(row));
}
function setupLibraryMenuInteractions(cat,list){
  wrapSwipeRows(list,'.library-card[data-dua-id]',el=>el.dataset.menuKey||el.dataset.duaId,(key,row,item,label)=>{
    setLibraryItemHidden(cat,key,true);
    row.classList.add("menu-item-hidden");
    showMenuUndo(label,()=>{
      setLibraryItemHidden(cat,key,false);
      row.classList.remove("menu-item-hidden","swipe-open");
      item.style.transform="";
    });
  });
  applyLibraryMenuOrder(cat,list);
  list.querySelectorAll(":scope > .swipe-row").forEach(row=>row.classList.toggle("menu-item-hidden",isLibraryItemHidden(cat,row.dataset.menuKey)));
  bindLongPressReorder(list,'.swipe-row',()=>saveLibraryMenuOrder(cat,list));
}

function bindLongPressReorder(container,selector,onSave){
  if(!container)return;
  container.querySelectorAll(selector).forEach(item=>{
    if(item.dataset.reorderBound==="1")return;
    item.dataset.reorderBound="1";
    let timer=null,dragging=false,pointerId=null,startX=0,startY=0;
    item.addEventListener("click",e=>{if(item.dataset.suppressClick==="1"){e.preventDefault();e.stopImmediatePropagation();item.dataset.suppressClick="0"}},true);
    item.addEventListener("pointerdown",e=>{
      if(e.button!=null&&e.button!==0)return;
      pointerId=e.pointerId;startX=e.clientX;startY=e.clientY;dragging=false;
      timer=setTimeout(()=>{timer=null;dragging=true;item.classList.add("reorder-dragging","reorder-ready");try{item.setPointerCapture(pointerId)}catch{}},550)
    });
    item.addEventListener("pointermove",e=>{
      if(e.pointerId!==pointerId)return;
      if(timer&&Math.hypot(e.clientX-startX,e.clientY-startY)>8){clearTimeout(timer);timer=null}
      if(!dragging)return;
      e.preventDefault();
      const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest(selector);
      if(!hit||hit===item||hit.parentElement!==container)return;
      const r=hit.getBoundingClientRect();
      if(e.clientY<r.top+r.height/2)container.insertBefore(item,hit);else container.insertBefore(item,hit.nextSibling)
    });
    const finish=e=>{
      if(e.pointerId!==pointerId)return;
      if(timer){clearTimeout(timer);timer=null}
      if(dragging){dragging=false;item.classList.remove("reorder-dragging","reorder-ready");item.dataset.suppressClick="1";onSave?.();setTimeout(()=>{item.dataset.suppressClick="0"},120)}
      try{if(item.hasPointerCapture?.(pointerId))item.releasePointerCapture(pointerId)}catch{}
      pointerId=null
    };
    item.addEventListener("pointerup",finish);item.addEventListener("pointercancel",finish)
  })
}
function setupHomeMenuInteractions(){
  applyHomeMenuOrder();
  const menu=document.querySelector(".home-menu");if(!menu)return;
  wrapSwipeRows(menu,".home-card",homeMenuKey,(key,row,item,label)=>{
    setHomeItemHidden(key,true);
    row.classList.add("menu-item-hidden");
    showMenuUndo(label,()=>{
      setHomeItemHidden(key,false);
      row.classList.remove("menu-item-hidden","swipe-open");
      item.style.transform="";
    });
  });
  const hidden=hiddenHomeItems();
  menu.querySelectorAll(".swipe-row").forEach(row=>row.classList.toggle("menu-item-hidden",hidden.has(row.dataset.menuKey)));
  bindLongPressReorder(menu,".swipe-row",saveHomeMenuOrder);
}
function libraryItemOrderKey(d){
  if(d.category==="surahs")return d.extra?"extra:"+d.id:"surah:"+d.surahNo;
  return d.id
}
function applyLibraryOrder(cat,items){
  const order=libraryOrders()[cat]||[],rank=new Map(order.map((id,i)=>[id,i]));
  return [...items].sort((x,y)=>(rank.has(libraryItemOrderKey(x))?rank.get(libraryItemOrderKey(x)):999999)-(rank.has(libraryItemOrderKey(y))?rank.get(libraryItemOrderKey(y)):999999))
}
function categoryItems(cat){
  const items=data.duas.filter(d=>d.category===cat);
  if(cat==="surahs")return applyLibraryOrder(cat,items.filter(d=>!d.extra).sort((x,y)=>(x.surahNo||999)-(y.surahNo||999)));
  return applyLibraryOrder(cat,items)
}
function openDua(d){closeFullscreenTasbih();clearQuickCount();dua=d;index=0;state.duaId=d.id;state.settings.mode=isEsmaNameDua(d)?"memorize":"read";if($("#duaSectionRepeatCount"))$("#duaSectionRepeatCount").value="1";if($("#duaLinkedPlayerShell"))setDuaVideoVisible(false);render();applyMode();if(state.settings.mode==="read")$("#readView").scrollTop=0}
function updateDuaPager(){const items=categoryItems(dua.category),i=items.findIndex(d=>d.id===dua.id);$("#duaPrevBtn").disabled=i<=0;$("#duaNextBtn").disabled=i<0||i>=items.length-1}
function moveDua(step){const items=categoryItems(dua.category),i=items.findIndex(d=>d.id===dua.id),n=i+step;if(i>=0&&n>=0&&n<items.length)openDua(items[n])}
$("#duaPrevBtn").onclick=()=>moveDua(-1);$("#duaNextBtn").onclick=()=>moveDua(1);
function openCategory(cat){
  hideDuaFloatingPlayer();$("#fullscreenTasbihBtn").classList.add("hidden");closeFullscreenTasbih();clearQuickCount();$("#progress").textContent="";
  state.currentView="library";$("#homeView").classList.add("hidden");$("#todoView").classList.add("hidden");$("#ilmihalView").classList.add("hidden");
  state.libraryCategory=cat;$("#listeningView").classList.add("hidden");$("#memorizeView").classList.add("hidden");$("#readView").classList.add("hidden");
  $(".navigation").classList.add("hidden");counter.classList.add("hidden");$("#libraryView").classList.remove("hidden");$("#libraryPageTitle").textContent=categoryTitle(cat);
  const list=$("#libraryPageList");list.innerHTML="";
  const appendCard=(d,label,meta,extraClass="",menuKey=null)=>{
    const b=document.createElement("button");b.className=("library-card "+extraClass).trim();
    if(d){b.dataset.duaId=d.id;b.dataset.menuKey=menuKey||d.id;}
    b.innerHTML="<strong>"+escapeHtml(label)+"</strong><span>"+escapeHtml(meta)+"</span>";
    if(d)b.onclick=()=>openDua(d);else b.disabled=true;
    list.appendChild(b);return b
  };
  if(cat==="surahs"){
    const full=categoryItems(cat);
    for(const d of full){
      appendCard(d,(d.surahNo?d.surahNo+". ":"")+d.title,d.segments.length+" bölüm","",libraryItemOrderKey(d))
    }
    const featured=data.duas.filter(d=>d.category==="surahs"&&d.featured&&!d.extra).sort((a,b)=>a.featuredOrder-b.featuredOrder);
    const extras=data.duas.filter(d=>d.category==="surahs"&&d.extra).sort((a,b)=>a.sortOrder-b.sortOrder);
    if(featured.length||extras.length){
      const head=document.createElement("div");head.className="library-subheading";head.textContent=data.surahExtraTitle||"";list.appendChild(head);
      featured.forEach(d=>appendCard(d,d.featuredLabel||d.title,d.segments.length+" bölüm","surah-featured","featured:"+d.id));
      extras.forEach(d=>appendCard(d,d.title,d.segments.length+" bölüm","surah-featured",libraryItemOrderKey(d)))
    }
    const src=data.quranSource;
    if(src){
      const source=document.createElement("div");
      source.className="quran-source-note";
      const parts=[src.arabic,src.transliteration,src.turkish].filter(Boolean).map(escapeHtml);
      source.innerHTML=(data.sourceLabel?escapeHtml(data.sourceLabel)+": ":"")+parts.join(" · ");
      list.appendChild(source);
    }
  }else{
    categoryItems(cat).forEach(d=>appendCard(d,d.title,d.target?d.target+" tekrar":d.segments.length+" bölüm"));
  }
  setupLibraryMenuInteractions(cat,list);
  save()
}$("#backContentBtn").onclick=openHome;$("#readMenuBtn").onclick=openHome;$("#backLibraryBtn").onclick=()=>openCategory(dua.category);$("#memorizeMenuBtn").onclick=openHome;$("#memorizeThisBtn").onclick=()=>{clearQuickCount();state.settings.mode="memorize";index=0;render();applyMode()};$("#memorizeHeaderModeBtn").onclick=()=>{};$("#memorizeHeaderBackBtn").onclick=()=>{
  if(isEsmaNameDua()){openCategory("asma");return}
  const ret=state.readerReturn&&state.readerReturn.duaId===dua.id?{...state.readerReturn}:null;
  state.settings.mode="read";
  render();applyMode();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(ret&&Number.isFinite(Number(ret.scrollY))){
      window.scrollTo({top:Number(ret.scrollY),behavior:"auto"});
    }else if(ret&&Number.isInteger(ret.segmentIndex)){
      document.querySelector('[data-open-segment="'+ret.segmentIndex+'"]')?.scrollIntoView({block:"center",behavior:"auto"});
    }
  }));
  save();
};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).close());
if($("#resetBtn"))$("#resetBtn").onclick=()=>{if(state.settings.mode==="read"){state.readCounts[dua.id]=0;applyMode()}else{counts[key()]=0;render()}};
$("#themeToggle").onclick=()=>{state.settings.dark=!state.settings.dark;applySettings();save()};
$("#restoreHiddenMenusBtn").onclick=()=>{
  localStorage.removeItem(HIDDEN_HOME_KEY);
  localStorage.removeItem(HIDDEN_LIBRARY_KEY);
  document.querySelectorAll(".menu-item-hidden").forEach(el=>el.classList.remove("menu-item-hidden"));
  if(state.currentView==="library"&&state.libraryCategory)openCategory(state.libraryCategory);
  $("#settingsDialog").close();
};
function toggleTextMode(key){const on=["showArabic","showLatin","showTurkish"].filter(k=>state.settings[k]).length;if(state.settings[key]&&on===1)return;state.settings[key]=!state.settings[key];applySettings();renderRead();save()}
$("#arabicToggle").onclick=()=>toggleTextMode("showArabic");
$("#latinToggle").onclick=()=>toggleTextMode("showLatin");
$("#turkishToggle").onclick=()=>toggleTextMode("showTurkish");
$("#notesToggle").onclick=()=>{state.settings.showNotes=!state.settings.showNotes;applySettings();render();renderRead();save()};
$("#fontDown").onclick=()=>setFont(state.settings.fontSize-3);$("#fontUp").onclick=()=>setFont(state.settings.fontSize+3);$("#fontReset").onclick=()=>setFont(32);
function setFont(n){state.settings.fontSize=Math.max(20,Math.min(52,n));applySettings();save()}
const counter=$("#counter");let timer=null,dragging=false,startX=0,startY=0,offsetX=0,offsetY=0,counterResetShown=false,counterPointerActive=false,counterPointerId=null,pendingSmallReset=null;
function hideCounterResetPopover(){
  const p=$("#counterResetPopover");if(!p)return;
  p.classList.add("hidden");counterResetShown=false;pendingSmallReset=null;
}
function showCounterResetPopover(){
  const p=$("#counterResetPopover");if(!p)return;
  pendingSmallReset=null;
  const r=counter.getBoundingClientRect();
  p.classList.remove("hidden");
  const pr=p.getBoundingClientRect();
  const left=Math.max(8,Math.min(innerWidth-pr.width-8,r.left+r.width/2-pr.width/2));
  let top=r.top-pr.height-8;
  if(top<8)top=Math.min(innerHeight-pr.height-8,r.bottom+8);
  p.style.left=left+"px";p.style.top=top+"px";
  counterResetShown=true;
}
function showSmallCounterResetPopover(button,type,segmentIndex){
  const p=$("#counterResetPopover");if(!p||!button)return;
  pendingSmallReset={type,segmentIndex};
  const r=button.getBoundingClientRect();
  p.classList.remove("hidden");
  const pr=p.getBoundingClientRect();
  const left=Math.max(8,Math.min(innerWidth-pr.width-8,r.left+r.width/2-pr.width/2));
  let top=r.top-pr.height-8;
  if(top<8)top=Math.min(innerHeight-pr.height-8,r.bottom+8);
  p.style.left=left+"px";p.style.top=top+"px";
  counterResetShown=true;
}
function resetSmallCounter(ctx){
  if(!ctx)return;
  const i=Number(ctx.segmentIndex),k=todayKey();
  if(ctx.type==="segmentRepeat"){
    counts[segmentKey(i)]=0;
    if(activeQuickCount?.type==="segmentRepeat"&&activeQuickCount.segmentIndex===i)activeQuickCount={type:"segmentRepeat",segmentIndex:i};
  }else if(ctx.type==="todoSegment"){
    const t=currentTodoTask("segment",i,k);
    if(t){
      t.history=t.history||{};
      t.history[k]={count:0,completedAt:null};
      saveTodos();
    }
  }
  renderRead();updateCounterDisplay();updateTodoProgressDisplay();save();
  hideCounterResetPopover();
}
function bindSmallCounterPress(button,type,segmentIndex){
  let holdTimer=null,held=false,startX=0,startY=0;
  button.addEventListener("pointerdown",e=>{
    e.stopPropagation();held=false;startX=e.clientX;startY=e.clientY;
    holdTimer=setTimeout(()=>{holdTimer=null;held=true;showSmallCounterResetPopover(button,type,segmentIndex)},550);
  });
  button.addEventListener("pointermove",e=>{
    if(holdTimer&&Math.hypot(e.clientX-startX,e.clientY-startY)>8){clearTimeout(holdTimer);holdTimer=null}
  });
  button.addEventListener("pointerup",e=>{
    e.stopPropagation();
    if(holdTimer){clearTimeout(holdTimer);holdTimer=null;toggleQuickCount(type,segmentIndex)}
    else if(held){e.preventDefault();held=false}
  });
  ["pointercancel","pointerleave"].forEach(ev=>button.addEventListener(ev,e=>{
    e.stopPropagation();if(holdTimer){clearTimeout(holdTimer);holdTimer=null}
  }));
  button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation()});
}
function resetActiveCounter(){
  const quick=quickCountInfo();
  if(state.settings.mode==="read"&&quick){
    if(quick.type==="segmentRepeat"){
      counts[segmentKey(quick.segmentIndex)]=0;
    }else if(quick.type==="todoSegment"&&quick.task){
      const k=todayKey();quick.task.history=quick.task.history||{};quick.task.history[k]={count:0,completedAt:null};saveTodos();
    }
    renderRead();updateCounterDisplay();updateTodoProgressDisplay();save();
  }else if(state.settings.mode==="read"){
    state.readCounts[dua.id]=0;renderRead();updateCounterDisplay();updateTodoProgressDisplay();save();
  }else{
    counts[key()]=0;render();updateCounterDisplay();updateTodoProgressDisplay();save();
  }
  renderFullscreenTasbih();hideCounterResetPopover();
}
function finishCounterPointer(e,cancelled=false){
  if(!counterPointerActive||e.pointerId!==counterPointerId)return;
  if(timer){clearTimeout(timer);timer=null}
  const wasDragging=dragging;
  dragging=false;
  counterPointerActive=false;
  counterPointerId=null;
  counter.classList.remove("dragging");
  try{if(counter.hasPointerCapture?.(e.pointerId))counter.releasePointerCapture(e.pointerId)}catch{}
  if(wasDragging){storeCounter();return}
  if(!cancelled&&!counterResetShown)incrementActiveCounter();
}
counter.addEventListener("pointerdown",e=>{
  if(counterPointerActive)return;
  counterPointerActive=true;
  counterPointerId=e.pointerId;
  try{counter.setPointerCapture(e.pointerId)}catch{}
  hideCounterResetPopover();dragging=false;counterResetShown=false;startX=e.clientX;startY=e.clientY;
  const r=counter.getBoundingClientRect();offsetX=e.clientX-r.left;offsetY=e.clientY-r.top;
  timer=setTimeout(()=>{timer=null;showCounterResetPopover()},550);
});
counter.addEventListener("pointermove",e=>{
  if(!counterPointerActive||e.pointerId!==counterPointerId)return;
  if(e.pointerType==="mouse"&&e.buttons===0){finishCounterPointer(e,true);return}
  const distance=Math.hypot(e.clientX-startX,e.clientY-startY);
  if(!dragging&&distance>8){
    if(timer){clearTimeout(timer);timer=null}
    hideCounterResetPopover();dragging=true;counter.classList.add("dragging");
  }
  if(dragging){
    e.preventDefault();
    moveCounter(e.clientX-offsetX,e.clientY-offsetY);
  }
});
counter.addEventListener("pointerup",e=>finishCounterPointer(e,false));
counter.addEventListener("pointercancel",e=>finishCounterPointer(e,true));
window.addEventListener("pointerup",e=>finishCounterPointer(e,false),true);
window.addEventListener("pointercancel",e=>finishCounterPointer(e,true),true);
window.addEventListener("blur",()=>{
  if(timer){clearTimeout(timer);timer=null}
  dragging=false;counterPointerActive=false;counterPointerId=null;counter.classList.remove("dragging");
});
$("#counterResetPopover").onclick=e=>{e.stopPropagation();const ctx=pendingSmallReset?{...pendingSmallReset}:null;if(ctx)resetSmallCounter(ctx);else resetActiveCounter()};
document.addEventListener("pointerdown",e=>{if(counterResetShown&&!counter.contains(e.target)&&!$("#counterResetPopover").contains(e.target))hideCounterResetPopover()});
function counterSafeTop(){let y=12;const globalHead=document.querySelector(".global-header");if(globalHead)y=Math.max(y,globalHead.getBoundingClientRect().bottom+12);if(state.currentView==="dua"&&state.settings.mode==="read"){const head=$("#readView .read-sticky-header");if(head&&!head.classList.contains("hidden"))y=Math.max(y,head.getBoundingClientRect().bottom+12)}return y}
function counterSafeBottom(){let bottom=12;if(state.currentView==="dua"&&state.settings.mode!=="read"){const nav=document.querySelector(".navigation");if(nav&&!nav.classList.contains("hidden"))bottom=Math.max(bottom,innerHeight-nav.getBoundingClientRect().top+12)}return bottom}
function moveCounter(x,y){const pad=12,w=counter.offsetWidth||78,h=counter.offsetHeight||78,minY=counterSafeTop(),bottom=counterSafeBottom(),maxY=Math.max(minY,innerHeight-h-bottom);x=Math.max(pad,Math.min(innerWidth-w-pad,x));y=Math.max(minY,Math.min(maxY,y));counter.style.right="auto";counter.style.bottom="auto";counter.style.left=x+"px";counter.style.top=y+"px"}
function defaultCounterPosition(){const pad=18,w=counter.offsetWidth||78,h=counter.offsetHeight||78,bottom=counterSafeBottom();return{x:Math.max(pad,innerWidth-w-pad),y:Math.max(counterSafeTop(),innerHeight-h-bottom)}}
function storeCounter(){const r=counter.getBoundingClientRect();localStorage.setItem("duaCounterPos",JSON.stringify({x:r.left,y:r.top}))}
function restoreCounter(){let restored=false;try{const p=JSON.parse(localStorage.getItem("duaCounterPos"));if(p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))){moveCounter(Number(p.x),Number(p.y));restored=true}}catch{}if(!restored){const p=defaultCounterPosition();moveCounter(p.x,p.y)}}
function keepCounterVisible(){restoreCounter()}

/* ---------- Dinleme / YouTube Loop Player ---------- */
let listeningPlayer=null,listeningPlayerReady=false,listeningCurrentVideoId="";
let listeningLoopActive=false,listeningLoopPaused=false,listeningLoopIteration=0,listeningWaiting=false;
let listeningLoopTimer=null,listeningRestartTimer=null,listeningEditingPresetId="";
let listeningPlayerCompact=localStorage.getItem("listeningPlayerCompact")==="1";
let listeningPlayerScale=Math.max(35,Math.min(100,Number(localStorage.getItem("listeningPlayerScale"))||65));
let listeningVideos=readListenStore("ylp_saved_videos",[]);
let listeningPresets=readListenStore("ylp_presets",[]);
let listeningHistory=readListenStore("ylp_history",readListenStore("ylp_recent",[]).map(x=>({videoId:x.videoId,title:"YouTube video · "+x.videoId,playedAt:x.updatedAt||Date.now()})));
let listeningLinks=readListenStore("duaListeningLinks",{});
let listeningAssignCategory="";

let duaLinkedPlayer=null,duaLinkedPlayerReady=false,duaLinkedMode="";
let duaLinkedVideoId="",duaLinkedPreset=null,duaLinkedIteration=0,duaLinkedTarget=1;
let duaLinkedTimer=null,duaLinkedFollowTimer=null,duaLinkedWaiting=false,duaLinkedActiveSegment=-1,duaLinkedPaused=false;
let duaPanelDragging=false,duaPanelDragStartY=0,duaPanelDragStartTop=0,duaLinkedSeekDragging=false;
let duaCompactDragTimer=null,duaCompactDragging=false,duaCompactPointerId=null,duaCompactStartX=0,duaCompactStartY=0,duaCompactOffsetX=0,duaCompactOffsetY=0,duaCompactSuppressClick=false,duaCompactEditing=false,duaCompactHoldOpenedSettings=false;

function readListenStore(k,f){try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}}
function writeListenStore(k,v){localStorage.setItem(k,JSON.stringify(v))}
function parseListenVideoId(input){
  const raw=String(input||"").trim();if(/^[a-zA-Z0-9_-]{11}$/.test(raw))return raw;
  try{const u=new URL(raw);if(u.hostname.includes("youtu.be"))return u.pathname.split("/").filter(Boolean)[0]||"";if(u.searchParams.get("v"))return u.searchParams.get("v");const p=u.pathname.split("/").filter(Boolean),m=p.findIndex(x=>["shorts","embed","live"].includes(x));if(m>=0)return p[m+1]||""}catch{}
  return "";
}
function parseListenTime(v){v=String(v||"").trim().replace(",",".");if(!v)return 0;if(/^\d+(\.\d+)?$/.test(v))return Math.max(0,Number(v));const p=v.split(":").map(Number);if(p.some(Number.isNaN))return NaN;if(p.length===2)return Math.max(0,p[0]*60+p[1]);if(p.length===3)return Math.max(0,p[0]*3600+p[1]*60+p[2]);return NaN}
function formatListenTime(sec){sec=Math.max(0,Number(sec)||0);const r=Math.round(sec*10)/10,w=Math.floor(r),f=Math.round((r-w)*10),s=w%60,m=Math.floor(w/60)%60,h=Math.floor(w/3600),st=String(s).padStart(2,"0")+(f?"."+f:"");return h?h+":"+String(m).padStart(2,"0")+":"+st:m+":"+st}
function listenPresetNumber(p){const n=Number(String(p?.title??"").trim());return Number.isInteger(n)&&n>0?n:Number.MAX_SAFE_INTEGER}
function listeningPresetsForVideo(id){return listeningPresets.filter(p=>(p.sourceType||"youtube")==="youtube"&&(p.sourceId||p.videoId)===id).sort((a,b)=>listenPresetNumber(a)-listenPresetNumber(b))}
function showListeningError(msg){$("#listeningError").textContent=msg||"";$("#listeningError").classList.toggle("hidden",!msg)}
function clampListenSpeed(v){const n=Number(v);return Number.isFinite(n)?Math.min(2,Math.max(.25,Math.round(n*100)/100)):1}

function saveListeningLinks(){writeListenStore("duaListeningLinks",listeningLinks)}
function linkedVideoForDua(duaId){
  const entry=Object.entries(listeningLinks).find(([,x])=>x?.duaId===duaId);
  if(!entry)return null;
  const [videoId,link]=entry;
  return{videoId,link,video:listeningVideos.find(v=>v.videoId===videoId)||null};
}
function linkedPresetForDuaSegment(duaId,sectionNumber){
  const linked=linkedVideoForDua(duaId);
  if(!linked)return null;
  return listeningPresetsForVideo(linked.videoId).find(p=>listenPresetNumber(p)===Number(sectionNumber))||null;
}
function linkedDuaForVideo(videoId){
  const link=listeningLinks[videoId];
  return link?data?.duas?.find(d=>d.id===link.duaId)||null:null;
}
function renderListeningLinkStatus(){
  const btn=$("#listeningAssignBtn"),status=$("#listeningLinkStatus");
  if(!btn||!status)return;
  btn.disabled=!listeningCurrentVideoId;
  if(!listeningCurrentVideoId){status.textContent="Önce bir video aç.";return}
  const d=linkedDuaForVideo(listeningCurrentVideoId);
  const count=listeningPresetsForVideo(listeningCurrentVideoId).filter(p=>Number.isFinite(listenPresetNumber(p))&&listenPresetNumber(p)!==Number.MAX_SAFE_INTEGER).length;
  status.textContent=d?(d.title+" ile eşleşti · "+count+" numaralı bölüm otomatik eşleşir"):"Bu video henüz bir içerikle eşleşmedi.";
}
function openListeningAssignDialog(){
  if(!listeningCurrentVideoId){showListeningError("Önce bir video aç.");return}
  listeningAssignCategory="";
  renderListeningAssignCategories();
  const current=linkedDuaForVideo(listeningCurrentVideoId);
  $("#listeningUnassignBtn").classList.toggle("hidden",!current);
  $("#listeningAssignDialog").showModal();
}
function renderListeningAssignCategories(){
  const cats=[...new Set((data?.duas||[]).map(d=>d.category).filter(Boolean))];
  $("#listeningAssignTitle").textContent="Dua / sûre ile eşleştir";
  $("#listeningAssignHint").textContent="Önce kategori seç.";
  $("#listeningAssignCategories").classList.remove("hidden");
  $("#listeningAssignItems").classList.add("hidden");
  $("#listeningAssignBack").classList.add("hidden");
  $("#listeningAssignCategories").innerHTML=cats.map(c=>'<button class="library-card" data-listen-assign-cat="'+escapeHtml(c)+'"><strong>'+escapeHtml(c)+'</strong><span>›</span></button>').join("");
  $("#listeningAssignCategories").querySelectorAll("[data-listen-assign-cat]").forEach(b=>b.onclick=()=>renderListeningAssignItems(b.dataset.listenAssignCat));
}
function renderListeningAssignItems(category){
  listeningAssignCategory=category;
  const items=(data?.duas||[]).filter(d=>d.category===category);
  $("#listeningAssignHint").textContent=category+" içinden seç.";
  $("#listeningAssignCategories").classList.add("hidden");
  $("#listeningAssignItems").classList.remove("hidden");
  $("#listeningAssignBack").classList.remove("hidden");
  $("#listeningAssignItems").innerHTML=items.map(d=>'<button class="library-card" data-listen-assign-dua="'+d.id+'"><strong>'+escapeHtml(d.title)+'</strong><span>'+d.segments.length+' bölüm</span></button>').join("");
  $("#listeningAssignItems").querySelectorAll("[data-listen-assign-dua]").forEach(b=>b.onclick=()=>assignListeningVideoToDua(b.dataset.listenAssignDua));
}
function assignListeningVideoToDua(duaId){
  if(!listeningCurrentVideoId)return;
  Object.keys(listeningLinks).forEach(videoId=>{if(listeningLinks[videoId]?.duaId===duaId&&videoId!==listeningCurrentVideoId)delete listeningLinks[videoId]});
  listeningLinks[listeningCurrentVideoId]={duaId,linkedAt:new Date().toISOString()};
  saveListeningLinks();
  $("#listeningAssignDialog").close();
  renderListeningLinkStatus();
  renderRead();
}
function unassignListeningVideo(){
  if(!listeningCurrentVideoId)return;
  delete listeningLinks[listeningCurrentVideoId];
  saveListeningLinks();
  $("#listeningAssignDialog").close();
  renderListeningLinkStatus();
  renderRead();
}

function ensureDuaLinkedPlayer(){
  if(duaLinkedPlayer)return;
  if(!(window.YT&&YT.Player))return;
  duaLinkedPlayer=new YT.Player("duaLinkedPlayer",{width:"100%",height:"100%",videoId:"",playerVars:{playsinline:1,rel:0,modestbranding:1},events:{
    onReady:()=>{
      duaLinkedPlayerReady=true;
      const linked=dua?linkedVideoForDua(dua.id):null;
      if(linked)prepareDuaLinkedVideo(linked.videoId);
      updateDuaLinkedCompactUI();
    },
    onStateChange:e=>{
      updateDuaLinkedToggleButton();
      updateDuaLinkedCompactUI();
      if(e.data===YT.PlayerState.ENDED){
        if(duaLinkedMode==="section"&&duaLinkedPreset)handleDuaLinkedBoundary();
        else if(duaLinkedMode==="full"){
          duaLinkedMode="";duaLinkedPaused=false;stopDuaLinkedFollow();
          $("#duaLinkedPlayStatus").textContent="Tamamlandı ✓";
          updateDuaLinkedToggleButton();updateDuaLinkedCompactUI();
        }
      }
    }
  }});
}
function prepareDuaLinkedVideo(videoId){
  if(!videoId)return false;
  duaLinkedVideoId=videoId;
  ensureDuaLinkedPlayer();
  if(!duaLinkedPlayerReady||!duaLinkedPlayer)return false;
  try{
    const currentId=duaLinkedPlayer.getVideoData?.().video_id||"";
    if(currentId!==videoId)duaLinkedPlayer.cueVideoById(videoId);
  }catch{}
  return true;
}
function enableDuaLinkedSound(){
  if(!duaLinkedPlayerReady||!duaLinkedPlayer)return;
  try{duaLinkedPlayer.unMute?.()}catch{}
  try{duaLinkedPlayer.setVolume?.(100)}catch{}
}
function renderDuaListeningPanel(){
  const panel=$("#duaListeningPanel");if(!panel||!dua)return;
  const linked=linkedVideoForDua(dua.id);
  panel.classList.toggle("hidden",!linked);
  $("#readView").classList.toggle("has-dua-listening",!!linked);
  if(!linked)return;
  const matched=listeningPresetsForVideo(linked.videoId).filter(p=>{const n=listenPresetNumber(p);return n>=1&&n<=dua.segments.length}).length;
  $("#duaListeningVideoTitle").textContent=linked.video?.title||"Eşleşen video";
  $("#duaListeningMatchInfo").textContent=matched+" / "+dua.segments.length+" bölüm eşleşti";
  if(!Number($("#duaSectionRepeatCount").value)||Number($("#duaSectionRepeatCount").value)<1)$("#duaSectionRepeatCount").value="1";
  prepareDuaLinkedVideo(linked.videoId);
  setDuaVideoVisible(false);
  panel.classList.add("player-collapsed");
  localStorage.setItem("duaPlayerCollapsed","1");
  $("#duaSectionRepeatCount").readOnly=true;
  syncDuaCompactSettings();
  updateDuaLinkedToggleButton();
  updateDuaLinkedCompactUI();
  if(!$("#readView").classList.contains("hidden")){
    requestAnimationFrame(()=>{
      restoreDuaCompactPosition();
      syncDuaPlayerClearance();
    });
  }
}
function duaListeningPanelBounds(){
  const panel=$("#duaListeningPanel"),header=document.querySelector(".global-header");
  const headerBottom=header?.getBoundingClientRect().bottom||0;
  const panelHeight=panel?.offsetHeight||220;
  const visibleGrip=46;
  const minTop=headerBottom-panelHeight+visibleGrip;
  const maxTop=Math.max(headerBottom+8,window.innerHeight-visibleGrip);
  return{minTop,maxTop};
}
function setDuaListeningPanelTop(top,savePos=false){
  const panel=$("#duaListeningPanel");if(!panel)return;
  const {minTop,maxTop}=duaListeningPanelBounds();
  const y=Math.max(minTop,Math.min(maxTop,Number(top)||minTop));
  panel.style.top=y+"px";
  if(savePos)localStorage.setItem("duaListeningPanelTop",String(y));
}
function restoreDuaListeningPanelPosition(){
  const panel=$("#duaListeningPanel");if(!panel||panel.classList.contains("hidden"))return;
  const saved=Number(localStorage.getItem("duaListeningPanelTop"));
  if(Number.isFinite(saved))setDuaListeningPanelTop(saved,false);
  else{
    const readHead=$("#readView .read-sticky-header");
    const base=(readHead?.getBoundingClientRect().bottom||document.querySelector(".global-header")?.getBoundingClientRect().bottom||0)+10;
    setDuaListeningPanelTop(base,false);
  }
}
function positionActiveTextBelowDuaVideo(item){
  const panel=$("#duaListeningPanel");if(!panel||panel.classList.contains("hidden")||!item)return;
  const pr=panel.getBoundingClientRect(),ir=item.getBoundingClientRect(),wanted=Math.min(window.innerHeight-80,pr.bottom+10);
  if(ir.top<wanted-6)window.scrollBy({top:ir.top-wanted,behavior:"smooth"});
}
function beginDuaPanelDrag(e){
  const panel=$("#duaListeningPanel");if(!panel)return;
  duaPanelDragging=true;duaPanelDragStartY=e.clientY;duaPanelDragStartTop=panel.getBoundingClientRect().top;
  try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}
  panel.classList.add("dragging");
}
function moveDuaPanelDrag(e){
  if(!duaPanelDragging)return;
  setDuaListeningPanelTop(duaPanelDragStartTop+(e.clientY-duaPanelDragStartY),false);
}
function endDuaPanelDrag(e){
  if(!duaPanelDragging)return;
  duaPanelDragging=false;
  const panel=$("#duaListeningPanel");panel?.classList.remove("dragging");
  if(panel)localStorage.setItem("duaListeningPanelTop",String(panel.getBoundingClientRect().top));
  try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}
}
function setDuaVideoVisible(){
  const shell=$("#duaLinkedPlayerShell"),panel=$("#duaListeningPanel");if(!shell)return;
  shell.classList.add("hidden");
  panel?.classList.remove("video-visible");
  requestAnimationFrame(()=>{syncDuaPlayerClearance();if(panel?.classList.contains("player-collapsed"))restoreDuaCompactPosition()});
}

function updateDuaLinkedToggleButton(){
  const b=$("#duaLinkedToggleBtn"),icon=$("#duaPlayIcon"),panel=$("#duaListeningPanel");if(!b)return;
  const playing=!!duaLinkedMode&&!duaLinkedPaused;
  if(icon)icon.textContent=playing?"⏸":"▶";
  b.setAttribute("aria-label",playing?"Duraklat":"Oynat");
  panel?.classList.toggle("is-playing",playing);
  syncDuaCompactSettings();
}
function duaLinkedPlaybackBounds(){
  if(duaLinkedMode==="section"&&duaLinkedPreset){
    return{start:Number(duaLinkedPreset.a)||0,end:Number(duaLinkedPreset.b)||0};
  }
  let end=0;
  if(duaLinkedPlayerReady&&duaLinkedPlayer){try{end=Number(duaLinkedPlayer.getDuration?.())||0}catch{}}
  return{start:0,end};
}
function updateDuaLinkedCompactUI(){
  if(!$("#duaLinkedSeek"))return;
  let current=0;
  if(duaLinkedPlayerReady&&duaLinkedPlayer){try{current=Number(duaLinkedPlayer.getCurrentTime?.())||0}catch{}}
  const {start,end}=duaLinkedPlaybackBounds(),duration=Math.max(0,end-start),elapsed=Math.max(0,Math.min(duration,current-start));
  if(!duaLinkedSeekDragging)$("#duaLinkedSeek").value=duration?String(Math.round(elapsed/duration*1000)):"0";
  $("#duaLinkedCurrentTime").textContent=formatListenTime(elapsed);
  $("#duaLinkedDuration").textContent=duration?formatListenTime(duration):"--:--";
}
function seekDuaLinkedFromSlider(){
  if(!duaLinkedPlayerReady||!duaLinkedPlayer)return;
  const {start,end}=duaLinkedPlaybackBounds(),duration=Math.max(0,end-start);if(!duration)return;
  const ratio=Math.max(0,Math.min(1,Number($("#duaLinkedSeek").value||0)/1000));
  const target=start+duration*ratio;
  try{duaLinkedPlayer.seekTo(target,true)}catch{}
  $("#duaLinkedCurrentTime").textContent=formatListenTime(duration*ratio);
  updateDuaLinkedActiveSegment();
}
function setDuaLinkedSpeed(value){
  let rate=clampListenSpeed(value);
  if(duaLinkedPlayerReady&&duaLinkedPlayer){
    try{
      const available=duaLinkedPlayer.getAvailablePlaybackRates?.()||[];
      if(available.length)rate=available.reduce((best,x)=>Math.abs(x-rate)<Math.abs(best-rate)?x:best,available[0]);
      duaLinkedPlayer.setPlaybackRate(rate);
    }catch{}
  }
  const selectedValue=[...$("#duaLinkedSpeed").options].some(o=>Number(o.value)===rate)?String(rate):"1";
  $("#duaLinkedSpeed").value=selectedValue;
  if($("#duaCompactSpeed"))$("#duaCompactSpeed").value=selectedValue;
  return rate;
}
function clearDuaLinkedHighlight(){
  duaLinkedActiveSegment=-1;
  document.querySelectorAll("#readContent .read-item.listening-active").forEach(el=>el.classList.remove("listening-active"));
}
function updateDuaLinkedActiveSegment(){
  if(!dua||!duaLinkedPlayerReady||!duaLinkedPlayer||!duaLinkedVideoId)return;
  let t=0;try{t=duaLinkedPlayer.getCurrentTime()||0}catch{return}
  const presets=listeningPresetsForVideo(duaLinkedVideoId);
  const p=presets.find(x=>Number(x.a)<=t&&t<Number(x.b)&&listenPresetNumber(x)>=1&&listenPresetNumber(x)<=dua.segments.length);
  if(!p)return;
  const segIndex=listenPresetNumber(p)-1;
  if(segIndex===duaLinkedActiveSegment)return;
  duaLinkedActiveSegment=segIndex;
  document.querySelectorAll("#readContent .read-item.listening-active").forEach(el=>el.classList.remove("listening-active"));
  const item=$("#readContent [data-open-segment='"+segIndex+"']");
  if(item){
    item.classList.add("listening-active");
    item.scrollIntoView({behavior:"smooth",block:"center"});
    setTimeout(()=>positionActiveTextBelowDuaVideo(item),260);
  }
}
function startDuaLinkedFollow(){
  clearInterval(duaLinkedFollowTimer);
  duaLinkedFollowTimer=setInterval(()=>{updateDuaLinkedActiveSegment();updateDuaLinkedCompactUI()},250);
  updateDuaLinkedActiveSegment();updateDuaLinkedCompactUI();
}
function stopDuaLinkedFollow(){
  clearInterval(duaLinkedFollowTimer);duaLinkedFollowTimer=null;
  updateDuaLinkedCompactUI();
}

function stopDuaLinkedPlayback(){
  clearInterval(duaLinkedTimer);duaLinkedTimer=null;stopDuaLinkedFollow();duaLinkedWaiting=false;duaLinkedMode="";duaLinkedPreset=null;duaLinkedPaused=false;
  if(duaLinkedPlayerReady&&duaLinkedPlayer)try{duaLinkedPlayer.pauseVideo()}catch{}
  $("#duaLinkedPlayStatus").textContent="Durduruldu";clearDuaLinkedHighlight();updateDuaLinkedToggleButton();updateDuaLinkedCompactUI();
}
function pauseResumeDuaLinkedPlayback(){
  if(!duaLinkedPlayerReady||!duaLinkedPlayer)return;
  if(!duaLinkedMode&&!duaLinkedPaused){playDuaLinkedFull();return}
  if(!duaLinkedPaused){
    duaLinkedPaused=true;
    if(duaLinkedMode==="section"){clearInterval(duaLinkedTimer);duaLinkedTimer=null}
    stopDuaLinkedFollow();
    try{duaLinkedPlayer.pauseVideo()}catch{}
    $("#duaLinkedPlayStatus").textContent="Duraklatıldı";
    updateDuaLinkedToggleButton();return;
  }

  duaLinkedPaused=false;
  enableDuaLinkedSound();
  try{duaLinkedPlayer.playVideo()}catch{}
  if(duaLinkedMode==="section"&&duaLinkedPreset){
    clearInterval(duaLinkedTimer);
    duaLinkedTimer=setInterval(()=>{if(duaLinkedMode!=="section"||duaLinkedPaused||duaLinkedWaiting||!duaLinkedPlayerReady)return;const t=duaLinkedPlayer.getCurrentTime()||0;if(t>=Number(duaLinkedPreset.b)-.03)handleDuaLinkedBoundary()},60);
  }
  startDuaLinkedFollow();
  if(duaLinkedMode==="section"&&duaLinkedPreset)$("#duaLinkedPlayStatus").textContent="Bölüm "+listenPresetNumber(duaLinkedPreset)+" · "+duaLinkedIteration+" / "+duaLinkedTarget;
  else $("#duaLinkedPlayStatus").textContent="Tamamı oynatılıyor";
  updateDuaLinkedToggleButton();
}
function playDuaLinkedFull(){
  const linked=dua?linkedVideoForDua(dua.id):null;if(!linked)return;
  prepareDuaLinkedVideo(linked.videoId);
  if(!duaLinkedPlayerReady||!duaLinkedPlayer){$("#duaLinkedPlayStatus").textContent="Oynatıcı hazırlanıyor…";return}
  clearInterval(duaLinkedTimer);duaLinkedMode="full";duaLinkedVideoId=linked.videoId;duaLinkedPreset=null;duaLinkedPaused=false;duaLinkedWaiting=false;
  $("#duaLinkedPlayStatus").textContent="Tamamı oynatılıyor";
  clearDuaLinkedHighlight();
  enableDuaLinkedSound();
  try{
    const currentId=duaLinkedPlayer.getVideoData?.().video_id||"";
    if(currentId!==linked.videoId)duaLinkedPlayer.loadVideoById(linked.videoId,0);
    else{duaLinkedPlayer.seekTo(0,true);duaLinkedPlayer.playVideo()}
  }catch{try{duaLinkedPlayer.loadVideoById(linked.videoId,0)}catch{}}
  setDuaLinkedSpeed($("#duaLinkedSpeed").value||1);
  startDuaLinkedFollow();updateDuaLinkedToggleButton();
}
function playDuaLinkedSection(sectionNumber){
  const linked=dua?linkedVideoForDua(dua.id):null,p=dua?linkedPresetForDuaSegment(dua.id,sectionNumber):null;
  if(!linked||!p)return;
  prepareDuaLinkedVideo(linked.videoId);
  if(!duaLinkedPlayerReady||!duaLinkedPlayer){$("#duaLinkedPlayStatus").textContent="Oynatıcı hazırlanıyor…";return}
  clearInterval(duaLinkedTimer);duaLinkedMode="section";duaLinkedVideoId=linked.videoId;duaLinkedPreset=p;duaLinkedIteration=0;duaLinkedTarget=Math.max(1,Number($("#duaSectionRepeatCount").value)||1);duaLinkedWaiting=false;duaLinkedPaused=false;
  $("#duaLinkedPlayStatus").textContent="Bölüm "+sectionNumber+" · 0 / "+duaLinkedTarget;
  clearDuaLinkedHighlight();
  enableDuaLinkedSound();
  try{
    const currentId=duaLinkedPlayer.getVideoData?.().video_id||"";
    if(currentId!==linked.videoId)duaLinkedPlayer.loadVideoById(linked.videoId,p.a);
    else{duaLinkedPlayer.seekTo(p.a,true);duaLinkedPlayer.playVideo()}
  }catch{try{duaLinkedPlayer.loadVideoById(linked.videoId,p.a)}catch{}}
  setDuaLinkedSpeed($("#duaLinkedSpeed").value||p.rate||1);
  duaLinkedTimer=setInterval(()=>{if(duaLinkedMode!=="section"||duaLinkedPaused||duaLinkedWaiting||!duaLinkedPlayerReady)return;const t=duaLinkedPlayer.getCurrentTime()||0;if(t>=Number(p.b)-.03)handleDuaLinkedBoundary()},60);
  startDuaLinkedFollow();updateDuaLinkedToggleButton();
}
function handleDuaLinkedBoundary(){
  if(duaLinkedMode!=="section"||!duaLinkedPreset||duaLinkedWaiting)return;
  duaLinkedIteration++;
  $("#duaLinkedPlayStatus").textContent="Bölüm "+listenPresetNumber(duaLinkedPreset)+" · "+duaLinkedIteration+" / "+duaLinkedTarget;
  if(duaLinkedIteration>=duaLinkedTarget){
    clearInterval(duaLinkedTimer);duaLinkedTimer=null;stopDuaLinkedFollow();duaLinkedMode="";duaLinkedPaused=false;
    try{duaLinkedPlayer.pauseVideo()}catch{}
    $("#duaLinkedPlayStatus").textContent="Bölüm "+listenPresetNumber(duaLinkedPreset)+" tamamlandı ✓";
    updateDuaLinkedToggleButton();updateDuaLinkedCompactUI();return;
  }
  duaLinkedWaiting=true;const pause=Math.max(0,Number(duaLinkedPreset.pause)||0)*1000;
  try{duaLinkedPlayer.pauseVideo()}catch{}
  setTimeout(()=>{if(!duaLinkedPreset)return;duaLinkedPlayer.seekTo(duaLinkedPreset.a,true);setDuaLinkedSpeed($("#duaLinkedSpeed").value||duaLinkedPreset.rate||1);enableDuaLinkedSound();duaLinkedPlayer.playVideo();setTimeout(()=>duaLinkedWaiting=false,120)},pause);
}
function listeningCurrentTitle(){
  const v=listeningVideos.find(x=>x.videoId===listeningCurrentVideoId);
  if(v?.title)return v.title;
  try{
    const t=String(listeningPlayer?.getVideoData?.().title||"").trim();
    if(t)return t;
  }catch{}
  return listeningCurrentVideoId?"YouTube video":"Bir video seç";
}
function updateListeningMiniPlayer(){
  const shell=$("#listeningPlayerShell"),size=$("#listeningPlayerSize"),compactBtn=$("#listeningCompactToggle");
  if(!shell||!size||!compactBtn)return;
  shell.style.setProperty("--listening-player-width",listeningPlayerScale+"%");
  size.value=String(listeningPlayerScale);
  size.disabled=listeningPlayerCompact;
  shell.classList.toggle("is-compact",listeningPlayerCompact);
  compactBtn.textContent=listeningPlayerCompact?"▣ Videoyu göster":"🎧 MP3 çalar";
  const title=$("#listeningMiniTitle"),status=$("#listeningMiniStatus"),toggle=$("#listeningMiniToggle");
  if(title)title.textContent=listeningCurrentTitle();
  let playing=false,stateLabel="Hazır";
  try{
    const st=listeningPlayerReady&&listeningPlayer?listeningPlayer.getPlayerState():-1;
    playing=st===YT.PlayerState.PLAYING;
    if(listeningLoopPaused)stateLabel="Duraklatıldı";
    else if(listeningLoopActive)stateLabel="Tekrar ediyor · "+listeningLoopIteration+" / "+Math.max(1,Number($("#listeningRepeatCount")?.value)||1);
    else if(playing)stateLabel="Oynatılıyor";
    else if(st===YT.PlayerState.PAUSED)stateLabel="Duraklatıldı";
    else if(st===YT.PlayerState.CUED)stateLabel="Hazır";
    else if(st===YT.PlayerState.ENDED)stateLabel="Tamamlandı";
  }catch{}
  if(status)status.textContent=stateLabel;
  if(toggle){
    toggle.textContent=playing||listeningLoopActive&&!listeningLoopPaused?"⏸":"▶";
    toggle.setAttribute("aria-label",playing?"Duraklat":"Oynat");
    toggle.disabled=!listeningCurrentVideoId;
  }
}
function setListeningPlayerScale(v){
  listeningPlayerScale=Math.max(35,Math.min(100,Number(v)||65));
  localStorage.setItem("listeningPlayerScale",String(listeningPlayerScale));
  updateListeningMiniPlayer();
}
function setListeningPlayerCompact(on){
  listeningPlayerCompact=!!on;
  localStorage.setItem("listeningPlayerCompact",listeningPlayerCompact?"1":"0");
  updateListeningMiniPlayer();
}
function toggleListeningMiniPlayback(){
  if(!listeningCurrentVideoId){showListeningError("Önce bir video seç.");return}
  ensureListeningPlayer();
  if(!listeningPlayerReady||!listeningPlayer)return;
  if(listeningLoopActive||listeningLoopPaused){
    pauseResumeListening();
    updateListeningMiniPlayer();
    return;
  }
  try{
    const st=listeningPlayer.getPlayerState();
    if(st===YT.PlayerState.PLAYING)listeningPlayer.pauseVideo();
    else listeningPlayer.playVideo();
  }catch{}
  setTimeout(updateListeningMiniPlayer,60);
}

function ensureListeningPlayer(){
  if(listeningPlayer)return;
  if(!(window.YT&&YT.Player))return;
  listeningPlayer=new YT.Player("listeningPlayer",{width:"100%",height:"100%",videoId:"",playerVars:{playsinline:1,rel:0,modestbranding:1},events:{
    onReady:()=>{listeningPlayerReady=true;updateListeningMiniPlayer()},
    onStateChange:e=>{
      updateListeningMiniPlayer();
      if(!listeningCurrentVideoId)return;
      syncListeningTitle();
      if(e.data===YT.PlayerState.ENDED){
        if(listeningLoopActive)handleListeningBoundary();
        else incrementListeningTodo("video",listeningCurrentVideoId,null);
      }
    },
    onError:e=>{const code=e?.data;showListeningError((code===101||code===150)?"Bu video başka sitelerde oynatmaya izin vermiyor.":"YouTube oynatma hatası oluştu.")}
  }});
}
const previousYTReady=window.onYouTubeIframeAPIReady;
window.onYouTubeIframeAPIReady=()=>{if(typeof previousYTReady==="function")previousYTReady();ensureListeningPlayer();ensureDuaLinkedPlayer()};

function openListening(){
  hideDuaFloatingPlayer();
  $("#fullscreenTasbihBtn").classList.add("hidden");closeFullscreenTasbih();clearQuickCount();
  state.currentView="listening";
  ["homeView","todoView","memorizeView","readView","libraryView","ilmihalView"].forEach(id=>$("#"+id).classList.add("hidden"));
  $(".navigation").classList.add("hidden");counter.classList.add("hidden");$("#progress").textContent="";
  $("#listeningView").classList.remove("hidden");
  setListeningTab("play");ensureListeningPlayer();renderListeningAll();updateListeningMiniPlayer();save();
}
function setListeningTab(tab){
  const play=tab==="play";
  $("#listeningPlayTab").classList.toggle("active",play);$("#listeningEditTab").classList.toggle("active",!play);
  $("#listeningPlayScreen").classList.toggle("hidden",!play);$("#listeningEditScreen").classList.toggle("hidden",play);updateListeningMiniPlayer();
}
function addListeningHistory(id){
  const old=listeningHistory.find(x=>x.videoId===id),v=listeningVideos.find(x=>x.videoId===id);
  listeningHistory=[{videoId:id,title:v?.title||old?.title||("YouTube video · "+id),playedAt:Date.now()},...listeningHistory.filter(x=>x.videoId!==id)].slice(0,50);
  writeListenStore("ylp_history",listeningHistory);renderListeningHistory();
}
function saveListeningVideo(id){
  if(!id)return;const old=listeningVideos.find(v=>v.videoId===id),h=listeningHistory.find(v=>v.videoId===id);
  const item=old||{videoId:id,url:"https://www.youtube.com/watch?v="+id,title:h?.title||("YouTube video · "+id),createdAt:Date.now()};
  item.updatedAt=Date.now();listeningVideos=[item,...listeningVideos.filter(v=>v.videoId!==id)];writeListenStore("ylp_saved_videos",listeningVideos);renderListeningAll();
}
function syncListeningTitle(){
  if(!listeningPlayerReady||!listeningPlayer||!listeningCurrentVideoId)return;
  try{const title=String(listeningPlayer.getVideoData?.().title||"").trim();if(!title)return;const v=listeningVideos.find(x=>x.videoId===listeningCurrentVideoId);if(v)v.title=title;const h=listeningHistory.find(x=>x.videoId===listeningCurrentVideoId);if(h)h.title=title;writeListenStore("ylp_saved_videos",listeningVideos);writeListenStore("ylp_history",listeningHistory);renderListeningAll();updateListeningMiniPlayer()}catch{}
}
function selectListeningVideo(input,autoplay=false){
  const id=parseListenVideoId(input);if(!id){showListeningError("Geçerli bir YouTube bağlantısı veya video kimliği gir.");return}
  ensureListeningPlayer();if(!listeningPlayerReady||!listeningPlayer){showListeningError("YouTube oynatıcı henüz hazır değil.");return}
  hardStopListening(false);listeningCurrentVideoId=id;$("#listeningUrl").value="https://www.youtube.com/watch?v="+id;$("#listeningEmptyPlayer").classList.add("hidden");showListeningError("");
  const already=listeningPlayer.getVideoData?.().video_id===id;if(!already){autoplay?listeningPlayer.loadVideoById(id):listeningPlayer.cueVideoById(id)}else if(autoplay)listeningPlayer.playVideo();
  addListeningHistory(id);renderListeningAll();updateListeningMiniPlayer();setTimeout(syncListeningTitle,700);
}
function setListeningSpeed(v){
  let r=clampListenSpeed(v);
  if(listeningPlayerReady&&listeningPlayer){try{const a=listeningPlayer.getAvailablePlaybackRates?.()||[];if(a.length)r=a.reduce((best,x)=>Math.abs(x-r)<Math.abs(best-r)?x:best,a[0]);listeningPlayer.setPlaybackRate(r)}catch{}}
  $("#listeningManualSpeed").value=String(r);$("#listeningEditSpeed").value=String(r);
  document.querySelectorAll("[data-listen-speed]").forEach(b=>b.classList.toggle("active",Number(b.dataset.listenSpeed)===r));
  document.querySelectorAll("[data-listen-edit-speed]").forEach(b=>b.classList.toggle("active",Number(b.dataset.listenEditSpeed)===r));
  return r;
}
function listeningRange(){return{a:parseListenTime($("#listeningStart").value),b:parseListenTime($("#listeningEnd").value)}}
function currentListeningPreset(){return listeningPresets.find(p=>p.id===$("#listeningPresetSelect").value)||null}
function updateListeningStatus(){
  const target=Math.max(1,Number($("#listeningRepeatCount").value)||1);
  $("#listeningEditStatus").textContent=listeningLoopIteration+" / "+target;
  $("#listeningRepeatStatus").textContent=listeningLoopIteration+" / "+($("#listeningPresetSelect").value?target:0);
  const canPause=listeningLoopActive||listeningLoopPaused,label=listeningLoopPaused?"▶ Devam":"⏸ Dur";
  $("#listeningPauseBtn").disabled=!canPause;$("#listeningEditPauseBtn").disabled=!canPause;$("#listeningPauseBtn").textContent=label;$("#listeningEditPauseBtn").textContent=label;
  $("#listeningRepeatBtn").disabled=(listeningLoopActive&&!listeningLoopPaused)||!$("#listeningPresetSelect").value;
  $("#listeningEditRepeatBtn").disabled=listeningLoopActive&&!listeningLoopPaused;updateListeningMiniPlayer();
}
function startListeningLoop(){
  const r=listeningRange();if(!listeningCurrentVideoId||!Number.isFinite(r.a)||!Number.isFinite(r.b)||r.b<=r.a){showListeningError("Video ve A–B aralığını kontrol et.");return}
  listeningLoopIteration=0;listeningLoopPaused=false;listeningLoopActive=true;listeningWaiting=false;clearInterval(listeningLoopTimer);clearTimeout(listeningRestartTimer);
  setListeningSpeed($("#listeningEditSpeed").value||1);listeningPlayer.seekTo(r.a,true);listeningPlayer.playVideo();listeningLoopTimer=setInterval(listeningTick,60);
  $("#listeningLoopState").textContent="Tekrar ediyor";$("#listeningEditLoopState").textContent="Tekrar ediyor";updateListeningStatus();
}
function listeningTick(){if(!listeningLoopActive||listeningWaiting||!listeningPlayerReady)return;const r=listeningRange(),t=listeningPlayer.getCurrentTime()||0;if(t>=r.b-.03)handleListeningBoundary()}
function handleListeningBoundary(){
  if(!listeningLoopActive||listeningWaiting)return;
  const target=Math.max(1,Number($("#listeningRepeatCount").value)||1);listeningLoopIteration++;
  const p=currentListeningPreset();if(p)incrementListeningTodo("section",listeningCurrentVideoId,p.id);
  updateListeningStatus();
  if(listeningLoopIteration>=target){listeningLoopActive=false;listeningLoopPaused=false;clearInterval(listeningLoopTimer);clearTimeout(listeningRestartTimer);try{listeningPlayer.pauseVideo()}catch{};$("#listeningLoopState").textContent="Tamamlandı ✓";$("#listeningEditLoopState").textContent="Tamamlandı ✓";updateListeningStatus();return}
  const r=listeningRange(),pause=Math.max(0,Number($("#listeningPauseBetween").value)||0)*1000;listeningWaiting=true;
  if(!pause){listeningPlayer.seekTo(r.a,true);setListeningSpeed($("#listeningEditSpeed").value||1);listeningPlayer.playVideo();setTimeout(()=>listeningWaiting=false,120);return}
  try{listeningPlayer.pauseVideo()}catch{};listeningRestartTimer=setTimeout(()=>{if(!listeningLoopActive)return;listeningPlayer.seekTo(r.a,true);setListeningSpeed($("#listeningEditSpeed").value||1);listeningPlayer.playVideo();setTimeout(()=>listeningWaiting=false,120)},pause);
}
function pauseResumeListening(){
  if(listeningLoopActive&&!listeningLoopPaused){listeningLoopActive=false;listeningLoopPaused=true;clearInterval(listeningLoopTimer);clearTimeout(listeningRestartTimer);try{listeningPlayer.pauseVideo()}catch{};$("#listeningLoopState").textContent="Duraklatıldı";$("#listeningEditLoopState").textContent="Duraklatıldı";updateListeningStatus();return}
  if(listeningLoopPaused){listeningLoopPaused=false;listeningLoopActive=true;listeningPlayer.playVideo();listeningLoopTimer=setInterval(listeningTick,60);$("#listeningLoopState").textContent="Tekrar ediyor";$("#listeningEditLoopState").textContent="Tekrar ediyor";updateListeningStatus()}
}
function hardStopListening(reset=true){listeningLoopActive=false;listeningLoopPaused=false;listeningWaiting=false;clearInterval(listeningLoopTimer);clearTimeout(listeningRestartTimer);if(reset)listeningLoopIteration=0;if(listeningPlayerReady&&listeningPlayer)try{listeningPlayer.pauseVideo()}catch{};updateListeningStatus()}
function useListeningPreset(p,play=false){
  if(!p)return;hardStopListening(true);$("#listeningStart").value=formatListenTime(p.a);$("#listeningEnd").value=formatListenTime(p.b);$("#listeningRepeatCount").value=p.repeats||10;$("#listeningPauseBetween").value=String(p.pause||0);setListeningSpeed(p.rate||1);
  const id=p.sourceId||p.videoId;if(id&&id!==listeningCurrentVideoId)selectListeningVideo(id,false);
  $("#listeningPresetSelect").value=p.id;updateListeningStatus();if(play)setTimeout(startListeningLoop,120);
}
function openListeningPresetDialog(p=null){
  listeningEditingPresetId=p?.id||"";$("#listeningPresetDialogTitle").textContent=p?"Bölümü düzenle":"Bölümü kaydet";
  const list=listeningCurrentVideoId?listeningPresetsForVideo(listeningCurrentVideoId):[],nums=list.map(listenPresetNumber).filter(Number.isFinite),next=nums.length?Math.max(...nums)+1:1,r=listeningRange();
  $("#listeningPresetNumber").value=String(p?listenPresetNumber(p):next);$("#listeningPresetStart").value=formatListenTime(p?.a??r.a);$("#listeningPresetEnd").value=formatListenTime(p?.b??r.b);$("#listeningPresetDialogError").classList.add("hidden");$("#listeningPresetDialog").showModal();
}
function saveListeningPresetDialog(){
  const n=Number($("#listeningPresetNumber").value),a=parseListenTime($("#listeningPresetStart").value),b=parseListenTime($("#listeningPresetEnd").value),err=$("#listeningPresetDialogError");
  let msg="";if(!listeningCurrentVideoId)msg="Önce video aç.";else if(!Number.isInteger(n)||n<1)msg="Bölüm numarası 1 veya daha büyük olmalı.";else if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)msg="Başlangıç ve bitiş aralığını kontrol et.";
  if(!msg&&listeningPresetsForVideo(listeningCurrentVideoId).some(p=>p.id!==listeningEditingPresetId&&listenPresetNumber(p)===n))msg="Bu numaralı bölüm zaten var.";
  if(msg){err.textContent=msg;err.classList.remove("hidden");return}
  let p=listeningPresets.find(x=>x.id===listeningEditingPresetId);
  if(p){p.title=String(n);p.a=a;p.b=b;p.updatedAt=Date.now()}
  else{p={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),title:String(n),sourceType:"youtube",sourceId:listeningCurrentVideoId,videoId:listeningCurrentVideoId,a,b,repeats:Math.max(1,Number($("#listeningRepeatCount").value)||10),rate:clampListenSpeed($("#listeningEditSpeed").value),pause:Number($("#listeningPauseBetween").value)||0,createdAt:Date.now()};listeningPresets.unshift(p);saveListeningVideo(listeningCurrentVideoId)}
  writeListenStore("ylp_presets",listeningPresets);$("#listeningPresetDialog").close();listeningEditingPresetId="";renderListeningAll();
}
function deleteListeningPreset(id){listeningPresets=listeningPresets.filter(p=>p.id!==id);writeListenStore("ylp_presets",listeningPresets);renderListeningAll()}
function renderListeningSaved(){
  const box=$("#listeningSavedVideos");$("#listeningSavedEmpty").classList.toggle("hidden",!!listeningVideos.length);
  box.innerHTML=listeningVideos.map(v=>{const linked=linkedDuaForVideo(v.videoId);return '<article class="listening-list-card"><div><strong>'+escapeHtml(v.title||v.videoId)+'</strong><small>'+listeningPresetsForVideo(v.videoId).length+' bölüm'+(linked?' · '+escapeHtml(linked.title)+' ile eşleşti':'')+'</small></div><div class="listening-card-actions"><button data-lv-open="'+v.videoId+'">Aç</button><button data-lv-todo="'+v.videoId+'">+ Todo</button><button data-lv-delete="'+v.videoId+'">Sil</button></div></article>'}).join("");
  box.querySelectorAll("[data-lv-open]").forEach(b=>b.onclick=()=>selectListeningVideo(b.dataset.lvOpen,false));
  box.querySelectorAll("[data-lv-todo]").forEach(b=>b.onclick=()=>openListeningTodoDialog("video",b.dataset.lvTodo,null));
  box.querySelectorAll("[data-lv-delete]").forEach(b=>b.onclick=()=>{const id=b.dataset.lvDelete;listeningVideos=listeningVideos.filter(v=>v.videoId!==id);delete listeningLinks[id];writeListenStore("ylp_saved_videos",listeningVideos);saveListeningLinks();renderListeningAll();renderRead()});
}
function renderListeningHistory(){
  $("#listeningHistoryEmpty").classList.toggle("hidden",!!listeningHistory.length);const box=$("#listeningHistory");
  box.innerHTML=listeningHistory.map(v=>'<article class="listening-list-card"><div><strong>'+escapeHtml(v.title||v.videoId)+'</strong><small>'+escapeHtml(v.videoId)+'</small></div><div class="listening-card-actions"><button data-lh-open="'+v.videoId+'">Aç</button>'+(!listeningVideos.some(x=>x.videoId===v.videoId)?'<button data-lh-save="'+v.videoId+'">Kaydet</button>':'')+'</div></article>').join("");
  box.querySelectorAll("[data-lh-open]").forEach(b=>b.onclick=()=>selectListeningVideo(b.dataset.lhOpen,false));box.querySelectorAll("[data-lh-save]").forEach(b=>b.onclick=()=>saveListeningVideo(b.dataset.lhSave));
}
function renderListeningPresets(){
  const list=listeningCurrentVideoId?listeningPresetsForVideo(listeningCurrentVideoId):[],box=$("#listeningPresetList");$("#listeningPresetEmpty").classList.toggle("hidden",!!list.length);
  box.innerHTML=list.map(p=>'<article class="listening-list-card"><div><strong>Bölüm '+escapeHtml(p.title)+'</strong><small>'+formatListenTime(p.a)+' – '+formatListenTime(p.b)+' · '+p.repeats+' tekrar · '+p.rate+'×</small></div><div class="listening-card-actions"><button data-lp-open="'+p.id+'">Aç</button><button data-lp-play="'+p.id+'">Oynat</button><button data-lp-edit="'+p.id+'">Düzenle</button><button data-lp-todo="'+p.id+'">+ Todo</button><button data-lp-delete="'+p.id+'">Sil</button></div></article>').join("");
  box.querySelectorAll("[data-lp-open]").forEach(b=>b.onclick=()=>useListeningPreset(listeningPresets.find(p=>p.id===b.dataset.lpOpen),false));box.querySelectorAll("[data-lp-play]").forEach(b=>b.onclick=()=>useListeningPreset(listeningPresets.find(p=>p.id===b.dataset.lpPlay),true));box.querySelectorAll("[data-lp-edit]").forEach(b=>b.onclick=()=>openListeningPresetDialog(listeningPresets.find(p=>p.id===b.dataset.lpEdit)));box.querySelectorAll("[data-lp-todo]").forEach(b=>{b.onclick=()=>{const p=listeningPresets.find(x=>x.id===b.dataset.lpTodo);openListeningTodoDialog("section",p?.sourceId||p?.videoId,p?.id)}});box.querySelectorAll("[data-lp-delete]").forEach(b=>b.onclick=()=>deleteListeningPreset(b.dataset.lpDelete));
}
function renderListeningPlaySelectors(){
  const vs=$("#listeningVideoSelect"),oldV=vs.value||listeningCurrentVideoId;vs.innerHTML='<option value="">Video seç…</option>'+listeningVideos.map(v=>'<option value="'+v.videoId+'">'+escapeHtml(v.title||v.videoId)+'</option>').join("");if(listeningVideos.some(v=>v.videoId===oldV))vs.value=oldV;
  const ps=$("#listeningPresetSelect"),oldP=ps.value,list=vs.value?listeningPresetsForVideo(vs.value):[];ps.disabled=!list.length;ps.innerHTML=list.length?'<option value="">Bölüm seç…</option>'+list.map(p=>'<option value="'+p.id+'">Bölüm '+escapeHtml(p.title)+' · '+formatListenTime(p.a)+'–'+formatListenTime(p.b)+'</option>').join(""):'<option value="">'+(vs.value?"Bu videoda bölüm yok":"Önce video seç…")+'</option>';if(list.some(p=>p.id===oldP))ps.value=oldP;
  const i=list.findIndex(p=>p.id===ps.value),has=i>=0;$("#listeningPrevPreset").disabled=!has||i<=0;$("#listeningNextPreset").disabled=!has||i>=list.length-1;$("#listeningVideoTodoBtn").disabled=!vs.value;$("#listeningPresetTodoBtn").disabled=!has;updateListeningStatus();
}
function renderListeningAll(){renderListeningSaved();renderListeningHistory();renderListeningPresets();renderListeningPlaySelectors();renderListeningLinkStatus()}
function navigateListeningPreset(dir){const list=listeningPresetsForVideo($("#listeningVideoSelect").value);if(!list.length)return;let i=list.findIndex(p=>p.id===$("#listeningPresetSelect").value);i=i<0?(dir>0?0:list.length-1):Math.max(0,Math.min(list.length-1,i+dir));$("#listeningPresetSelect").value=list[i].id;selectListeningPreset(list[i].id,false)}
function selectListeningPreset(id,play=false){const p=listeningPresets.find(x=>x.id===id);if(!p){renderListeningPlaySelectors();return}useListeningPreset(p,play);renderListeningPlaySelectors()}
function openListeningTodoDialog(type,videoId,presetId){
  pendingTodoScope=type==="section"?"listeningSection":"listeningVideo";pendingListeningTodo={videoId,presetId};
  const v=listeningVideos.find(x=>x.videoId===videoId),p=listeningPresets.find(x=>x.id===presetId),today=todayKey();
  $("#todoDialogTitle").textContent=type==="section"?"Bu dinleme bölümünü Todo'ya ekle":"Bu videoyu Todo'ya ekle";$("#todoDescription").value="";
  $("#todoTarget").value=type==="section"?Math.max(1,Number(p?.repeats)||1):1;$("#todoScheduleMode").value="days";$("#todoStartDate").value=today;$("#todoEndDate").value=addDaysKey(today,9);$("#todoDurationDays").value=10;updateTodoScheduleFields();$("#todoDialog").showModal();
}
function incrementListeningTodo(type,videoId,presetId){
  const k=todayKey(),now=new Date().toISOString();
  todos.forEach(t=>{if(t.sourceType!=="listening"||t.listeningType!==type||t.videoId!==videoId||!todoOccursOn(t,k))return;if(type==="section"&&t.presetId!==presetId)return;t.history=t.history||{};const h=t.history[k]||(t.history[k]={count:0,completedAt:null});if(h.completedAt)return;h.count=(h.count||0)+1;if(h.count>=Number(t.target||1))h.completedAt=now});
  saveTodos();updateHomeTodoCount();if(state.currentView==="todo")renderTodo();
}

$("#listeningPlayerSize").oninput=e=>setListeningPlayerScale(e.target.value);
$("#listeningCompactToggle").onclick=()=>setListeningPlayerCompact(!listeningPlayerCompact);
$("#listeningMiniExpand").onclick=()=>setListeningPlayerCompact(false);
$("#listeningMiniToggle").onclick=toggleListeningMiniPlayback;
$("#listeningPlayTab").onclick=()=>setListeningTab("play");
$("#listeningEditTab").onclick=()=>setListeningTab("edit");
$("#listeningLoadBtn").onclick=()=>selectListeningVideo($("#listeningUrl").value,false);
$("#listeningSaveVideoBtn").onclick=()=>listeningCurrentVideoId?saveListeningVideo(listeningCurrentVideoId):showListeningError("Önce video aç.");
$("#listeningAssignBtn").onclick=openListeningAssignDialog;
$("#listeningAssignBack").onclick=renderListeningAssignCategories;
$("#listeningUnassignBtn").onclick=unassignListeningVideo;
$("#duaLinkedToggleBtn").onclick=pauseResumeDuaLinkedPlayback;
$("#memorizeListenBtn").onclick=e=>{e.stopPropagation();const n=Number($("#memorizeListenBtn").dataset.section||0);if(n)playDuaLinkedSection(n)};
$("#readHeaderCollapseBtn").onclick=()=>setReadHeaderCollapsed(!$("#readView .read-sticky-header").classList.contains("collapsed"));
$("#duaListeningPanel").addEventListener("pointerdown",beginCompactPlayerHold);
$("#duaListeningPanel").addEventListener("pointermove",moveCompactPlayerHold);
["pointerup","pointercancel"].forEach(ev=>$("#duaListeningPanel").addEventListener(ev,endCompactPlayerHold));
$("#duaListeningPanel").addEventListener("click",e=>{
  const panel=$("#duaListeningPanel");
  if(duaCompactSuppressClick){e.preventDefault();e.stopPropagation();return}
  if(panel.classList.contains("player-collapsed")&&!e.target.closest("#duaCompactSettings")){
    e.preventDefault();e.stopPropagation();
  }
},true);
$("#duaPanelDragHandle").addEventListener("pointerdown",beginDuaPanelDrag);
$("#duaPanelDragHandle").addEventListener("pointermove",moveDuaPanelDrag);
["pointerup","pointercancel"].forEach(ev=>$("#duaPanelDragHandle").addEventListener(ev,endDuaPanelDrag));
$("#duaLinkedSpeed").onchange=e=>setDuaLinkedSpeed(e.target.value);
const duaRepeatInput=$("#duaSectionRepeatCount");
const compactRepeatInput=$("#duaCompactRepeatInput");
const compactSpeedSelect=$("#duaCompactSpeed");
compactRepeatInput.addEventListener("focus",()=>setTimeout(()=>{try{compactRepeatInput.select()}catch{}},0));
compactRepeatInput.addEventListener("click",()=>setTimeout(()=>{try{compactRepeatInput.select()}catch{}},0));
compactRepeatInput.addEventListener("input",()=>{compactRepeatInput.value=compactRepeatInput.value.replace(/\D/g,"").slice(0,3)});
compactRepeatInput.addEventListener("change",commitDuaCompactRepeat);
compactRepeatInput.addEventListener("blur",commitDuaCompactRepeat);
compactSpeedSelect.addEventListener("change",()=>setDuaLinkedSpeed(compactSpeedSelect.value));
document.addEventListener("pointerdown",e=>{
  const panel=$("#duaListeningPanel");
  if(panel?.classList.contains("settings-open")&&!panel.contains(e.target))hideDuaCompactSettings();
});
$("#duaLinkedSeek").addEventListener("pointerdown",()=>{duaLinkedSeekDragging=true});
$("#duaLinkedSeek").addEventListener("input",()=>{seekDuaLinkedFromSlider()});
["pointerup","pointercancel","change"].forEach(ev=>$("#duaLinkedSeek").addEventListener(ev,()=>{duaLinkedSeekDragging=false;seekDuaLinkedFromSlider();updateDuaLinkedCompactUI()}));
$("#duaListeningDragHandle").addEventListener("pointerdown",beginDuaPanelDrag);
$("#duaListeningDragHandle").addEventListener("pointermove",moveDuaPanelDrag);
["pointerup","pointercancel"].forEach(ev=>$("#duaListeningDragHandle").addEventListener(ev,endDuaPanelDrag));
$("#listeningClearHistory").onclick=()=>{listeningHistory=[];writeListenStore("ylp_history",[]);renderListeningHistory()};
$("#listeningVideoSelect").onchange=e=>{if(e.target.value)selectListeningVideo(e.target.value,false);renderListeningPlaySelectors()};
$("#listeningPresetSelect").onchange=e=>selectListeningPreset(e.target.value,false);
$("#listeningPrevPreset").onclick=()=>navigateListeningPreset(-1);$("#listeningNextPreset").onclick=()=>navigateListeningPreset(1);
$("#listeningVideoTodoBtn").onclick=()=>openListeningTodoDialog("video",$("#listeningVideoSelect").value,null);
$("#listeningPresetTodoBtn").onclick=()=>{const p=currentListeningPreset();if(p)openListeningTodoDialog("section",p.sourceId||p.videoId,p.id)};
$("#listeningRepeatBtn").onclick=()=>{const p=currentListeningPreset();if(p)useListeningPreset(p,true)};
$("#listeningPauseBtn").onclick=pauseResumeListening;$("#listeningEditRepeatBtn").onclick=startListeningLoop;$("#listeningEditPauseBtn").onclick=pauseResumeListening;
$("#listeningSetStart").onclick=()=>{if(listeningPlayerReady)$("#listeningStart").value=formatListenTime(listeningPlayer.getCurrentTime()||0)};
$("#listeningSetEnd").onclick=()=>{if(listeningPlayerReady)$("#listeningEnd").value=formatListenTime(listeningPlayer.getCurrentTime()||0)};
document.querySelectorAll("[data-listen-nudge-a]").forEach(b=>b.onclick=()=>{const n=parseListenTime($("#listeningStart").value),d=Number(b.dataset.listenNudgeA);$("#listeningStart").value=formatListenTime(Math.max(0,Math.round((n+d)*10)/10))});
document.querySelectorAll("[data-listen-nudge-b]").forEach(b=>b.onclick=()=>{const n=parseListenTime($("#listeningEnd").value),d=Number(b.dataset.listenNudgeB);$("#listeningEnd").value=formatListenTime(Math.max(0,Math.round((n+d)*10)/10))});
document.querySelectorAll("[data-listen-speed]").forEach(b=>b.onclick=()=>setListeningSpeed(b.dataset.listenSpeed));
document.querySelectorAll("[data-listen-edit-speed]").forEach(b=>b.onclick=()=>setListeningSpeed(b.dataset.listenEditSpeed));
$("#listeningManualSpeed").onchange=e=>setListeningSpeed(e.target.value);$("#listeningEditSpeed").onchange=e=>setListeningSpeed(e.target.value);
$("#listeningSavePresetBtn").onclick=()=>openListeningPresetDialog(null);$("#listeningPresetDialogSave").onclick=saveListeningPresetDialog;

addEventListener("resize",()=>{syncGlobalHeaderHeight();syncReadHeaderHeight();requestAnimationFrame(()=>{syncDuaPlayerClearance();restoreCounter();const p=$("#duaListeningPanel");if(p?.classList.contains("player-collapsed"))restoreDuaCompactPosition();else restoreDuaListeningPanelPosition()})});
init().catch(error=>{
  console.error("Dua V2 init:",error);
  const home=$("#homeView");if(home)home.classList.remove("hidden");
  const title=$("#homeView .home-head h1");if(title)title.textContent="Veri yüklenemedi";
  const note=$("#homeView .home-head p");if(note)note.textContent="Oturumu veya bağlantıyı kontrol edip sayfayı yenileyin.";
  const menu=document.querySelector(".home-menu");if(menu)menu.innerHTML="";
});