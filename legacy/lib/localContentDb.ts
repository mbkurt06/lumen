"use client";
import {supabase} from "@/lib/supabase/client";
import {isLocalDatabaseEnabled} from "@/lib/storageMode";

async function remoteRows(table:string,field:string,value:unknown):Promise<any[]>{
 if(typeof navigator!=="undefined"&&!navigator.onLine)throw new Error("Supabase connection is required.");
 const {data,error}=await supabase.from(table).select("*").eq(field,value).order("sort_order");
 if(error)throw error;
 return data??[];
}


export type CachedLibraryItem = {
  id:string;
  owner_id?:string;
  parent_id:string|null;
  kind:string;
  title:string;
  subtitle?:string|null;
  sort_order:number;
  is_favorite?:boolean;
  metadata?:Record<string,unknown>|null;
  created_at?:string;
  updated_at?:string;
};

export type CachedContentNode = {
  id:string;
  owner_id?:string;
  document_id:string;
  parent_id?:string|null;
  kind:string;
  sort_order:number;
  title:string|null;
  text_content:string|null;
  secondary_text:string|null;
  translation:string|null;
  metadata?:Record<string,unknown>|null;
  created_at?:string;
  updated_at?:string;
};

export type CachedQuranPage = {
  id?:string;
  owner_id?:string;
  source_key:string;
  word_page:number;
  display_page:number;
  surah_numbers:number[];
  juz:number|null;
  plain_text:string;
  rich_content:any;
  source_sha256?:string|null;
  metadata?:Record<string,unknown>|null;
  created_at?:string;
  updated_at?:string;
};

const DB_NAME="lumen-static-content";
const DB_VERSION=2;

function openDb(){
  return new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){
      reject(new Error("IndexedDB kullanılamıyor."));
      return;
    }
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains("library_items")){
        const store=db.createObjectStore("library_items",{keyPath:"id"});
        store.createIndex("parent_id","parent_id",{unique:false});
        store.createIndex("source","metadata.source",{unique:false});
      }
      if(!db.objectStoreNames.contains("content_nodes")){
        const store=db.createObjectStore("content_nodes",{keyPath:"id"});
        store.createIndex("document_id","document_id",{unique:false});
        store.createIndex("source","metadata.source",{unique:false});
        store.createIndex("page","metadata.page",{unique:false});
      }
      if(!db.objectStoreNames.contains("quran_mushaf_pages")){
        const store=db.createObjectStore("quran_mushaf_pages",{keyPath:"id"});
        store.createIndex("source_word_page",["source_key","word_page"],{unique:false});
      }
      for(const extraStore of ["quran_mushaf_sources","quran_mushaf_source_chunks","media_sources","media_segments"]){
        if(!db.objectStoreNames.contains(extraStore)){
          db.createObjectStore(extraStore,{keyPath:"id"});
        }
      }
      if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta",{keyPath:"key"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function withStore<T>(storeName:string,mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>|void){
  const db=await openDb();
  try{
    return await new Promise<T|undefined>((resolve,reject)=>{
      const tx=db.transaction(storeName,mode);
      const store=tx.objectStore(storeName);
      let request:IDBRequest<T>|void;
      try{ request=work(store); }catch(error){ reject(error); return; }
      if(request){
        request.onsuccess=()=>resolve(request!.result);
        request.onerror=()=>reject(request!.error);
      }else{
        tx.oncomplete=()=>resolve(undefined);
      }
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }finally{
    db.close();
  }
}

function allFromIndex<T>(storeName:string,indexName:string,key:IDBValidKey){
  return new Promise<T[]>(async(resolve,reject)=>{
    let db:IDBDatabase|null=null;
    try{
      db=await openDb();
      const tx=db.transaction(storeName,"readonly");
      const req=tx.objectStore(storeName).index(indexName).getAll(key);
      req.onsuccess=()=>resolve((req.result??[]) as T[]);
      req.onerror=()=>reject(req.error);
    }catch(error){reject(error);}
    finally{
      // Closed by transaction completion below.
      if(db){
        const current=db;
        setTimeout(()=>current.close(),0);
      }
    }
  });
}

export async function getMeta<T=unknown>(key:string):Promise<T|null>{
  const row=await withStore<any>("meta","readonly",store=>store.get(key));
  return row?.value ?? null;
}

export async function setMeta(key:string,value:unknown){
  await withStore("meta","readwrite",store=>store.put({key,value}));
}

export type StaticStoreName="library_items"|"content_nodes"|"quran_mushaf_pages"|"quran_mushaf_sources"|"quran_mushaf_source_chunks"|"media_sources"|"media_segments";

export async function clearStaticStore(storeName:StaticStoreName){
  await withStore(storeName,"readwrite",store=>store.clear());
}

export async function putStaticRows(storeName:StaticStoreName,rows:any[]){
  if(!rows.length || !isLocalDatabaseEnabled()) return;
  const db=await openDb();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(storeName,"readwrite");
      const store=tx.objectStore(storeName);
      for(const row of rows){
        const normalized = storeName==="quran_mushaf_pages" && !row.id
          ? {...row,id:`${row.source_key}:${row.word_page}`}
          : row;
        store.put(normalized);
      }
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close();}
}

