// TG-B1 — fotozapros yaratish + Telegram dispatch (TZ §5.3, §1.8, §8).
// SOF va testlanadigan: db va sendMessage inyeksiya qilinadi (deps) — bu yerda
// import QILINMAYDI. server action real bog'lamalarni uzatadi, testlar mock uzatadi.
//
// Doira (TG-B1): menejer qidiruv sahifasida fotozapros yaratadi → hamma faol
// skladchi (WAREHOUSE, telegramId bor) Telegram vazifasini oladi. Umumiy navbat
// modeli: assigneeId = null. Fotoni QABUL QILISH (Blob/Photo/DONE) — TG-B2.
//
// BUG-04: ilgari yetkazilish JIM edi — sendMessage xatoni yutar, dispatchedTo
// yolg'on chiqar, hech kim ro'yxatdan o'tmagan bo'lsa (workers=[]) menejer
// bexabar qolardi. Endi: (1) har urinish SENT/FAILED bo'lib PhotoDispatch'ga
// yoziladi + AuditLog (§8 История); (2) hech kimga yetmasa noWorkers signali
// qaytadi; (3) redispatchPendingPhotoRequests — /fotozapros render'ida ishga
// tushadigan yengil «lazy sweep» (expireOverdueReservations uslubi) yetib
// bormaganlarni chegaralangan (max 3) qayta uradi — so'rov yo'qolmaydi.

import type { Prisma } from "@prisma/client";
import type { SendMessageOptions, SendResult } from "@/lib/telegram";

// ───────────────────────── Xato ─────────────────────────

export type PhotoRequestErrorCode = "NOT_FOUND" | "VALIDATION";

/** Foydalanuvchiga ko'rsatsa bo'ladigan (ruscha) xabarli tipli xato. */
export class PhotoRequestError extends Error {
  constructor(
    public readonly code: PhotoRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PhotoRequestError";
  }
}

// ───────────────────────── Sozlamalar (BUG-04 retry) ─────────────────────────

/** Qayta urinishlar chegarasi (bir skladchi × bir so'rov). «Vechniy retry»ga qarshi. */
export const MAX_DISPATCH_ATTEMPTS = 3;
/** Faqat yaqin (24 soat) PENDING so'rovlar qayta uriladi — eski navbat qazilmaydi. */
export const REDISPATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Bitta lazy-sweep'da ko'pi bilan shuncha PENDING so'rov qayta uriladi. Sweep
 * /fotozapros render'ida ketma-ket ishlaydi (paint'dan oldin) — noto'g'ri
 * sozlangan bot / ommaviy uzilishda `take` bo'lmasa har menejer uchun sahifa
 * N×M Telegram round-trip'ga cho'ziladi. Chegara buni to'xtatadi (cron/navbatga
 * o'tmasdan, TZ §9 — sodda saqlaymiz).
 */
export const REDISPATCH_BATCH_LIMIT = 50;

// ───────────────────────── Deps (inyeksiya) ─────────────────────────
// db'dan bizga kerak amallar. Prisma'ning to'liq tipini talab qilmaymiz —
// testlar oson mock qilishi uchun minimal shakl.

export interface PhotoRequestBatchLocation {
  id: string;
  block: string;
  landmark: string;
}

export interface PhotoRequestBatch {
  id: string;
  stoneType: { name: string } | null;
  locations: PhotoRequestBatchLocation[];
}

export interface PhotoRequestRecord {
  id: string;
  managerId: string;
  batchId: string;
  batchLocationId: string | null;
  assigneeId: string | null;
  status: string;
  comment: string | null;
}

export interface PhotoRequestWorker {
  id: string;
  telegramId: string | null;
}

/** Bitta so'rov uchun mavjud yetkazilish yozuvi (redispatch qaror uchun). */
export interface PhotoDispatchRow {
  chatId: string;
  status: "SENT" | "FAILED";
  attempts: number;
}

/** Qayta yuborish uchun PENDING so'rov (batch + tanlangan lokatsiya + yozuvlar). */
export interface PendingPhotoRequestRow {
  id: string;
  comment: string | null;
  batch: {
    stoneType: { name: string } | null;
    locations: PhotoRequestBatchLocation[];
  };
  batchLocation: { block: string; landmark: string } | null;
  dispatches: PhotoDispatchRow[];
  // §6.1 — zapros endi birinchi fotoda YOPILMAYDI (N plita to'plash uchun PENDING
  // qoladi), shuning uchun «javob berilgan»likni foto bor-yo'qligi bilan aniqlaymiz:
  // kamida bitta foto tushgan bo'lsa — skladchi(lar) vazifani oldi, qayta nag YO'Q.
  photos: Array<{ id: string }>;
}

