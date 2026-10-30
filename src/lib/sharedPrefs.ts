import { supabase } from "./supabase";

/* Hesapta tutulan, bütün cihazlarda ortak ayarlar (ör. namaz konumu ve ihtiyat).
   Görünüm ayarları buraya girmez; onlar cihaz başına (readerSettings, tema). */
async function readAll(): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
  return { ...(((data as { preferences?: Record<string, unknown> } | null)?.preferences) ?? {}) };
}
export async function getShared<T>(key: string): Promise<T | undefined> {
  return (await readAll())[key] as T | undefined;
}
export async function setShared(key: string, value: unknown) {
  const prefs = await readAll();
  prefs[key] = value;
  await supabase.from("user_preferences").upsert({ preferences: prefs, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
}
