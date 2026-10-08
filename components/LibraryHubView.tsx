"use client";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { EzberHomeView, type EzberItem } from "@/components/EzberHomeView";
import { LibraryCatalogView } from "@/components/LibraryCatalogView";
import { readLocalReaderPrefs, writeLocalReaderPrefs } from "@/lib/readerPrefs";
import { offlineGetOne, offlineUpsert } from "@/lib/offlineDb";

export type SectionKey = "ezber" | "risale" | "quran" | "he";

const defaultOrder: SectionKey[] = ["ezber", "risale", "quran", "he"];

const labels: Record<SectionKey, string> = {
  ezber: "Ezber",
  risale: "Risale-i Nur",
  quran: "Kur’an-ı Kerim",
  he: "HE Külliyat",
};

export function LibraryHubView({
  user,
  onOpenItem,
  initialSection = null,
  initialEzberRoot = null,
  onOpenListening,
  onSectionChange,
}: {
  user: User;
  onOpenItem: (item: EzberItem, siblings: EzberItem[], parent: EzberItem | null) => void;
  initialSection?: SectionKey | null;
  initialEzberRoot?: EzberItem | null;
  onOpenListening?: () => void;
  onSectionChange?: (section: SectionKey | null) => void;
}) {
  const [section, setSection] = useState<SectionKey | null>(initialSection);

  function changeSection(next: SectionKey | null) {
    setSection(next);
    onSectionChange?.(next);
  }
  const [order, setOrder] = useState<SectionKey[]>(defaultOrder);
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);

  useEffect(() => {
    void (async()=>{
      let prefs=readLocalReaderPrefs();
      if(!Object.keys(prefs).length){
        const cached=await offlineGetOne<any>("user_preferences",user.id);
        if(cached?.preferences) prefs=cached.preferences as Record<string,unknown>;
      }
      const saved=prefs.libraryHubOrder;
      if(Array.isArray(saved)){
        const filtered=saved.filter((x):x is SectionKey=>defaultOrder.includes(x as SectionKey));
        const missing=defaultOrder.filter(x=>!filtered.includes(x));
        setOrder([...filtered,...missing]);
      }
    })();
  }, [user.id]);

  async function saveOrder(next: SectionKey[]) {
    setOrder(next);
    const current=readLocalReaderPrefs();
    const snapshot={...current,libraryHubOrder:next};
    writeLocalReaderPrefs(snapshot);
    await offlineUpsert("user_preferences",user.id,{
      owner_id:user.id,
      preferences:snapshot,
      updated_at:new Date().toISOString(),
    },{onConflict:"owner_id"});
  }

  function move(over: SectionKey) {
    if (!dragKey || dragKey === over) return;
    const from = order.indexOf(dragKey);
    const to = order.indexOf(over);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
  }

  const title = useMemo(() => section ? labels[section] : "Kütüphane", [section]);

  return (
    <div className="libraryHubPage">
      {(section === null || section === "he") && (
        <div className="libraryHubTopbar">
          <div>
            {section && (
              <button className="legacyBack" onClick={() => changeSection(null)}>‹ Kütüphane</button>
            )}
            <h1>{title}</h1>
          </div>
        </div>
      )}

      {!section && (
        <div className="libraryHubList">
          {order.map(key => (
            <button
              key={key}
              draggable
              className={"libraryHubRow " + (dragKey === key ? "dragging" : "")}
              onDragStart={() => setDragKey(key)}
              onDragEnter={e => {
                e.preventDefault();
                move(key);
              }}
              onDragOver={e => e.preventDefault()}
              onDragEnd={() => {
                setDragKey(null);
                saveOrder(order);
              }}
              onClick={() => changeSection(key)}
            >
              <strong>{labels[key]}</strong>
              <span>›</span>
            </button>
          ))}
        </div>
      )}

      {section === "ezber" && (
        <div className="nativeEzberMount active">
          <EzberHomeView
            user={user}
            onOpenItem={onOpenItem}
            initialRoot={initialEzberRoot}
            onOpenListening={onOpenListening}
          />
        </div>
      )}

      {(section === "quran" || section === "risale") && (
        <LibraryCatalogView
          section={section}
          user={user}
          onOpenItem={onOpenItem}
          onMenu={() => changeSection(null)}
        />
      )}

      {section === "he" && (
        <div className="libraryPlaceholder">
          <h2>{labels[section]}</h2>
          <p>Bu bölümün içeriklerini birlikte toplu olarak ekleyeceğiz.</p>
        </div>
      )}
    </div>
  );
}
