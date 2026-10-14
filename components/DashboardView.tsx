"use client";
import "./dashboard.css";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client"; from "react";
type Timer={name:string;start:number;elapsed:number;running:boolean;target:number};
type Reminder={id:number;name:string;end:number};
const read=(key:string,fallback:any)=>{try{return JSON.parse(localStorage.getItem(key)||"null")??fallback}catch{return fallback}};
const time=(s:number)=>{s=Math.max(0,Math.floor(s));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,"0")).join(":")};
export function DashboardView({userId,onNavigate}:{userId:string;onNavigate:(tab:"todos"|"calendar"|"library")=>void}){
 const [now,setNow]=useState(Date.now()),[timer,setTimer]=useState<Timer|null>(null),[reminders,setReminders]=useState<Reminder[]>([]),[history,setHistory]=useState<{name:string;seconds:number;date:number}[]>([]),[ready,setReady]=useState(false);
 const prefix="lumen-dashboard:"+userId+":";
 const [todos,setTodos]=useState<{id:string;title:string;is_completed:boolean}[]>([]);
 useEffect(()=>{let live=true;async function load(){try{const {data}=await supabase.from("todos").select("id,title,is_completed").order("created_at",{ascending:false}).limit(30);if(live&&data)setTodos(data)}catch{}}void load();const id=setInterval(()=>void load(),60000);return()=>{live=false;clearInterval(id)}},[userId]);
 useEffect(()=>{setTimer(read(prefix+"timer",null));setReminders(read(prefix+"reminders",[]));setHistory(read(prefix+"history",[]));setReady(true)},[prefix]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[]);
 useEffect(()=>{const listener=(event:Event)=>{const detail=(event as CustomEvent<{name:string}>).detail;if(!detail?.name)return;const current=read(prefix+"timer",null) as Timer|null;if(current){const seconds=current.elapsed+(current.running?(Date.now()-current.start)/1000:0);const logs=read(prefix+"history",[]) as {name:string;seconds:number;date:number}[];localStorage.setItem(prefix+"history",JSON.stringify([{name:current.name,seconds:Math.round(seconds),date:Date.now()},...logs]));setHistory(read(prefix+"history",[]));}setTimer({name:detail.name,start:Date.now(),elapsed:0,running:true,target:0})};window.addEventListener("lumen-start-timer",listener);return()=>window.removeEventListener("lumen-start-timer",listener)},[prefix]);
 useEffect(()=>{if(ready)localStorage.setItem(prefix+"timer",JSON.stringify(timer))},[timer,ready,prefix]);
 useEffect(()=>{if(ready)localStorage.setItem(prefix+"reminders",JSON.stringify(reminders))},[reminders,ready,prefix]);
 useEffect(()=>{if(ready)localStorage.setItem(prefix+"history",JSON.stringify(history))},[history,ready,prefix]);
 const elapsed=timer?timer.elapsed+(timer.running?(now-timer.start)/1000:0):0;
 function finish(){if(!timer)return;setHistory(h=>[{name:timer.name,seconds:Math.round(elapsed),date:Date.now()},...h]);setTimer(null)}
 function start(){const name=window.prompt("İşin adı");if(!name?.trim())return;if(timer){if(!window.confirm("Mevcut işi bitirip yenisine başlamak istiyor musun?"))return;finish()}const minutes=Number(window.prompt("Hedef süre (dakika)","60")||0);setTimer({name:name.trim(),start:Date.now(),elapsed:0,running:true,target:Math.max(0,minutes)*60})}
 function startNamed(name:string){if(timer&&!window.confirm("Mevcut zaman kaydını bitirip yeni işe başlansın mı?"))return;if(timer)finish();setTimer({name,start:Date.now(),elapsed:0,running:true,target:0})}
 function remind(){const name=window.prompt("Hatırlatma adı");if(!name?.trim())return;const minutes=Number(window.prompt("Kaç dakika sonra?","40"));if(minutes>0)setReminders(a=>[...a,{id:Date.now(),name:name.trim(),end:Date.now()+minutes*60000}])}
 const today=new Intl.DateTimeFormat("tr-TR",{dateStyle:"full"}).format(now);
 const todayEntries=history.filter(h=>new Date(h.date).toDateString()===new Date(now).toDateString());
 return <div className="lumenDashboard"><header className="dashHeader"><div><h1>{today}</h1><p>Günlük planın ve zaman yönetimin</p></div><button onClick={start}>＋ Süre başlat</button></header><div className="dashGrid">
 <section className="dashCard"><h2>◴ Aktif Zaman Sayacı</h2>{timer?<><div className="dashDigits">{time(elapsed)}</div><h3>{timer.name}</h3><p>Hedef: {timer.target?time(timer.target):"Yok"} {timer.target>0&&elapsed>=timer.target?" · Hedef doldu":""}</p><button onClick={()=>setTimer(t=>t?{...t,elapsed:t.elapsed+(t.running?(Date.now()-t.start)/1000:0),start:Date.now(),running:!t.running}:null)}>{timer.running?"Duraklat":"Devam"}</button><button onClick={finish}>Bitir</button><button onClick={()=>setTimer(t=>t?{...t,target:t.target+900}:null)}>+15 dk</button></>:<><p>Aktif çalışma yok.</p><button onClick={start}>▶ Başlat</button></>}</section>
 <section className="dashCard"><h2>◷ Hızlı Hatırlatma Sayaçları</h2><button onClick={remind}>＋ Hatırlatma ekle</button>{reminders.map(r=><div className="dashRow" key={r.id}><span>{r.name}</span><strong>{time((r.end-now)/1000)}</strong><button onClick={()=>setReminders(a=>a.filter(x=>x.id!==r.id))}>×</button></div>)}<small>Bu ilk sürümde uyarılar yalnızca ekran açıkken izlenir.</small></section>
 <section className="dashCard"><h2>☑ Yapılacaklar</h2>{todos.slice(0,8).map(t=><div className="dashRow" key={t.id}><span>{t.is_completed?"✓":"○"} {t.title}</span><button onClick={()=>startNamed(t.title)}>▶ Süre</button></div>)}<button onClick={()=>onNavigate("todos")}>TODO'ya git →</button></section>
 <section className="dashCard"><h2>▦ Bugünün Planı</h2><p>Takvim etkinliklerine hızlı erişim.</p><button onClick={()=>onNavigate("calendar")}>Takvimi aç →</button></section>
 <section className="dashCard"><h2>◴ Bugünkü Zaman Kullanımı</h2><div className="dashDigits">{time(todayEntries.reduce((a,b)=>a+b.seconds,0))}</div>{todayEntries.map((h,i)=><div className="dashRow" key={i}><span>{h.name}</span><strong>{time(h.seconds)}</strong></div>)}</section>
 <section className="dashCard"><h2>✎ Hızlı Notlar</h2><textarea placeholder="Notlarını yaz..." defaultValue={typeof window!=="undefined"?read(prefix+"notes",""):""} onChange={e=>localStorage.setItem(prefix+"notes",JSON.stringify(e.target.value))}/></section>
 </div></div>
}
