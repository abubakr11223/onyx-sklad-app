// Kunlik ma'lumot zaxirasi — bazadan tashqariga.
//
// Nima qiladi: hamma ish jadvalini bitta JSON'ga yig'adi (src/lib/db-snapshot)
// va uni Telegram orqali EGA (OWNER) akkauntlariga hujjat sifatida yuboradi.
// Telegram tanlangani — qo'shimcha hech qanday kalit/hisob kerak emas: bot
// tokeni allaqachon ishlayapti, fayl telefonda ham, kompyuterda ham qoladi.
//
// Nega umuman kerak: Neon PITR bazani tiklaydi, lekin u Neon akkauntining
// ichida. Bitta noto'g'ri purge, o'chirilgan proyekt yoki adashgan migratsiya
// — ma'lumot yo'qolishiga olib kelmasligi kerak. Zaxira ALOHIDA joyda tursin.
//
// Jadval: vercel.json → crons, kuniga bir marta (Vercel Hobby cheklovi).
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  buildSnapshot,
  snapshotCaption,
  snapshotFilename,
  snapshotToJson,
  snapshotTotalRows,
} from "@/lib/db-snapshot";
import { sendDocument } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Zaxira 26 ta jadvalni ketma-ket o'qiydi — standart 10s yetmasligi mumkin.
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "cron/backup")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const takenAt = new Date().toISOString();
  const snapshot = await buildSnapshot(db, takenAt);
  const json = snapshotToJson(snapshot);
  const bytes = new TextEncoder().encode(json);
  const filename = snapshotFilename(takenAt);
  const total = snapshotTotalRows(snapshot);

  // Kimga: egalar (OWNER) — Telegram'i ulanganlar. Menejer/skladchi zaxira
  // faylini olmaydi: unda hamma mijoz, narx va qarz ma'lumoti bor.
  const owners = await db.user.findMany({
    where: { role: "OWNER", telegramId: { not: null } },
    select: { id: true, telegramId: true },
  });

  const delivered: string[] = [];
  const failed: { chatId: string; error: string }[] = [];
  for (const o of owners) {
    const chatId = o.telegramId as string;
    const r = await sendDocument(chatId, filename, bytes, snapshotCaption(snapshot));
    if (r.ok) delivered.push(chatId);
    else failed.push({ chatId, error: r.error });
  }

  if (owners.length === 0) {
    console.warn(
      "[cron/backup] Telegram'i ulangan OWNER yo'q — zaxira hech kimga ketmadi.",
    );
  }
  console.info(
    `[cron/backup] ${total} yozuv, ${bytes.length} bayt; yuborildi: ${delivered.length}, xato: ${failed.length}`,
  );

  return Response.json({
    ok: true,
    takenAt,
    bytes: bytes.length,
    totalRows: total,
    counts: snapshot.counts,
    delivered: delivered.length,
    failed,
  });
}
