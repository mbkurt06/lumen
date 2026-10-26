import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lumen.mobile",
  appName: "Lumen",
  webDir: "dist",
  backgroundColor: "#0F1115",
  android: { allowMixedContent: false },
};

export default config;
