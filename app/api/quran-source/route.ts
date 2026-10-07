import { NextResponse } from "next/server";

const SOURCE_URL="https://kuran.diyanet.gov.tr/Content/dosyalar/kuran.docx";

export const runtime="nodejs";

export async function GET(){
  try{
    const response=await fetch(SOURCE_URL,{cache:"no-store"});
    if(!response.ok){
      return NextResponse.json({error:`Diyanet kaynağı HTTP ${response.status}`},{status:502});
    }
    const bytes=await response.arrayBuffer();
    return new NextResponse(bytes,{
      status:200,
      headers:{
        "Content-Type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition":"inline; filename=\"kuran.docx\"",
        "Cache-Control":"public, max-age=86400, s-maxage=86400",
      },
    });
  }catch(error){
    return NextResponse.json({
      error:error instanceof Error ? error.message : "Kur’an Word kaynağı indirilemedi."
    },{status:502});
  }
}
