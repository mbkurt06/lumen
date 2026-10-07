import { NextResponse } from "next/server";
import { adminSupabase, authenticatedUser, googleCalendarFetch, type GoogleCalendarAccount } from "@/lib/google-calendar/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
    const admin = adminSupabase();
    const { data, error } = await admin
      .from("google_calendar_accounts")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at");
    if (error) throw error;

    const accounts = [];
    for (const raw of data || []) {
      const account = raw as GoogleCalendarAccount;
      try {
        const calendarList = await googleCalendarFetch(account, "/users/me/calendarList?maxResults=250");
        accounts.push({
          id: account.id,
          email: account.email,
          displayName: account.display_name,
          calendars: (calendarList?.items || []).map((cal: any) => ({
            id: cal.id,
            summary: cal.summary || cal.id,
            primary: Boolean(cal.primary),
            selected: cal.selected !== false,
            backgroundColor: cal.backgroundColor || null,
            foregroundColor: cal.foregroundColor || null,
            accessRole: cal.accessRole || "reader",
            timeZone: cal.timeZone || null,
          })),
        });
      } catch (error) {
        accounts.push({
          id: account.id,
          email: account.email,
          displayName: account.display_name,
          calendars: [],
          error: error instanceof Error ? error.message : "Takvimler alınamadı.",
        });
      }
    }

    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Hesaplar alınamadı." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
    const { accountId } = await request.json();
    const admin = adminSupabase();
    await admin.from("google_calendar_accounts").delete().eq("id", accountId).eq("owner_id", user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Hesap kaldırılamadı." }, { status: 500 });
  }
}
