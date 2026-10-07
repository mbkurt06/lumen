import { NextResponse } from "next/server";
import { adminSupabase, exchangeCode, verifyOAuthState } from "@/lib/google-calendar/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const state = verifyOAuthState(url.searchParams.get("state") || "", request);
    const code = url.searchParams.get("code");
    if (!code) throw new Error(url.searchParams.get("error") || "Google yetkilendirme kodu gelmedi.");

    const tokens = await exchangeCode(code, request);
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.sub || !profile.email) throw new Error("Google hesap bilgileri alınamadı.");

    const admin = adminSupabase();
    const { data: existing } = await admin
      .from("google_calendar_accounts")
      .select("id,refresh_token")
      .eq("owner_id", state.userId)
      .eq("google_sub", String(profile.sub))
      .maybeSingle();

    const refreshToken = tokens.refresh_token || existing?.refresh_token;
    if (!refreshToken) throw new Error("Google refresh token vermedi. Hesabı yeniden izin vererek bağlayın.");

    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
    const payload = {
      owner_id: state.userId,
      google_sub: String(profile.sub),
      email: String(profile.email),
      display_name: profile.name ? String(profile.name) : null,
      refresh_token: refreshToken,
      access_token: tokens.access_token,
      token_expires_at: expiresAt,
      scopes: String(tokens.scope || "").split(" ").filter(Boolean),
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      await admin.from("google_calendar_accounts").update(payload).eq("id", existing.id);
    } else {
      await admin.from("google_calendar_accounts").insert(payload);
    }

    const returnUrl = new URL(state.origin);
    returnUrl.searchParams.set("calendar", "connected");
    return NextResponse.redirect(returnUrl);
  } catch (error) {
    const origin = url.origin;
    const returnUrl = new URL(origin);
    returnUrl.searchParams.set("calendar", "error");
    returnUrl.searchParams.set("message", error instanceof Error ? error.message : "Google bağlantısı başarısız.");
    return NextResponse.redirect(returnUrl);
  }
}
