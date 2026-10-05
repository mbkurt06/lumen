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

const root = process.cwd();
const env = await readEnv(path.join(root, ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error(".env.local Supabase bilgileri eksik.");

const sourceDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(root, "../dua-memorizer/data");

const duaPath = path.join(sourceDir, "dualar.json");
const ilmihalPath = path.join(sourceDir, "ilmihal.json");

const [duaRaw, ilmihalRaw] = await Promise.all([
  fs.readFile(duaPath, "utf8"),
  fs.readFile(ilmihalPath, "utf8"),
]);

const duaData = JSON.parse(duaRaw);
const ilmihalData = JSON.parse(ilmihalRaw);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Lumen e-posta: ")).trim();
const password = (await rl.question("Lumen şifre: ")).trim();
rl.close();

const supabase = createClient(url, key);
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) throw authError;
const user = auth.user;
if (!user) throw new Error("Giriş yapılamadı.");

console.log("Giriş başarılı:", user.email);

const { data: oldRoots, error: oldError } = await supabase
  .from("library_items")
  .select("id,metadata")
  .is("parent_id", null);

if (oldError) throw oldError;

for (const item of oldRoots ?? []) {
  if (item.metadata?.source === "legacy-dua-memorizer") {
    const { error } = await supabase.from("library_items").delete().eq("id", item.id);
    if (error) throw error;
  }
}

async function addItem({ parentId = null, kind, title, subtitle = null, order = 0, metadata = {} }) {
  const { data, error } = await supabase
    .from("library_items")
    .insert({
      parent_id: parentId,
      kind,
      title,
      subtitle,
      sort_order: order,
      metadata: { source: "legacy-dua-memorizer", ...metadata },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function addNodes(documentId, rows) {
  if (!rows.length) return;
  const payload = rows.map((row, index) => ({
    document_id: documentId,
    parent_id: null,
    kind: row.kind ?? "phrase",
    sort_order: index,
    title: row.title ?? null,
    text_content: row.text ?? null,
    secondary_text: row.secondary ?? null,
    translation: row.translation ?? null,
    metadata: row.metadata ?? {},
  }));
  const { error } = await supabase.from("content_nodes").insert(payload);
  if (error) throw error;
}

const categories = new Map();
let order = 0;
for (const dua of duaData.duas ?? []) {
  const categoryName = dua.category || "Diğer";
  let categoryId = categories.get(categoryName);
  if (!categoryId) {
    categoryId = await addItem({
      kind: "collection",
      title: categoryName,
      order: order++,
      metadata: { legacy_category: categoryName },
    });
    categories.set(categoryName, categoryId);
    console.log("Koleksiyon:", categoryName);
  }

  const docId = await addItem({
    parentId: categoryId,
    kind: "document",
    title: dua.title || dua.id,
    subtitle: dua.invocation || null,
    order: 0,
    metadata: { legacy_id: dua.id, target: dua.target ?? null },
  });

  const rows = (dua.segments ?? []).map(segment => {
    const s = typeof segment === "string" ? { latin: segment } : segment;
    return {
      kind: categoryName === "Sûreler" ? "verse" : "phrase",
      text: s.latin ?? null,
      secondary: s.arabic ?? null,
      translation: s.turkish ?? null,
      metadata: {
        note: s.note ?? null,
        target: s.target ?? null,
      },
    };
  });

  await addNodes(docId, rows);
  console.log("  Eser:", dua.title, "-", rows.length, "parça");
}

const ilmihalRoot = await addItem({
  kind: "collection",
  title: ilmihalData.title || "İlmihal",
  subtitle: ilmihalData.source || null,
  order: order++,
  metadata: { legacy_id: "ilmihal" },
});

for (let sectionIndex = 0; sectionIndex < (ilmihalData.sections ?? []).length; sectionIndex++) {
  const section = ilmihalData.sections[sectionIndex];
  const sectionId = await addItem({
    parentId: ilmihalRoot,
    kind: "folder",
    title: section.title,
    order: sectionIndex,
    metadata: { ilmihal_section: section.title },
  });

  for (let topicIndex = 0; topicIndex < (section.topics ?? []).length; topicIndex++) {
    const topic = section.topics[topicIndex];
    const docId = await addItem({
      parentId: sectionId,
      kind: "document",
      title: topic.title,
      order: topicIndex,
      metadata: { ilmihal_topic: topic.title },
    });

    const rows = [];
    for (const text of topic.body ?? []) rows.push({ kind: "paragraph", text });
    for (const text of topic.list ?? []) rows.push({ kind: "paragraph", text, metadata: { list_item: true } });
    await addNodes(docId, rows);
  }
}

console.log("\nAktarım tamamlandı.");
console.log("Dua/tesbihat/sûre/esma kayıtları:", (duaData.duas ?? []).length);
console.log("İlmihal bölümleri:", (ilmihalData.sections ?? []).length);
