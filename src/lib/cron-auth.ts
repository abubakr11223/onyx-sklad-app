// `Authorization: Bearer <CRON_SECRET>` tekshiruvi — cron va eksport
// endpoint'lari uchun umumiy.
//
// Nega alohida modul: bir xil mantiq /api/cron/expire-reservations ichida
// yozilgan edi; ikkinchi cron paydo bo'lgach uni route'dan route'ga import
// qilish noto'g'ri (route modullari — HTTP chegarasi, kutubxona emas). Eski
// route o'z nusxasi bilan qoldi (uning testlari shunga bog'liq), yangilari
// shu modulni ishlatadi.

/** Doimiy-vaqtli satr solishtirish: uzunlik farqi ham hisobga olinadi. */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ (i < bBytes.length ? bBytes[i] : 0);
  }
  return diff === 0;
}

/**
 * CRON_SECRET o'rnatilmagan bo'lsa — false (fail-closed): himoyasiz chaqiruv
 * qabul qilinmaydi. Vercel Cron sarlavhani o'zi qo'shadi; qo'lda chaqirganda
 * `curl -H "Authorization: Bearer $CRON_SECRET"`.
 */
export function isCronAuthorized(req: Request, label: string): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length === 0) {
    console.warn(`[${label}] CRON_SECRET o'rnatilmagan — rad etildi.`);
    return false;
  }
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return timingSafeEqual(header.slice(prefix.length), expected);
}
