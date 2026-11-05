import { looksOffline } from "./offlineFetch";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { supabase } from "./supabase";

export const CURRENT = { version: __APP_VERSION__, build: __APP_BUILD__, builtAt: __APP_BUILT_AT__ };
export const isNative = () => Capacitor.isNativePlatform();

export interface ApkInstallerPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(o: { url: string }): Promise<void>;
  addListener(ev: "progress", cb: (e: { received: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>;
}
const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");

export interface ApkRelease {
  versionCode: number;
  versionName: string;
  file: string;
  sha256?: string;
  builtAt?: string;
  commit?: string;
}

export type UpdateResult =
  | { state: "current" }
  | { state: "available"; latest: { version: string; build: string; builtAt?: string } }
  | { state: "apk-available"; release: ApkRelease }
  | { state: "none-published" }
  | { state: "error"; message: string };

const BUCKET = "app-updates";

/** Yayınlanmış en son APK bilgisini (latest.json) okur; yoksa null. */
export async function fetchLatestApk(): Promise<ApkRelease | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download("latest.json");
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as ApkRelease;
  } catch {
    return null;
  }
}

export async function apkDownloadUrl(file: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file, 3600);
  if (error || !data) throw new Error(error?.message ?? "İndirme bağlantısı alınamadı");
  return data.signedUrl;
}

// Android: yüklü sürüm koduyla yayındaki en son APK'yı karşılaştırır.
// Web: yayındaki version.json ile açık olan derlemeyi karşılaştırır.
export async function checkForUpdate(): Promise<UpdateResult> {
  try {
    if (isNative()) {
      const info = await App.getInfo();
      const latest = await fetchLatestApk();
      if (!latest) return { state: "none-published" };
      return latest.versionCode > parseInt(info.build, 10) ? { state: "apk-available", release: latest } : { state: "current" };
    }
    // internet yokken sorma (iPhone'da "Uçak Modu'nu kapatın" uyarısı çıkmasın)
    if (looksOffline()) return { state: "error", message: "çevrimdışı" };
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Sürüm bilgisi alınamadı (" + res.status + ")");
    const latest = await res.json();
    if (latest.build && latest.build !== CURRENT.build) return { state: "available", latest };
    return { state: "current" };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function installedApkInfo(): Promise<{ version: string; code: string } | null> {
  if (!isNative()) return null;
  const i = await App.getInfo();
  return { version: i.version, code: i.build };
}

/** APK'yı indirir ve Android kurulum ekranını açar. İzin yoksa ayar ekranına yönlendirir. */
export async function installApk(release: ApkRelease, onProgress: (pct: number) => void): Promise<"started" | "needs-permission"> {
  const { allowed } = await ApkInstaller.canInstall();
  if (!allowed) {
    await ApkInstaller.openInstallSettings();
    return "needs-permission";
  }
  const url = await apkDownloadUrl(release.file);
  const sub = await ApkInstaller.addListener("progress", (e) => onProgress(e.total > 0 ? Math.round((e.received / e.total) * 100) : 0));
  try {
    await ApkInstaller.downloadAndInstall({ url });
  } finally {
    await sub.remove();
  }
  return "started";
}
