import {NextResponse} from "next/server";
export const runtime="nodejs";
export async function GET(){
  const url=process.env.CONTENT_DOCUMENT_URL;
  if(!url)return NextResponse.json({error:"Document source not configured"},{status:503});
  try{
    const response=await fetch(url,{cache:"no-store"});
    if(!response.ok)return NextResponse.json({error:"Upstream request failed"},{status:502});
    return new NextResponse(await response.arrayBuffer(),{headers:{
      "Content-Type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition":'inline; filename="document.docx"',
      "Cache-Control":"public, max-age=86400"
    }});
  }catch{return NextResponse.json({error:"Document source unavailable"},{status:502});}
}
