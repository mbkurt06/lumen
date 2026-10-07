"use client";

type ApiVerse = {
  verse_number?: number;
  transcription?: string | null;
};

type ApiSurahResponse = {
  data?: {
    zero?: ApiVerse | null;
    verses?: ApiVerse[];
  };
};

const memory = new Map<number, Record<number,string>>();
const pending = new Map<number, Promise<Record<number,string>>>();

function cacheKey(surahNo:number){
  return `lumen-quran-tr-transcription-v1:${surahNo}`;
}

function clean(value:string){
  return value
    .replace(/\s+/g," ")
    .replace(/\s+([.,;:!?])/g,"$1")
    .trim();
}

export async function loadTurkishQuranTranscription(surahNo:number):Promise<Record<number,string>>{
  const known=memory.get(surahNo);
  if(known) return known;

  if(typeof window!=="undefined"){
    try{
      const raw=localStorage.getItem(cacheKey(surahNo));
      if(raw){
        const parsed=JSON.parse(raw) as Record<number,string>;
        memory.set(surahNo,parsed);
        return parsed;
      }
    }catch{}
  }

  const active=pending.get(surahNo);
  if(active) return active;

  const request=(async()=>{
    const response=await fetch(`https://api.acikkuran.com/surah/${surahNo}`,{
      headers:{Accept:"application/json"},
      cache:"force-cache",
    });
    if(!response.ok) throw new Error(`Kur’an okunuş kaynağı alınamadı (${response.status}).`);
    const payload=await response.json() as ApiSurahResponse;
    const result:Record<number,string>={};

    const verses=payload.data?.verses ?? [];
    for(const verse of verses){
      const no=Number(verse.verse_number || 0);
      const text=clean(String(verse.transcription || ""));
      if(no>0 && text) result[no]=text;
    }

    // Fâtiha API cevabında besmele bazı sürümlerde zero alanında gelebiliyor.
    if(surahNo===1 && payload.data?.zero?.transcription && !result[1]){
      result[1]=clean(payload.data.zero.transcription);
    }

    memory.set(surahNo,result);
    if(typeof window!=="undefined"){
      try{localStorage.setItem(cacheKey(surahNo),JSON.stringify(result));}catch{}
    }
    return result;
  })().finally(()=>pending.delete(surahNo));

  pending.set(surahNo,request);
  return request;
}
