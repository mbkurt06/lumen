"use client";

import { supabase } from "@/lib/supabase/client";
import { putStaticRows } from "@/lib/localContentDb";
import { getOfflineOwnerId } from "@/lib/offlineIdentity";
import { isLocalDatabaseEnabled } from "@/lib/storageMode";

export type OfflineTable =
  | "user_preferences"
  | "todos"
  | "calendar_event_state"
  | "reading_state"
  | "memorization_state"
  | "dua_v2_state"
  | "dua_v2_todos"
  | "dua_v2_counter_events"
  | "dua_v2_listening_history"
  | "dua_v2_listening_links"
  | "dua_v2_listening_sections"
  | "dua_v2_listening_videos";

type OfflineMutationTable = OfflineTable | "library_items";

type OfflineMutation = {
  id?:number;
  ownerId?:string;
  table:OfflineMutationTable;
  action:"upsert"|"update"|"delete";
  payload?:Record<string,unknown>;
  match?:Record<string,unknown>;
  createdAt:string;
  onConflict?:string;
};

const DB_NAME="lumen-offline-data";
const DB_VERSION=1;
const OUTBOX="outbox";
const META="meta";

const TABLES:OfflineTable[]=[
  "user_preferences",
  "todos",
  "calendar_event_state",
  "reading_state",
  "memorization_state",
  "dua_v2_state",
  "dua_v2_todos",
  "dua_v2_counter_events",
  "dua_v2_listening_history",
  "dua_v2_listening_links",
  "dua_v2_listening_sections",
  "dua_v2_listening_videos",
];

function rowKey(table:OfflineTable,row:Record<string,any>){
  switch(table){
    case "user_preferences": return String(row.owner_id);
    case "todos": return String(row.id);
    case "calendar_event_state": return String(row.id || `${row.owner_id}|${row.account_id}|${row.calendar_id}|${row.event_id}|${row.occurrence_date}`);
    case "reading_state": return String(row.id || `${row.owner_id}|${row.document_id}`);
    case "memorization_state": return String(row.id || `${row.owner_id}|${row.content_node_id}`);
    case "dua_v2_state": return String(row.owner_id);
    case "dua_v2_todos": return `${row.owner_id}|${row.id}`;
    case "dua_v2_counter_events": return `${row.owner_id}|${row.event_id}`;
    case "dua_v2_listening_history": return `${row.owner_id}|${row.video_id}`;
    case "dua_v2_listening_links": return `${row.owner_id}|${row.video_id}`;
    case "dua_v2_listening_sections": return `${row.owner_id}|${row.id}`;
    case "dua_v2_listening_videos": return `${row.owner_id}|${row.video_id}`;
  }
}

