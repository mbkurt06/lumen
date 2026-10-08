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
  if(typeof value==="boolean") return value;

  // Older preference snapshots stored these switches without a scope
  // (showPlay/showCounter). Settings still reads those values, so Reader must
  // use the same fallback or the UI can say "Kapalı" while the button appears.
  const legacyKey=key[0].toLowerCase()+key.slice(1);
  const legacyValue=prefs[legacyKey];
  return typeof legacyValue==="boolean" ? legacyValue : fallback;
}
