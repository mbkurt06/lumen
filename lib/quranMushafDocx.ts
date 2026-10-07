"use client";

import JSZip from "jszip";
import { supabase } from "@/lib/supabase/client";
import quranTranslit from "@/data/quran-translit-tr.json";
import { getCachedQuranMushafPage, putStaticRows } from "@/lib/localContentDb";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const SOURCE_KEY = "istanbul_mushaf_docx";
const EXACT_FONT_FAMILY = "LumenExactMushaf";
const FONT_CACHE_DB = "lumen-quran-word-font";
const FONT_CACHE_STORE = "fonts";
const FONT_CACHE_KEY = "shaikh-hamdullah-mushaf";

export type QuranMushafRun = {
  text: string;
  runStyle?: string;
  font?: string;
  rtl?: boolean;
  lang?: string;
  surahNo?: number;
  ayahNo?: number;
  nodeId?: string;
  marker?: boolean;
};

export type QuranMushafParagraph = {
  style?: string;
  rawOoxml: string;
  runs: QuranMushafRun[];
};

export type QuranMushafPage = {
  word_page: number;
  display_page: number;
  surah_numbers: number[];
  juz: number | null;
  plain_text: string;
  rich_content: {
    version: number;
    paragraphs: QuranMushafParagraph[];
  };
  metadata?: Record<string, unknown>;
};

type MutableRun = QuranMushafRun & { _pending?: boolean };

type MutablePage = {
  wordPage: number;
  paragraphs: Array<{
    style?: string;
    rawOoxml: string;
    runs: MutableRun[];
  }>;
  surahNumbers: Set<number>;
  juz: number | null;
};

function attr(el: Element | null | undefined, local: string) {
  if (!el) return null;
  return el.getAttributeNS(W, local) ?? el.getAttribute("w:" + local) ?? el.getAttribute(local);
}

function firstChildNS(parent: Element | null | undefined, name: string) {
  if (!parent) return null;
  const nodes = parent.getElementsByTagNameNS(W, name);
  return nodes.length ? nodes[0] : null;
}

function directChildrenNS(parent: Element, name: string) {
  return Array.from(parent.childNodes).filter(
    node => node.nodeType === Node.ELEMENT_NODE
      && (node as Element).namespaceURI === W
      && (node as Element).localName === name
  ) as Element[];
}

