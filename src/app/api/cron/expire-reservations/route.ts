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
import { db } from "@/lib/db";
import { expireOverdueReservations } from "@/lib/reservations";
import {
  BACKUP_STALE_HOURS,
  isBackupStale,
  readLastBackupOk,
  staleBackupMessage,
} from "@/lib/backup-status";
import { sendMessage } from "@/lib/telegram";

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

  // Zaxira TIRIKMI — «o'lik odam tugmasi» (audit 2026-09-02).
  // Nega aynan shu yerda: bu BOSHQA cron, boshqa vaqtda ishlaydi. Zaxira
  // cronи butunlay o'lsa (o'chib qolgan, ko'chirishda yo'qolgan, kaliti
  // noto'g'ri) — o'zi haqida hech qachon xabar bera olmaydi. Bu esa tirik
  // qoladi va o'lganini aytadi. Tafsilot: src/lib/backup-status.ts.
  const backup = await checkBackupAlive();
  return Response.json({ ok: true, expired, backup });
}

interface BackupCheck {
  lastOkAt: string | null;
  stale: boolean;
  notified: number;
}

/**
 * Zaxira eskirgan bo'lsa egalarga xabar yuboradi.
 * HECH QACHON throw qilmaydi: bu qo'shimcha tekshiruv, uning xatosi bron
 * tozalashning natijasini bekor qilmasligi kerak.
 */
async function checkBackupAlive(): Promise<BackupCheck> {
  const nowIso = new Date().toISOString();
  let lastOkAt: string | null = null;
  try {
    lastOkAt = await readLastBackupOk(db);
  } catch {
    // readLastBackupOk o'zi ham yutadi, bu ikkinchi himoya.
  }
  const stale = isBackupStale(lastOkAt, nowIso, BACKUP_STALE_HOURS);
  if (!stale) return { lastOkAt, stale: false, notified: 0 };

  console.warn(
    `[cron/expire-reservations] zaxira eskirgan (oxirgisi: ${lastOkAt ?? "hech qachon"}).`,
  );
  let notified = 0;
  try {
    const owners = await db.user.findMany({
      where: { role: "OWNER", telegramId: { not: null } },
      select: { telegramId: true },
    });
    const text = staleBackupMessage(lastOkAt, nowIso);
    for (const o of owners) {
      const r = await sendMessage(o.telegramId as string, text);
      if (r.ok) notified += 1;
    }
  } catch (e) {
    console.warn(
      `[cron/expire-reservations] zaxira ogohlantirishi yuborilmadi: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { lastOkAt, stale: true, notified };
}
