import { expect, test } from "@playwright/test";
import { blockSupabase } from "./helpers";

test.describe("Giriş ekranı", () => {
  test.beforeEach(async ({ page }) => {
    await blockSupabase(page);
  });

  test("oturum yokken giriş formu görünür", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Lumen/);
    await expect(page.getByRole("heading", { name: "Lumen hesabı" })).toBeVisible();
    await expect(page.getByPlaceholder("E-posta")).toBeVisible();
    await expect(page.getByPlaceholder("Şifre")).toBeVisible();
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeEnabled();
  });

  test("boş formla giriş gönderilmez", async ({ page }) => {
    await page.goto("/");
    const email = page.getByPlaceholder("E-posta");
    await expect(email).toBeVisible();

    await page.getByRole("button", { name: "Giriş yap" }).click();

    // The browser blocks submit on required fields, so the status never says "Giriş yapılıyor".
    await expect(page.getByText("Giriş yapılıyor...")).toHaveCount(0);
    expect(await email.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });

  test("Supabase erişilemezken uygulama çökmez", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Lumen hesabı" })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
