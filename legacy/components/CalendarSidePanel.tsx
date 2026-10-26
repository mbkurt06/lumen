"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { offlineCacheGet, offlineCacheSet, offlineGetOne, offlineUpsert } from "@/lib/offlineDb";
import { readLocalReaderPrefs, writeLocalReaderPrefs } from "@/lib/readerPrefs";

type CalendarInfo = {
  id:string;
  summary:string;
  accessRole:string;
  backgroundColor:string|null;
};

type CalendarAccount = {
  id:string;
  email:string;
  displayName:string|null;
  calendars:CalendarInfo[];
  error?:string;
};

export function CalendarSidePanel({user}:{user:User}) {
  const [accounts,setAccounts]=useState<CalendarAccount[]>([]);
  const [hiddenKeys,setHiddenKeys]=useState<Set<string>>(new Set());
  const [todoKeys,setTodoKeys]=useState<Set<string>|null>(null);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [connecting,setConnecting]=useState(false);

  const authHeaders=useCallback(async()=>{
    const {data}=await supabase.auth.getSession();
    const token=data.session?.access_token;
    if(!token) throw new Error("Oturum bulunamadı.");
    return {authorization:`Bearer ${token}`,"content-type":"application/json"};
  },[]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const cacheKey="google-calendar-accounts:"+user.id;
      const cachedAccounts=await offlineCacheGet<CalendarAccount[]>(cacheKey);
      if(cachedAccounts?.length) setAccounts(cachedAccounts);

      let prefs=readLocalReaderPrefs();
      if(!Object.keys(prefs).length){
        const cached=await offlineGetOne<any>("user_preferences",user.id);
        if(cached?.preferences) prefs=cached.preferences as Record<string,unknown>;
      }

      const hidden=Array.isArray(prefs.calendarHiddenKeys)
        ? prefs.calendarHiddenKeys.filter(x=>typeof x==="string") as string[]
        : [];
      setHiddenKeys(new Set(hidden));
      if(Array.isArray(prefs.calendarTodoEnabledKeys)){
        setTodoKeys(new Set(prefs.calendarTodoEnabledKeys.filter(x=>typeof x==="string") as string[]));
      }else{
        setTodoKeys(null);
      }

      if(!navigator.onLine){
        if(!cachedAccounts) setAccounts([]);
        setMessage("");
        return;
      }

      const headers=await authHeaders();
      const response=await fetch("/api/google-calendar/accounts",{headers});
      const json=await response.json();
      if(!response.ok) throw new Error(json.error||"Takvimler alınamadı.");
      const rows=(json.accounts||[]) as CalendarAccount[];
      setAccounts(rows);
      await offlineCacheSet(cacheKey,rows);
      setMessage("");
    }catch(error){
      if(navigator.onLine) setMessage(error instanceof Error?error.message:"Takvimler alınamadı.");
    }finally{
      setLoading(false);
    }
  },[authHeaders,user.id]);

  useEffect(()=>{void load();},[load]);

  const flatCalendars=useMemo(()=>accounts.flatMap(account=>account.calendars.map(calendar=>({
    ...calendar,
    accountId:account.id,
    key:`${account.id}|${calendar.id}`,
  }))),[accounts]);

  function defaultTodoKeys(){
    return new Set(flatCalendars
      .filter(calendar=>calendar.accessRole==="owner"||calendar.accessRole==="writer")
      .map(calendar=>calendar.key));
  }

  async function savePrefs(patch:Record<string,unknown>){
    const current=readLocalReaderPrefs();
    const snapshot={...current,...patch};
    writeLocalReaderPrefs(snapshot);
    await offlineUpsert("user_preferences",user.id,{
      owner_id:user.id,
      preferences:snapshot,
      updated_at:new Date().toISOString(),
    },{onConflict:"owner_id"});
    window.dispatchEvent(new CustomEvent("lumen-calendar-sources-changed"));
  }

  function toggleVisible(key:string){
    setHiddenKeys(current=>{
      const next=new Set(current);
      if(next.has(key)) next.delete(key); else next.add(key);
      void savePrefs({calendarHiddenKeys:[...next]});
      return next;
    });
  }

  function todoEnabled(key:string){
    return (todoKeys??defaultTodoKeys()).has(key);
  }

  function toggleTodo(key:string){
    setTodoKeys(current=>{
      const next=new Set(current??defaultTodoKeys());
      if(next.has(key)) next.delete(key); else next.add(key);
      void savePrefs({calendarTodoEnabledKeys:[...next]});
      return next;
    });
  }

  async function connectGoogle(){
    if(connecting) return;
    setConnecting(true);
    try{
      const headers=await authHeaders();
      const response=await fetch("/api/google-calendar/connect",{method:"POST",headers});
      const json=await response.json();
      if(!response.ok) throw new Error(json.error||"Google hesabı bağlantısı başlatılamadı.");
      if(!json.url) throw new Error("Google yetkilendirme adresi oluşturulamadı.");
      location.assign(json.url);
    }catch(error){
      setMessage(error instanceof Error?error.message:"Google hesabı bağlantısı başlatılamadı.");
      setConnecting(false);
    }
  }

  async function disconnect(accountId:string){
    if(!confirm("Bu Google hesabını Lumen Takvim'den kaldırmak istiyor musunuz?")) return;
    try{
      const headers=await authHeaders();
      const response=await fetch("/api/google-calendar/accounts",{
        method:"DELETE",
        headers,
        body:JSON.stringify({accountId}),
      });
      const json=await response.json();
      if(!response.ok) throw new Error(json.error||"Hesap kaldırılamadı.");
      await load();
      window.dispatchEvent(new CustomEvent("lumen-calendar-sources-changed"));
    }catch(error){
      setMessage(error instanceof Error?error.message:"Hesap kaldırılamadı.");
    }
  }

  return (
    <div className="rightCalendarPanel">
      <div className="rightPanelSectionHead">
        <div>
          <strong>Takvimler</strong>
          <small>Görünüm ve TODO kaynakları</small>
        </div>
      </div>

      <button className="rightPanelPrimary" onClick={()=>void connectGoogle()} disabled={connecting}>
        {connecting?"Google açılıyor…":"+ Google hesabı ekle"}
      </button>

      {loading&&<p className="muted">Takvimler yükleniyor…</p>}
      {message&&<p className="rightPanelMessage">{message}</p>}

      {accounts.map(account=>(
        <section className="rightCalendarAccount" key={account.id}>
          <div className="rightCalendarAccountHead">
            <span>
              <strong>{account.displayName||account.email}</strong>
              <small>{account.email}</small>
            </span>
            <button onClick={()=>void disconnect(account.id)} title="Hesabı kaldır">•••</button>
          </div>
          {account.error&&<p className="rightPanelMessage">{account.error}</p>}
          <div className="rightCalendarList">
            {account.calendars.map(calendar=>{
              const key=`${account.id}|${calendar.id}`;
              return (
                <div className="rightCalendarRow" key={key}>
                  <label title="Takvimde göster/gizle">
                    <input type="checkbox" checked={!hiddenKeys.has(key)} onChange={()=>toggleVisible(key)}/>
                    <i style={calendar.backgroundColor?{backgroundColor:calendar.backgroundColor}:undefined}/>
                    <span>{calendar.summary}</span>
                  </label>
                  <button
                    className={"rightTodoSource "+(todoEnabled(key)?"active":"")}
                    onClick={()=>toggleTodo(key)}
                    title="Günlük TODO'da göster/gizle"
                  >
                    TODO
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!loading&&!accounts.length&&<p className="muted">Henüz Google Takvim hesabı bağlı değil.</p>}
    </div>
  );
}
