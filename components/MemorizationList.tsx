"use client";
import {useEffect,useState} from "react";
import {getCachedContentByDocument} from "@/lib/localContentDb";
import {supabase} from "@/lib/supabase/client";

export type SavedMemorization={id:string;title:string;subtitle?:string|null;metadata?:Record<string,unknown>|null;indices:number[]};
const key=(userId:string)=>"lumen-ezber-listem-v1:"+userId;
export function readSavedMemorization(userId:string):SavedMemorization[]{
  try{const data=JSON.parse(localStorage.getItem(key(userId))||"[]");return Array.isArray(data)?data:[];}catch{return [];}
}
export function saveMemorization(userId:string,item:SavedMemorization){
  const list=readSavedMemorization(userId);const at=list.findIndex(entry=>entry.id===item.id);
  if(at>=0)list[at]=item;else list.push(item);
  localStorage.setItem(key(userId),JSON.stringify(list));
  window.dispatchEvent(new Event("lumen-memorization-list-changed"));
}
export function MemorizationList({userId,onOpen,onBack}:{userId:string;onOpen:(item:SavedMemorization,index:number)=>void;onBack:()=>void}){
 const [items,setItems]=useState<SavedMemorization[]>([]);
 const [expanded,setExpanded]=useState<string|null>(null);
 const [nodes,setNodes]=useState<Record<string,{id:string;title:string|null;sort_order:number}[]>>({});
 const [loading,setLoading]=useState<string|null>(null);
 useEffect(()=>{const refresh=()=>setItems(readSavedMemorization(userId));refresh();window.addEventListener("lumen-memorization-list-changed",refresh);return()=>window.removeEventListener("lumen-memorization-list-changed",refresh);},[userId]);
 const open=async(id:string)=>{
   if(expanded===id){setExpanded(null);return;}
   setExpanded(id);
   if(nodes[id])return;
   setLoading(id);
   try{
     let rows=await getCachedContentByDocument(id);
     if(!rows.length&&navigator.onLine){const result=await supabase.from("content_nodes").select("id,title,sort_order").eq("document_id",id).order("sort_order");rows=(result.data||[]) as typeof rows;}
     setNodes(old=>({...old,[id]:rows.map(r=>({id:r.id,title:r.title,sort_order:r.sort_order}))}));
   }catch{setNodes(old=>({...old,[id]:[]}));}
   finally{setLoading(null);}
 };
 return <section style={{padding:"66px 16px 30px",maxWidth:900,margin:"auto"}}>
  <button onClick={onBack} style={{marginBottom:14}}>‹ Geri</button><h2>Ezber Listem</h2>
  <p>Eklediğin dualar ve sûreler. Bir bölümü seçerek tek sayfalık ezber ekranında çalışabilirsin.</p>
  {items.length===0?<p>Henüz bir içerik eklemedin. Ezber bölümünden bir dua açıp “Ezber Listeme Ekle” düğmesini kullan.</p>:items.map(item=><article key={item.id} style={{border:"1px solid #ccc",borderRadius:12,padding:14,marginBottom:12}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
    <button style={{flex:1,textAlign:"left",fontWeight:700}} onClick={()=>void open(item.id)} aria-expanded={expanded===item.id}>{item.title} {expanded===item.id?"⌃":"⌄"}</button>
    <button aria-label={item.title+" listeden kaldır"} onClick={()=>{if(!window.confirm("Bu içeriği yalnızca Ezber Listem'den kaldırmak istiyor musun?"))return;localStorage.setItem(key(userId),JSON.stringify(items.filter(row=>row.id!==item.id)));setItems(readSavedMemorization(userId));}}>Kaldır</button>
   </div>
   {expanded===item.id&&<div style={{display:"grid",gap:6,marginTop:12}}>
    {loading===item.id&&<span>Bölümler yükleniyor…</span>}
    {nodes[item.id]?.length===0&&<span>Bölümler çevrimdışı bulunamadı. İçeriği çevrimiçiyken bir kez açıp senkronize et.</span>}
    {nodes[item.id]?.map((node,index)=>item.indices.length&& !item.indices.includes(index)?null:<button key={node.id} onClick={()=>onOpen(item,index)} style={{padding:12,textAlign:"left",border:"1px solid #ddd",borderRadius:8,background:"transparent"}}>{index+1}. Bölüm{node.title? " — "+node.title:""}</button>)}
   </div>}
  </article>)}
 </section>;
}
