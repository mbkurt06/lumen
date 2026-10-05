"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export type EzberItem = {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  subtitle: string | null;
  sort_order: number;
};

type MenuKey =
  | "Sûreler"
  | "Namaz Duaları"
  | "Günlük Dualar"
  | "Tesbihat"
  | "Esmâü’l-Hüsnâ"
  | "Dinleme"
  | "İslam İlmihali";

const menu: { key: MenuKey; label: string; icon?: string }[] = [
  { key: "Sûreler", label: "Sûreler" },
  { key: "Namaz Duaları", label: "Namaz Duaları" },
  { key: "Günlük Dualar", label: "Günlük Dualar" },
  { key: "Tesbihat", label: "Tesbihatlar" },
  { key: "Esmâü’l-Hüsnâ", label: "Esmâü’l-Hüsnâ" },
  { key: "Dinleme", label: "Dinleme", icon: "🎧" },
  { key: "İslam İlmihali", label: "İslam İlmihali" },
];

export function EzberHomeView({
  onOpenItem,
}: {
  onOpenItem: (item: EzberItem) => void;
}) {
  const [roots, setRoots] = useState<EzberItem[]>([]);
  const [currentRoot, setCurrentRoot] = useState<EzberItem | null>(null);
  const [children, setChildren] = useState<EzberItem[]>([]);
  const [message, setMessage] = useState("");

  const loadRoots = useCallback(async () => {
    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order")
      .is("parent_id", null)
      .order("sort_order");

    if (error) {
      setMessage(error.message);
      return;
    }
    setRoots(data ?? []);
  }, []);

  useEffect(() => {
    loadRoots();
  }, [loadRoots]);

  async function openMenu(key: MenuKey) {
    if (key === "Dinleme") {
      setMessage("Dinleme ekranını eski uygulamadaki haliyle ayrıca taşıyacağız.");
      return;
    }

    const root = roots.find(x => x.title === key);
    if (!root) {
      setMessage(key + " koleksiyonu bulunamadı.");
      return;
    }

    setCurrentRoot(root);

    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order")
      .eq("parent_id", root.id)
      .order("sort_order")
      .order("title");

    if (error) {
      setMessage(error.message);
      return;
    }

    setChildren(data ?? []);
    setMessage("");
  }

  async function openChild(item: EzberItem) {
    if (item.kind === "document") {
      onOpenItem(item);
      return;
    }

    const { data, error } = await supabase
      .from("library_items")
      .select("id,parent_id,kind,title,subtitle,sort_order")
      .eq("parent_id", item.id)
      .order("sort_order")
      .order("title");

    if (error) {
      setMessage(error.message);
      return;
    }

    setCurrentRoot(item);
    setChildren(data ?? []);
  }

  if (currentRoot) {
    return (
      <section className="legacyHomePage">
        <div className="legacyListHead">
          <button className="legacyBack" onClick={() => setCurrentRoot(null)}>
            ‹ Geri
          </button>
          <h2>{currentRoot.title}</h2>
          <span />
        </div>

        <div className="legacyCategoryList">
          {children.map(item => (
            <button
              className="legacyCategoryRow"
              key={item.id}
              onClick={() => openChild(item)}
            >
              <span>
                <strong>{item.title}</strong>
                {item.subtitle && <small>{item.subtitle}</small>}
              </span>
              <b>›</b>
            </button>
          ))}
          {!children.length && (
            <div className="legacyEmptyLine">Bu bölümde içerik bulunamadı.</div>
          )}
        </div>

        {message && <p className="legacyHomeMessage">{message}</p>}
      </section>
    );
  }

  return (
    <section className="legacyHomePage">
      <div className="legacyHomeHead">
        <h1>Dua Ezber</h1>
        <p>Bir bölüm seç</p>
      </div>

      <div className="legacyHomeMenu">
        {menu.map(item => (
          <button
            key={item.key}
            className="legacyHomeRow"
            onClick={() => openMenu(item.key)}
          >
            <strong>{item.icon ? item.icon + " " : ""}{item.label}</strong>
            <span>›</span>
          </button>
        ))}
      </div>

      {message && <p className="legacyHomeMessage">{message}</p>}
    </section>
  );
}
