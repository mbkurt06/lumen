"use client";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { type EzberItem } from "@/components/EzberHomeView";
import { DuaEzberExactEmbed } from "@/components/DuaEzberExactEmbed";

type SectionKey = "ezber" | "risale" | "quran" | "he";

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
}: {
  user: User;
  onOpenItem: (item: EzberItem, siblings: EzberItem[], parent: EzberItem | null) => void;
  initialSection?: SectionKey | null;
  initialEzberRoot?: EzberItem | null;
  onOpenListening?: () => void;
}) {
  const [section, setSection] = useState<SectionKey | null>(initialSection);
  const [order, setOrder] = useState<SectionKey[]>(defaultOrder);
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);

  useEffect(() => {
    supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle()
      .then(({ data }) => {
        const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
        const saved = prefs.libraryHubOrder;
        if (Array.isArray(saved)) {
          const filtered = saved.filter((x): x is SectionKey => defaultOrder.includes(x as SectionKey));
          const missing = defaultOrder.filter(x => !filtered.includes(x));
          setOrder([...filtered, ...missing]);
        }
      });
  }, []);

  async function saveOrder(next: SectionKey[]) {
    setOrder(next);
    const { data } = await supabase
      .from("user_preferences")
      .select("preferences")
      .maybeSingle();

    const old = (data?.preferences ?? {}) as Record<string, unknown>;
    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: {
        ...old,
        libraryHubOrder: next,
      },
    });
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
      <div className={"libraryHubTopbar " + (section === "ezber" ? "ezberIntegratedTopbar" : "")}>
        <div>
          {section && (
            <button className="legacyBack" onClick={() => setSection(null)}>‹ Kütüphane</button>
          )}
          {section !== "ezber" && <h1>{title}</h1>}
        </div>
      </div>

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
              onClick={() => setSection(key)}
            >
              <strong>{labels[key]}</strong>
              <span>›</span>
            </button>
          ))}
        </div>
      )}

      <DuaEzberExactEmbed active={section === "ezber"} />

      {section && section !== "ezber" && (
        <div className="libraryPlaceholder">
          <h2>{labels[section]}</h2>
          <p>Bu bölümün içeriklerini birlikte toplu olarak ekleyeceğiz.</p>
        </div>
      )}
    </div>
  );
}
