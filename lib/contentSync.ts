"use client";

import { supabase } from "@/lib/supabase/client";
import { clearStaticStore, getMeta, putStaticRows, setMeta } from "@/lib/localContentDb";

type StaticTable = "library_items"|"content_nodes"|"quran_mushaf_pages"|"quran_mushaf_sources"|"quran_mushaf_source_chunks"|"media_sources"|"media_segments";
type Fingerprint = { count:number; maxUpdatedAt:string|null };

const TABLES: StaticTable[] = [
  "library_items",
  "content_nodes",
  "quran_mushaf_pages",
  "quran_mushaf_sources",
  "quran_mushaf_source_chunks",
  "media_sources",
  "media_segments",
];
const PAGE_SIZE = 750;

async function remoteFingerprint(table:StaticTable):Promise<Fingerprint>{
  const countResult = await supabase.from(table).select("id",{count:"exact",head:true});
  if(countResult.error) throw countResult.error;

  const latestResult = await supabase
    .from(table)
    .select("updated_at")
    .order("updated_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(latestResult.error) throw latestResult.error;

  return {
    count:countResult.count ?? 0,
    maxUpdatedAt:(latestResult.data as any)?.updated_at ?? null,
  };
}

async function fetchRows(table:StaticTable,after:string|null){
  const rows:any[]=[];
  let from=0;

  while(true){
    let query=supabase
      .from(table)
      .select("*")
      .order("updated_at",{ascending:true})
      .order("id",{ascending:true})
      .range(from,from+PAGE_SIZE-1);

    if(after) query=query.gt("updated_at",after);

    const {data,error}=await query;
    if(error) throw error;
    const batch=data ?? [];
    rows.push(...batch);
    if(batch.length<PAGE_SIZE) break;
    from+=PAGE_SIZE;
  }
  return rows;
}

async function fullSync(table:StaticTable,remote:Fingerprint){
  const rows=await fetchRows(table,null);
  await clearStaticStore(table);
  await putStaticRows(table,rows);
  await setMeta(`fingerprint:${table}`,remote);
}

async function incrementalSync(table:StaticTable,local:Fingerprint,remote:Fingerprint){
  const changed=await fetchRows(table,local.maxUpdatedAt);
  await putStaticRows(table,changed);

  // Additions/updates are cheap to merge. If the row count does not reconcile,
  // a deletion/replacement happened, so rebuild this static table once.
  const expected=local.count + changed.filter(row=>String(row.updated_at||"")>String(local.maxUpdatedAt||"")).length;
  if(remote.count<local.count || (remote.count!==local.count && expected<remote.count)){
    await fullSync(table,remote);
    return;
  }
  await setMeta(`fingerprint:${table}`,remote);
}

let syncPromise:Promise<void>|null=null;

export function syncStaticContentInBackground(ownerId:string, options:{forceFull?:boolean} = {}){
  if(typeof window==="undefined") return Promise.resolve();
  if(!navigator.onLine) return Promise.resolve();
  if(syncPromise) return syncPromise;

  syncPromise=(async()=>{
    const cachedOwner=await getMeta<string>("cache_owner_id");
    if(cachedOwner && cachedOwner!==ownerId){
      for(const table of TABLES) await clearStaticStore(table);
      for(const table of TABLES) await setMeta(`fingerprint:${table}`,null);
      await setMeta("initial_sync_complete",false);
    }
    await setMeta("cache_owner_id",ownerId);

    window.dispatchEvent(new CustomEvent("lumen-static-sync",{detail:{state:"checking"}}));

    for(let index=0; index<TABLES.length; index+=1){
      const table=TABLES[index];
      const remote=await remoteFingerprint(table);
      const local=await getMeta<Fingerprint>(`fingerprint:${table}`);

      if(options.forceFull || !local){
        window.dispatchEvent(new CustomEvent("lumen-static-sync",{detail:{
          state:"downloading",
          table,
          firstSync:!local,
          forceFull:options.forceFull===true,
          tableIndex:index+1,
          tableCount:TABLES.length
        }}));
        await fullSync(table,remote);
        continue;
      }

      if(local.count===remote.count && local.maxUpdatedAt===remote.maxUpdatedAt) continue;

      window.dispatchEvent(new CustomEvent("lumen-static-sync",{detail:{
        state:"downloading",
        table,
        firstSync:false,
        forceFull:false,
        tableIndex:index+1,
        tableCount:TABLES.length
      }}));
      await incrementalSync(table,local,remote);
    }

    await setMeta("initial_sync_complete",true);
    await setMeta("last_sync_at",new Date().toISOString());
    window.dispatchEvent(new CustomEvent("lumen-static-sync",{detail:{state:"ready"}}));
  })()
    .catch(error=>{
      console.warn("Static content sync failed",error);
      window.dispatchEvent(new CustomEvent("lumen-static-sync",{detail:{state:"error",message:error instanceof Error?error.message:String(error)}}));
    })
    .finally(()=>{syncPromise=null;});

  return syncPromise;
}
