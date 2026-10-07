"use client";

import JSZip from "jszip";
import { supabase } from "@/lib/supabase/client";

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

async function rebuildFirstJuzCatalog(
  ownerId:string,
  pages:MutablePage[],
) {
  const verses = new Map<string,VerseRecord>();

  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) {
        if (!run.surahNo || !run.ayahNo) continue;
        if (juzFor(run.surahNo,run.ayahNo) !== 1) continue;
        const key = `${run.surahNo}:${run.ayahNo}`;
        const logicalPage = run.surahNo === 1 ? 1 : (page.wordPage === 1 ? 2 : page.wordPage + 1);
        const existing = verses.get(key);
        if (!existing) {
          verses.set(key,{
            surahNo:run.surahNo,
            ayahNo:run.ayahNo,
            page:logicalPage,
            juz:1,
            text:run.marker ? "" : run.text,
            nodeId:safeRandomUUID(),
          });
        } else if (!run.marker) {
          existing.text += run.text;
          existing.page = Math.min(existing.page,logicalPage);
        }
      }
    }
  }

  if (verses.size !== 148) {
    throw new Error(`İlk cüz için beklenen 148 ayet yerine ${verses.size} ayet çıkarıldı.`);
  }
  const fatihaVerses = Array.from(verses.values()).filter(v=>v.surahNo===1);
  const baqaraVerses = Array.from(verses.values()).filter(v=>v.surahNo===2);
  if (fatihaVerses.length !== 7 || baqaraVerses.length !== 141) {
    throw new Error(`İlk cüz ayet dağılımı beklenenden farklı: Fâtiha ${fatihaVerses.length}, Bakara ${baqaraVerses.length}.`);
  }

  const rows = [
    {
      id:TEST_ROOT_ID,owner_id:ownerId,parent_id:null,kind:"folder",title:"Kur’an-ı Kerim",
      subtitle:"İlk cüz · Word birebir test",sort_order:0,
      metadata:{source:"quran_v1",entity:"root",fully_seeded:true,arabic_source:SOURCE_KEY,test_first_juz:true}
    },
    {
      id:TEST_FATIHA_ID,owner_id:ownerId,parent_id:TEST_ROOT_ID,kind:"document",title:"Fâtiha",
      subtitle:"0. sayfa",sort_order:1,
      metadata:{source:"quran_seeded",catalog_source:"quran_v1",arabic_source:SOURCE_KEY,surah_no:1,start_page:1,end_page:1,start_juz:1,end_juz:1,fully_seeded:true,test_first_juz:true}
    },
    {
      id:TEST_BAQARA_ID,owner_id:ownerId,parent_id:TEST_ROOT_ID,kind:"document",title:"Bakara",
      subtitle:"1–20. sayfalar",sort_order:2,
      metadata:{source:"quran_seeded",catalog_source:"quran_v1",arabic_source:SOURCE_KEY,surah_no:2,start_page:2,end_page:21,start_juz:1,end_juz:1,fully_seeded:true,test_first_juz:true}
    },
    {
      id:TEST_JUZ1_ID,owner_id:ownerId,parent_id:TEST_ROOT_ID,kind:"document",title:"1. Cüz",
      subtitle:"0–20. sayfalar",sort_order:1001,
      metadata:{source:"quran_juz_view",catalog_source:"quran_v1",arabic_source:SOURCE_KEY,juz_no:1,start_surah:1,start_ayah:1,start_page:1,end_page:21,fully_seeded:true,test_first_juz:true}
    }
  ];
  const {error:itemError}=await supabase.from("library_items").upsert(rows,{onConflict:"id"});
  if (itemError) throw itemError;

  await supabase.from("content_nodes").delete().in("document_id",[TEST_FATIHA_ID,TEST_BAQARA_ID]);

  const nodeRows = Array.from(verses.values())
    .sort((a,b)=>a.surahNo-b.surahNo||a.ayahNo-b.ayahNo)
    .map(v=>({
      id:v.nodeId,owner_id:ownerId,
      document_id:v.surahNo===1?TEST_FATIHA_ID:TEST_BAQARA_ID,
      parent_id:null,kind:"verse",sort_order:v.ayahNo,title:`${v.surahNo}:${v.ayahNo}`,
      text_content:null,secondary_text:v.text,translation:null,
      metadata:{
        source:"quran_seeded",arabic_source:SOURCE_KEY,surah_no:v.surahNo,ayah_no:v.ayahNo,
        page:v.page,juz:1,surah_title:v.surahNo===1?"Fâtiha":"Bakara",
        page_scheme:"first-juz-docx-test",test_first_juz:true
      }
    }));
  const {error:nodeError}=await supabase.from("content_nodes").insert(nodeRows);
  if (nodeError) throw nodeError;

  for (const page of pages.slice(0,20)) {
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) {
        if (!run.surahNo || !run.ayahNo) continue;
        const verse=verses.get(`${run.surahNo}:${run.ayahNo}`);
        if (verse) run.nodeId=verse.nodeId;
      }
    }
  }

  return verses;
}

