"use client";
import { useEffect } from "react";

export function DuaEzberExactEmbed() {
  useEffect(() => {
    document.body.classList.add("exactV2EzberActive");
    return () => document.body.classList.remove("exactV2EzberActive");
  }, []);

  return (
    <div className="exactV2EzberFrame">
      <iframe
        src="/dua-v2/index.html?embedded=1"
        title="Dua Ezber"
        allow="autoplay; fullscreen"
      />
    </div>
  );
}
