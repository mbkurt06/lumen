"use client";

export type ReaderScope = "ezber"|"risale"|"quran"|"he";

export const READER_PREFS_KEY="lumen-reader-prefs-v1";

export function readLocalReaderPrefs():Record<string,unknown>{
  if(typeof window==="undefined") return {};
  try{
    const raw=localStorage.getItem(READER_PREFS_KEY);
    return raw ? JSON.parse(raw) as Record<string,unknown> : {};
  }catch{
    return {};
  }
}

export function writeLocalReaderPrefs(prefs:Record<string,unknown>){
  if(typeof window==="undefined") return;
  try{localStorage.setItem(READER_PREFS_KEY,JSON.stringify(prefs));}catch{}
}

export function scopedBoolean(
  prefs:Record<string,unknown>,
  scope:ReaderScope,
  key:"ShowCounter"|"ShowPlay"|"ShowArabic"|"ShowLatin"|"ShowTurkish",
  fallback:boolean
){
  const value=prefs[scope+key];
  return typeof value==="boolean" ? value : fallback;
}
