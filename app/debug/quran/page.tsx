"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type PageRow = {
  word_page:number;
  display_page:number;
  juz:number|null;
  surah_numbers:number[]|null;
  plain_text:string|null;
  rich_content:any;
  metadata:any;
};

export default function QuranDebugPage() {
  const [page,setPage]=useState(2);
  const [row,setRow]=useState<PageRow|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [fontChecks,setFontChecks]=useState<Record<string,boolean>>({});

  async function load() {
    setLoading(true);
    setError("");
    const {data,error}=await supabase
      .from("quran_mushaf_pages")
      .select("word_page,display_page,juz,surah_numbers,plain_text,rich_content,metadata")
      .eq("source_key","istanbul_mushaf_docx")
      .eq("word_page",page)
      .maybeSingle();
    if(error){ setError(error.message); setRow(null); }
    else setRow(data as PageRow|null);
    setLoading(false);
  }

  useEffect(()=>{ void load(); },[page]);

  useEffect(()=>{
    if(typeof document==="undefined") return;
    const fonts=[
      "LumenExactMushaf",
      "Shaikh Hamdullah Mushaf",
      "Noto Naskh Arabic",
      "Geeza Pro",
      "Traditional Arabic"
    ];
    const out:Record<string,boolean>={};
    for(const f of fonts) out[f]=document.fonts?.check(`24px "${f}"`) ?? false;
    setFontChecks(out);
  },[row]);

  const firstRun=useMemo(()=>{
    try{return row?.rich_content?.paragraphs?.[0]?.runs?.[0]?.text ?? "";}
    catch{return "";}
  },[row]);

  function exportDebug() {
    const payload={
      exportedAt:new Date().toISOString(),
      location:window.location.href,
      userAgent:navigator.userAgent,
      pageRequested:page,
      row,
      firstRun,
      computed:{
        plainLength:row?.plain_text?.length ?? 0,
        firstRunLength:firstRun.length,
        metadata:row?.metadata ?? null,
        fonts:fontChecks,
      }
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`quran-debug-page-${page}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sample=row?.plain_text || "";

  return (
    <main style={{padding:24,maxWidth:1200,margin:"0 auto",fontFamily:"system-ui"}}>
      <h1>Kur’an Debug Ekranı</h1>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:16}}>
        <label>word_page</label>
        <input type="number" min={1} max={604} value={page} onChange={e=>setPage(Number(e.target.value)||1)} />
        <button onClick={()=>void load()}>Yeniden oku</button>
        <button onClick={exportDebug} disabled={!row}>Debug JSON dışa aktar</button>
        <a href="/">Ana uygulama</a>
      </div>

      {loading&&<p>Yükleniyor…</p>}
      {error&&<pre style={{color:"crimson"}}>{error}</pre>}

      <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12,marginBottom:20}}>
        <DebugBox title="DB eşleşmesi" value={row ? "Kayıt bulundu" : "Kayıt yok"} />
        <DebugBox title="plain_text uzunluğu" value={String(row?.plain_text?.length ?? 0)} />
        <DebugBox title="rich first run uzunluğu" value={String(firstRun.length)} />
        <DebugBox title="display_page" value={String(row?.display_page ?? "-")} />
        <DebugBox title="juz" value={String(row?.juz ?? "-")} />
        <DebugBox title="exactWordCharacters" value={String(row?.metadata?.exactWordCharacters ?? "-")} />
      </section>

      <h2>1. Ham plain_text</h2>
      <pre style={{whiteSpace:"pre-wrap",direction:"rtl",unicodeBidi:"plaintext",fontSize:24,lineHeight:1.8,border:"1px solid #888",padding:16,minHeight:140}}>
        {sample || "(boş)"}
      </pre>

      <h2>2. Sistem fontu ile</h2>
      <div dir="rtl" style={{whiteSpace:"pre-wrap",fontSize:28,lineHeight:1.8,fontFamily:"Arial, sans-serif",border:"1px solid #888",padding:16,minHeight:140}}>
        {sample || "(boş)"}
      </div>

      <h2>3. Noto/Geeza/Traditional zinciri ile</h2>
      <div dir="rtl" style={{whiteSpace:"pre-wrap",fontSize:28,lineHeight:1.8,fontFamily:'"Noto Naskh Arabic","Geeza Pro","Traditional Arabic",serif',border:"1px solid #888",padding:16,minHeight:140}}>
        {sample || "(boş)"}
      </div>

      <h2>4. rich_content ilk run</h2>
      <pre style={{whiteSpace:"pre-wrap",direction:"rtl",unicodeBidi:"plaintext",fontSize:24,lineHeight:1.8,border:"1px solid #888",padding:16,minHeight:100}}>
        {firstRun || "(boş)"}
      </pre>

      <h2>5. Font kontrolü</h2>
      <pre>{JSON.stringify(fontChecks,null,2)}</pre>

      <h2>6. Metadata</h2>
      <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(row?.metadata ?? null,null,2)}</pre>

      <h2>7. rich_content yapı özeti</h2>
      <pre style={{whiteSpace:"pre-wrap",maxHeight:420,overflow:"auto"}}>
        {JSON.stringify({
          version:row?.rich_content?.version,
          paragraphs:row?.rich_content?.paragraphs?.map((p:any)=>({
            style:p?.style,
            runCount:Array.isArray(p?.runs)?p.runs.length:0,
            sample:p?.runs?.slice?.(0,3)?.map?.((r:any)=>({text:r?.text,font:r?.font,rtl:r?.rtl,runStyle:r?.runStyle}))
          }))
        },null,2)}
      </pre>
    </main>
  );
}

function DebugBox({title,value}:{title:string;value:string}) {
  return <div style={{border:"1px solid #777",borderRadius:8,padding:12}}><div style={{fontSize:12,opacity:.7}}>{title}</div><strong>{value}</strong></div>;
}