async function rebuildQuranFromWord(
  ownerId:string,
  pages:MutablePage[],
  savedTodos:Array<{id:string;notes:string|null}>,
  savedPreferences:Record<string,any>
) {
  const verseMap = new Map<string,VerseRecord>();

  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) {
        if (!run.surahNo || !run.ayahNo) continue;
        const key = `${run.surahNo}:${run.ayahNo}`;
        const existing = verseMap.get(key);
        if (!existing) {
          verseMap.set(key,{
            surahNo:run.surahNo,
            ayahNo:run.ayahNo,
            page:page.wordPage,
            juz:juzFor(run.surahNo,run.ayahNo),
            text:run.marker ? "" : run.text,
            nodeId:safeRandomUUID(),
          });
        } else if (!run.marker) {
          existing.text += run.text;
          if (page.wordPage < existing.page) existing.page = page.wordPage;
        }
      }
    }
  }

  if (verseMap.size !== 6236) {
    throw new Error(`Word belgesinden 6236 yerine ${verseMap.size} tekil ayet çıkarıldı.`);
  }

  const rootId = safeRandomUUID();
  const surahIds = new Map<number,string>();
  for (let s=1;s<=114;s+=1) surahIds.set(s,safeRandomUUID());

  const verses = Array.from(verseMap.values()).sort((a,b)=>a.surahNo-b.surahNo||a.ayahNo-b.ayahNo);
  const ranges = new Map<number,{startPage:number;endPage:number;startJuz:number;endJuz:number}>();
  for (const verse of verses) {
    const current = ranges.get(verse.surahNo);
    if (!current) ranges.set(verse.surahNo,{startPage:verse.page,endPage:verse.page,startJuz:verse.juz,endJuz:verse.juz});
    else {
      current.startPage=Math.min(current.startPage,verse.page);
      current.endPage=Math.max(current.endPage,verse.page);
      current.startJuz=Math.min(current.startJuz,verse.juz);
      current.endJuz=Math.max(current.endJuz,verse.juz);
    }
  }

  const rootRow = {
    id:rootId, owner_id:ownerId, parent_id:null, kind:"folder", title:"Kur’an-ı Kerim",
    subtitle:"İstanbul Mushafı · Word kaynağı", sort_order:0,
    metadata:{source:"quran_v1",entity:"root",fully_seeded:true,arabic_source:"istanbul_mushaf_docx"}
  };

  const surahRows = Array.from({length:114},(_,i)=>{
    const surahNo=i+1;
    const range=ranges.get(surahNo)!;
    return {
      id:surahIds.get(surahNo)!, owner_id:ownerId, parent_id:rootId, kind:"document",
      title:SURAH_TITLES[i], subtitle:`${range.startPage-1}–${range.endPage-1}. sayfalar`, sort_order:surahNo,
      metadata:{
        source:"quran_seeded",catalog_source:"quran_v1",arabic_source:"istanbul_mushaf_docx",
        surah_no:surahNo,start_page:range.startPage,end_page:range.endPage,
        start_juz:range.startJuz,end_juz:range.endJuz,fully_seeded:true,page_scheme:"istanbul-docx-604"
      }
    };
  });

  const juzRows = Array.from({length:30},(_,i)=>{
    const juzNo=i+1;
    const inJuz=verses.filter(v=>v.juz===juzNo);
    const startPage=Math.min(...inJuz.map(v=>v.page));
    const endPage=Math.max(...inJuz.map(v=>v.page));
    const first=inJuz[0];
    return {
      id:safeRandomUUID(),owner_id:ownerId,parent_id:rootId,kind:"document",title:`${juzNo}. Cüz`,
      subtitle:`${startPage-1}–${endPage-1}. sayfalar`,sort_order:1000+juzNo,
      metadata:{
        source:"quran_juz_view",catalog_source:"quran_v1",arabic_source:"istanbul_mushaf_docx",
        juz_no:juzNo,start_surah:first.surahNo,start_ayah:first.ayahNo,start_page:startPage,end_page:endPage,fully_seeded:true
      }
    };
  });

  // Önce Word kaynaklı yeni yapı hazırlanır. Eski Kur’an ancak yeni yapı hazır olduğunda kaldırılır.
  const {error:rootInsertError}=await supabase.from("library_items").insert(rootRow);
  if (rootInsertError) throw rootInsertError;

  for (let i=0;i<surahRows.length;i+=50) {
    const {error}=await supabase.from("library_items").insert(surahRows.slice(i,i+50));
    if (error) throw error;
  }
  const {error:juzInsertError}=await supabase.from("library_items").insert(juzRows);
  if (juzInsertError) throw juzInsertError;

  const nodeRows = verses.map(v=>({
    id:v.nodeId,owner_id:ownerId,document_id:surahIds.get(v.surahNo)!,parent_id:null,kind:"verse",
    sort_order:v.ayahNo,title:`${v.surahNo}:${v.ayahNo}`,text_content:null,secondary_text:v.text,translation:null,
    metadata:{
      source:"quran_seeded",arabic_source:"istanbul_mushaf_docx",surah_no:v.surahNo,ayah_no:v.ayahNo,
      page:v.page,juz:v.juz,surah_title:SURAH_TITLES[v.surahNo-1],page_scheme:"istanbul-docx-604"
    }
  }));

  for (let i=0;i<nodeRows.length;i+=250) {
    const {error}=await supabase.from("content_nodes").insert(nodeRows.slice(i,i+250));
    if (error) throw error;
  }

  for (const page of pages) {
    page.juz = null;
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) {
        if (!run.surahNo || !run.ayahNo) continue;
        const verse=verseMap.get(`${run.surahNo}:${run.ayahNo}`);
        if (verse) run.nodeId=verse.nodeId;
        page.surahNumbers.add(run.surahNo);
        if (!page.juz && verse) page.juz=verse.juz;
      }
    }
  }

  // Eski kökü ve varsa eski bağımsız Kur’an kayıtlarını kaldır.
  const {data:oldRoots}=await supabase
    .from("library_items").select("id")
    .contains("metadata",{source:"quran_v1",entity:"root"})
    .neq("id",rootId);
  for (const old of oldRoots ?? []) {
    const {error}=await supabase.from("library_items").delete().eq("id",old.id);
    if (error) throw error;
  }
  await supabase.from("content_nodes").delete().eq("metadata->>source","quran_seeded").neq("metadata->>arabic_source","istanbul_mushaf_docx");
  await supabase.from("library_items").delete().eq("metadata->>source","quran_seeded").neq("metadata->>arabic_source","istanbul_mushaf_docx");
  await supabase.from("library_items").delete().eq("metadata->>source","quran_juz_view").neq("metadata->>arabic_source","istanbul_mushaf_docx");

  const byKey=new Map(verses.map(v=>[`${v.surahNo}:${v.ayahNo}`,v]));

  for (const todo of savedTodos) {
    let meta:any={};
    try { meta=JSON.parse(todo.notes||"{}"); } catch {}
    const pos=meta?.quran?.position;
    if (!pos?.surahNo || !pos?.ayahNo) continue;
    const verse=byKey.get(`${pos.surahNo}:${pos.ayahNo}`);
    if (!verse) continue;
    const nextPos={...pos,nodeId:verse.nodeId,page:verse.page,juz:verse.juz,surahTitle:SURAH_TITLES[verse.surahNo-1],updatedAt:new Date().toISOString()};
    await supabase.from("todos").update({
      related_library_item_id:surahIds.get(verse.surahNo),
      related_content_node_id:verse.nodeId,
      notes:JSON.stringify({...meta,quran:{...meta.quran,tracking:true,position:nextPos}})
    }).eq("id",todo.id);
  }

  const bookmarks=Array.isArray(savedPreferences.quranBookmarks)?savedPreferences.quranBookmarks:[];
  const remapped=bookmarks.map((bookmark:any)=>{
    const pos=bookmark?.position;
    const verse=pos?.surahNo&&pos?.ayahNo?byKey.get(`${pos.surahNo}:${pos.ayahNo}`):null;
    if (!verse) return bookmark;
    return {...bookmark,position:{...pos,nodeId:verse.nodeId,page:verse.page,juz:verse.juz,surahTitle:SURAH_TITLES[verse.surahNo-1],updatedAt:new Date().toISOString()}};
  });
  if (remapped.length || savedPreferences.quranBookmarks) {
    await supabase.from("user_preferences").upsert({
      owner_id:ownerId,
      preferences:{...savedPreferences,quranBookmarks:remapped,quranBookmark:null},
      updated_at:new Date().toISOString()
    },{onConflict:"owner_id"});
  }

  return {verseMap,rootId,surahIds};
}

