/* Bu cihazın kimliği: tarayıcı/uygulama başına bir kez üretilir, ayarlar bu kimlikle ayrı tutulur. */
const KEY = "lumen.deviceId";

export function deviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "nostorage";
  }
}

/** Cihaz için okunur ad (ör. "iPad · Safari", "Android · Uygulama"). */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const kind = ipad ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Bilgisayar";
  const browser = native ? "Uygulama" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
  return `${kind} · ${browser}`;
}
