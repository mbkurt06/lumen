import { NextResponse } from "next/server";

type SourceVerse = {
  verse_number?: number;
  transcription?: string | null;
};

type SourcePayload = {
  data?: {
    zero?: SourceVerse | null;
    verses?: SourceVerse[];
  };
};

function clean(value:string){
  return value.replace(/\s+/g," ").trim();
}

export async function GET(
  request:Request,
  context:{params:Promise<{surah:string}>}
) {
  const {surah}=await context.params;
  const surahNo=Number(surah);
  if(!Number.isInteger(surahNo) || surahNo<1 || surahNo>114){
    return NextResponse.json({error:"Geçersiz sûre numarası."},{status:400});
  }

  const url=new URL(request.url);
  const requestedAyah=Number(url.searchParams.get("ayah") || 0);

  try{
    const sourceUrl=requestedAyah>0
      ? `https://api.acikkuran.com/surah/${surahNo}/verse/${requestedAyah}`
      : `https://api.acikkuran.com/surah/${surahNo}`;

    const response=await fetch(sourceUrl,{
      headers:{Accept:"application/json"},
      next:{revalidate:86400},
    });

    if(!response.ok){
      return NextResponse.json({error:`Kaynak HTTP ${response.status}`},{status:502});
    }

    const payload=await response.json() as any;

    if(requestedAyah>0){
      const row=payload?.data;
      const text=clean(String(row?.transcription || ""));
      return NextResponse.json({
        surah:surahNo,
        ayah:requestedAyah,
        transcription:text || null,
      },{
        headers:{"Cache-Control":"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"},
      });
    }

    const typed=payload as SourcePayload;
    const verses:Record<number,string>={};
    for(const verse of typed.data?.verses ?? []){
      const no=Number(verse?.verse_number || 0);
      const text=clean(String(verse?.transcription || ""));
      if(no>0 && text) verses[no]=text;
    }

    return NextResponse.json({surah:surahNo,verses},{
      headers:{"Cache-Control":"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"},
    });
  }catch(error){
    return NextResponse.json({
      error:error instanceof Error ? error.message : "Okunuş kaynağına ulaşılamadı."
    },{status:502});
  }
}
