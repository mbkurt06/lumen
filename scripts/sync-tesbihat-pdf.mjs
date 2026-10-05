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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Lumen e-posta: ")).trim();
const password = (await rl.question("Lumen şifre: ")).trim();
rl.close();

const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) throw authError;

const { data: root, error: rootError } = await supabase
  .from("library_items")
  .select("id")
  .is("parent_id", null)
  .eq("title", "Tesbihat")
  .maybeSingle();
if (rootError) throw rootError;
if (!root) throw new Error("Tesbihat kökü bulunamadı.");

const docs = [
  {
    title: "Salât-ı Münciye (Salâten Tüncînâ)",
    subtitle: null,
    order: 5,
    rows: [
      { text: "Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed.", note: null },
      { text: "Salâten tüncînâ bihâ min-cemî‘i’l-ehvâli ve’l-âfât.", note: "“ve’l-âfât” derken avuç içleri yere bakacak şekilde çevrilir; bitince eski hâline getirilir." },
      { text: "Ve takdî lenâ bihâ cemî‘a’l-hâcât.", note: null },
      { text: "Ve tütahhirunâ bihâ min-cemî‘i’s-seyyiât.", note: null },
      { text: "Ve terfe‘unâ bihâ ‘indeke a‘le’d-derecât.", note: null },
      { text: "Ve tübelliğunâ bihâ aksâ’l-gâyât.", note: null },
      { text: "Min-cemî‘i’l-hayrâti fi’l-hayâti ve ba‘de’l-memât.", note: null },
      { text: "Âmîn yâ Mucîbe’d-de‘avâti ve’l-hamdü lillâhi Rabbi’l-âlemîn. Âmîn.", note: "Denilir ve eller yüze sürülüp indirilir." },
    ],
  },
  {
    title: "İstiâze Duası (Uzun)",
    subtitle: null,
    order: 6,
    rows: [
      { text: "Allâhümme ecirnâ mine’n-nâr.", target: 3, note: "PDF’de 3, 5 veya 7 defa tekrar edilebileceği belirtilir." },
      { text: "Allâhümme ecirnâ min-külli nâr." },
      { text: "Allâhümme ecirnâ min-fitneti’d-dîniyyeti ve’d-dünyeviyyeh." },
      { text: "Allâhümme ecirnâ min-fitneti âhiri’z-zemân." },
      { text: "Allâhümme ecirnâ min-fitneti Mesîhi’d-Deccâli ve’s-Süfyân." },
      { text: "Allâhümme ecirnâ mine’d-dalâlâti ve’l-bid’iyyâti ve’l-beliyyât." },
      { text: "Allâhümme ecirnâ min-şerri’n-nefsi’l-emmâreh." },
      { text: "Allâhümme ecirnâ min-şürûri’n-nüfûsi’l-emmârâti’l-fir’avniyyeh." },
      { text: "Allâhümme ecirnâ min-şerri’n-nisâ." },
      { text: "Allâhümme ecirnâ min-belâi’n-nisâ." },
      { text: "Allâhümme ecirnâ min-fitneti’n-nisâ." },
      { text: "Allâhümme ecirnâ min-‘azâbi’l-kabr." },
      { text: "Allâhümme ecirnâ min-‘azâbi yevmi’l-kıyâmeh." },
      { text: "Allâhümme ecirnâ min-‘azâbi Cehennem." },
      { text: "Allâhümme ecirnâ min-‘azâbi kahrik." },
      { text: "Allâhümme ecirnâ min-nâri kahrik." },
      { text: "Allâhümme ecirnâ min-‘azâbi’l-kabri ve’n-nîrân." },
      { text: "Allâhümme ecirnâ mine’r-riyâi ve’s-süm‘ati ve’l-‘ucubi ve’l-fahr." },
      { text: "Allâhümme ecirnâ min-tecâvüzi’l-mülhidîn." },
      { text: "Allâhümme ecirnâ min-şerri’l-münâfikîn." },
      { text: "Allâhümme ecirnâ min-fitneti’l-fâsikîn." },
      { text: "Allâhümme ecirnâ ve ecir vâlideynâ ve talebete Resâili’n-Nûri’s-sâdıkîne fi-hidmeti’l-Kur’âni ve’l-îmân. Ve ahbâbene’l-mü’minîne’l-muhlisîne ve akrabâenâ ve ecdâdenâ mine’n-nâr.", note: "Bundan sonra avuç içleri yukarı çevrilir." },
      { text: "Bi-‘afvike yâ Mücîr, bi-fadlike yâ Gaffâr." },
      { text: "Allâhümme’d-hilne’l-Cennete me‘a’l-ebrâr." },
      { text: "Allâhümme’d-hilne’l-Cennete me‘a’l-ebrâr." },
      { text: "Allâhümme’d-hilnâ ve edhil Üstâzenâ Sa‘îde’n-Nursî (radıyallâhu ‘anh) ve vâlideynâ ve talebete Resâili’n-Nûri’s-sâdıkîne ve ihvânenâ ve ehavâtinâ ve akrabâenâ ve ecdâdenâ ve ahbâbene’l-mü’minîne’l-muhlisîne fi-hidmeti’l-îmâni ve’l-Kur’ân. El-Cennete me‘a’l-ebrâr bi-şefâati nebiyyike’l-muhtâr ve âlihi’l-ethâr ve eshâbihi’l-ahyâr ve sellim mâ dâme’l-leylü ve’n-nehâr. Âmîn, ve’l-hamdü lillâhi Rabbi’l-Âlemîn.", note: "Denilir ve eller yüze sürülür." },
    ],
  },
  {
    title: "Namaz Sonrası Salavatlar",
    subtitle: null,
    order: 7,
    rows: [
      { text: "Bismillâhirrahmânirrahîm." },
      { text: "İnnallâhe ve melâiketehû yüsallûne ‘ale’n-nebiy. Yâ eyyühellezîne âmenû sallû ‘aleyhi ve sellimû teslîmâ. Lebbeyk." },
      { text: "Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed. Bi-‘adedi külli dâin ve devâin ve bârik ve sellim ‘aleyhi ve ‘aleyhim kesîrâ." },
      { text: "Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed. Bi-‘adedi külli dâin ve devâin ve bârik ve sellim ‘aleyhi ve ‘aleyhim kesîrâ." },
      { text: "Allâhümme salli ‘alâ seyyidinâ Muhammedin ve ‘alâ âli seyyidinâ Muhammed. Bi-‘adedi külli dâin ve devâin ve bârik ve sellim ‘aleyhi ve ‘aleyhim kesîran kesîrâ." },
      { text: "Salli ve sellim yâ Rabbi ‘alâ habîbike Muhammedin ve ‘alâ cemî‘i’l-enbiyâi ve’l-mürselîne ve ‘alâ âli küllin ve sahbi küllin ecma‘în. Âmîn ve’l-hamdü lillâhi Rabbi’l-âlemîn." },
      { text: "Elfü elfi salâtin ve elfü elfi selâmin ‘aleyke yâ Resûlellah." },
      { text: "Elfü elfi salâtin ve elfü elfi selâmin ‘aleyke yâ Habîballah." },
      { text: "Elfü elfi salâtin ve elfü elfi selâmin ‘aleyke yâ emîne vahyillâh." },
    ],
  },
];

