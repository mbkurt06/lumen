"use client";

import JSZip from "jszip";
import { supabase } from "@/lib/supabase/client";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SOURCE_KEY = "istanbul_mushaf_docx";

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
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map(v => v.toString(16).padStart(2, "0")).join("");
}

async function fetchQuranNodeMap() {
  const byVerse = new Map<string, string>();
  const pageJuz = new Map<number, number>();
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,metadata")
      .eq("metadata->>source", "quran_seeded")
      .range(from, from + 999);

    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      const m = (row.metadata ?? {}) as Record<string, unknown>;
      const surah = Number(m.surah_no || 0);
      const ayah = Number(m.ayah_no || 0);
      const page = Number(m.page || 0);
      const juz = Number(m.juz || 0);
      if (surah && ayah) byVerse.set(`${surah}:${ayah}`, row.id);
      if (page && juz && !pageJuz.has(page)) pageJuz.set(page, juz);
    }
    if (rows.length < 1000) break;
    from += 1000;
  }

  return { byVerse, pageJuz };
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
        } else if (run.text) {
          pending.push(run);
        }
      }
    }

    if (paragraph.runs.length) current.paragraphs.push(paragraph);
  }
  pushPage();

  if (pending.length) {
    throw new Error("Belgenin sonunda ayet numarasıyla kapanmayan metin bulundu.");
  }

  if (pages.length !== 604) {
    throw new Error(`Beklenen 604 sayfa yerine ${pages.length} sayfa bulundu.`);
  }
  if (headingCount !== 114) {
    throw new Error(`Beklenen 114 sûre başlığı yerine ${headingCount} başlık bulundu.`);
  }
  if (ayahMarkerCount !== 6236) {
    throw new Error(`Beklenen 6236 ayet numarası yerine ${ayahMarkerCount} ayet numarası bulundu.`);
  }

  progress("Ayet kimlikleri mevcut Kur’an veritabanıyla eşleştiriliyor…", 28);
  const { byVerse, pageJuz } = await fetchQuranNodeMap();

  let unmatched = 0;
  for (const page of pages) {
    page.juz = pageJuz.get(page.wordPage) ?? null;
    for (const paragraph of page.paragraphs) {
      for (const run of paragraph.runs) {
        if (!run.surahNo || !run.ayahNo) continue;
        const nodeId = byVerse.get(`${run.surahNo}:${run.ayahNo}`);
        if (nodeId) run.nodeId = nodeId;
        else unmatched += 1;
        page.surahNumbers.add(run.surahNo);
        delete run._pending;
      }
    }
  }

  if (unmatched) {
    throw new Error(`${unmatched} Word metin parçası mevcut ayet kayıtlarıyla eşleşmedi.`);
  }

  const sourceMeta = {
    source: "Mushaf-ı Şerif — İstanbul Mushafları",
    importedFrom: "DOCX",
    wordPageOffset: -1,
    paragraphStyles: ["mshfKuranMetni", "mshfSureBal", "mshfBesmele"],
    characterStyles: ["mshfAyetNo", "mshfSureAd"],
    primaryFont: "Shaikh Hamdullah Mushaf",
    note: "Görünür karakterler, Word run sınırları, ayet numarası karakterleri, sayfa kırımları ve stil kimlikleri aynen korunmuştur.",
  };

  progress("Eski Word-Mushaf sayfa kayıtları temizleniyor…", 35);
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
    page_count: 604,
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

  const rows = pages.map(page => ({
    owner_id: ownerId,
    source_key: SOURCE_KEY,
    word_page: page.wordPage,
    display_page: page.wordPage - 1,
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
      exactWordCharacters: true,
      exactWordRunStyles: true,
      exactWordParagraphStyles: true,
      exactWordAyahMarkers: true,
      displayPageOffset: -1,
    },
    updated_at: new Date().toISOString(),
  }));

  const batchSize = 12;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from("quran_mushaf_pages")
      .upsert(batch, { onConflict: "owner_id,source_key,word_page" });
    if (error) throw error;
    const completed = Math.min(rows.length, index + batch.length);
    progress(
      `Word Mushaf sayfaları veritabanına yazılıyor: ${completed}/604`,
      40 + Math.round((completed / rows.length) * 58),
    );
  }

  progress("Word Mushaf içe aktarma tamamlandı.", 100);
  window.dispatchEvent(new CustomEvent("lumen-quran-mushaf-imported", {
    detail: { sourceKey: SOURCE_KEY, sha256: fileSha256, pages: 604 },
  }));

  return {
    sourceKey: SOURCE_KEY,
    sha256: fileSha256,
    pages: 604,
    ayahs: 6236,
    surahs: 114,
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
