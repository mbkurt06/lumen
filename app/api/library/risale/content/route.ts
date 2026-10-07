import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 604800;

const BASE = "https://risaleinur.hizmetvakfi.org";
const FETCH_TIMEOUT_MS = 8000;

async function timedFetch(url:string, init:RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await timedFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const ORDINALS: Record<number,string> = {
  1:"Birinci",2:"İkinci",3:"Üçüncü",4:"Dördüncü",5:"Beşinci",6:"Altıncı",7:"Yedinci",8:"Sekizinci",9:"Dokuzuncu",10:"Onuncu",
  11:"On Birinci",12:"On İkinci",13:"On Üçüncü",14:"On Dördüncü",15:"On Beşinci",16:"On Altıncı",17:"On Yedinci",18:"On Sekizinci",
  19:"On Dokuzuncu",20:"Yirminci",21:"Yirmi Birinci",22:"Yirmi İkinci",23:"Yirmi Üçüncü",24:"Yirmi Dördüncü",25:"Yirmi Beşinci",
  26:"Yirmi Altıncı",27:"Yirmi Yedinci",28:"Yirmi Sekizinci",29:"Yirmi Dokuzuncu",30:"Otuzuncu",31:"Otuz Birinci",32:"Otuz İkinci",33:"Otuz Üçüncü"
};

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
    .replace(/&#(d+);/g, (_, n) => String.fromCodePoint(Number(n)))
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

function slugify(value:string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[’']/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function officialTitle(title:string, book:string, chapterNo:number) {
  if (chapterNo > 0 && ORDINALS[chapterNo]) {
    const suffix =
      /söz/i.test(book) ? "Söz" :
      /mektub/i.test(book) ? "Mektup" :
      /lem/i.test(book) ? "Lem’a" :
      /şu|sua/i.test(book) ? "Şuâ" : "";
    if (suffix) return `${ORDINALS[chapterNo]} ${suffix}`;
  }
  return title;
}


async function findViaSearchPage(query:string) {
  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(query)}`;
    const response = await timedFetch(searchUrl, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Lumen/0.8" },
      next: { revalidate: 604800 },
      redirect: "follow",
    } as RequestInit & { next?: { revalidate:number } });
    if (!response.ok) return null;
    const html = await response.text();

    const articles = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)].map(match => match[1]);
    const normalized = slugify(query);

    for (const article of articles) {
      const headingHtml =
        article.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ||
        article.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
        "";
      const heading = stripTags(headingHtml);
      const headingSlug = slugify(heading);
      if (headingSlug && !(headingSlug === normalized || headingSlug.includes(normalized) || normalized.includes(headingSlug))) {
        continue;
      }

      const href = article.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1] || searchUrl;
      const entry =
        article.match(/<div[^>]+class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
        article.match(/<div[^>]+class=["'][^"']*entry-summary[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
        article;
      if (stripTags(entry).length > 120) {
        return { title: heading || query, html: entry, url: href };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function findViaWpApi(query:string) {
  try {
    const search = await timedFetch(`${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=20`, {
      headers: { accept: "application/json", "user-agent": "Lumen/0.8 (+personal reading app)" },
      next: { revalidate: 604800 },
    });
    if (!search.ok) return null;
    const results = await search.json();
    if (!Array.isArray(results) || !results.length) return null;

    const normalized = slugify(query);
    const best = results
      .filter((item:any)=>item?.subtype==="post")
      .sort((a:any,b:any)=>{
        const at=slugify(String(a?.title||""));
        const bt=slugify(String(b?.title||""));
        const as=at===normalized?0:at.includes(normalized)||normalized.includes(at)?1:2;
        const bs=bt===normalized?0:bt.includes(normalized)||normalized.includes(bt)?1:2;
        return as-bs;
      })[0] ?? results[0];

    if (!best?.id) return null;
    const post = await timedFetch(`${BASE}/wp-json/wp/v2/posts/${best.id}`, {
      headers: { accept: "application/json", "user-agent": "Lumen/0.8 (+personal reading app)" },
      next: { revalidate: 604800 },
    });
    if (!post.ok) return null;
    const json = await post.json();
    return {
      title: stripTags(String(json?.title?.rendered || best.title || query)),
      html: String(json?.content?.rendered || ""),
      url: String(json?.link || best.url || ""),
    };
  } catch {
    return null;
  }
}

async function findViaHtml(query:string) {
  const candidates = [
    `${BASE}/${slugify(query)}/`,
    `${BASE}/${slugify(query)}-2/`,
  ];

  for (const url of candidates) {
    try {
      const response = await timedFetch(url, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Lumen/0.8" },
        next: { revalidate: 604800 },
        redirect: "follow",
      });
      if (!response.ok) continue;
      const html = await response.text();
      const article =
        html.match(/<div[^>]+class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/article>/i)?.[1] ||
        html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
        "";
      if (stripTags(article).length > 120) return { title: query, html: article, url: response.url || url };
    } catch {}
  }

  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(query)}`;
    const response = await timedFetch(searchUrl, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Lumen/0.8" },
      next: { revalidate: 604800 },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const links = [...html.matchAll(/<a[^>]+href=["'](https?:\/\/risaleinur\.hizmetvakfi\.org\/[^"'#?]+\/?)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(match => ({ url:match[1], text:stripTags(match[2]) }))
      .filter(item => item.text && !/kategori|etiket|author|page\//i.test(item.url));
    const normalized = slugify(query);
    const best = links.sort((a,b)=>{
      const as=slugify(a.text)===normalized?0:slugify(a.text).includes(normalized)||normalized.includes(slugify(a.text))?1:2;
      const bs=slugify(b.text)===normalized?0:slugify(b.text).includes(normalized)||normalized.includes(slugify(b.text))?1:2;
      return as-bs;
    })[0];
    if (!best) return null;
    const page = await timedFetch(best.url, {
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Lumen/0.8" },
      next: { revalidate: 604800 },
    });
    if (!page.ok) return null;
    const pageHtml = await page.text();
    const article =
      pageHtml.match(/<div[^>]+class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/article>/i)?.[1] ||
      pageHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
      "";
    return stripTags(article).length > 120 ? { title:best.text || query, html:article, url:best.url } : null;
  } catch {
    return null;
  }
}

function extractBlocks(html:string) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<style[\s\S]*?<\/style>/gi,"")
    .replace(/<!--([\s\S]*?)-->/g,"");

  const blocks: Array<{kind:string;title:string|null;text:string}> = [];
  const regex=/<(h2|h3|h4|p|blockquote|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match:RegExpExecArray|null;
  while ((match=regex.exec(cleaned))) {
    const tag=match[1].toLowerCase();
    const text=stripTags(match[2]);
    if (!text || text.length < 2) continue;
    if (/^(previous|next|önceki|sonraki)$/i.test(text)) continue;
    blocks.push({
      kind: tag.startsWith("h") ? "heading" : "paragraph",
      title: tag.startsWith("h") ? text : null,
      text,
    });
  }

  if (!blocks.length) {
    const text=stripTags(cleaned);
    for (const paragraph of text.split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean)) {
      blocks.push({kind:"paragraph",title:null,text:paragraph});
    }
  }

  const seen = new Set<string>();
  return blocks.filter(block=>{
    const key=block.kind+"|"+block.text;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(request:Request) {
  try {
    const url=new URL(request.url);
    const title=String(url.searchParams.get("title")||"").trim();
    const book=String(url.searchParams.get("book")||"").trim();
    const chapterNo=Number(url.searchParams.get("chapter")||0);
    if(!title) return NextResponse.json({error:"Başlık gerekli."},{status:400});

    const query=officialTitle(title,book,chapterNo);
    const found=(await findViaSearchPage(query)) || (await findViaWpApi(query)) || (await findViaHtml(query));
    if(!found) {
      return NextResponse.json({error:`Resmî kaynakta “${query}” bulunamadı.`},{status:404});
    }

    const blocks=extractBlocks(found.html);
    if(!blocks.length) return NextResponse.json({error:"Metin içeriği ayrıştırılamadı."},{status:502});

    return NextResponse.json({
      title:found.title || query,
      sourceUrl:found.url,
      sourceName:"Hizmet Vakfı Risale-i Nur Külliyatı",
      blocks,
    });
  } catch(error) {
    return NextResponse.json(
      {error:error instanceof Error?error.message:"Risale metni alınamadı."},
      {status:502}
    );
  }
}
