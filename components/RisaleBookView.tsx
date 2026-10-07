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
  title,
  bookTitle,
  nodes,
}:{
  title:string;
  bookTitle?:string;
  nodes:RisaleNode[];
}){
  const [page,setPage]=useState(0);
  const pages=useMemo(()=>paginate(nodes),[nodes]);

  useEffect(()=>setPage(0),[title]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="ArrowLeft" && page<pages.length-1){
        event.preventDefault();
        setPage(v=>Math.min(pages.length-1,v+1));
      }
      if(event.key==="ArrowRight" && page>0){
        event.preventDefault();
        setPage(v=>Math.max(0,v-1));
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[page,pages.length]);

  const visible=pages[page] ?? [];

  return (
    <div className="risaleBookReader">
      <nav className="risalePagePager" aria-label="Risale sayfa geçişi">
        <button disabled={page>=pages.length-1} onClick={()=>setPage(v=>Math.min(pages.length-1,v+1))}>
          ‹ Sonraki sayfa
        </button>
        <span>{page+1} / {pages.length}</span>
        <button disabled={page<=0} onClick={()=>setPage(v=>Math.max(0,v-1))}>
          Önceki sayfa ›
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
