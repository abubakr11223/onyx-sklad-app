// Cron backstop — muddati o'tgan bronlarni «В наличии»ga qaytaradi (TZ §4.4/§6.6).
// Sabab: expireOverdueReservations() faqat /bron va /fotozapros render'ida "lazy
// sweep" bo'lib ishlaydi. Agar hech kim o'sha sahifalarni ochmasa, muddati o'tgan
// SLAB/PIECE bronlari RESERVED holatida qolib ketardi. Bu endpoint Vercel Cron
// tomonidan chaqiriladi (vercel.json → crons) va shu funksiyani majburan yuritadi.
// Lazy sweep O'CHIRILMAGAN — bu qo'shimcha himoya qatlami (defense in depth).
//
// Xavfsizlik: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` sarlavhasini
// yuboradi (CRON_SECRET muhitda o'rnatilgan bo'lsa). Sarlavha mos kelmasa → 401.
// Solishtirish doimiy-vaqtli (telegram webhook route'idagi naqsh).
//
// Chastota: production Vercel Hobby (bepul) rejasida — cron kuniga BIR MARTA
// cheklangan. Shu bois jadval `vercel.json`da kunlik ("0 3 * * *", UTC 03:00).
// Pro rejaga o'tilsa, jadvalni tez-tez qilish mumkin (masalan har 15 daqiqada
// "*/15 * * * *") — kod o'zgarmaydi, faqat vercel.json'dagi `schedule`.
import { expireOverdueReservations } from "@/lib/reservations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Doimiy-vaqtli satr solishtirish (telegram/webhook route bilan bir xil naqsh).
 * Uzunlik farqi ham hisobga olinadi; birinchi farqda chiqib ketmaydi.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ (i < bBytes.length ? bBytes[i] : 0);
  }
  return diff === 0;
}

/**
 * `Authorization: Bearer <CRON_SECRET>` to'g'ri kelsa true. CRON_SECRET
 * o'rnatilmagan bo'lsa → false (fail-closed): himoyasiz cron chaqiruvi
 * qabul qilinmaydi.
 */
export function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length === 0) {
    console.warn(
      "[cron/expire-reservations] CRON_SECRET o'rnatilmagan — rad etildi.",
    );
    return false;
  }
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return timingSafeEqual(header.slice(prefix.length), expected);
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const expired = await expireOverdueReservations();
  console.info(`[cron/expire-reservations] ${expired} ta bron EXPIRED qilindi.`);
  return Response.json({ ok: true, expired });
}
