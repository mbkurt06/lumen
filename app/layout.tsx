import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen",
  description: "Kur’an, dua, Risale-i Nur ve kişisel okuma/ezber uygulaması",
  manifest: "/manifest.webmanifest",
  themeColor: "#315b4d",
  appleWebApp: {
    capable: true,
    title: "Lumen",
    statusBarStyle: "default",
  },
};

const themeScript = `
try {
  const root = document.documentElement;
  const theme = localStorage.getItem("lumen-theme");
  if (theme === "dark") root.classList.add("pre-dark");

  let prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem("lumen-reader-prefs-v1") || "{}");
  } catch {}

  if (prefs.quranPageTheme) {
    root.dataset.preQuranPageTheme = String(prefs.quranPageTheme);
  }
  if (prefs.risalePageTheme) {
    root.dataset.preRisalePageTheme = String(prefs.risalePageTheme);
  }
  if (typeof prefs.quranFontScale === "number") {
    root.style.setProperty("--quran-font-scale", String(prefs.quranFontScale));
  }
  if (typeof prefs.quranFontWeight === "number") {
    root.style.setProperty("--quran-font-weight", String(prefs.quranFontWeight));
  }
  if (typeof prefs.quranFontFamily === "string") {
    root.style.setProperty("--quran-font-family", JSON.stringify(prefs.quranFontFamily));
  }

  try {
    const state = JSON.parse(localStorage.getItem("lumen-app-state") || "{}");
    const section = state.returnLibrarySection;
    if (section === "quran" || section === "risale" || section === "ezber" || section === "he") {
      root.dataset.preReaderScope = section;
      const scale = prefs[section + "FontScale"];
      if (typeof scale === "number") root.style.setProperty("--font-scale", String(scale));
    }
  } catch {}
} catch {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
