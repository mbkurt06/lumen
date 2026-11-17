import { expect, test } from "@playwright/test";

test.describe("PWA dosyaları", () => {
  test("manifest doğru bilgileri verir", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);

    const manifest = await response.json();
    expect(typeof manifest.name).toBe("string");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  test("service worker dosyası sunulur", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
  });

  test("uygulama ikonu sunulur", async ({ request }) => {
    const response = await request.get("/icon.svg");
    expect(response.ok()).toBe(true);
  });
});
