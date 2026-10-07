import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export type GoogleCalendarAccount = {
  id: string;
  owner_id: string;
  google_sub: string;
  email: string;
  display_name: string | null;
  refresh_token: string;
  access_token: string | null;
  token_expires_at: string | null;
  scopes: string[];
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function googleConfig(request?: Request) {
  const clientId = required("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = required("GOOGLE_CALENDAR_CLIENT_SECRET");
  const stateSecret = required("GOOGLE_CALENDAR_STATE_SECRET");
  const redirectUri =
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
    (request ? `${new URL(request.url).origin}/api/google-calendar/callback` : "");
  return { clientId, clientSecret, stateSecret, redirectUri };
}

export function adminSupabase() {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function authenticatedUser(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const client = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

export function signOAuthState(payload: { userId: string; origin: string }, request: Request) {
  const { stateSecret } = googleConfig(request);
  const body = b64url(JSON.stringify({ ...payload, at: Date.now() }));
  const signature = crypto.createHmac("sha256", stateSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyOAuthState(state: string, request: Request) {
  const { stateSecret } = googleConfig(request);
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("Invalid OAuth state.");
  const expected = crypto.createHmac("sha256", stateSecret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid OAuth state.");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    userId: string;
    origin: string;
    at: number;
  };
  if (!parsed.userId || !parsed.origin || !parsed.at) throw new Error("Invalid OAuth state.");
  if (Date.now() - parsed.at > 15 * 60 * 1000) throw new Error("OAuth state expired.");
  return parsed;
}

export async function exchangeCode(code: string, request: Request) {
  const { clientId, clientSecret, redirectUri } = googleConfig(request);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || json.error || "Google token exchange failed.");
  return json as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type: string;
    id_token?: string;
  };
}

async function refreshAccessToken(account: GoogleCalendarAccount) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || json.error || "Google token refresh failed.");

  const accessToken = String(json.access_token);
  const expiresAt = new Date(Date.now() + Number(json.expires_in || 3600) * 1000).toISOString();
  const admin = adminSupabase();
  await admin
    .from("google_calendar_accounts")
    .update({ access_token: accessToken, token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", account.id);

  return accessToken;
}

export async function accessTokenFor(account: GoogleCalendarAccount) {
  if (account.access_token && account.token_expires_at) {
    const expiry = new Date(account.token_expires_at).getTime();
    if (expiry > Date.now() + 60_000) return account.access_token;
  }
  return refreshAccessToken(account);
}

export async function googleCalendarFetch(
  account: GoogleCalendarAccount,
  path: string,
  init: RequestInit = {}
) {
  const token = await accessTokenFor(account);
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (response.status === 204) return null;
  const json = await response.json();
  if (!response.ok) {
    const message = json?.error?.message || json?.error_description || "Google Calendar request failed.";
    throw new Error(message);
  }
  return json;
}
