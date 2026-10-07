"use client";
import { useEffect } from "react";

export function DuaEzberExactEmbed({ active }: { active: boolean }) {
  useEffect(() => {
    if (active) document.body.classList.add("exactV2EzberActive");
    else document.body.classList.remove("exactV2EzberActive");
    return () => document.body.classList.remove("exactV2EzberActive");
  }, [active]);

  return (
    <div className={"exactV2EzberFrame " + (active ? "active" : "preloaded")}>
      <iframe
        src="/dua-v2/index.html?embedded=1"
        title="Dua Ezber"
        allow="autoplay; fullscreen"
      />
    </div>
  );
}
