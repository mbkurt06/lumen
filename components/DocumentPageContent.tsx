"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QuranMushafPage, QuranMushafParagraph, QuranMushafRun } from "@/lib/documentImport";
import { loadTurkishQuranAyahTranscription, loadTurkishQuranTranscription } from "@/lib/textTranscription";
import { supabase } from "@/lib/supabase/client";

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

export function DocumentPageContent({
  page,
  selectedNodeId,
  onSelectNode,
  onOpenActions,
}: {
  page: QuranMushafPage;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onOpenActions?: (args:{nodeId:string;text:string;x:number;y:number}) => void;
}) {
  const exactWordCharacters = page.metadata?.exactWordCharacters === true;
  const [pronunciationTooltip, setPronunciationTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [pronunciations, setPronunciations] = useState<Record<string,string>>({});
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{x:number;y:number}|null>(null);
  const longPressTriggered = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressStart.current = null;
  };

  useEffect(() => () => clearLongPress(), []);

  const pageIdentity = `${page.source_key}:${page.word_page}:${page.updated_at || ""}`;
  const surahNumbers = useMemo(() => {
    const values = new Set<number>();
    for (const paragraph of page.rich_content?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        const surahNo = Number(run.surahNo || 0);
        if (surahNo > 0) values.add(surahNo);
      }
    }
    return Array.from(values).sort((a,b)=>a-b);
  }, [pageIdentity]);
  const surahKey = surahNumbers.join(",");

  useEffect(() => {
    let cancelled=false;
    const nodeIds=Array.from(new Set(
      (page.rich_content?.paragraphs ?? [])
        .flatMap(paragraph=>paragraph.runs ?? [])
        .map(run=>run.nodeId)
        .filter((value): value is string => Boolean(value))
    ));
    if(!nodeIds.length) return;

    void supabase
      .from("content_nodes")
      .select("id,metadata")
      .in("id",nodeIds)
      .then(({data})=>{
        if(cancelled || !data?.length) return;
        const next:Record<string,string>={};
        for(const row of data){
          const meta=(row.metadata ?? {}) as Record<string,unknown>;
          const surahNo=Number(meta.surah_no || 0);
          const ayahNo=Number(meta.ayah_no || 0);
          const text=String(meta.transcription_tr || "").trim();
          if(surahNo>0 && ayahNo>0 && text) next[`${surahNo}:${ayahNo}`]=text;
        }
        if(Object.keys(next).length){
          setPronunciations(prev=>{
            let changed=false;
            for(const [key,value] of Object.entries(next)){
              if(prev[key]!==value){changed=true;break;}
            }
            return changed ? {...prev,...next} : prev;
          });
        }
      });
    return()=>{cancelled=true;};
  },[pageIdentity]);

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
      setPronunciations(prev=>{
        const prevKeys=Object.keys(prev);
        const nextKeys=Object.keys(next);
        if(prevKeys.length===nextKeys.length && nextKeys.every(key=>prev[key]===next[key])) return prev;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [surahKey]);

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
                  onPointerDown={event => {
                    if ((event.pointerType !== "touch" && event.pointerType !== "pen") || !onOpenActions) return;
                    longPressTriggered.current = false;
                    longPressStart.current = {x:event.clientX,y:event.clientY};
                    clearLongPress();
                    longPressStart.current = {x:event.clientX,y:event.clientY};
                    const target = event.currentTarget;
                    const text = group.runs.filter(run => !run.marker).map(run => run.text).join("").trim();
                    longPressTimer.current = setTimeout(() => {
                      longPressTriggered.current = true;
                      window.getSelection()?.removeAllRanges();
                      const rect = target.getBoundingClientRect();
                      onOpenActions({
                        nodeId:group.nodeId!,
                        text,
                        x:Math.max(110,Math.min(window.innerWidth - 110,event.clientX || rect.left + rect.width/2)),
                        y:Math.max(52,rect.top - 8),
                      });
                      clearLongPress();
                    }, 520);
                  }}
                  onPointerMove={event => {
                    if (!longPressTimer.current || !longPressStart.current) return;
                    const dx=Math.abs(event.clientX-longPressStart.current.x);
                    const dy=Math.abs(event.clientY-longPressStart.current.y);
                    if (dx>10 || dy>10) clearLongPress();
                  }}
                  onPointerUp={() => clearLongPress()}
                  onPointerCancel={() => clearLongPress()}
                  onContextMenu={event => {
                    event.preventDefault();
                  }}
                  onClick={event => {
                    event.stopPropagation();
                    const text = group.runs.filter(run => !run.marker).map(run => run.text).join("").trim();
                    if (onOpenActions && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      onOpenActions({
                        nodeId:group.nodeId!,
                        text,
                        x:Math.max(110,Math.min(window.innerWidth - 110,event.clientX || rect.left + rect.width/2)),
                        y:Math.max(52,rect.top - 8),
                      });
                      return;
                    }
                    if (longPressTriggered.current) {
                      longPressTriggered.current = false;
                      return;
                    }
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
