"use client";

import type { QuranMushafPage, QuranMushafParagraph, QuranMushafRun } from "@/lib/quranMushafDocx";

type RenderGroup = {
  nodeId?: string;
  surahNo?: number;
  ayahNo?: number;
  runs: QuranMushafRun[];
};

function groupRuns(paragraph: QuranMushafParagraph): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (const run of paragraph.runs) {
    const last = groups[groups.length - 1];
    const sameAyah = !!run.nodeId
      && last?.nodeId === run.nodeId
      && last?.surahNo === run.surahNo
      && last?.ayahNo === run.ayahNo;

    if (sameAyah) {
      last.runs.push(run);
      continue;
    }

    groups.push({
      nodeId: run.nodeId,
      surahNo: run.surahNo,
      ayahNo: run.ayahNo,
      runs: [run],
    });
  }
  return groups;
}

function runClass(run: QuranMushafRun) {
  const classes = ["quranWordRun"];
  if (run.runStyle) classes.push("quranWordRun-" + run.runStyle);
  if (run.marker) classes.push("quranWordAyahMarker");
  return classes.join(" ");
}

const ARABIC_MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;

const baseLatin: Record<string,string> = {
  "ا":"", "أ":"’", "إ":"’", "آ":"â", "ٱ":"",
  "ب":"b", "ت":"t", "ث":"s̱", "ج":"c", "ح":"ḥ", "خ":"ḫ",
  "د":"d", "ذ":"ẕ", "ر":"r", "ز":"z", "س":"s", "ش":"ş",
  "ص":"ṣ", "ض":"ḍ", "ط":"ṭ", "ظ":"ẓ", "ع":"ʿ", "غ":"ġ",
  "ف":"f", "ق":"ḳ", "ك":"k", "ک":"k", "ل":"l", "م":"m",
  "ن":"n", "ه":"h", "ة":"h", "و":"v", "ي":"y", "ى":"â",
  "ئ":"’", "ؤ":"’", "ء":"’", "ـ":""
};

function transliterateArabicWord(source:string) {
  const chars = Array.from(source.normalize("NFD"));
  let out = "";
  for (let i=0; i<chars.length; i+=1) {
    const ch = chars[i];
    if (/\s/.test(ch)) { out += " "; continue; }
    if (/[﴿﴾۞۩]/.test(ch)) continue;
    if (ARABIC_MARK.test(ch)) continue;

    const marks:string[] = [];
    let j=i+1;
    while (j<chars.length && ARABIC_MARK.test(chars[j])) {
      marks.push(chars[j]);
      j+=1;
    }
    i=j-1;

    const hasFatha = marks.includes("\u064E");
    const hasDamma = marks.includes("\u064F");
    const hasKasra = marks.includes("\u0650");
    const hasFathatan = marks.includes("\u064B");
    const hasDammatan = marks.includes("\u064C");
    const hasKasratan = marks.includes("\u064D");
    const shadda = marks.includes("\u0651");
    const daggerAlif = marks.includes("\u0670");

    let base = baseLatin[ch];
    if (base === undefined) {
      if (/[-–—،؛؟.,:()]/.test(ch)) out += ch;
      continue;
    }

    // Unmarked alif/waw/ya usually carry a long vowel in this fully-vocalized Mushaf.
    if (ch === "ا" && marks.length === 0) base = "â";
    else if (ch === "و" && marks.length === 0) base = "û";
    else if (ch === "ي" && marks.length === 0) base = "î";
    else if (ch === "ى" && marks.length === 0) base = "â";

    if (shadda && base) base += base;

    let vowel = "";
    if (hasFathatan) vowel = "an";
    else if (hasDammatan) vowel = "un";
    else if (hasKasratan) vowel = "in";
    else if (hasFatha) vowel = "a";
    else if (hasDamma) vowel = "u";
    else if (hasKasra) vowel = "i";
    if (daggerAlif) vowel += "â";

    out += base + vowel;
  }

  return out
    .replace(/âa/g,"â")
    .replace(/îi/g,"î")
    .replace(/ûu/g,"û")
    .replace(/\s+/g," ")
    .trim();
}

function pronunciationPieces(text:string) {
  // Keep whitespace in the original document flow, but make hover targets
  // small enough to follow the mouse naturally (up to three words).
  const tokens = text.match(/\s+|\S+/g) ?? [text];
  const pieces:{text:string; pronunciation?:string}[] = [];
  let words:string[] = [];
  let raw = "";

  const flush = () => {
    if (!raw) return;
    const pronunciation = transliterateArabicWord(words.join(" "));
    pieces.push({text:raw, pronunciation:pronunciation || undefined});
    words = [];
    raw = "";
  };

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      raw += token;
      continue;
    }
    if (words.length >= 3) flush();
    raw += token;
    words.push(token);
  }
  flush();
  return pieces;
}

function RunContent({ run }: { run: QuranMushafRun }) {
  const canPronounce = !run.marker && run.runStyle !== "mshfAyetNo" && run.runStyle !== "mshfSureAd";
  return (
    <span
      className={runClass(run)}
      data-word-run-style={run.runStyle || undefined}
      data-word-font={run.font || undefined}
      lang={run.lang || undefined}
    >
      {canPronounce
        ? pronunciationPieces(run.text).map((piece,index) => piece.pronunciation ? (
            <span
              key={index}
              className="quranPronunciationChunk"
              data-pronunciation={piece.pronunciation}
            >
              {piece.text}
            </span>
          ) : piece.text)
        : run.text}
    </span>
  );
}

export function QuranMushafPageContent({
  page,
  selectedNodeId,
  onSelectNode,
}: {
  page: QuranMushafPage;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const exactWordCharacters = page.metadata?.exactWordCharacters === true;

  if (!exactWordCharacters) {
    return (
      <div className="quranFallbackPlainText" dir="rtl">
        {page.plain_text}
      </div>
    );
  }

  return (
    <>
      {(page.rich_content?.paragraphs ?? []).map((paragraph, paragraphIndex) => {
        const groups = groupRuns(paragraph);
        const style = paragraph.style || "none";

        return (
          <div
            key={paragraphIndex}
            className={"quranWordParagraph quranWordParagraph-" + style}
            data-word-style={style}
            dir="rtl"
          >
            {groups.map((group, groupIndex) => {
              if (!group.nodeId) {
                return (
                  <span key={groupIndex} className="quranWordNonAyah">
                    {group.runs.map((run, runIndex) => (
                      <RunContent key={runIndex} run={run} />
                    ))}
                  </span>
                );
              }

              const selected = selectedNodeId === group.nodeId;
              return (
                <span
                  key={groupIndex}
                  id={"quran-ayah-" + group.nodeId}
                  role="button"
                  tabIndex={0}
                  className={"quranWordAyah" + (selected ? " selected" : "")}
                  data-surah={group.surahNo}
                  data-ayah={group.ayahNo}
                  onClick={event => {
                    event.stopPropagation();
                    onSelectNode(group.nodeId!);
                  }}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectNode(group.nodeId!);
                    }
                  }}
                >
                  {group.runs.map((run, runIndex) => (
                    <RunContent key={runIndex} run={run} />
                  ))}
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
