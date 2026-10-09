import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: process.env.NEXT_PUBLIC_APP_TITLE || "Content Workspace",
    short_name: process.env.NEXT_PUBLIC_APP_SHORT_TITLE || "Workspace",
    description: process.env.NEXT_PUBLIC_APP_DESCRIPTION || "Personal content workspace",
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
        purpose: "maskable",
      },
    ],
  };
}
