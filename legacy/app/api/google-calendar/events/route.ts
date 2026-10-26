import { NextResponse } from "next/server";
import { adminSupabase, authenticatedUser, googleCalendarFetch, type GoogleCalendarAccount } from "@/lib/google-calendar/server";

export const runtime = "nodejs";

async function ownedAccount(userId: string, accountId: string) {
  const admin = adminSupabase();
  const { data } = await admin
    .from("google_calendar_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("owner_id", userId)
    .maybeSingle();
  return data as GoogleCalendarAccount | null;
}

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });

    const url = new URL(request.url);
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");
    if (!timeMin || !timeMax) return NextResponse.json({ error: "Tarih aralığı eksik." }, { status: 400 });

    const requested = url.searchParams.getAll("calendar");
    const grouped = new Map<string, string[]>();
    for (const key of requested) {
      const separator = key.indexOf("|");
      if (separator <= 0) continue;
      const accountId = key.slice(0, separator);
      const calendarId = key.slice(separator + 1);
      const list = grouped.get(accountId) || [];
      list.push(calendarId);
      grouped.set(accountId, list);
    }

    const admin = adminSupabase();
    const { data } = await admin
      .from("google_calendar_accounts")
      .select("*")
      .eq("owner_id", user.id);

    const events: any[] = [];
    for (const raw of data || []) {
      const account = raw as GoogleCalendarAccount;
      const calendarIds = grouped.get(account.id) || [];
      for (const calendarId of calendarIds) {
        const qs = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "2500",
        });
        const result = await googleCalendarFetch(
          account,
          `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`
        );
        for (const event of result?.items || []) {
          events.push({
            id: event.id,
            accountId: account.id,
            calendarId,
            calendarKey: `${account.id}|${calendarId}`,
            summary: event.summary || "(Başlıksız)",
            description: event.description || "",
            location: event.location || "",
            start: event.start?.dateTime || event.start?.date || null,
            end: event.end?.dateTime || event.end?.date || null,
            allDay: Boolean(event.start?.date && !event.start?.dateTime),
            status: event.status || "",
            htmlLink: event.htmlLink || "",
            colorId: event.colorId || null,
            reminders: {
              useDefault: event.reminders?.useDefault !== false,
              overrides: Array.isArray(event.reminders?.overrides)
                ? event.reminders.overrides
                    .filter((item: any) => item?.method === "popup" && Number.isFinite(Number(item?.minutes)))
                    .map((item: any) => ({ method: "popup", minutes: Number(item.minutes) }))
                : [],
            },
          });
        }
      }
    }

    events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Etkinlikler alınamadı." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
    const body = await request.json();
    const account = await ownedAccount(user.id, body.accountId);
    if (!account) return NextResponse.json({ error: "Google hesabı bulunamadı." }, { status: 404 });

    const event = await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(body.calendarId)}/events`,
      { method: "POST", body: JSON.stringify(body.event) }
    );
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Etkinlik oluşturulamadı." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
    const body = await request.json();
    const account = await ownedAccount(user.id, body.accountId);
    if (!account) return NextResponse.json({ error: "Google hesabı bulunamadı." }, { status: 404 });

    const event = await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(body.calendarId)}/events/${encodeURIComponent(body.eventId)}`,
      { method: "PATCH", body: JSON.stringify(body.event) }
    );
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Etkinlik güncellenemedi." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
    const body = await request.json();
    const account = await ownedAccount(user.id, body.accountId);
    if (!account) return NextResponse.json({ error: "Google hesabı bulunamadı." }, { status: 404 });

    await googleCalendarFetch(
      account,
      `/calendars/${encodeURIComponent(body.calendarId)}/events/${encodeURIComponent(body.eventId)}`,
      { method: "DELETE" }
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Etkinlik silinemedi." }, { status: 500 });
  }
}