/** PhotoDispatch upsert argumenti (Prisma @@unique([photoRequestId, chatId])). */
interface PhotoDispatchUpsertArgs {
  where: { photoRequestId_chatId: { photoRequestId: string; chatId: string } };
  create: {
    photoRequestId: string;
    chatId: string;
    status: "SENT" | "FAILED";
    attempts: number;
    lastError: string | null;
    deliveredAt: Date | null;
    messageId: number | null;
  };
  update: {
    status: "SENT" | "FAILED";
    attempts: { increment: number };
    lastError: string | null;
    deliveredAt: Date | null;
    messageId: number | null;
  };
}

/** AuditLog create argumenti (§8 История — har urinish loglanadi). */
// payload — Prisma.InputJsonValue: real PrismaClient shu tipni kutadi, shuning
// uchun `Record<string, unknown>` emas (aks holda db deps'ga mos kelmaydi).
interface AuditLogCreateArgs {
  data: {
    userId: string | null;
    action: "PHOTO_REQUEST";
    entityType: string;
    entityId: string;
    payload: Prisma.InputJsonValue;
  };
}

export interface PhotoRequestDeps {
  db: {
    batch: {
      findUnique(args: {
        where: { id: string };
        include: { stoneType: true; locations: true };
      }): Promise<PhotoRequestBatch | null>;
    };
    photoRequest: {
      create(args: {
        data: {
          managerId: string;
          batchId: string;
          batchLocationId: string | null;
          batchPatternId: string | null;
          assigneeId: null;
          status: "PENDING";
          comment: string | null;
        };
      }): Promise<PhotoRequestRecord>;
      // BUG-04 redispatch: yaqin PENDING so'rovlar + yetkazilish yozuvlari.
      findMany(args: {
        where: {
          status: "PENDING";
          createdAt: { gte: Date };
        };
        include: {
          batch: { include: { stoneType: true; locations: true } };
          batchLocation: true;
          dispatches: true;
          photos: { select: { id: true }; take: 1 };
        };
        take: number;
      }): Promise<PendingPhotoRequestRow[]>;
    };
    user: {
      findMany(args: {
        where: {
          role: "WAREHOUSE";
          isActive: true;
          telegramId: { not: null };
        };
        select: { id: true; telegramId: true };
      }): Promise<PhotoRequestWorker[]>;
    };
    photoDispatch: {
      upsert(args: PhotoDispatchUpsertArgs): Promise<unknown>;
    };
    auditLog: {
      create(args: AuditLogCreateArgs): Promise<unknown>;
    };
  };
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<SendResult>;
}

export interface CreatePhotoRequestInput {
  managerId: string;
  batchId: string;
  batchLocationId?: string | null;
  /** ТЗ №3 — фото узор-подгруппы (вместо/в дополнение к локации). */
  batchPatternId?: string | null;
  comment?: string | null;
}

export interface CreatePhotoRequestResult {
  request: PhotoRequestRecord;
  /** Muvaffaqiyatli yetkazilgan skladchilar soni (haqiqiy — SENT'lar). */
  dispatchedTo: number;
  /** true = telegramId'li faol skladchi umuman yo'q (BUG-04 asosiy sabab). */
  noWorkers: boolean;
}

// ───────────────────────── Vazifa matni (ru) ─────────────────────────

/**
 * Skladchiga boradigan vazifa matni. location null bo'lsa — «локация не указана».
 * Alohida export — unit-testlanadi.
 */
export function buildTaskText(
  stoneTypeName: string,
  location: { block: string; landmark: string } | null,
  comment: string | null,
): string {
  const where = location
    ? `Блок ${location.block}, ориентир ${location.landmark}.`
    : "Локация не указана.";
  const lines = [
    `📷 Задача: сфотографируйте камень ${stoneTypeName}. ${where}`,
  ];
  const c = comment?.trim();
  if (c) lines.push(`Комментарий: ${c}`);
  // §5.3 — skladchi qaysi toshni suratga olganini adashtirmasligi uchun: aynan
  // SHU xabarga reply qilib yuborishni so'raymiz (bir nechta ochiq vazifa bo'lsa
  // ham foto to'g'ri fotozaprosga bog'lanadi).
  lines.push("Отправьте фото ответом (reply) на это сообщение.");
  return lines.join("\n");
}

// ───────────────────── Yetkazilishni yozish (SENT/FAILED + audit) ─────────────────────

