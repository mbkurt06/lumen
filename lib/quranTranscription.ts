"use client";

type ApiSurahResponse = {
  surah?: number;
  verses?: Record<string,string>;
};

const memory = new Map<number, Record<number,string>>();
const pending = new Map<number, Promise<Record<number,string>>>();

function cacheKey(surahNo:number){
  return `lumen-quran-tr-transcription-v2:${surahNo}`;
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
        if(Object.keys(parsed).length){
          memory.set(surahNo,parsed);
          return parsed;
        }
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


export async function loadTurkishQuranAyahTranscription(
  surahNo:number,
  ayahNo:number
):Promise<string>{
  const cached=await loadTurkishQuranTranscription(surahNo).catch(()=>({}));
  if(cached[ayahNo]) return cached[ayahNo];

  const response=await fetch(
    `/api/quran-transcription/${surahNo}?ayah=${ayahNo}`,
    {headers:{Accept:"application/json"},cache:"force-cache"}
  );
  if(!response.ok) return "";

  const payload=await response.json() as {transcription?:string|null};
  const text=clean(String(payload.transcription || ""));
  if(!text) return "";

  const next={...(memory.get(surahNo) || cached),[ayahNo]:text};
  memory.set(surahNo,next);
  if(typeof window!=="undefined"){
    try{localStorage.setItem(cacheKey(surahNo),JSON.stringify(next));}catch{}
  }
  return text;
}
