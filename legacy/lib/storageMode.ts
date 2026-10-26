"use client";

export const STORAGE_MODE_KEY="workspace-local-database-enabled";

export function isLocalDatabaseEnabled():boolean{
  if(typeof window==="undefined")return true;
  return localStorage.getItem(STORAGE_MODE_KEY)!=="0";
}

export function setLocalDatabaseEnabled(enabled:boolean){
  localStorage.setItem(STORAGE_MODE_KEY,enabled?"1":"0");
  window.dispatchEvent(new CustomEvent("workspace-storage-mode-changed",{detail:{enabled}}));
}
