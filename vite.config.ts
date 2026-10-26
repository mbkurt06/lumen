import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const build = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "dev").slice(0, 7);
const builtAt = new Date().toISOString();

// Her derlemede dist/version.json üretir: web güncelleme denetimi bunu okur.
const versionFile = () => ({
  name: "lumen-version-file",
  closeBundle() {
    mkdirSync("dist", { recursive: true });
    writeFileSync("dist/version.json", JSON.stringify({ version: pkg.version, build, builtAt }));
  },
});

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
});
