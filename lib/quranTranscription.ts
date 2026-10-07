"use client";

import corpusJson from "@/data/quran-translit-tr.json";

type Corpus = Record<string,Record<string,string>>;
const corpus = corpusJson as Corpus;

function clean(value:string){
  return value
    .replace(/\s+/g," ")
    .replace(/\s+([.,;:!?])/g,"$1")
    .trim();
}

export async function loadTurkishQuranTranscription(
  surahNo:number
):Promise<Record<number,string>>{
  const source=corpus[String(surahNo)] ?? {};
  const result:Record<number,string>={};
  for(const [ayahNo,value] of Object.entries(source)){
    const no=Number(ayahNo);
    const text=clean(String(value || ""));
    if(no>0 && text) result[no]=text;
  }
  return result;
}

export async function loadTurkishQuranAyahTranscription(
  surahNo:number,
  ayahNo:number
):Promise<string>{
  return clean(String(corpus[String(surahNo)]?.[String(ayahNo)] || ""));
}
