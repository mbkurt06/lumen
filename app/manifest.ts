import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumen",
    short_name: "Lumen",
    description: "Kur’an, dua, Risale-i Nur ve kişisel okuma/ezber uygulaması",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#315b4d",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}
