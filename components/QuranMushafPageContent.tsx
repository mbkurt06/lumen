"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
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

const FATIHA_WORD_PRONUNCIATION: Record<string,string> = {
  "بسم":"Bismillâh",
  "الله":"lillâhi",
  "الرحمن":"er-Rahmân",
  "الرحيم":"er-Rahîm",
  "الحمد":"Elhamdü",
  "لله":"lillâhi",
  "رب":"rabbi",
  "العالمين":"l-âlemîn",
  "مالك":"mâliki",
  "يوم":"yevmi",
  "الدين":"d-dîn",
  "اياك":"iyyâke",
  "نعبد":"na'büdü",
  "واياك":"ve iyyâke",
  "نستعين":"neste'în",
  "اهدنا":"ihdinâ",
  "الصراط":"s-sırâta",
  "المستقيم":"l-müstakîm",
  "صراط":"sırâta",
  "الذين":"llezîne",
  "انعمت":"en'amte",
  "عليهم":"aleyhim",
  "غير":"gayri",
  "المغضوب":"l-mağdûbi",
  "ولا":"ve le",
  "الضالين":"d-dâllîn",
};

function normalizeArabicToken(value:string) {
  return value
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,"")
    .replace(/[إأٱآ]/g,"ا")
    .replace(/[ؤ]/g,"و")
    .replace(/[ئ]/g,"ي")
    .replace(/[ى]/g,"ي")
    .replace(/[^ء-ي]/g,"");
}

function pronunciationPieces(run: QuranMushafRun) {
  if (run.surahNo !== 1 || run.marker || run.runStyle === "mshfAyetNo" || run.runStyle === "mshfSureAd") {
    return [{text:run.text}];
  }

  const tokens = run.text.match(/\s+|\S+/g) ?? [run.text];
  return tokens.map(token => {
    if (/^\s+$/.test(token)) return {text:token};
    const normalized = normalizeArabicToken(token);
    return {
      text:token,
      pronunciation:FATIHA_WORD_PRONUNCIATION[normalized] || undefined,
    };
  });
}

const FATIHA_AYAH_PRONUNCIATION = [
  "",
  "Bismillâhirrahmânirrahîm",
  "Elhamdü lillâhi rabbil âlemîn",
  "Errahmânirrahîm",
  "Mâliki yevmiddîn",
  "İyyâke na'büdü ve iyyâke neste'în",
  "İhdinessırâtal müstakîm",
  "Sırâtallezîne en'amte aleyhim gayril mağdûbi aleyhim ve leddâllîn",
];

function fullAyahPronunciation(surahNo?: number, ayahNo?: number) {
  if (surahNo !== 1 || !ayahNo) return "";
  return FATIHA_AYAH_PRONUNCIATION[ayahNo] || "";
}

function RunContent({ run }: { run: QuranMushafRun }) {
  return (
    <span
      className={runClass(run)}
      data-word-run-style={run.runStyle || undefined}
      data-word-font={run.font || undefined}
      lang={run.lang || undefined}
    >
      {pronunciationPieces(run).map((piece,index) => piece.pronunciation ? (
        <span
          key={index}
          className="quranPronunciationChunk"
          data-pronunciation={piece.pronunciation}
        >
          {piece.text}
        </span>
      ) : piece.text)}
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
  const [pronunciationTooltip, setPronunciationTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

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
                  onMouseEnter={event => {
                    const text = fullAyahPronunciation(group.surahNo, group.ayahNo);
                    if (!text || document.body.classList.contains("quranHideLatin")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = Math.max(190, Math.min(window.innerWidth - 190, event.clientX));
                    const y = Math.max(12, rect.top - 8);
                    setPronunciationTooltip({ text, x, y });
                  }}
                  onMouseMove={event => {
                    const text = fullAyahPronunciation(group.surahNo, group.ayahNo);
                    if (!text || document.body.classList.contains("quranHideLatin")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = Math.max(190, Math.min(window.innerWidth - 190, event.clientX));
                    const y = Math.max(12, rect.top - 8);
                    setPronunciationTooltip({ text, x, y });
                  }}
                  onMouseLeave={() => setPronunciationTooltip(null)}
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
      {pronunciationTooltip && typeof document !== "undefined"
        ? createPortal(
            <div
              className="quranPronunciationTooltip"
              style={{
                left: pronunciationTooltip.x,
                top: pronunciationTooltip.y,
              }}
            >
              {pronunciationTooltip.text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
