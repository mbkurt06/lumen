import { supabase } from "./supabase";
import type { Scope } from "./readerSettings";

/* Ayraçlar: her bölümde birden çok, isimli; Kur'an'da mushaf sayfasına bağlı. */
export type Bookmark = {
  id: string;
  scope: string;
  book_id: string | null;
  document_id: string;
  node_id: string | null;
  mushaf_page: number | null;
  title: string;
  quote: string | null;
  label: string | null;
  book_title: string | null;
  section: string | null;
  updated_at: string;
};
const COLS = "id,scope,book_id,document_id,node_id,mushaf_page,title,quote,label,book_title,section,updated_at";

/** Kur'an: bütün Kur'an ayraçları. Diğerleri: aynı kitabın (üst klasör) ayraçları. */
export async function listBookmarks(scope: Scope, bookId: string | null): Promise<Bookmark[]> {
  let q = supabase.from("reader_bookmarks").select(COLS).eq("scope", scope).order("updated_at", { ascending: false }).limit(200);
  if (scope !== "kuran") q = bookId ? q.eq("book_id", bookId) : q.is("book_id", null);
  const { data } = await q;
  return (data ?? []) as Bookmark[];
}

/** autoTitle: isim verilmezse kullanılacak ad; label: yerin adı ("İkinci Lem'a · Sayfa 1"). */
export type BookmarkDraft = { scope: Scope; book_id: string | null; document_id: string; node_id: string | null; mushaf_page: number | null; quote: string; autoTitle: string; label?: string; book_title?: string };

export async function addBookmark(d: BookmarkDraft, name: string) {
  return supabase.from("reader_bookmarks").insert({
    scope: d.scope, book_id: d.book_id, document_id: d.document_id, node_id: d.node_id, mushaf_page: d.mushaf_page,
    title: name.trim() || d.book_title || d.autoTitle, quote: d.quote.slice(0, 300), label: d.label ?? d.autoTitle, book_title: d.book_title ?? null, section: d.scope,
  }).select(COLS).single();
}
/** Var olan ayracı yeni yere taşı (ismi aynı kalır). Bağlı görevler ayracı gösterdiği için onlar da güncellenmiş olur. */
export async function moveBookmark(id: string, d: BookmarkDraft) {
  return supabase.from("reader_bookmarks").update({
    document_id: d.document_id, node_id: d.node_id, mushaf_page: d.mushaf_page, quote: d.quote.slice(0, 300), label: d.label ?? d.autoTitle,
    ...(d.book_title ? { book_title: d.book_title } : {}), updated_at: new Date().toISOString(),
  }).eq("id", id);
}
export async function deleteBookmark(id: string) {
  return supabase.from("reader_bookmarks").delete().eq("id", id);
}
