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
// W2-T2 — jim yiqilish tuzatildi: ilgari sendDocument muvaffaqiyatsiz bo'lsa
// ham route ok:true qaytarardi (Vercel cron logida yashil), hech kim bilmasdi.
// Endi HAR QANDAY xato (snapshot yiqildi / fayl 50 MB dan katta / hujjat
// yetkazilmadi) → HTTP 500 + ok:false (cron logi qizil) va egalarga
// sendMessage orqali ogohlantirish (best-effort — o'zi hech qachon throw
// qilmaydi, natijasi javob tanasida ko'rinadi).
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
import { sendDocument, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Zaxira 26 ta jadvalni ketma-ket o'qiydi — standart 10s yetmasligi mumkin.
export const maxDuration = 60;

/**
 * Telegram Bot API hujjat chegarasi — 50 MB. Bundan katta faylga sendDocument
 * urinmaymiz (API baribir rad etadi); o'rniga egaga qo'lda yuklab olish yo'li
 * aytiladi.
 */
export const TELEGRAM_DOCUMENT_LIMIT_BYTES = 50 * 1024 * 1024;

/** Katta zaxirani qo'lda olish yo'li (Authorization: Bearer CRON_SECRET). */
export const EXPORT_SNAPSHOT_PATH = "/api/export/snapshot";

type OwnerChat = { id: string; telegramId: string | null };

/**
 * Egalarni Telegram sendMessage bilan ogohlantirish — best-effort: HECH QACHON
 * throw qilmaydi, natija javob tanasiga kiradi (notified / notifyFailed).
 */
async function notifyOwners(
  owners: OwnerChat[],
  text: string,
): Promise<{ notified: string[]; notifyFailed: { chatId: string; error: string }[] }> {
  const notified: string[] = [];
  const notifyFailed: { chatId: string; error: string }[] = [];
  for (const o of owners) {
    const chatId = o.telegramId as string;
    try {
      const r = await sendMessage(chatId, text);
      if (r.ok) notified.push(chatId);
      else notifyFailed.push({ chatId, error: r.error });
    } catch (e) {
      // sendMessage shartnoma bo'yicha throw qilmaydi, lekin ogohlantirish
      // yo'li zaxira natijasini hech qachon yiqitmasligi kerak.
      notifyFailed.push({
        chatId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { notified, notifyFailed };
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "cron/backup")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const takenAt = new Date().toISOString();
  const day = takenAt.slice(0, 10);

  // Kimga: egalar (OWNER) — Telegram'i ulanganlar. Menejer/skladchi zaxira
  // faylini olmaydi: unda hamma mijoz, narx va qarz ma'lumoti bor.
  // Snapshot'DAN OLDIN o'qiladi: snapshot yiqilsa ham kimni ogohlantirishni
  // bilishimiz kerak.
  let owners: OwnerChat[] = [];
  let ownersError: string | null = null;
  try {
    owners = await db.user.findMany({
      where: { role: "OWNER", telegramId: { not: null } },
      select: { id: true, telegramId: true },
    });
  } catch (e) {
    ownersError = e instanceof Error ? e.message : String(e);
    console.error(`[cron/backup] OWNER ro'yxatini o'qib bo'lmadi: ${ownersError}`);
  }

  // (1) Snapshot yaratish — yiqilsa: 500 + egalarga xabar.
  let json: string;
  let total: number;
  let caption: string;
  let counts: Record<string, number>;
  try {
    const snapshot = await buildSnapshot(db, takenAt);
    json = snapshotToJson(snapshot);
    total = snapshotTotalRows(snapshot);
    caption = snapshotCaption(snapshot);
    counts = snapshot.counts;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[cron/backup] snapshot yiqildi: ${error}`);
    const notify = await notifyOwners(
      owners,
      [
        `⚠️ Onyx: резервная копия ${day} НЕ создана.`,
        `Ошибка: ${error}`.slice(0, 500),
        "Проверьте логи Vercel (cron/backup).",
      ].join("\n"),
    );
    return Response.json(
      { ok: false, reason: "snapshot_failed", error, takenAt, ...notify },
      { status: 500 },
    );
  }

  const bytes = new TextEncoder().encode(json);
  const filename = snapshotFilename(takenAt);

  if (ownersError !== null || owners.length === 0) {
    // Yuboradigan hech kim yo'q — zaxira hech kimga ketmadi, bu ham jim
    // qolmasin: cron logi qizil bo'lsin (egani ogohlantira olmaymiz — chat yo'q).
    const reason = ownersError !== null ? "owners_query_failed" : "no_owners";
    console.warn(
      `[cron/backup] Telegram'i ulangan OWNER yo'q (${reason}) — zaxira hech kimga ketmadi.`,
    );
    return Response.json(
      {
        ok: false,
        reason,
        ...(ownersError !== null ? { error: ownersError } : {}),
        takenAt,
        bytes: bytes.length,
        totalRows: total,
        counts,
      },
      { status: 500 },
    );
  }

  // (2) Hajm darvozasi — 50 MB dan katta faylga sendDocument urinmaymiz:
  // Telegram baribir rad etadi. Egaga qo'lda olish yo'lini aytamiz; snapshot
  // o'zi baribir /api/export/snapshot orqali mavjud.
  if (bytes.length > TELEGRAM_DOCUMENT_LIMIT_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1);
    console.error(
      `[cron/backup] zaxira ${bytes.length} bayt (${mb} MB) — Telegram 50 MB chegarasidan katta, yuborilmadi.`,
    );
    const notify = await notifyOwners(
      owners,
      [
        `⚠️ Onyx: резервная копия ${day} слишком большая для Telegram (${mb} МБ, лимит 50 МБ) — файл НЕ отправлен.`,
        `Скачайте копию вручную: ${EXPORT_SNAPSHOT_PATH}`,
        "(нужен заголовок Authorization: Bearer <CRON_SECRET>)",
      ].join("\n"),
    );
    return Response.json(
      {
        ok: false,
        reason: "oversize",
        takenAt,
        bytes: bytes.length,
        limit: TELEGRAM_DOCUMENT_LIMIT_BYTES,
        totalRows: total,
        counts,
        ...notify,
      },
      { status: 500 },
    );
  }

  // (3) Yuborish. Idempotent: qayta chaqirilsa shunchaki yana bir nusxa ketadi.
  const delivered: string[] = [];
  const failed: { chatId: string; error: string }[] = [];
  for (const o of owners) {
    const chatId = o.telegramId as string;
    const r = await sendDocument(chatId, filename, bytes, caption);
    if (r.ok) delivered.push(chatId);
    else failed.push({ chatId, error: r.error });
  }

  console.info(
    `[cron/backup] ${total} yozuv, ${bytes.length} bayt; yuborildi: ${delivered.length}, xato: ${failed.length}`,
  );

  // (4) Birorta hujjat yetkazilmagan bo'lsa — 500 + egalarga xabar (matnli
  // xabar kichik, hujjat o'tmagan joyda ham o'tib qolishi mumkin).
  if (failed.length > 0) {
    const notify = await notifyOwners(
      owners,
      [
        `⚠️ Onyx: резервная копия ${day} не доставлена (${failed.length} из ${owners.length} чатов — ошибка отправки файла).`,
        `Скачайте копию вручную: ${EXPORT_SNAPSHOT_PATH}`,
        "Подробности — в логах Vercel (cron/backup).",
      ].join("\n"),
    );
    return Response.json(
      {
        ok: false,
        reason: "send_failed",
        takenAt,
        bytes: bytes.length,
        totalRows: total,
        counts,
        delivered: delivered.length,
        failed,
        ...notify,
      },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    takenAt,
    bytes: bytes.length,
    totalRows: total,
    counts,
    delivered: delivered.length,
    failed,
  });
}
