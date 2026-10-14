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
 const [nodes,setNodes]=useState<Record<string,{id:string;title:string|null;sort_order:number;text_content?:string|null;secondary_text?:string|null;translation?:string|null}[]>>({});
 const [loading,setLoading]=useState<string|null>(null);
 useEffect(()=>{const refresh=()=>setItems(readSavedMemorization(userId));refresh();window.addEventListener("lumen-memorization-list-changed",refresh);return()=>window.removeEventListener("lumen-memorization-list-changed",refresh);},[userId]);
 const open=async(id:string)=>{
   if(expanded===id){setExpanded(null);return;}
   setExpanded(id);
   if(nodes[id])return;
   setLoading(id);
   try{
     let rows=await getCachedContentByDocument(id);
     if(!rows.length&&navigator.onLine){const result=await supabase.from("content_nodes").select("id,title,sort_order,text_content,secondary_text,translation").eq("document_id",id).order("sort_order");rows=(result.data||[]) as typeof rows;}
     setNodes(old=>({...old,[id]:rows.map(r=>({id:r.id,title:r.title,sort_order:r.sort_order,text_content:r.text_content,secondary_text:r.secondary_text,translation:r.translation}))}));
   }catch{setNodes(old=>({...old,[id]:[]}));}
   finally{setLoading(null);}
 };
 const selected=items.find(item=>item.id===expanded);
 return <section className="savedMemorizationPage">
  <button type="button" className="savedMemorizationBack" onClick={()=>expanded?setExpanded(null):onBack()}>‹ Geri</button>
  <h2>{selected?.title || "Ezber Listem"}</h2>
  {!selected ? (
    <>
      <p>Ezberlemek istediğin duayı veya sûreyi seç.</p>
      {items.length===0?<p>Henüz bir içerik eklemedin. Ezber bölümünden bir dua açıp “Ezber Listeme Ekle” düğmesini kullan.</p>:(
        <div className="savedMemorizationItems">
          {items.map(item=><article key={item.id} className="savedMemorizationItem">
            <button type="button" className="savedMemorizationOpen" onClick={()=>void open(item.id)}>{item.title}<span aria-hidden="true">›</span></button>
            <button type="button" className="savedMemorizationRemove" aria-label={item.title+" listeden kaldır"} onClick={()=>{if(!window.confirm("Bu içeriği yalnızca Ezber Listem'den kaldırmak istiyor musun?"))return;localStorage.setItem(key(userId),JSON.stringify(items.filter(row=>row.id!==item.id)));setItems(readSavedMemorization(userId));}}>Kaldır</button>
          </article>)}
        </div>
      )}
    </>
  ) : (
    <div className="savedMemorizationSections">
      {loading===selected.id&&<p>Bölümler yükleniyor…</p>}
      {loading!==selected.id&&nodes[selected.id]?.length===0&&<p>Bölümler çevrimdışı bulunamadı. İçeriği çevrimiçiyken bir kez açıp senkronize et.</p>}
      {nodes[selected.id]?.map((node,index)=>selected.indices.length&&!selected.indices.includes(index)?null:(
        <button type="button" key={node.id} className="savedMemorizationSection" onClick={()=>onOpen(selected,index)}>
          <strong className="savedMemorizationSectionNumber">{index+1}. Bölüm</strong>
          {node.secondary_text&&<span className="savedMemorizationArabic" dir="rtl">{node.secondary_text}</span>}
          {node.text_content&&<span className="savedMemorizationLatin">{node.text_content}</span>}
          {node.translation&&<span className="savedMemorizationTranslation">{node.translation}</span>}
          {!node.secondary_text&&!node.text_content&&!node.translation&&<span>{node.title || "Bölümü aç"}</span>}
        </button>
      ))}
    </div>
  )}
 </section>;
}
