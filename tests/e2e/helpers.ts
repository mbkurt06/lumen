import type { Page } from "@playwright/test";

// Keys the app itself uses (lib/offlineIdentity.ts, components/PrivateMemberGate.tsx).
const OFFLINE_USER_KEY = "lumen-offline-user-v1";
const LOCAL_APPROVAL_KEY = "lumen-private-approved-user-v1";

export const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "e2e@lumen.test",
};

/**
 * Tests never talk to a real Supabase project.
 * Every request to a Supabase host fails, which is exactly the offline path
 * the app must survive.
 */
export async function blockSupabase(page: Page) {
  await page.route(/supabase\.(co|in)|lumen-offline\.invalid/, route => route.abort());
}

/**
 * Seeds a device that has signed in and been approved before,
 * so the app should open its shell from local data alone.
 */
export async function seedApprovedDevice(page: Page) {
  await page.addInitScript(
    ({ userKey, approvalKey, user }) => {
      localStorage.setItem(
        userKey,
        JSON.stringify({
          id: user.id,
          email: user.email,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
      );
      localStorage.setItem(approvalKey, user.id);
    },
    { userKey: OFFLINE_USER_KEY, approvalKey: LOCAL_APPROVAL_KEY, user: TEST_USER },
  );
}