/**
 * Bitta skladchiga yuboradi va natijani yozadi: PhotoDispatch upsert (SENT/FAILED,
 * attempts++, lastError, deliveredAt) + AuditLog PHOTO_REQUEST (§8 История).
 * Yozuv sendMessage muvaffaqiyatiga bog'liq emas — u ham fatal emas: yozib
 * bo'lmasa ham qolgan skladchilarni to'xtatmaymiz.
 * @returns yetkazildi (true = SENT).
 */
async function dispatchAndRecord(
  deps: PhotoRequestDeps,
  photoRequestId: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  const { db, sendMessage } = deps;
  const res = await sendMessage(chatId, text);
  const now = new Date();
  // §5.3 — SENT bo'lsa Telegram qaytargan message_id'ni saqlaymiz (reply-to
  // bog'lash uchun). FAILED'da xabar yo'q → null. Qayta yuborishda (update) yangi
  // xabar yangi message_id oladi — skladchi eng oxirgi xabarga reply qiladi.
  const messageId = res.ok ? res.messageId : null;

  await db.photoDispatch.upsert({
    where: { photoRequestId_chatId: { photoRequestId, chatId } },
    create: {
      photoRequestId,
      chatId,
      status: res.ok ? "SENT" : "FAILED",
      attempts: 1,
      lastError: res.ok ? null : res.error,
      deliveredAt: res.ok ? now : null,
      messageId,
    },
    update: {
      status: res.ok ? "SENT" : "FAILED",
      attempts: { increment: 1 },
      lastError: res.ok ? null : res.error,
      deliveredAt: res.ok ? now : null,
      messageId,
    },
  });

  await db.auditLog.create({
    data: {
      userId: null, // avtomatik yetkazilish — bajaruvchi yo'q (§1.10 uslubi)
      action: "PHOTO_REQUEST",
      entityType: "PhotoRequest",
      entityId: photoRequestId,
      payload: {
        event: "dispatch",
        chatId,
        delivered: res.ok,
        error: res.ok ? null : res.error,
      },
    },
  });

  return res.ok;
}

// ───────────────────────── Asosiy amal ─────────────────────────

/**
 * Fotozapros yaratadi va uni hamma faol skladchiga (Telegram) yuboradi.
 * Bitta send xato bersa — qolganlarini TO'XTATMAYDI (har-send alohida yoziladi).
 * BUG-04: dispatchedTo endi HAQIQIY SENT soni; hech kimga yetmasa noWorkers.
 */
export async function createAndDispatchPhotoRequest(
  input: CreatePhotoRequestInput,
  deps: PhotoRequestDeps,
): Promise<CreatePhotoRequestResult> {
  const { db } = deps;

  const batchId = input.batchId?.trim();
  if (!batchId) {
    throw new PhotoRequestError("VALIDATION", "Не указана партия");
  }

  // (1) partiyani stoneType + lokatsiyalari bilan yuklaymiz.
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: { stoneType: true, locations: true },
  });
  if (!batch) {
    throw new PhotoRequestError("NOT_FOUND", "Партия не найдена");
  }

  const requestedLocationId = input.batchLocationId?.trim() || null;
  const comment = input.comment?.trim() || null;

  // Tanlangan lokatsiya SHU partiyaga tegishli bo'lishi shart. Berilgan, ammo
  // topilmasa (boshqa partiyaniki yoki mavjud emas) — VALIDATION xato, 500 emas.
  const chosen = requestedLocationId
    ? (batch.locations.find((l) => l.id === requestedLocationId) ?? null)
    : null;
  if (requestedLocationId && !chosen) {
    throw new PhotoRequestError("VALIDATION", "Локация не относится к этой партии");
  }

  // (2) fotozaprosni yaratamiz (umumiy navbat: assigneeId = null).
  // Faqat tasdiqlangan lokatsiya id'si yoziladi (chosen?.id), xom input emas.
  const request = await db.photoRequest.create({
    data: {
      managerId: input.managerId,
      batchId: batch.id,
      batchLocationId: chosen?.id ?? null,
      batchPatternId: input.batchPatternId?.trim() || null,
      assigneeId: null,
      status: "PENDING",
      comment,
    },
  });

  // (3) faol skladchilar — telegramId bilan bog'langanlari.
  const workers = await db.user.findMany({
    where: { role: "WAREHOUSE", isActive: true, telegramId: { not: null } },
    select: { id: true, telegramId: true },
  });

  // BUG-04 asosiy sabab: telegramId'li skladchi yo'q → yuboradigan hech kim yo'q.
  // JIM 0 emas — bu holni ochiq belgilaymiz va §8 История'ga yozamiz.
  if (workers.length === 0) {
    await db.auditLog.create({
      data: {
        userId: input.managerId,
        action: "PHOTO_REQUEST",
        entityType: "PhotoRequest",
        entityId: request.id,
        payload: {
          event: "dispatch",
          noWorkers: true,
          delivered: 0,
          note: "Нет складчиков с привязанным Telegram — запрос не доставлен",
        },
      },
    });
    return { request, dispatchedTo: 0, noWorkers: true };
  }

  // (4) vazifa matni. Lokatsiya berilmagan bo'lsa — partiyaning yagona bloki
  // (bittadan ortiq bo'lsa — «локация не указана»).
  const stoneName = batch.stoneType?.name ?? "камень";
  const locForText =
    chosen ?? (batch.locations.length === 1 ? batch.locations[0] : null);
  const text = buildTaskText(stoneName, locForText, comment);

  // (5) har bir skladchiga yuboramiz — natija SENT/FAILED bo'lib yoziladi.
  // Ketma-ket (Promise.allSettled emas): DB yozuvlari tartibli, so'rov soni oz.
  let dispatchedTo = 0;
  for (const w of workers) {
    const ok = await dispatchAndRecord(
      deps,
      request.id,
      w.telegramId as string,
      text,
    );
    if (ok) dispatchedTo += 1;
  }

  return { request, dispatchedTo, noWorkers: false };
}

