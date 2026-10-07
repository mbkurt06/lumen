"use client";

type ApiSurahResponse = {
  surah?: number;
  verses?: Record<string,string>;
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
    const response=await fetch(`/api/quran-transcription/${surahNo}`,{
      headers:{Accept:"application/json"},
      cache:"force-cache",
    });
    if(!response.ok) throw new Error(`Kur’an okunuş kaynağı alınamadı (${response.status}).`);
    const payload=await response.json() as ApiSurahResponse;
    const result:Record<number,string>={};

    for(const [ayahNo,value] of Object.entries(payload.verses ?? {})){
      const no=Number(ayahNo);
      const text=clean(String(value || ""));
      if(no>0 && text) result[no]=text;
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