async function upsertDocument(doc) {
  const { data: existing, error: findError } = await supabase
    .from("library_items")
    .select("id")
    .eq("parent_id", root.id)
    .eq("title", doc.title)
    .maybeSingle();
  if (findError) throw findError;

  let id = existing?.id;
  if (!id) {
    const { data, error } = await supabase
      .from("library_items")
      .insert({
        parent_id: root.id,
        kind: "document",
        title: doc.title,
        subtitle: doc.subtitle,
        sort_order: doc.order,
        metadata: { source: "pdf-namaz-tesbihati-2026-10-05" },
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  } else {
    const { error } = await supabase
      .from("library_items")
      .update({
        subtitle: doc.subtitle,
        sort_order: doc.order,
        metadata: { source: "pdf-namaz-tesbihati-2026-10-05" },
      })
      .eq("id", id);
    if (error) throw error;
    const { error: deleteError } = await supabase.from("content_nodes").delete().eq("document_id", id);
    if (deleteError) throw deleteError;
  }

  const payload = doc.rows.map((row, index) => ({
    document_id: id,
    parent_id: null,
    kind: "phrase",
    sort_order: index,
    title: null,
    text_content: row.text,
    secondary_text: null,
    translation: null,
    metadata: {
      target: row.target ?? null,
      note: row.note ?? null,
      source: "pdf-namaz-tesbihati-2026-10-05",
    },
  }));

  const { error: nodeError } = await supabase.from("content_nodes").insert(payload);
  if (nodeError) throw nodeError;
  console.log("Güncellendi:", doc.title, "-", payload.length, "parça");
}

for (const doc of docs) await upsertDocument(doc);

// Existing five prayer tesbihat documents: fix the repeated salawat spellings if legacy data contains them.
// This deliberately does not shorten repeated lines; the PDF prints the first two lines separately and the third as "kesîran kesîrâ".
const prayerTitles = [
  "Sabah Namazı Tesbihatı",
  "Öğle Namazı Tesbihatı",
  "İkindi Namazı Tesbihatı",
  "Akşam Namazı Tesbihatı",
  "Yatsı Namazı Tesbihatı",
];

for (const title of prayerTitles) {
  const { data: prayer } = await supabase
    .from("library_items")
    .select("id")
    .eq("parent_id", root.id)
    .eq("title", title)
    .maybeSingle();
  if (!prayer) continue;

  const { data: rows, error } = await supabase
    .from("content_nodes")
    .select("id,text_content,sort_order")
    .eq("document_id", prayer.id)
    .order("sort_order");
  if (error) throw error;

  const matches = (rows ?? []).filter(r =>
    (r.text_content || "").toLocaleLowerCase("tr-TR").includes("bi-‘adedi külli dâin") ||
    (r.text_content || "").toLocaleLowerCase("tr-TR").includes("bi-adedi külli dâin") ||
    (r.text_content || "").toLocaleLowerCase("tr-TR").includes("bi-aded")
  );

  const canonical = docs[2].rows.slice(2, 5).map(x => x.text);
  for (let i = 0; i < Math.min(3, matches.length); i++) {
    const { error: updateError } = await supabase
      .from("content_nodes")
      .update({ text_content: canonical[i] })
      .eq("id", matches[i].id);
    if (updateError) throw updateError;
  }
}

console.log("\nPDF tesbihat senkronu tamamlandı.");
console.log("Eklendi/güncellendi: Salât-ı Münciye, Uzun İstiâze, Namaz Sonrası Salavatlar.");
console.log("Beş namaz tesbihatındaki üçlü salavat tekrarları PDF biçimine göre düzeltildi.");