// ───────────────────────── Lazy re-dispatch (BUG-04, §8 resilience) ─────────────────────────

export interface RedispatchResult {
  /** Nechta (so'rov × skladchi) urinish qilindi. */
  retried: number;
  /** Shundan nechtasi bu safar yetkazildi (SENT). */
  delivered: number;
}

/**
 * Yaqin (REDISPATCH_WINDOW_MS) PENDING fotozaproslardan yetib bormaganlarini
 * qayta uradi. /fotozapros render'ida chaqiriladi (expireOverdueReservations
 * uslubidagi «lazy sweep» — cron YO'Q). Ikki holni tutadi:
 *   • skladchiga umuman yozuv yo'q (masalan, u so'rovdan KEYIN ro'yxatdan o'tgan
 *     — BUG-04 asl stsenariysi) → birinchi marta yuboriladi;
 *   • yozuv FAILED va attempts < MAX_DISPATCH_ATTEMPTS (o'tkinchi xato) → yana.
 * SENT bo'lganlar va urinishlari tugaganlar tegilmaydi.
 */
export async function redispatchPendingPhotoRequests(
  deps: PhotoRequestDeps,
): Promise<RedispatchResult> {
  const { db } = deps;
  const since = new Date(Date.now() - REDISPATCH_WINDOW_MS);

  const pending = await db.photoRequest.findMany({
    where: { status: "PENDING", createdAt: { gte: since } },
    include: {
      batch: { include: { stoneType: true, locations: true } },
      batchLocation: true,
      dispatches: true,
      // §6.1 — javob berilganini aniqlash uchun (bitta foto yetarli).
      photos: { select: { id: true }, take: 1 },
    },
    take: REDISPATCH_BATCH_LIMIT,
  });
  if (pending.length === 0) return { retried: 0, delivered: 0 };

  const workers = await db.user.findMany({
    where: { role: "WAREHOUSE", isActive: true, telegramId: { not: null } },
    select: { id: true, telegramId: true },
  });
  if (workers.length === 0) return { retried: 0, delivered: 0 };

  let retried = 0;
  let delivered = 0;

  for (const req of pending) {
    // §6.1 — zapros endi birinchi fotoda DONE bo'lmaydi (PENDING qolib N plita
    // to'playdi). Foto tushgan bo'lsa — skladchi vazifani oldi va bajarmoqda:
    // uni qayta nag QILMAYMIZ (aks holda javob berilgan so'rov cheksiz uriladi).
    if (req.photos.length > 0) continue;

    const stoneName = req.batch.stoneType?.name ?? "камень";
    const locForText =
      req.batchLocation ??
      (req.batch.locations.length === 1 ? req.batch.locations[0] : null);
    const text = buildTaskText(stoneName, locForText, req.comment);

    for (const w of workers) {
      const chatId = w.telegramId as string;
      const existing = req.dispatches.find((d) => d.chatId === chatId);
      // Yetkazilgan — tegmaymiz. Urinishlar tugagan — voz kechamiz (max chegara).
      if (existing?.status === "SENT") continue;
      if (existing && existing.attempts >= MAX_DISPATCH_ATTEMPTS) continue;

      retried += 1;
      const ok = await dispatchAndRecord(deps, req.id, chatId, text);
      if (ok) delivered += 1;
    }
  }

  return { retried, delivered };
}
