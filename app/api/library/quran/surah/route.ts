import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 604800;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const number = Number(url.searchParams.get("number"));
    if (!Number.isInteger(number) || number < 1 || number > 114) {
      return NextResponse.json({ error: "Geçerli bir sûre numarası gerekli." }, { status: 400 });
    }

    const endpoint = `https://api.alquran.cloud/v1/surah/${number}/editions/quran-uthmani,tr.diyanet`;
    const response = await fetch(endpoint, {
      headers: { "accept": "application/json" },
      next: { revalidate: 604800 },
    });
    const json = await response.json();
    if (!response.ok || json?.code !== 200 || !Array.isArray(json?.data)) {
      throw new Error("Sûre metni alınamadı.");
    }

    const arabicEdition = json.data.find((edition: any) => edition?.edition?.identifier === "quran-uthmani") ?? json.data[0];
    const turkishEdition = json.data.find((edition: any) => edition?.edition?.identifier === "tr.diyanet");

    const translationByAyah = new Map<number, string>();
    for (const ayah of turkishEdition?.ayahs || []) {
      translationByAyah.set(Number(ayah.numberInSurah), String(ayah.text || ""));
    }

    const ayahs = (arabicEdition?.ayahs || []).map((ayah: any) => ({
      number: Number(ayah.number),
      numberInSurah: Number(ayah.numberInSurah),
      text: String(ayah.text || ""),
      translation: translationByAyah.get(Number(ayah.numberInSurah)) || "",
      juz: Number(ayah.juz || 0),
      page: Number(ayah.page || 0),
      hizbQuarter: Number(ayah.hizbQuarter || 0),
      sajda: Boolean(ayah.sajda),
    }));

    return NextResponse.json({
      surah: {
        number,
        arabicName: String(arabicEdition?.name || ""),
        englishName: String(arabicEdition?.englishName || ""),
        numberOfAyahs: Number(arabicEdition?.numberOfAyahs || ayahs.length),
        revelationType: String(arabicEdition?.revelationType || ""),
      },
      ayahs,
      sources: {
        arabic: { name: "AlQuran Cloud · quran-uthmani", url: "https://alquran.cloud/" },
        translation: { name: "Diyanet İşleri · tr.diyanet", url: "https://kuran.diyanet.gov.tr/" },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sûre metni alınamadı." },
      { status: 502 }
    );
  }
}
