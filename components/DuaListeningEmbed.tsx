"use client";
import { useEffect } from "react";

export function DuaListeningEmbed({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "lumen-dua-listening-back") onBack();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onBack]);

  return (
    <div className="duaListeningEmbed">
      <iframe
        src="/dua-v2/index.html?embedded=1&view=listening"
        title="Ezber Dinleme"
        allow="autoplay; fullscreen"
      />
    </div>
  );
}
