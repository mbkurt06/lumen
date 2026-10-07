"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { QuranMushafPage, QuranMushafParagraph, QuranMushafRun } from "@/lib/quranMushafDocx";
import { loadTurkishQuranAyahTranscription, loadTurkishQuranTranscription } from "@/lib/quranTranscription";

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

const FATIHA_PRONUNCIATION_FALLBACK: Record<number,string> = {
  1:"Bismillâhirrahmânirrahîm",
  2:"Elhamdü lillâhi rabbil âlemîn",
  3:"Errahmânirrahîm",
  4:"Mâliki yevmiddîn",
  5:"İyyâke na'büdü ve iyyâke neste'în",
  6:"İhdinessırâtal müstakîm",
  7:"Sırâtallezîne en'amte aleyhim gayril mağdûbi aleyhim ve leddâllîn",
};

function RunContent({ run }: { run: QuranMushafRun }) {
  return (
    <span
      className={runClass(run)}
      data-word-run-style={run.runStyle || undefined}
      data-word-font={run.font || undefined}
      lang={run.lang || undefined}
    >
      {run.text}
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
  const [pronunciations, setPronunciations] = useState<Record<string,string>>({});

  const surahNumbers = useMemo(() => {
    const values = new Set<number>();
    for (const paragraph of page.rich_content?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        const surahNo = Number(run.surahNo || 0);
        if (surahNo > 0) values.add(surahNo);
      }
    }
    return Array.from(values);
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      surahNumbers.map(async surahNo => {
        try {
          const rows = await loadTurkishQuranTranscription(surahNo);
          return [surahNo, rows] as const;
        } catch {
          return [surahNo, {} as Record<number,string>] as const;
        }
      })
    ).then(all => {
      if (cancelled) return;
      const next:Record<string,string> = {};
      for (const [surahNo, rows] of all) {
        for (const [ayahNo, text] of Object.entries(rows)) {
          if (text) next[`${surahNo}:${ayahNo}`] = text;
        }
      }
      setPronunciations(next);
    });
    return () => { cancelled = true; };
  }, [surahNumbers]);

  const fullAyahPronunciation = (surahNo?:number, ayahNo?:number) => {
    if (!surahNo || !ayahNo) return "";
    return pronunciations[`${surahNo}:${ayahNo}`]
      || (surahNo === 1 ? FATIHA_PRONUNCIATION_FALLBACK[ayahNo] || "" : "");
  };

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
                  data-node-id={group.nodeId}
                  data-surah={group.surahNo}
                  data-ayah={group.ayahNo}
                  onMouseEnter={event => {
                    if (document.body.classList.contains("quranHideLatin")) return;
                    const rects = Array.from(event.currentTarget.getClientRects());
                    const lineRect =
                      rects.find(rect => event.clientY >= rect.top && event.clientY <= rect.bottom) ??
                      rects.reduce((best, rect) =>
                        Math.abs(rect.top - event.clientY) < Math.abs(best.top - event.clientY) ? rect : best,
                        rects[0]
                      );
                    const x = Math.max(190, Math.min(window.innerWidth - 190, event.clientX));
                    const y = Math.max(12, (lineRect?.top ?? event.clientY) - 4);
                    const immediate = fullAyahPronunciation(group.surahNo, group.ayahNo);
                    if (immediate) {
                      setPronunciationTooltip({ text: immediate, x, y });
                      return;
                    }
                    if (group.surahNo && group.ayahNo) {
                      void loadTurkishQuranAyahTranscription(group.surahNo, group.ayahNo)
                        .then(text => {
                          if (!text) return;
                          setPronunciations(prev => ({
                            ...prev,
                            [`${group.surahNo}:${group.ayahNo}`]: text,
                          }));
                          setPronunciationTooltip({ text, x, y });
                        });
                    }
                  }}
                  onMouseMove={event => {
                    const text = fullAyahPronunciation(group.surahNo, group.ayahNo);
                    if (document.body.classList.contains("quranHideLatin")) return;
                    if (!text) return;
                    const rects = Array.from(event.currentTarget.getClientRects());
                    const lineRect =
                      rects.find(rect => event.clientY >= rect.top && event.clientY <= rect.bottom) ??
                      rects.reduce((best, rect) =>
                        Math.abs(rect.top - event.clientY) < Math.abs(best.top - event.clientY) ? rect : best,
                        rects[0]
                      );
                    const x = Math.max(190, Math.min(window.innerWidth - 190, event.clientX));
                    const y = Math.max(12, (lineRect?.top ?? event.clientY) - 4);
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
