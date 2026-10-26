# Lumen

Kişisel uygulama: Dashboard, Yapılacaklar, Kütüphane, Namaz, Takvim. Tek kod tabanı: web (Vercel) ve Android (Capacitor).

- Geliştirme: `npm install && npm run dev` (http://localhost:3100)
- Derleme: `npm run build` → `dist/` (içinde `version.json` üretilir)
- Veritabanı: Supabase `lumen` projesi (`supabase/migrations`)
- Eski Next.js uygulaması: `legacy/` (yalnızca başvuru için; Google Takvim, Kur'an okuyucu vb. buradan taşınacak)
