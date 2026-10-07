"use client";

import { useEffect, useMemo, useState } from "react";

type RisaleNode = {
  id:string;
  title:string|null;
  text_content:string|null;
  secondary_text:string|null;
  translation:string|null;
  sort_order:number;
  metadata?:Record<string,unknown>|null;
};

function nodeWeight(node:RisaleNode){
  const title=(node.title||"").length;
  const text=(node.text_content||"").length;
  const arabic=(node.secondary_text||"").length;
  const translation=(node.translation||"").length;
  return text + translation + Math.round(arabic*1.25) + title*2.2 + (node.title ? 180 : 40);
}

function paginate(nodes:RisaleNode[],target=2250){
  const pages:RisaleNode[][]=[];
  let current:RisaleNode[]=[];
  let weight=0;

  for(const node of nodes){
    const w=nodeWeight(node);
    const heading=!!node.title && !node.text_content && !node.secondary_text;

    if(current.length && (weight+w>target || (heading && weight>target*.78))){
      pages.push(current);
      current=[];
      weight=0;
    }

    current.push(node);
    weight+=w;

    if(heading && weight>target*.9){
      pages.push(current);
      current=[];
      weight=0;
    }
  }
  if(current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

export function RisaleBookView({
  itemId,
  title,
  bookTitle,
  nodes,
  hasPreviousDocument=false,
  hasNextDocument=false,
  onPreviousDocument,
  onNextDocument,
}:{
  itemId:string;
  title:string;
  bookTitle?:string;
  nodes:RisaleNode[];
  hasPreviousDocument?:boolean;
  hasNextDocument?:boolean;
  onPreviousDocument?:()=>void;
  onNextDocument?:()=>void;
}){
  const [page,setPage]=useState(0);
  const [fontScale,setFontScale]=useState(1);
  const pages=useMemo(()=>paginate(nodes,2250/Math.pow(fontScale,1.65)),[nodes,fontScale]);

  useEffect(()=>{
    let restoredPage=0;
    try {
      const saved=Number(localStorage.getItem("lumen-risale-page:"+itemId) || 0);
      if(Number.isFinite(saved) && saved>=0) restoredPage=saved;
    } catch {}
    setPage(Math.min(restoredPage,Math.max(0,pages.length-1)));
  },[itemId,title,pages.length]);
  useEffect(()=>{
    const readScale=()=>{
      const raw=getComputedStyle(document.documentElement).getPropertyValue("--font-scale");
      const value=Number.parseFloat(raw);
      setFontScale(Number.isFinite(value) && value>0 ? value : 1);
    };
    readScale();
    window.addEventListener("lumen-library-prefs",readScale as EventListener);
    return()=>window.removeEventListener("lumen-library-prefs",readScale as EventListener);
  },[]);
  useEffect(()=>setPage(current=>Math.min(current,pages.length-1)),[pages.length]);
  useEffect(()=>{
    try { localStorage.setItem("lumen-risale-page:"+itemId,String(page)); } catch {}
  },[itemId,page]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="ArrowLeft"){
        if(page>0){
          event.preventDefault();
          setPage(v=>Math.max(0,v-1));
        }else if(hasPreviousDocument && onPreviousDocument){
          event.preventDefault();
          onPreviousDocument();
        }
      }
      if(event.key==="ArrowRight"){
        if(page<pages.length-1){
          event.preventDefault();
          setPage(v=>Math.min(pages.length-1,v+1));
        }else if(hasNextDocument && onNextDocument){
          event.preventDefault();
          onNextDocument();
        }
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[page,pages.length,hasPreviousDocument,hasNextDocument,onPreviousDocument,onNextDocument]);

  const visible=pages[page] ?? [];

  return (
    <div className="risaleBookReader">
      <nav className="risalePagePager" aria-label="Risale sayfa geçişi">
        <button
          disabled={page<=0 && !hasPreviousDocument}
          onClick={()=>{
            if(page>0) setPage(v=>Math.max(0,v-1));
            else onPreviousDocument?.();
          }}
        >
          {page>0 ? "‹ Önceki sayfa" : "‹ Önceki bölüm"}
        </button>
        <span>{page+1} / {pages.length}</span>
        <button
          disabled={page>=pages.length-1 && !hasNextDocument}
          onClick={()=>{
            if(page<pages.length-1) setPage(v=>Math.min(pages.length-1,v+1));
            else onNextDocument?.();
          }}
        >
          {page<pages.length-1 ? "Sonraki sayfa ›" : "Sonraki bölüm ›"}
        </button>
      </nav>

      <section className="risaleBookPage">
        <header className="risaleBookPageHead">
          <strong>{bookTitle || "Risale-i Nur"}</strong>
          <span>{page+1}</span>
        </header>

        <div className="risaleBookPageBody">
          {page===0 && <h1 className="risaleBookDocumentTitle">{title}</h1>}
          {visible.map(node=>(
            <div className="risaleBookBlock" key={node.id} data-node-id={node.id}>
              {node.title && <h2>{node.title}</h2>}
              {node.secondary_text && <p className="risaleBookArabic" dir="rtl">{node.secondary_text}</p>}
              {node.text_content && <p>{node.text_content}</p>}
              {node.translation && <p className="risaleBookTranslation">{node.translation}</p>}
            </div>
          ))}
        </div>

        <footer className="risaleBookPageFoot">{page+1}</footer>
      </section>
    </div>
  );
}