export async function getCachedLibraryItem(id:string){
  if(!isLocalDatabaseEnabled())return (await remoteRows("library_items","id",id))[0]??null;
  const row=await withStore<CachedLibraryItem>("library_items","readonly",store=>store.get(id));
  return row ?? null;
}

export async function getCachedContentNode(id:string){
  if(!isLocalDatabaseEnabled())return (await remoteRows("content_nodes","id",id))[0]??null;
  const row=await withStore<CachedContentNode>("content_nodes","readonly",store=>store.get(id));
  return row ?? null;
}

export async function getCachedLibraryChildren(parentId:string){
  if(!isLocalDatabaseEnabled())return remoteRows("library_items","parent_id",parentId);
  const rows=await allFromIndex<CachedLibraryItem>("library_items","parent_id",parentId);
  return rows.sort((a,b)=>(a.sort_order-b.sort_order)||a.title.localeCompare(b.title,"tr"));
}

export async function getCachedLibraryRoot(source:string){
  if(!isLocalDatabaseEnabled()){
    const {data,error}=await supabase.from("library_items").select("*").eq("metadata->>source",source).is("parent_id",null);
    if(error)throw error;
    return (data??[]).find(row=>(row.metadata as any)?.entity==="root")??null;
  }
  const rows=await allFromIndex<CachedLibraryItem>("library_items","source",source);
  return rows
    .filter(row=>{
      const m=(row.metadata??{}) as Record<string,unknown>;
      return m.entity==="root" && (m.fully_seeded===true || source==="dua_v2");
    })
    .sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")))[0] ?? null;
}

export async function getCachedContentByDocument(documentId:string){
  if(!isLocalDatabaseEnabled())return remoteRows("content_nodes","document_id",documentId);
  const rows=await allFromIndex<CachedContentNode>("content_nodes","document_id",documentId);
  return rows.sort((a,b)=>a.sort_order-b.sort_order);
}

export async function getCachedQuranNodesByPage(page:number){
  if(!isLocalDatabaseEnabled()){
    const {data,error}=await supabase.from("content_nodes").select("*").eq("metadata->>page",String(page)).eq("metadata->>source","quran_seeded");
    if(error)throw error;
    return data??[];
  }
  const [numericRows,stringRows]=await Promise.all([
    allFromIndex<CachedContentNode>("content_nodes","page",page),
    allFromIndex<CachedContentNode>("content_nodes","page",String(page)),
  ]);
  const rows=[...numericRows,...stringRows.filter(row=>!numericRows.some(item=>item.id===row.id))];
  return rows
    .filter(row=>(row.metadata as any)?.source==="quran_seeded")
    .sort((a,b)=>{
      const am=(a.metadata??{}) as any;
      const bm=(b.metadata??{}) as any;
      return Number(am.surah_no||0)-Number(bm.surah_no||0)
        || Number(am.ayah_no||a.sort_order||0)-Number(bm.ayah_no||b.sort_order||0);
    });
}

export async function getCachedQuranMushafPage(sourceKey:string,wordPage:number){
  if(!isLocalDatabaseEnabled()){
    const {data,error}=await supabase.from("quran_mushaf_pages").select("*").eq("source_key",sourceKey).eq("word_page",wordPage).maybeSingle();
    if(error)throw error;
    return data??null;
  }
  const rows=await allFromIndex<CachedQuranPage>("quran_mushaf_pages","source_word_page",[sourceKey,wordPage]);
  return rows[0] ?? null;
}

export async function hasStaticCache(){
  return (await getMeta<boolean>("initial_sync_complete"))===true;
}