function safeRandomUUID() {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10,16).join("")}`;
}

function arabicNumberToInt(value: string) {
  const western = value.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return Number(western);
}

function splitMarkers(text: string) {
  const out: Array<{ text: string; ayahNo?: number; marker?: boolean }> = [];
  const re = /﴿([0-9٠-٩]+)﴾/g;
  let index = 0;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    if (match.index > index) out.push({ text: text.slice(index, match.index) });
    out.push({
      text: match[0],
      ayahNo: arabicNumberToInt(match[1]),
      marker: true,
    });
    index = match.index + match[0].length;
  }
  if (index < text.length) out.push({ text: text.slice(index) });
  return out;
}

function paragraphStyle(p: Element) {
  const pPr = directChildrenNS(p, "pPr")[0];
  const pStyle = pPr ? firstChildNS(pPr, "pStyle") : null;
  return attr(pStyle, "val") || undefined;
}

function runInfo(r: Element) {
  const rPr = directChildrenNS(r, "rPr")[0];
  const rStyle = rPr ? firstChildNS(rPr, "rStyle") : null;
  const rFonts = rPr ? firstChildNS(rPr, "rFonts") : null;
  const rtl = !!(rPr && firstChildNS(rPr, "rtl"));
  const lang = rPr ? firstChildNS(rPr, "lang") : null;

  let font: string | undefined;
  if (rFonts) {
    font = attr(rFonts, "cs") || attr(rFonts, "ascii") || attr(rFonts, "hAnsi") || undefined;
  }

  return {
    runStyle: attr(rStyle, "val") || undefined,
    font,
    rtl,
    lang: attr(lang, "bidi") || undefined,
  };
}

function hasPageBreak(p: Element) {
  const breaks = p.getElementsByTagNameNS(W, "br");
  return Array.from(breaks).some(br => attr(br, "type") === "page");
}

function textFromRun(r: Element) {
  let text = "";
  let pageBreak = false;
  for (const node of Array.from(r.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.namespaceURI !== W) continue;
    if (el.localName === "t") text += el.textContent || "";
    else if (el.localName === "tab") text += "\t";
    else if (el.localName === "br") {
      if (attr(el, "type") === "page") pageBreak = true;
      else text += "\n";
    }
  }
  return { text, pageBreak };
}

async function sha256Hex(buffer: ArrayBuffer) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const hash = await subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash)).map(v => v.toString(16).padStart(2, "0")).join("");
  }
  // Safari / insecure local-network fallback: stable source id is enough for this local test import.
  const bytes = new Uint8Array(buffer);
  let h1 = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 200000))) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 16777619) >>> 0;
  }
  return `fallback-${bytes.length.toString(16)}-${h1.toString(16).padStart(8,"0")}`;
}

function reverseFontKeyBytes(fontKey: string) {
  const hex = fontKey.replace(/[{}-]/g, "");
  if (hex.length !== 32) throw new Error("Word gömülü font anahtarı geçersiz.");
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) key[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return Uint8Array.from(Array.from(key).reverse());
}

function deobfuscateWordFont(buffer: ArrayBuffer, fontKey: string) {
  const bytes = new Uint8Array(buffer.slice(0));
  const key = reverseFontKeyBytes(fontKey);
  const limit = Math.min(32, bytes.length);
  for (let i = 0; i < limit; i += 1) bytes[i] ^= key[i % 16];
  return bytes;
}

async function extractEmbeddedMushafFont(zip: JSZip, fontTableXml?: string) {
  if (!fontTableXml) return null;

  const fontXml = new DOMParser().parseFromString(fontTableXml, "application/xml");
  const relsText = await zip.file("word/_rels/fontTable.xml.rels")?.async("string");
  if (!relsText) return null;
  const relsXml = new DOMParser().parseFromString(relsText, "application/xml");

  const fonts = Array.from(fontXml.getElementsByTagNameNS(W, "font"));
  const mushaf = fonts.find(font => (attr(font, "name") || "").trim() === "Shaikh Hamdullah Mushaf");
  if (!mushaf) return null;

  const embed = Array.from(mushaf.children).find(el =>
    el.namespaceURI === W && ["embedRegular","embedBold","embedItalic","embedBoldItalic"].includes(el.localName)
  );
  if (!embed) return null;

  const relId = embed.getAttributeNS(R, "id") || embed.getAttribute("r:id");
  const fontKey = attr(embed, "fontKey");
  if (!relId || !fontKey) return null;

  const relationship = Array.from(relsXml.getElementsByTagNameNS(PR, "Relationship"))
    .find(rel => rel.getAttribute("Id") === relId);
  const target = relationship?.getAttribute("Target");
  if (!target) return null;

  const cleanTarget = target.replace(/^\.\.\//, "");
  const path = cleanTarget.startsWith("word/") ? cleanTarget : "word/" + cleanTarget;
  const embedded = zip.file(path);
  if (!embedded) return null;

  const obfuscated = await embedded.async("arraybuffer");
  const decoded = deobfuscateWordFont(obfuscated, fontKey);

  // Doğru çözümlemede TrueType başlığı 00 01 00 00 olur.
  if (!(decoded[0] === 0 && decoded[1] === 1 && decoded[2] === 0 && decoded[3] === 0)) {
    throw new Error("Word içindeki Shaikh Hamdullah Mushaf fontu çözülemedi.");
  }

  return decoded;
}

function openFontCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FONT_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FONT_CACHE_STORE)) db.createObjectStore(FONT_CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cacheExactMushafFont(bytes: Uint8Array) {
  if (typeof indexedDB === "undefined") return;
  const db = await openFontCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_CACHE_STORE, "readwrite");
      tx.objectStore(FONT_CACHE_STORE).put(bytes.buffer.slice(0), FONT_CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function readExactMushafFont() {
  if (typeof indexedDB === "undefined") return null;
  const db = await openFontCache();
  try {
    return await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(FONT_CACHE_STORE, "readonly");
      const req = tx.objectStore(FONT_CACHE_STORE).get(FONT_CACHE_KEY);
      req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

let exactFontLoadPromise: Promise<boolean> | null = null;
let exactFontRegistered = false;

export async function ensureExactMushafFont() {
  if (typeof window === "undefined" || typeof FontFace === "undefined") return false;
  if (exactFontRegistered) return true;
  if (exactFontLoadPromise) return exactFontLoadPromise;

  exactFontLoadPromise = (async () => {
    const buffer = await readExactMushafFont();
    if (!buffer) return false;

    const blob = new Blob([buffer], { type: "font/ttf" });
    const url = URL.createObjectURL(blob);
    try {
      const face = new FontFace(EXACT_FONT_FAMILY, `url("${url}")`, {
        style: "normal",
        weight: "400",
        display: "block",
      });
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;
      exactFontRegistered = true;
      document.documentElement.style.setProperty("--quran-exact-font-family", JSON.stringify(EXACT_FONT_FAMILY));
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().finally(() => {
    exactFontLoadPromise = null;
  });

  return exactFontLoadPromise;
}


const SURAH_TITLES = [
  "Fâtiha","Bakara","Âl-i İmrân","Nisâ","Mâide","En'âm","A'râf","Enfâl","Tevbe","Yûnus",
  "Hûd","Yûsuf","Ra'd","İbrâhîm","Hicr","Nahl","İsrâ","Kehf","Meryem","Tâhâ",
  "Enbiyâ","Hac","Mü'minûn","Nûr","Furkân","Şuarâ","Neml","Kasas","Ankebût","Rûm",
  "Lokmân","Secde","Ahzâb","Sebe'","Fâtır","Yâsîn","Sâffât","Sâd","Zümer","Mü'min",
  "Fussilet","Şûrâ","Zuhruf","Duhân","Câsiye","Ahkâf","Muhammed","Fetih","Hucurât","Kâf",
  "Zâriyât","Tûr","Necm","Kamer","Rahmân","Vâkıa","Hadîd","Mücâdele","Haşr","Mümtehine",
  "Saff","Cum'a","Münâfikûn","Tegâbün","Talâk","Tahrîm","Mülk","Kalem","Hâkka","Meâric",
  "Nûh","Cin","Müzzemmil","Müddessir","Kıyâmet","İnsân","Mürselât","Nebe'","Nâziât","Abese",
  "Tekvîr","İnfitâr","Mutaffifîn","İnşikâk","Bürûc","Târık","A'lâ","Gâşiye","Fecr","Beled",
  "Şems","Leyl","Duhâ","İnşirâh","Tîn","Alak","Kadr","Beyyine","Zilzâl","Âdiyât",
  "Kâria","Tekâsür","Asr","Hümeze","Fîl","Kureyş","Mâûn","Kevser","Kâfirûn","Nasr",
  "Tebbet","İhlâs","Felak","Nâs"
];

const JUZ_STARTS: Array<[number,number]> = [
  [1,1],[2,142],[2,253],[3,93],[4,24],[4,148],[5,82],[6,111],[7,88],[8,41],
  [9,93],[11,6],[12,53],[15,1],[17,1],[18,75],[21,1],[23,1],[25,21],[27,56],
  [29,46],[33,31],[36,28],[39,32],[41,47],[46,1],[51,31],[58,1],[67,1],[78,1]
];

function verseKey(surah:number, ayah:number) {
  return surah * 1000 + ayah;
}

function juzFor(surah:number, ayah:number) {
  const key = verseKey(surah,ayah);
  let juz = 1;
  for (let i=0;i<JUZ_STARTS.length;i+=1) {
    const [s,a] = JUZ_STARTS[i];
    if (verseKey(s,a) <= key) juz = i + 1;
    else break;
  }
  return juz;
}

type VerseRecord = {
  surahNo:number;
  ayahNo:number;
  page:number;
  juz:number;
  text:string;
  nodeId:string;
};

function transcriptionFor(surahNo:number,ayahNo:number){
  const corpus=quranTranslit as Record<string,Record<string,string>>;
  return String(corpus[String(surahNo)]?.[String(ayahNo)] || "").trim();
}


const TEST_ROOT_ID = "7e100000-0000-4000-8000-000000000001";
const TEST_FATIHA_ID = "7e100000-0000-4000-8000-000000000002";
const TEST_BAQARA_ID = "7e100000-0000-4000-8000-000000000003";
const TEST_JUZ1_ID = "7e100000-0000-4000-8000-000000000004";

function paragraphText(paragraph: MutablePage["paragraphs"][number]) {
  return paragraph.runs.map(run => run.text).join("");
}

function firstJuzLogicalPages(pages: MutablePage[]) {
  const physical = pages.slice(0,20);
  if (physical.length !== 20) throw new Error("İlk cüz için ilk 20 Word sayfası bulunamadı.");

  const first = physical[0];
  const baqaraStart = first.paragraphs.findIndex(paragraph =>
    paragraph.style === "mshfSureBal" && /﴿2﴾/.test(paragraphText(paragraph))
  );
  if (baqaraStart < 0) {
    throw new Error("İlk Word sayfasında Bakara başlangıcı bulunamadı; Fâtiha/Bakara ayrımı yapılamadı.");
  }

  const makePage = (
    wordPage:number,
    displayPage:number,
    originalWordPage:number,
    paragraphs: MutablePage["paragraphs"],
  ): MutablePage & {displayPage:number;originalWordPage:number} => {
    const surahs = new Set<number>();
    let juz:number|null = null;
    for (const paragraph of paragraphs) {
      for (const run of paragraph.runs) {
        if (run.surahNo) surahs.add(run.surahNo);
        if (!juz && run.surahNo && run.ayahNo) juz = juzFor(run.surahNo,run.ayahNo);
      }
    }
    return {wordPage,displayPage,originalWordPage,paragraphs,surahNumbers:surahs,juz};
  };

  const logical:Array<MutablePage & {displayPage:number;originalWordPage:number}> = [
    makePage(1,0,1,first.paragraphs.slice(0,baqaraStart)),
    makePage(2,1,1,first.paragraphs.slice(baqaraStart)),
  ];

  for (const page of physical.slice(1)) {
    logical.push(makePage(page.wordPage + 1,page.wordPage,page.wordPage,page.paragraphs));
  }
  return logical;
}

function fullLogicalPages(pages:MutablePage[]) {
  if (pages.length !== 604) {
    throw new Error(`Beklenen 604 sayfa yerine ${pages.length} sayfa bulundu.`);
  }
  if (headingCount !== 114) {
    throw new Error(`Beklenen 114 sûre başlığı yerine ${headingCount} başlık bulundu.`);
  }
  if (ayahMarkerCount !== 6236) {
    throw new Error(`Beklenen 6236 ayet numarası yerine ${ayahMarkerCount} ayet numarası bulundu.`);
  }

  progress("Mevcut Kur’an Todo ve ayraçları korunuyor…", 20);
  const [{data:savedTodoRows},{data:preferenceRow}] = await Promise.all([
    supabase.from("todos").select("id,notes").eq("owner_id",ownerId),
    supabase.from("user_preferences").select("preferences").eq("owner_id",ownerId).maybeSingle(),
  ]);
  const savedTodos=(savedTodoRows ?? []) as Array<{id:string;notes:string|null}>;
  const savedPreferences=((preferenceRow?.preferences ?? {}) as Record<string,any>);

  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) delete run._pending;
    }
  }

  progress("604 sayfalık Word Mushaf kitap düzenine dönüştürülüyor…", 26);
  const logicalPages=fullLogicalPages(pages);
  if(logicalPages.length !== 605){
    throw new Error(`Fâtiha ayrı sayfa olacak şekilde 605 mantıksal sayfa bekleniyordu; ${logicalPages.length} oluştu.`);
  }

  progress("114 sûre ve 30 cüz veritabanında hazırlanıyor…", 32);
  await rebuildQuranFromWord(ownerId,logicalPages,savedTodos,savedPreferences);

  const sourceMeta = {
    source: "Diyanet İşleri Başkanlığı Kur’an-ı Kerim Word",
    importedFrom: "DOCX",
    importScope: "full-quran",
    originalWordPages: "1-604",
    logicalPages: "0-604",
    wordPageOffset: -1,
    paragraphStyles: ["mshfKuranMetni", "mshfSureBal", "mshfBesmele"],
    characterStyles: ["mshfAyetNo", "mshfSureAd"],
    primaryFont: "Shaikh Hamdullah Mushaf",
    exactFontCachedLocally: !!exactFontBytes,
    exactBrowserFontFamily: EXACT_FONT_FAMILY,
    note: "Tam Kur’an: 114 sûre, 30 cüz ve 6236 ayet. Fâtiha uygulamada 0. sayfa olarak ayrı tutulur.",
  };

  progress("Eski Mushaf sayfaları yenileniyor…", 40);
  const { error: deleteError } = await supabase
    .from("quran_mushaf_pages")
    .delete()
    .eq("owner_id", ownerId)
    .eq("source_key", SOURCE_KEY);
  if (deleteError) throw deleteError;

  const sourceRow = {
    owner_id: ownerId,
    source_key: SOURCE_KEY,
    filename: file.name,
    file_sha256: fileSha256,
    page_count: logicalPages.length,
    ayah_count: 6236,
    surah_count: 114,
    styles_xml: stylesXml ?? null,
    font_table_xml: fontTableXml ?? null,
    settings_xml: settingsXml ?? null,
    theme_xml: themeXml ?? null,
    metadata: sourceMeta,
    updated_at: new Date().toISOString(),
  };

  const { error: sourceError } = await supabase
    .from("quran_mushaf_sources")
    .upsert(sourceRow, { onConflict: "owner_id,source_key" });
  if (sourceError) throw sourceError;

  const rows = logicalPages.map(page => ({
    owner_id: ownerId,
    source_key: SOURCE_KEY,
    word_page: page.wordPage,
    display_page: page.displayPage,
    surah_numbers: Array.from(page.surahNumbers).sort((a, b) => a - b),
    juz: page.juz,
    plain_text: page.paragraphs.map(p => p.runs.map(r => r.text).join("")).join("\n"),
    rich_content: {
      version: 1,
      paragraphs: page.paragraphs.map(paragraph => ({
        style: paragraph.style,
        rawOoxml: paragraph.rawOoxml,
        runs: paragraph.runs,
      })),
    },
    source_sha256: fileSha256,
    metadata: {
      source: "mushaf_istanbul_docx",
      importScope:"full-quran",
      originalWordPage:page.originalWordPage,
      exactWordCharacters: true,
      exactWordRunStyles: true,
      exactWordParagraphStyles: true,
      exactWordAyahMarkers: true,
      displayPageOffset: -1,
    },
    updated_at: new Date().toISOString(),
  }));

  const batchSize = 8;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from("quran_mushaf_pages")
      .upsert(batch, { onConflict: "owner_id,source_key,word_page" });
    if (error) throw error;
    const completed = Math.min(rows.length, index + batch.length);
    progress(
      `Kur’an sayfaları yazılıyor: ${completed}/${rows.length}`,
      42 + Math.round((completed / rows.length) * 56),
    );
  }

  progress("Kur’an’ın tamamı hazır: 114 sûre · 30 cüz · 6236 ayet.", 100);
  window.dispatchEvent(new CustomEvent("lumen-quran-mushaf-imported", {
    detail: { sourceKey: SOURCE_KEY, sha256: fileSha256, pages: logicalPages.length, ayahs: 6236, surahs:114, scope:"full-quran" },
  }));

  return {
    sourceKey: SOURCE_KEY,
    sha256: fileSha256,
    pages: logicalPages.length,
    ayahs: 6236,
    surahs: 114,
  };
}

export async function loadQuranMushafPage(wordPage: number): Promise<QuranMushafPage | null> {
  const cached = await getCachedQuranMushafPage(SOURCE_KEY, wordPage).catch(() => null);
  if (cached) return cached as QuranMushafPage;

  const { data, error } = await supabase
    .from("quran_mushaf_pages")
    .select("id,source_key,word_page,display_page,surah_numbers,juz,plain_text,rich_content,source_sha256,metadata,created_at,updated_at")
    .eq("source_key", SOURCE_KEY)
    .eq("word_page", wordPage)
    .maybeSingle();

  if (error) throw error;
  if (data) void putStaticRows("quran_mushaf_pages",[data]).catch(() => {});
  return data as QuranMushafPage | null;
}
