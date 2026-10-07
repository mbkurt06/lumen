import { NextResponse } from "next/server";
import { authenticatedUser, googleConfig, signOAuthState } from "@/lib/google-calendar/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });

    const { clientId, redirectUri } = googleConfig(request);
    const origin = new URL(request.url).origin;
    const state = signOAuthState({ userId: user.id, origin }, request);

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar"
    ].join(" "));

    return NextResponse.json({ url: url.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google bağlantısı başlatılamadı.";
    const notConfigured = message.startsWith("Missing environment variable:");
    return NextResponse.json(
      {
        error: notConfigured
          ? "Google Takvim OAuth yapılandırması eksik."
          : message,
        code: notConfigured ? "GOOGLE_CALENDAR_NOT_CONFIGURED" : "GOOGLE_CALENDAR_CONNECT_FAILED",
        detail: notConfigured ? message : undefined,
      },
      { status: 500 }
    );
  }
}
