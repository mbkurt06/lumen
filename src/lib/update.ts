import { Capacitor } from "@capacitor/core";

export const CURRENT = { version: __APP_VERSION__, build: __APP_BUILD__, builtAt: __APP_BUILT_AT__ };

export type UpdateResult =
  | { state: "current" }
  | { state: "available"; latest: { version: string; build: string; builtAt?: string } }
  | { state: "native-pending" }
  | { state: "error"; message: string };

export const isNative = () => Capacitor.isNativePlatform();

// Web: yayındaki version.json ile açık olan derlemeyi karşılaştırır.
// Android: APK güncellemesi sonraki adımda (Supabase Storage + kurulum) bağlanacak.
export async function checkForUpdate(): Promise<UpdateResult> {
  if (isNative()) return { state: "native-pending" };
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Sürüm bilgisi alınamadı (" + res.status + ")");
    const latest = await res.json();
    if (latest.build && latest.build !== CURRENT.build) return { state: "available", latest };
    return { state: "current" };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
