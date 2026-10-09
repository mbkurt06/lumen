"use client";

type CachedSegments = Record<number,string>;
const STORAGE_PREFIX="workspace-transcription-v1-";
const normalize=(value:string)=>value.replace(/\s+/g," ").trim();

function readCache(section:number):CachedSegments{
  if(typeof window==="undefined") return {};
  try{
    const value=JSON.parse(localStorage.getItem(STORAGE_PREFIX+section)||"{}");
    const result:CachedSegments={};
    for(const [index,text] of Object.entries(value)) {
      const n=Number(index);
      if(Number.isInteger(n)&&n>0&&typeof text==="string") result[n]=normalize(text);
    }
    return result;
  }catch{return {};}
}
function writeCache(section:number,rows:CachedSegments){
  try { localStorage.setItem(STORAGE_PREFIX+section,JSON.stringify(rows)); } catch {}
}
export async function loadTranscription(section:number):Promise<CachedSegments>{
  const cached=readCache(section);
  if(typeof navigator!=="undefined" && !navigator.onLine) return cached;
  try{
    const response=await fetch(`/api/text-transcription/${section}`,{cache:"no-store"});
    if(!response.ok) return cached;
    const body=await response.json();
    const rows={...cached,...(body.verses||{})};
    writeCache(section,rows);
    return rows;
  }catch{return cached;}
}
export async function loadSegmentTranscription(section:number,index:number):Promise<string>{
  const cached=readCache(section);
  if(cached[index])return cached[index];
  if(typeof navigator!=="undefined" && !navigator.onLine)return "";
  try{
    const response=await fetch(`/api/text-transcription/${section}?part=${index}`,{cache:"no-store"});
    if(!response.ok)return "";
    const body=await response.json();
    const value=normalize(String(body.transcription||""));
    if(value)writeCache(section,{...cached,[index]:value});
    return value;
  }catch{return "";}
}
export {loadTranscription as loadTurkishQuranTranscription,loadSegmentTranscription as loadTurkishQuranAyahTranscription};
