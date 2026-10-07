import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 604800;

const CORPUS_REPO = "alitekdemir/Risale-i-Nur-Diyanet";
const TREE_URL = "https://api.github.com/repos/" + CORPUS_REPO + "/git/trees/master?recursive=1";
const RAW_BASE = "https://raw.githubusercontent.com/" + CORPUS_REPO + "/master/";
const BLOB_BASE = "https://github.com/" + CORPUS_REPO + "/blob/master/";
const OFFICIAL_BASE = "https://risaleinur.hizmetvakfi.org";

const BOOK_DIRS: Record<string,string> = {
  "sozler":"html/01 Sözler",
  "mektubat":"html/02 Mektubat",
  "lemalar":"html/03 Lem'alar",
  "sualar":"html/04 Şuâlar",
  "tarihce i hayat":"html/05 Tarihçe-i Hayat",
  "mesnevi i nuriye":"html/06 Mesnevî-i Nuriye",
  "isaratul icaz":"html/07 İşaratü'l-i'caz",
  "sikke i tasdik i gaybi":"html/08 Sikke-i Tasdik-i Gaybî",
  "barla lahikasi":"html/09 Barla Lâhikası",
  "kastamonu lahikasi":"html/10 Kastamonu Lâhikası",
  "emirdag lahikasi i":"html/11 Emirdağ Lâhikası 1",
  "emirdag lahikasi ii":"html/12 Emirdağ Lâhikası 2",
  "asa yi musa":"html/13 Asâ-yı Musa",
};

function normalize(value:string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[âîû]/g, c => ({ "â":"a","î":"i","û":"u" }[c] || c))
    .replace(/[’‘'"]/g,"")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function encodePath(path:string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeEntities(value:string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#8212;|&mdash;/gi, "—")
    .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8230;|&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n,16)));
}

function stripTags(value:string) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h1|h2|h3|h4|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBlocks(html:string) {
  const content =
    html.match(/<div[^>]+class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    html;

  const cleaned = content
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<style[\s\S]*?<\/style>/gi,"")
    .replace(/<!--([\s\S]*?)-->/g,"");

  const blocks:Array<{kind:string;title:string|null;text:string}> = [];
  const regex=/<(h1|h2|h3|h4|p|blockquote|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match:RegExpExecArray|null;

  while ((match=regex.exec(cleaned))) {
    const tag=match[1].toLowerCase();
    const text=stripTags(match[2]);
    if (!text || text.length < 2) continue;
    const heading=tag.startsWith("h");
    blocks.push({
      kind:heading ? "heading" : "paragraph",
      title:heading ? text : null,
      text,
    });
  }

  if (!blocks.length) {
    for (const paragraph of stripTags(cleaned).split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean)) {
      blocks.push({kind:"paragraph",title:null,text:paragraph});
    }
  }

  const seen=new Set<string>();
  return blocks.filter(block=>{
    const key=block.kind+"|"+block.text;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchCorpusPaths() {
  const response=await fetch(TREE_URL,{
    headers:{accept:"application/vnd.github+json","user-agent":"Lumen-Risale-Reader"},
    next:{revalidate:604800},
  });
  if(!response.ok) throw new Error("Risale metin dizini alınamadı.");
  const json=await response.json();
  return (json.tree || [])
    .filter((item:any)=>item.type==="blob" && String(item.path||"").startsWith("html/") && String(item.path||"").endsWith(".html"))
    .map((item:any)=>String(item.path));
}

function stripFilePrefix(path:string) {
  const name=path.split("/").pop() || path;
  return name
    .replace(/\.html$/i,"")
    .replace(/^\d+(?:\.\d+)*\s+/,"");
}

function resolveCorpusPath(paths:string[], title:string, book:string, chapterNo:number) {
  const normalizedBook=normalize(book);
  const dir=BOOK_DIRS[normalizedBook];

  if (dir && chapterNo > 0) {
    const dirNo=(dir.match(/html\/(\d+)/)?.[1] || "").padStart(2,"0");
    const prefix=`${dir}/${dirNo}.${String(chapterNo).padStart(2,"0")} `;
    const direct=paths.find(path=>path.startsWith(prefix));
    if(direct) return direct;
  }

  if (dir && chapterNo <= 0) {
    const inside=paths.filter(path=>path.startsWith(dir+"/"));
    const main=inside.find(path=>{
      const base=normalize(stripFilePrefix(path));
      return base===normalizedBook || base.includes(normalizedBook) || normalizedBook.includes(base);
    });
    if(main) return main;
  }

  const candidates=[title,book].map(normalize).filter(Boolean);
  let best:{path:string;score:number}|null=null;

  for(const path of paths) {
    const base=normalize(stripFilePrefix(path));
    const full=normalize(path);
    let score=999;

    for(const query of candidates) {
      if(base===query) score=Math.min(score,0);
      else if(base.startsWith(query) || query.startsWith(base)) score=Math.min(score,1);
      else if(base.includes(query) || query.includes(base)) score=Math.min(score,2);
      else if(full.includes(query)) score=Math.min(score,3);
    }

    if(score<999 && (!best || score<best.score)) best={path,score};
  }

  return best?.path || null;
}

async function fetchCorpusHtml(path:string) {
  const response=await fetch(RAW_BASE+encodePath(path),{
    headers:{accept:"text/html,text/plain","user-agent":"Lumen-Risale-Reader"},
    next:{revalidate:604800},
  });
  if(!response.ok) throw new Error("Risale metin dosyası indirilemedi.");
  return response.text();
}

export async function GET(request:Request) {
  try {
    const url=new URL(request.url);
    const title=String(url.searchParams.get("title")||"").trim();
    const book=String(url.searchParams.get("book")||"").trim();
    const chapterNo=Number(url.searchParams.get("chapter")||0);

    if(!title) {
      return NextResponse.json({error:"Başlık gerekli."},{status:400});
    }

    const paths=await fetchCorpusPaths();
    const path=resolveCorpusPath(paths,title,book,chapterNo);

    if(!path) {
      return NextResponse.json({
        error:`Diyanet asıl nüsha arşivinde “${title}” bulunamadı.`
      },{status:404});
    }

    const html=await fetchCorpusHtml(path);
    const blocks=extractBlocks(html);

    if(!blocks.length) {
      return NextResponse.json({error:"Risale metni ayrıştırılamadı."},{status:502});
    }

    return NextResponse.json({
      title:stripFilePrefix(path),
      sourceUrl:BLOB_BASE+encodePath(path),
      sourceName:"Risale-i-Nur Diyanet Asıl Nüsha metin arşivi",
      officialSource:OFFICIAL_BASE,
      license:"CC BY-ND 4.0",
      blocks,
    });
  } catch(error) {
    return NextResponse.json(
      {error:error instanceof Error?error.message:"Risale metni alınamadı."},
      {status:502}
    );
  }
}
