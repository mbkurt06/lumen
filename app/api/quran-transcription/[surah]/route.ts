import { NextResponse } from "next/server";

function collectTranscriptions(value:unknown, out:Record<number,string>) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTranscriptions(item,out);
    return;
  }
  if (typeof value !== "object") return;

  const row=value as Record<string,unknown>;
  const verseNumber=Number(
    row.verse_number ?? row.verseNumber ?? row.verse ?? row.ayah_number ?? row.ayahNumber ?? 0
  );
  const transcription=
    typeof row.transcription === "string" ? row.transcription :
    typeof row.transliteration === "string" ? row.transliteration :
    "";

  if (verseNumber>0 && transcription.trim()) {
    out[verseNumber]=transcription.replace(/\s+/g," ").trim();
  }

  for (const nested of Object.values(row)) collectTranscriptions(nested,out);
}

export async function GET(
  _request:Request,
  context:{params:Promise<{surah:string}>}
) {
  const {surah}=await context.params;
  const surahNo=Number(surah);
  if(!Number.isInteger(surahNo) || surahNo<1 || surahNo>114){
    return NextResponse.json({error:"Geçersiz sûre numarası."},{status:400});
  }

  try{
    const response=await fetch(`https://api.acikkuran.com/surah/${surahNo}`,{
      headers:{Accept:"application/json"},
      next:{revalidate:86400},
    });
    if(!response.ok){
      return NextResponse.json({error:`Kaynak HTTP ${response.status}`},{status:502});
    }

    const payload=await response.json();
    const verses:Record<number,string>={};
    collectTranscriptions(payload,verses);

    return NextResponse.json({surah:surahNo,verses},{
      headers:{"Cache-Control":"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"},
    });
  }catch(error){
    return NextResponse.json({
      error:error instanceof Error ? error.message : "Okunuş kaynağına ulaşılamadı."
    },{status:502});
  }
}