function openDb(){
  return new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){
      reject(new Error("IndexedDB kullanılamıyor."));
      return;
    }
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const table of TABLES){
        if(!db.objectStoreNames.contains(table)){
          const store=db.createObjectStore(table,{keyPath:"_localKey"});
          store.createIndex("owner_id","owner_id",{unique:false});
          if(table==="todos"){
            store.createIndex("related_library_item_id","related_library_item_id",{unique:false});
            store.createIndex("related_content_node_id","related_content_node_id",{unique:false});
          }
          if(table==="memorization_state"){
            store.createIndex("content_node_id","content_node_id",{unique:false});
          }
          if(table==="reading_state"){
            store.createIndex("document_id","document_id",{unique:false});
          }
        }
      }
      if(!db.objectStoreNames.contains(OUTBOX)){
        db.createObjectStore(OUTBOX,{keyPath:"id",autoIncrement:true});
      }
      if(!db.objectStoreNames.contains(META)){
        db.createObjectStore(META,{keyPath:"key"});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function txDone(tx:IDBTransaction){
  await new Promise<void>((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
}

export async function offlinePutRows(table:OfflineTable,rows:Record<string,any>[]){
  if(!isLocalDatabaseEnabled())return;
  if(!rows.length) return;
  const db=await openDb();
  try{
    const tx=db.transaction(table,"readwrite");
    const store=tx.objectStore(table);
    for(const row of rows){
      store.put({...row,_localKey:rowKey(table,row)});
    }
    await txDone(tx);
  }finally{db.close();}
}

export async function offlineReplaceRows(table:OfflineTable,rows:Record<string,any>[],ownerId:string){
  if(!isLocalDatabaseEnabled())return;
  const db=await openDb();
  try{
    // Safari/iPad can auto-close an IndexedDB transaction after an awaited
    // request. Read the keys in one transaction, then replace rows in a second.
    const readTx=db.transaction(table,"readonly");
    const keysReq=readTx.objectStore(table).index("owner_id").getAllKeys(ownerId);
    const keys=await new Promise<IDBValidKey[]>((resolve,reject)=>{
      keysReq.onsuccess=()=>resolve(keysReq.result || []);
      keysReq.onerror=()=>reject(keysReq.error);
    });
    await txDone(readTx);

    const writeTx=db.transaction(table,"readwrite");
    const store=writeTx.objectStore(table);
    for(const key of keys) store.delete(key);
    for(const row of rows) store.put({...row,_localKey:rowKey(table,row)});
    await txDone(writeTx);
  }finally{db.close();}
}

export async function offlineGetRows<T=any>(
  table:OfflineTable,
  ownerId:string,
  filter?:(row:T)=>boolean
):Promise<T[]>{
  if(!isLocalDatabaseEnabled()){
    if(!navigator.onLine)throw new Error("Supabase connection is required.");
    const {data,error}=await supabase.from(table).select("*").eq("owner_id",ownerId);
    if(error)throw error;
    return ((data??[]) as T[]).filter(row=>filter?filter(row):true);
  }
  const db=await openDb();
  try{
    const tx=db.transaction(table,"readonly");
    const req=tx.objectStore(table).index("owner_id").getAll(ownerId);
    const rows=await new Promise<any[]>((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result || []);
      req.onerror=()=>reject(req.error);
    });
    return rows.map(({_localKey,...row})=>row as T).filter(row=>filter?filter(row):true);
  }finally{db.close();}
}

export async function offlineGetOne<T=any>(
  table:OfflineTable,
  ownerId:string,
  filter?:(row:T)=>boolean
):Promise<T|null>{
  const rows=await offlineGetRows<T>(table,ownerId,filter);
  return rows[0] ?? null;
}

export async function offlinePatchRows(
  table:OfflineTable,
  ownerId:string,
  match:Record<string,unknown>,
  patch:Record<string,unknown>
){
  const rows=await offlineGetRows<any>(table,ownerId);
  const changed=rows.filter(row=>Object.entries(match).every(([k,v])=>row[k]===v));
  if(!changed.length) return;
  await offlinePutRows(table,changed.map(row=>({...row,...patch,updated_at:new Date().toISOString()})));
}

export async function offlineDeleteRows(
  table:OfflineTable,
  ownerId:string,
  match:Record<string,unknown>
){
  const rows=await offlineGetRows<any>(table,ownerId);
  const keys=rows
    .filter(row=>Object.entries(match).every(([k,v])=>row[k]===v))
    .map(row=>rowKey(table,row));
  if(!keys.length) return;
  const db=await openDb();
  try{
    const tx=db.transaction(table,"readwrite");
    const store=tx.objectStore(table);
    for(const key of keys) store.delete(key);
    await txDone(tx);
  }finally{db.close();}
}

async function queueMutation(mutation:OfflineMutation){
  const db=await openDb();
  try{
    const tx=db.transaction(OUTBOX,"readwrite");
    tx.objectStore(OUTBOX).add(mutation);
    await txDone(tx);
  }finally{db.close();}
  window.dispatchEvent(new CustomEvent("lumen-offline-queue-changed"));
}

export async function offlineUpsert(
  table:OfflineTable,
  ownerId:string,
  payload:Record<string,any>,
  options:{onConflict?:string;match?:Record<string,unknown>}={}
){
  const row={...payload,owner_id:payload.owner_id || ownerId,updated_at:payload.updated_at || new Date().toISOString()};
  if(!isLocalDatabaseEnabled()){
    if(!navigator.onLine)return {error:new Error("Supabase connection is required."),queued:false};
    const {error}=await supabase.from(table).upsert(row,options.onConflict?{onConflict:options.onConflict}:undefined);
    return {error,queued:false};
  }
  await offlinePutRows(table,[row]);

  if(!navigator.onLine){
    await queueMutation({ownerId,table,action:"upsert",payload:row,onConflict:options.onConflict,createdAt:new Date().toISOString()});
    return {error:null,queued:true};
  }

  let query:any=supabase.from(table).upsert(row,options.onConflict?{onConflict:options.onConflict}:undefined);
  const {error}=await query;
  if(error){
    await queueMutation({ownerId,table,action:"upsert",payload:row,onConflict:options.onConflict,createdAt:new Date().toISOString()});
    return {error,queued:true};
  }
  return {error:null,queued:false};
}

export async function offlineUpdate(
  table:OfflineTable,
  ownerId:string,
  match:Record<string,unknown>,
  patch:Record<string,any>
){
  if(!isLocalDatabaseEnabled()){
    if(!navigator.onLine)return {error:new Error("Supabase connection is required."),queued:false};
    let direct:any=supabase.from(table).update(patch);
    for(const [key,value] of Object.entries(match))direct=direct.eq(key,value);
    const {error}=await direct;
    return {error,queued:false};
  }
  await offlinePatchRows(table,ownerId,match,patch);
  if(!navigator.onLine){
    await queueMutation({ownerId,table,action:"update",payload:patch,match,createdAt:new Date().toISOString()});
    return {error:null,queued:true};
  }

  let query:any=supabase.from(table).update(patch);
  for(const [key,value] of Object.entries(match)) query=query.eq(key,value);
  const {error}=await query;
  if(error){
    await queueMutation({ownerId,table,action:"update",payload:patch,match,createdAt:new Date().toISOString()});
    return {error,queued:true};
  }
  return {error:null,queued:false};
}

export async function offlineLibraryItemUpdate(
  ownerId:string,
  row:Record<string,any>,
  patch:Record<string,any>
){
  const now=new Date().toISOString();
  const next={...row,...patch,updated_at:now};
  if(!isLocalDatabaseEnabled()){
    if(!navigator.onLine)return {error:new Error("Supabase connection is required."),queued:false};
    const {error}=await supabase.from("library_items").update({...patch,updated_at:now}).eq("id",row.id).eq("owner_id",ownerId);
    return {error,queued:false};
  }
  await putStaticRows("library_items",[next]);

  const mutation:OfflineMutation={
    ownerId,
    table:"library_items",
    action:"update",
    payload:{...patch,updated_at:now},
    match:{id:row.id,owner_id:ownerId},
    createdAt:now,
  };

  if(!navigator.onLine){
    await queueMutation(mutation);
    return {error:null,queued:true};
  }

  const {error}=await supabase
    .from("library_items")
    .update(mutation.payload || {})
    .eq("id",row.id)
    .eq("owner_id",ownerId);

  if(error){
    await queueMutation(mutation);
    return {error,queued:true};
  }
  return {error:null,queued:false};
}

export async function offlineDelete(
  table:OfflineTable,
  ownerId:string,
  match:Record<string,unknown>
){
  if(!isLocalDatabaseEnabled()){
    if(!navigator.onLine)return {error:new Error("Supabase connection is required."),queued:false};
    let direct:any=supabase.from(table).delete();
    for(const [key,value] of Object.entries(match))direct=direct.eq(key,value);
    const {error}=await direct;
    return {error,queued:false};
  }
  await offlineDeleteRows(table,ownerId,match);
  if(!navigator.onLine){
    await queueMutation({ownerId,table,action:"delete",match,createdAt:new Date().toISOString()});
    return {error:null,queued:true};
  }

  let query:any=supabase.from(table).delete();
  for(const [key,value] of Object.entries(match)) query=query.eq(key,value);
  const {error}=await query;
  if(error){
    await queueMutation({ownerId,table,action:"delete",match,createdAt:new Date().toISOString()});
    return {error,queued:true};
  }
  return {error:null,queued:false};
}

async function getOutbox():Promise<OfflineMutation[]>{
  const db=await openDb();
  try{
    const tx=db.transaction(OUTBOX,"readonly");
    const req=tx.objectStore(OUTBOX).getAll();
    return await new Promise<OfflineMutation[]>((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result || []);
      req.onerror=()=>reject(req.error);
    });
  }finally{db.close();}
}

async function deleteOutbox(id:number){
  const db=await openDb();
  try{
    const tx=db.transaction(OUTBOX,"readwrite");
    tx.objectStore(OUTBOX).delete(id);
    await txDone(tx);
  }finally{db.close();}
}

export async function flushOfflineOutbox(ownerId?:string):Promise<number>{
  const allRows=await getOutbox();
  let activeOwnerId=ownerId || null;
  if(!activeOwnerId){
    try{
      const {data}=await supabase.auth.getSession();
      activeOwnerId=data.session?.user?.id || null;
    }catch{}
  }
  const belongsToActiveUser=(mutation:OfflineMutation)=>{
    const mutationOwner=mutation.ownerId
      || String((mutation.payload as any)?.owner_id || "")
      || String((mutation.match as any)?.owner_id || "");
    return !activeOwnerId || !mutationOwner || mutationOwner===activeOwnerId;
  };
  if(!navigator.onLine) return allRows.filter(belongsToActiveUser).length;
  const rows=allRows.filter(belongsToActiveUser);
  for(const mutation of rows){
    if(!mutation.id) continue;
    try{
      let query:any;
      if(mutation.action==="upsert"){
        query=supabase.from(mutation.table).upsert(
          mutation.payload || {},
          mutation.onConflict ? {onConflict:mutation.onConflict} : undefined
        );
      }else if(mutation.action==="update"){
        query=supabase.from(mutation.table).update(mutation.payload || {});
        for(const [key,value] of Object.entries(mutation.match || {})) query=query.eq(key,value);
      }else{
        query=supabase.from(mutation.table).delete();
        for(const [key,value] of Object.entries(mutation.match || {})) query=query.eq(key,value);
      }
      const {error}=await query;
      if(error) throw error;
      await deleteOutbox(mutation.id);
    }catch{
      break;
    }
  }
  return (await getOutbox()).filter(belongsToActiveUser).length;
}

const PERSONAL_TABLES:OfflineTable[]=[
  "user_preferences",
  "todos",
  "calendar_event_state",
  "reading_state",
  "memorization_state",
  "dua_v2_state",
  "dua_v2_todos",
  "dua_v2_counter_events",
  "dua_v2_listening_history",
  "dua_v2_listening_links",
  "dua_v2_listening_sections",
  "dua_v2_listening_videos",
];

export async function syncPersonalOfflineData(ownerId:string){
  if(!isLocalDatabaseEnabled() || !navigator.onLine) return;
  const pending=await flushOfflineOutbox(ownerId);
  // If a local mutation could not be delivered yet, do not overwrite newer
  // device state with older server rows. Retry when connectivity is healthy.
  if(pending>0) return;

  for(const table of PERSONAL_TABLES){
    try{
      const {data,error}=await supabase.from(table).select("*").eq("owner_id",ownerId);
      if(error) throw error;
      await offlineReplaceRows(table,(data ?? []) as Record<string,any>[],ownerId);
    }catch(error){
      console.warn("Personal offline sync failed",table,error);
    }
  }

  // Google OAuth tokens stay server-side. Cache only sanitized account/calendar
  // metadata and a broad event window for offline calendar viewing.
  try{
    const {data:sessionData}=await supabase.auth.getSession();
    const token=sessionData.session?.access_token;
    if(token){
      const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
      const accountsResponse=await fetch("/api/google-calendar/accounts",{headers});
      if(accountsResponse.ok){
        const accountsJson=await accountsResponse.json();
        const accounts=(accountsJson.accounts ?? []) as any[];
        await offlineCacheSet("google-calendar-accounts:"+ownerId,accounts);

        const calendarKeys=accounts.flatMap(account=>
          (account.calendars ?? []).map((calendar:any)=>`${account.id}|${calendar.id}`)
        );
        if(calendarKeys.length){
          const year=new Date().getFullYear();
          const params=new URLSearchParams({
            timeMin:new Date(year-1,0,1).toISOString(),
            timeMax:new Date(year+2,0,1).toISOString(),
          });
          for(const key of calendarKeys) params.append("calendar",key);
          const eventsResponse=await fetch("/api/google-calendar/events?"+params.toString(),{headers});
          if(eventsResponse.ok){
            const eventsJson=await eventsResponse.json();
            await offlineCacheSet(
              "google-calendar-events-master:"+ownerId,
              (eventsJson.events ?? []) as any[]
            );
          }
        }
      }
    }
  }catch(error){
    console.warn("Google calendar offline cache refresh failed",error);
  }

  // Keep the fast localStorage mirror aligned with the authoritative server
  // after all pending preference writes have been delivered.
  try{
    const prefRows=await offlineGetRows<any>("user_preferences",ownerId);
    const prefs=prefRows[0]?.preferences;
    if(prefs && typeof prefs==="object"){
      localStorage.setItem("lumen-reader-prefs-v1",JSON.stringify(prefs));
    }
  }catch{}

  const db=await openDb();
  try{
    const tx=db.transaction(META,"readwrite");
    tx.objectStore(META).put({key:"last_personal_sync_at",value:new Date().toISOString()});
    await txDone(tx);
  }finally{db.close();}

  window.dispatchEvent(new CustomEvent("lumen-personal-sync",{detail:{state:"ready"}}));
}

async function currentOfflineOwnerId(){
  return await getOfflineOwnerId();
}

function mutationOwner(mutation:OfflineMutation){
  return mutation.ownerId
    || String((mutation.payload as any)?.owner_id || "")
    || String((mutation.match as any)?.owner_id || "")
    || null;
}

export async function offlineOutboxCount(ownerId?:string){
  const activeOwnerId=ownerId || await currentOfflineOwnerId();
  const rows=await getOutbox();
  return activeOwnerId
    ? rows.filter(row=>!mutationOwner(row) || mutationOwner(row)===activeOwnerId).length
    : rows.length;
}
export async function offlineHasPending(table:OfflineMutationTable,ownerId?:string){
  const activeOwnerId=ownerId || await currentOfflineOwnerId();
  return (await getOutbox()).some(row=>
    row.table===table && (!activeOwnerId || !mutationOwner(row) || mutationOwner(row)===activeOwnerId)
  );
}


export async function offlineCacheGet<T=unknown>(key:string):Promise<T|null>{
  const db=await openDb();
  try{
    const tx=db.transaction(META,"readonly");
    const req=tx.objectStore(META).get(key);
    return await new Promise<T|null>((resolve,reject)=>{
      req.onsuccess=()=>resolve((req.result?.value ?? null) as T|null);
      req.onerror=()=>reject(req.error);
    });
  }finally{db.close();}
}

export async function offlineCacheSet(key:string,value:unknown){
  const db=await openDb();
  try{
    const tx=db.transaction(META,"readwrite");
    tx.objectStore(META).put({key,value,updatedAt:new Date().toISOString()});
    await txDone(tx);
  }finally{db.close();}
}
