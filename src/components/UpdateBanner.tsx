import { useEffect, useState } from "react";
import { checkForUpdate, isNative } from "../lib/update";

// Web'de yeni derleme yayınlanınca kullanıcıya "Yenile" çubuğu gösterir.
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (isNative()) return;
    let stop = false;
    const run = async () => {
      const r = await checkForUpdate();
      if (!stop && r.state === "available") setAvailable(true);
    };
    const t = setInterval(run, 10 * 60 * 1000);
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    run();
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  if (!available) return null;
  return (
    <div className="banner" role="status">
      <span>Yeni sürüm var.</span>
      <button onClick={() => location.reload()}>Yenile</button>
    </div>
  );
}
