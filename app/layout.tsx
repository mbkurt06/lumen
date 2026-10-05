import type { ReactNode } from "react";
import "./globals.css";

const themeScript = `
try {
  if (localStorage.getItem("lumen-theme") === "dark") {
    document.documentElement.classList.add("pre-dark");
  }
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
