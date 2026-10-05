import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

async function readEnv(file) {
  const raw = await fs.readFile(file, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = await readEnv(path.join(process.cwd(), ".env.local"));
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Lumen e-posta: ")).trim();
const password = (await rl.question("Lumen şifre: ")).trim();
rl.close();

const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) throw authError;

async function getRoot(title) {
  const { data, error } = await supabase
    .from("library_items")
    .select("id,title")
    .is("parent_id", null)
    .eq("title", title)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(title + " kök koleksiyonu bulunamadı.");
  return data;
}

const tesbihatRoot = await getRoot("Tesbihat");
const surelerRoot = await getRoot("Sûreler");

const { data: tesbihatItems, error: tesError } = await supabase
  .from("library_items")
  .select("id,title,parent_id")
  .eq("parent_id", tesbihatRoot.id);
if (tesError) throw tesError;

const keep = new Set([
  "Sabah Namazı Tesbihatı",
  "Öğle Namazı Tesbihatı",
  "İkindi Namazı Tesbihatı",
  "Akşam Namazı Tesbihatı",
  "Yatsı Namazı Tesbihatı",
  "Salât-ı Münciye (Salâten Tüncînâ)",
  "İstiâze Duası (Uzun)",
]);

const ayetelTitles = new Set(["Âyetel Kürsî", "Ayetel Kürsî"]);

for (const item of tesbihatItems ?? []) {
  if (ayetelTitles.has(item.title)) {
    const { error } = await supabase
      .from("library_items")
      .update({
        parent_id: surelerRoot.id,
        metadata: { moved_from: "Tesbihat", quran_surah: 2, quran_verse_start: 255 },
      })
      .eq("id", item.id);
    if (error) throw error;
    console.log("Taşındı:", item.title, "→ Sûreler");
    continue;
  }

  if (!keep.has(item.title)) {
    const { error } = await supabase.from("library_items").delete().eq("id", item.id);
    if (error) throw error;
    console.log("Silindi:", item.title);
  }
}

const quranOrder = new Map([
  ["Fâtiha Sûresi", 1000],
  ["Âyetel Kürsî", 2255],
  ["Ayetel Kürsî", 2255],
  ["Bakara 285–286 (Âmenerrasûlü)", 2285],
  ["Fetih 27–29", 48027],
  ["Haşr 20–24", 59020],
  ["Nebe (Amme) Sûresi", 78000],
  ["Duhâ Sûresi", 93000],
  ["İnşirâh (Elem Neşrah) Sûresi", 94000],
  ["Tîn Sûresi", 95000],
  ["Kadr Sûresi", 97000],
  ["Zilzâl Sûresi", 99000],
  ["Âdiyât Sûresi", 100000],
  ["Kâria Sûresi", 101000],
  ["Tekâsür Sûresi", 102000],
  ["Asr Sûresi", 103000],
  ["Hümeze Sûresi", 104000],
  ["Fîl Sûresi", 105000],
  ["Kureyş Sûresi", 106000],
  ["Mâûn Sûresi", 107000],
  ["Kevser Sûresi", 108000],
  ["Kâfirûn Sûresi", 109000],
  ["Nasr Sûresi", 110000],
  ["Tebbet (Mesed) Sûresi", 111000],
  ["İhlâs Sûresi", 112000],
  ["Felak Sûresi", 113000],
  ["Nâs Sûresi", 114000],
]);

const { data: sureler, error: sureError } = await supabase
  .from("library_items")
  .select("id,title,sort_order")
  .eq("parent_id", surelerRoot.id);
if (sureError) throw sureError;

const sorted = [...(sureler ?? [])].sort((a, b) => {
  const av = quranOrder.get(a.title) ?? 999999 + (a.sort_order ?? 0);
  const bv = quranOrder.get(b.title) ?? 999999 + (b.sort_order ?? 0);
  return av - bv;
});

for (let i = 0; i < sorted.length; i++) {
  const { error } = await supabase
    .from("library_items")
    .update({ sort_order: i })
    .eq("id", sorted[i].id);
  if (error) throw error;
}

const { data: keptTesbihat, error: keptError } = await supabase
  .from("library_items")
  .select("id,title")
  .eq("parent_id", tesbihatRoot.id);
if (keptError) throw keptError;

const tesOrder = [
  "Sabah Namazı Tesbihatı",
  "Öğle Namazı Tesbihatı",
  "İkindi Namazı Tesbihatı",
  "Akşam Namazı Tesbihatı",
  "Yatsı Namazı Tesbihatı",
  "Salât-ı Münciye (Salâten Tüncînâ)",
  "İstiâze Duası (Uzun)",
  "Namaz Sonrası Salavatlar",
];

for (const item of keptTesbihat ?? []) {
  const index = tesOrder.indexOf(item.title);
  if (index < 0) continue;
  const { error } = await supabase
    .from("library_items")
    .update({ sort_order: index })
    .eq("id", item.id);
  if (error) throw error;
}

console.log("\nTemizlik tamamlandı.");
console.log("Tesbihat altında yalnız 5 namaz tesbihatı bırakıldı.");
console.log("Âyetel Kürsî Sûreler'e taşındı ve Sûreler mushaf sırasına göre sıralandı.");