export async function importQuranMushafDocx(
  file: File,
  ownerId: string,
  onProgress?: (message: string, percent: number) => void,
) {
  const progress = (message: string, percent: number) => onProgress?.(message, percent);
  progress("Word dosyası okunuyor…", 2);

  const fileBuffer = await file.arrayBuffer();
  const fileSha256 = await sha256Hex(fileBuffer);
  const zip = await JSZip.loadAsync(fileBuffer);

  const documentXml = await zip.file("word/document.xml")?.async("string");
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  const fontTableXml = await zip.file("word/fontTable.xml")?.async("string");
  const exactFontBytes = await extractEmbeddedMushafFont(zip, fontTableXml);
  if (exactFontBytes) {
    await cacheExactMushafFont(exactFontBytes);
    await ensureExactMushafFont();
  }
  const settingsXml = await zip.file("word/settings.xml")?.async("string");
  const themeXml = await zip.file("word/theme/theme1.xml")?.async("string");

  if (!documentXml) throw new Error("DOCX içinde word/document.xml bulunamadı.");

  const xml = new DOMParser().parseFromString(documentXml, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Word XML okunamadı.");

  const body = xml.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("Word belgesinin gövdesi bulunamadı.");

  const serializer = new XMLSerializer();
  const pages: MutablePage[] = [];
  let current: MutablePage = {
    wordPage: 1,
    paragraphs: [],
    surahNumbers: new Set<number>(),
    juz: null,
  };
  let currentSurah = 0;
  let headingCount = 0;
  let ayahMarkerCount = 0;
  const pending: MutableRun[] = [];

  const pushPage = () => {
    if (!current.paragraphs.length) return;
    pages.push(current);
    current = {
      wordPage: pages.length + 1,
      paragraphs: [],
      surahNumbers: new Set<number>(),
      juz: null,
    };
  };

  progress("604 sayfalık Mushaf yapısı ayrıştırılıyor…", 8);

  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const p = child as Element;
    if (p.namespaceURI !== W || p.localName !== "p") continue;

    if (hasPageBreak(p) && current.paragraphs.length) pushPage();

    const style = paragraphStyle(p);
    const paragraph = {
      style,
      rawOoxml: serializer.serializeToString(p),
      runs: [] as MutableRun[],
    };

    const rawRunRecords: MutableRun[] = [];
    for (const r of directChildrenNS(p, "r")) {
      const info = runInfo(r);
      const { text } = textFromRun(r);
      if (!text && !info.runStyle && !info.font) continue;

      for (const piece of splitMarkers(text)) {
        const run: MutableRun = {
          text: piece.text,
          ...(info.runStyle ? { runStyle: info.runStyle } : {}),
          ...(info.font ? { font: info.font } : {}),
          ...(info.rtl ? { rtl: true } : {}),
          ...(info.lang ? { lang: info.lang } : {}),
          ...(piece.marker ? { marker: true, ayahNo: piece.ayahNo } : {}),
        };
        rawRunRecords.push(run);
        paragraph.runs.push(run);
      }
    }

    const paragraphText = paragraph.runs.map(run => run.text).join("");

    if (style === "mshfSureBal") {
      const match = paragraphText.match(/﴿([0-9٠-٩]+)﴾/);
      if (match) {
        currentSurah = arabicNumberToInt(match[1]);
        current.surahNumbers.add(currentSurah);
        headingCount += 1;
      }
    }

    const canContainAyah = style === "mshfKuranMetni"
      || (style === "mshfBesmele" && /﴿([0-9٠-٩]+)﴾/.test(paragraphText));

    if (canContainAyah && currentSurah) {
      for (const run of rawRunRecords) {
        if (run.marker && run.ayahNo) {
          ayahMarkerCount += 1;
          const nodeGroup = [...pending, run];
          for (const piece of nodeGroup) {
            piece.surahNo = currentSurah;
            piece.ayahNo = run.ayahNo;
          }
          pending.length = 0;
        } else if (run.text && run.text.trim().length > 0) {
          pending.push(run);
        }
      }
    }

    if (paragraph.runs.length) current.paragraphs.push(paragraph);
  }
  pushPage();

  const remainingPendingText = pending.map(run => run.text).join("").trim();
  if (remainingPendingText) {
    throw new Error("Belgenin sonunda ayet numarasıyla kapanmayan metin bulundu: " + remainingPendingText.slice(0, 80));
  }
  pending.length = 0;

  if (pages.length !== 604) {
    throw new Error(`Beklenen 604 sayfa yerine ${pages.length} sayfa bulundu.`);
  }
  if (headingCount !== 114) {
    throw new Error(`Beklenen 114 sûre başlığı yerine ${headingCount} başlık bulundu.`);
  }
  if (ayahMarkerCount !== 6236) {
    throw new Error(`Beklenen 6236 ayet numarası yerine ${ayahMarkerCount} ayet numarası bulundu.`);
  }

  progress("İlk cüz ayetleri ve sayfa sınırları hazırlanıyor…", 24);
  await rebuildFirstJuzCatalog(ownerId,pages);

  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) delete run._pending;
    }
  }

  const logicalPages = firstJuzLogicalPages(pages);
  if (logicalPages.length !== 21) throw new Error(`İlk cüz için 21 mantıksal sayfa yerine ${logicalPages.length} sayfa oluştu.`);

  const sourceMeta = {
    source: "Mushaf-ı Şerif — İstanbul Mushafları",
    importedFrom: "DOCX",
    importScope: "first-juz-test",
    originalWordPages: "1-20",
    logicalPages: "0-20",
    wordPageOffset: -1,
    paragraphStyles: ["mshfKuranMetni", "mshfSureBal", "mshfBesmele"],
    characterStyles: ["mshfAyetNo", "mshfSureAd"],
    primaryFont: "Shaikh Hamdullah Mushaf",
    exactFontCachedLocally: !!exactFontBytes,
    exactBrowserFontFamily: EXACT_FONT_FAMILY,
    note: "Sadece 1. cüz test için kaydedildi. Word run sınırları, karakterler, font ve stil bilgileri korunur.",
  };

  progress("Eski test Mushaf sayfaları temizleniyor…", 36);
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
    page_count: 21,
    ayah_count: 148,
    surah_count: 2,
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
    juz: 1,
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
      importScope:"first-juz-test",
      originalWordPage:page.originalWordPage,
      exactWordCharacters: true,
      exactWordRunStyles: true,
      exactWordParagraphStyles: true,
      exactWordAyahMarkers: true,
      displayPageOffset: -1,
    },
    updated_at: new Date().toISOString(),
  }));

  const batchSize = 7;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from("quran_mushaf_pages")
      .upsert(batch, { onConflict: "owner_id,source_key,word_page" });
    if (error) throw error;
    const completed = Math.min(rows.length, index + batch.length);
    progress(
      `İlk cüz Word sayfaları yazılıyor: ${completed}/21`,
      45 + Math.round((completed / rows.length) * 53),
    );
  }

  progress("1. cüz birebir Word testi tamamlandı.", 100);
  window.dispatchEvent(new CustomEvent("lumen-quran-mushaf-imported", {
    detail: { sourceKey: SOURCE_KEY, sha256: fileSha256, pages: 21, ayahs: 148, scope:"first-juz-test" },
  }));

  return {
    sourceKey: SOURCE_KEY,
    sha256: fileSha256,
    pages: 21,
    ayahs: 148,
    surahs: 2,
  };
}

export async function loadQuranMushafPage(wordPage: number): Promise<QuranMushafPage | null> {
  const { data, error } = await supabase
    .from("quran_mushaf_pages")
    .select("word_page,display_page,surah_numbers,juz,plain_text,rich_content,metadata")
    .eq("source_key", SOURCE_KEY)
    .eq("word_page", wordPage)
    .maybeSingle();

  if (error) throw error;
  return data as QuranMushafPage | null;
}
