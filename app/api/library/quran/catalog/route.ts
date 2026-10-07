import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET() {
  try {
    const response = await fetch("https://api.alquran.cloud/v1/surah", {
      headers: { "accept": "application/json" },
      next: { revalidate: 86400 },
    });
    const json = await response.json();
    if (!response.ok || json?.code !== 200 || !Array.isArray(json?.data)) {
      throw new Error("Kur'an sûre listesi alınamadı.");
    }

    const surahs = json.data.map((surah: any) => ({
      number: Number(surah.number),
      arabicName: String(surah.name || ""),
      englishName: String(surah.englishName || ""),
      englishNameTranslation: String(surah.englishNameTranslation || ""),
      numberOfAyahs: Number(surah.numberOfAyahs || 0),
      revelationType: String(surah.revelationType || ""),
    }));

    return NextResponse.json({
      surahs,
      source: "AlQuran Cloud",
      sourceUrl: "https://alquran.cloud/",
      diyanetUrl: "https://kuran.diyanet.gov.tr/",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kur'an sûre listesi alınamadı." },
      { status: 502 }
    );
  }
}
