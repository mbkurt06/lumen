"use client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { syncStaticContentInBackground } from "@/lib/contentSync";
import { getMeta } from "@/lib/localContentDb";

const AUTO_SYNC_KEY = "lumen-static-auto-sync";

function formatSyncDate(value:string|null){
  if(!value) return "Henüz senkronize edilmedi";
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return "Henüz senkronize edilmedi";
  return date.toLocaleString("tr-TR");
}

export function SettingsView({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [autoSync,setAutoSync]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [syncStatus,setSyncStatus]=useState("Güncel");
  const [lastSync,setLastSync]=useState<string|null>(null);

  useEffect(()=>{
    setAutoSync(localStorage.getItem(AUTO_SYNC_KEY)==="1");
    void getMeta<string>("last_sync_at").then(value=>{
      setLastSync(value);
      if(value) setSyncStatus("Güncel");
    }).catch(()=>{});

    const onSync=(event:Event)=>{
      const detail=(event as CustomEvent<any>).detail ?? {};
      if(detail.state==="checking"){
        setSyncing(true);
        setSyncStatus("Değişiklikler kontrol ediliyor…");
      }else if(detail.state==="downloading"){
        setSyncing(true);
        const names:Record<string,string>={
          library_items:"Kütüphane",
          content_nodes:"İçerikler",
          quran_mushaf_pages:"Kur’an sayfaları",
        };
        const suffix=detail.tableIndex && detail.tableCount ? ` (${detail.tableIndex}/${detail.tableCount})` : "";
        setSyncStatus(`${names[detail.table] || "İçerikler"} indiriliyor${suffix}…`);
      }else if(detail.state==="ready"){
        setSyncing(false);
        setSyncStatus("Güncel");
        void getMeta<string>("last_sync_at").then(setLastSync).catch(()=>{});
      }else if(detail.state==="error"){
        setSyncing(false);
        setSyncStatus(detail.message || "Senkronizasyon başarısız");
      }
    };
    window.addEventListener("lumen-static-sync",onSync as EventListener);
    return ()=>window.removeEventListener("lumen-static-sync",onSync as EventListener);
  },[]);

  async function runFullSync(){
    if(syncing) return;
    setSyncing(true);
    setSyncStatus("Tüm içerikler hazırlanıyor…");
    await syncStaticContentInBackground(user.id,{forceFull:true});
  }

  function toggleAutoSync(){
    const next=!autoSync;
    setAutoSync(next);
    localStorage.setItem(AUTO_SYNC_KEY,next ? "1" : "0");
    window.dispatchEvent(new CustomEvent("lumen-auto-sync-changed",{detail:{enabled:next}}));
    if(next) void syncStaticContentInBackground(user.id);
  }

  return (
    <div className="settingsCard">
      <div className="dialogHead">
        <strong>Genel ayarlar</strong>
      </div>

      <div className="settingRow">
        <span>Hesap</span>
        <strong>{user.email}</strong>
      </div>

      <div className="settingRow">
        <span>Uygulama</span>
        <span className="muted">Lumen</span>
      </div>

      <div className="settingsSection">
        <div className="settingsSectionHead">
          <strong>İçerik senkronizasyonu</strong>
          <span className="muted">Kur’an, dualar, Risale-i Nur ve kitaplar</span>
        </div>

        <div className="settingRow syncSettingRow">
          <div>
            <strong>Tüm içerikleri lokale indir</strong>
            <div className="muted syncHint">İlk kullanımda veya gerektiğinde Supabase’deki sabit içeriklerin tamamını bu cihaza indirir.</div>
          </div>
          <button className="settingButton" disabled={syncing} onClick={()=>void runFullSync()}>
            {syncing ? "Senkronize ediliyor…" : "Şimdi senkronize et"}
          </button>
        </div>

        <div className="settingRow syncSettingRow">
          <div>
            <strong>Otomatik senkronizasyon</strong>
            <div className="muted syncHint">Uygulama açılırken bir kez kontrol edilir. Otomatik açıkken ayrıca 15 dakikada bir değişiklik kontrolü yapılır.</div>
          </div>
          <button
            type="button"
            className={"syncSwitch " + (autoSync ? "on" : "off")}
            role="switch"
            aria-checked={autoSync}
            onClick={toggleAutoSync}
          >
            <span />
          </button>
        </div>

        <div className="syncStatusRow">
          <span>{syncStatus}</span>
          <span className="muted">Son senkronizasyon: {formatSyncDate(lastSync)}</span>
        </div>
      </div>

      <p className="muted" style={{marginTop:16}}>
        Okuma görünümü, gece modu, yazı boyutu, Arapça, Latin harfleri ve meal
        ayarları Kütüphane içindeki sağ üst ayarlar düğmesinden yönetilir.
      </p>

      <button
        className="secondary danger"
        style={{ marginTop: 18 }}
        onClick={onSignOut}
      >
        Çıkış yap
      </button>
    </div>
  );
}
