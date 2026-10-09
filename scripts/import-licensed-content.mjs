import { createClient } from "@supabase/supabase-js";

const sourcePackage=process.env.CONTENT_PACKAGE;
const serverUrl=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
const collectionId=process.env.CONTENT_COLLECTION_ID;
if(!sourcePackage||!serverUrl||!secret||!collectionId){
  throw new Error("Set CONTENT_PACKAGE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTENT_COLLECTION_ID.");
}

const library=await import(sourcePackage);
const raw=typeof library.getData==="function"?await library.getData():library.default??library;
const candidates=Array.isArray(raw)?raw:Array.isArray(raw.sections)?raw.sections:Array.isArray(raw.chapters)?raw.chapters:Array.isArray(raw.data)?raw.data:null;
if(!candidates || candidates.length!==100) {
  console.error("Unexpected source shape. Root keys:",Object.keys(raw??{}),"array size:",candidates?.length);
  process.exit(1);
}
const read=(v,keys)=>{for(const k of keys){if(typeof v?.[k]==="string"&&v[k].trim())return v[k].trim();}return "";};
function blockText(v,keys){
  const direct=read(v,keys);
  if(direct)return direct;
  const pieces=v.lines??v.items??v.verses??v.segments??v.prayers;
  if(!Array.isArray(pieces))return "";
  return pieces.map(p=>read(p,keys)).filter(Boolean).join("\n");
}
const normalized=candidates.map((v,i)=>({
  number:Number(v.number??v.chapterNumber??v.sectionNumber??v.id??i+1),
  original:blockText(v,["arabic","arabicText","text_ar","ar","original"]),
  romanized:blockText(v,["transliteration","latin","romanized","reading","transcription","tr_latin"]),
  translation:blockText(v,["turkish","translation_tr","turkishTranslation","meaning","translation","tr"])
}));
const failures=normalized.filter((v,i)=>v.number!==i+1||!/[\u0600-\u06FF]/u.test(v.original)||!v.romanized||!v.translation);
if(failures.length) {
  console.error("Import stopped; incomplete source fields:",failures.slice(0,8).map(v=>({number:v.number,arabic:!!v.original,latin:!!v.romanized,meaning:!!v.translation})));
  process.exit(1);
}
const api=createClient(serverUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:folder,error:folderError}=await api.from("library_items").select("id,owner_id").eq("id",collectionId).single();
if(folderError||!folder)throw new Error("Collection not found: "+folderError?.message);
const {data:existing,error:existingError}=await api.from("library_items").select("id,sort_order,title").eq("parent_id",collectionId);
if(existingError)throw existingError;
let inserted=0;
for(const chapter of normalized){
  const prior=existing.find(x=>x.sort_order===chapter.number&&x.title===chapter.number+". Bab");
  const item={owner_id:folder.owner_id,parent_id:collectionId,kind:"document",title:chapter.number+". Bab",subtitle:"Arapça · Latin · Türkçe",sort_order:chapter.number,metadata:{source:"dua_v2",entity:"document",category_key:"jawshan",unit:"chapter",segment_count:1,licensed_source:sourcePackage}};
  let id=prior?.id;
  if(id){
    const {error}=await api.from("library_items").update(item).eq("id",id);if(error)throw error;
  }else{
    const {data,error}=await api.from("library_items").insert(item).select("id").single();
    if(error)throw error;
    id=data.id;
  }
  const {data:children,error:childError}=await api.from("content_nodes").select("id").eq("document_id",id).order("sort_order");
  if(childError)throw childError;
  const node={owner_id:folder.owner_id,document_id:id,kind:"phrase",title:null,sort_order:1,secondary_text:chapter.original,text_content:chapter.romanized,translation:chapter.translation,metadata:{unit:"chapter",source_package:sourcePackage}};
  if(children.length){
    const {error}=await api.from("content_nodes").update(node).eq("id",children[0].id);if(error)throw error;
    if(children.length>1){
      const {error:deleteError}=await api.from("content_nodes").delete().eq("document_id",id).neq("id",children[0].id);
      if(deleteError)throw deleteError;
    }
  }else{
    const {error}=await api.from("content_nodes").insert(node);if(error)throw error;
  }
  inserted++;
  if(inserted%10===0)console.log("Imported chapters:",inserted);
}
console.log("Completed 100 chapters; content is stored only in Supabase.");
