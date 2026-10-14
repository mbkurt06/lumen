import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumen",
    short_name: "Lumen",
    description: "Kur’an, dua, ezber, tesbih ve kişisel takvim",
    id: "/",
    scope: "/",
    lang: "tr",
    dir: "ltr",
    categories: ["education", "lifestyle"],
    start_url: "/",
    display: "standalone",
    background_color: "#151a17",
    theme_color: "#315b4d",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
