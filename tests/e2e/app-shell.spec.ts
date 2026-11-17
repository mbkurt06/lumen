import { expect, test } from "@playwright/test";
import { blockSupabase, seedApprovedDevice } from "./helpers";

test.describe("Daha önce onaylanmış cihaz (çevrimdışı açılış)", () => {
  test.beforeEach(async ({ page }) => {
    await blockSupabase(page);
    await seedApprovedDevice(page);
  });

  test("kayıtlı hesapla uygulama kabuğu açılır", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".brand")).toHaveText("Lumen");
    const nav = page.locator("nav.nav");
    for (const label of ["Dashboard", "TODO", "Kütüphane", "Takvim", "Ayarlar"]) {
      await expect(nav.getByRole("button", { name: label })).toBeVisible();
    }
    // Default screen is the dashboard.
    await expect(page.getByRole("button", { name: "Bugünün planına dön" })).toBeVisible();
  });

  test("menüden TODO ve Ayarlar sayfalarına geçilir", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav.nav");

    await nav.getByRole("button", { name: "TODO" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "TODO" })).toBeVisible();

    await nav.getByRole("button", { name: "Ayarlar" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ayarlar" })).toBeVisible();

    await nav.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.getByRole("button", { name: "Bugünün planına dön" })).toBeVisible();
  });

  test("Kütüphane ve Takvim sayfaları açılır", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav.nav");

    await nav.getByRole("button", { name: "Kütüphane" }).click();
    await expect(nav.getByRole("button", { name: "Kütüphane" })).toHaveClass(/active/);

    await nav.getByRole("button", { name: "Takvim" }).click();
    await expect(nav.getByRole("button", { name: "Takvim" })).toHaveClass(/active/);
    await expect(page.locator(".brand")).toHaveText("Lumen");
  });

  test("sayfa yenilenince oturum korunur", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand")).toHaveText("Lumen");

    await page.reload();
    await expect(page.locator(".brand")).toHaveText("Lumen");
    await expect(page.getByRole("heading", { name: "Lumen hesabı" })).toHaveCount(0);
  });
});
