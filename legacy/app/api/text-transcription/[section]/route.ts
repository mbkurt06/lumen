import { NextResponse } from "next/server";

export async function GET(request: Request, context: {params: Promise<{section:string}>}) {
  const section=Number((await context.params).section);
  const part=Number(new URL(request.url).searchParams.get("part")||0);
  if(!Number.isInteger(section)||section<1||!Number.isInteger(part)||part<0)
    return NextResponse.json({error:"Invalid item number"},{status:400});
  const template=part>0?process.env.CONTENT_TRANSCRIPTION_PART_URL:process.env.CONTENT_TRANSCRIPTION_SECTION_URL;
  if(!template)return NextResponse.json({error:"Source not configured"},{status:503});
  const url=template.replaceAll("{section}",String(section)).replaceAll("{part}",String(part));
  try {
    const upstream=await fetch(url,{next:{revalidate:86400}});
    if(!upstream.ok)return NextResponse.json({error:"Source unavailable"},{status:502});
    const payload=await upstream.json();
    if(part>0) return NextResponse.json({transcription:payload?.data?.transcription||""});
    const verses:Record<number,string>={};
    for(const row of payload?.data?.verses||[]){
      const index=Number(row.verse_number);
      if(index>0)verses[index]=String(row.transcription||"");
    }
    return NextResponse.json({verses});
  }catch {return NextResponse.json({error:"Source unavailable"},{status:502});}
}
