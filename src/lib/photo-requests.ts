// TG-B1 — fotozapros yaratish + Telegram dispatch (TZ §5.3, §1.8).
// SOF va testlanadigan: db va sendMessage inyeksiya qilinadi (deps) — bu yerda
// import QILINMAYDI. server action real bog'lamalarni uzatadi, testlar mock uzatadi.
//
// Doira (TG-B1): menejer qidiruv sahifasida fotozapros yaratadi → hamma faol
// skladchi (WAREHOUSE, telegramId bor) Telegram vazifasini oladi. Umumiy navbat
// modeli: assigneeId = null. Fotoni QABUL QILISH (Blob/Photo/DONE) — TG-B2.

import type { SendMessageOptions } from "@/lib/telegram";

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

// ───────────────────────── Deps (inyeksiya) ─────────────────────────
// db'dan bizga faqat 3 amal kerak. Prisma'ning to'liq tipini talab qilmaymiz —
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
          assigneeId: null;
          status: "PENDING";
          comment: string | null;
        };
      }): Promise<PhotoRequestRecord>;
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
  };
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void>;
}

export interface CreatePhotoRequestInput {
  managerId: string;
  batchId: string;
  batchLocationId?: string | null;
  comment?: string | null;
}

export interface CreatePhotoRequestResult {
  request: PhotoRequestRecord;
  dispatchedTo: number;
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
    ? `Blok ${location.block}, orientir ${location.landmark}.`
    : "Lokatsiya ko'rsatilmagan.";
  const lines = [
    `📷 Vazifa: ${stoneTypeName} toshini suratga oling. ${where}`,
  ];
  const c = comment?.trim();
  if (c) lines.push(`Izoh: ${c}`);
  lines.push("Rasmni shu yerga javob qilib yuboring.");
  return lines.join("\n");
}

// ───────────────────────── Asosiy amal ─────────────────────────

/**
 * Fotozapros yaratadi va uni hamma faol skladchiga (Telegram) yuboradi.
 * Bitta send xato bersa — qolganlarini TO'XTATMAYDI (har-send catch).
 */
export async function createAndDispatchPhotoRequest(
  input: CreatePhotoRequestInput,
  deps: PhotoRequestDeps,
): Promise<CreatePhotoRequestResult> {
  const { db, sendMessage } = deps;

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

  // (4) vazifa matni. Lokatsiya berilmagan bo'lsa — partiyaning bloklarini
  // ko'rsatamiz (bittadan ortiq bo'lsa), aks holda «локация не указана».
  const stoneName = batch.stoneType?.name ?? "tosh";
  const locForText =
    chosen ??
    (batch.locations.length === 1
      ? batch.locations[0]
      : null);
  const text = buildTaskText(stoneName, locForText, comment);

  // (5) har bir skladchiga yuboramiz — bittasi yiqilsa qolganlarini to'xtatmaydi.
  // findMany filtri telegramId'ni non-null qiladi, shuning uchun to'g'ridan-to'g'ri.
  const results = await Promise.allSettled(
    workers.map((w) => sendMessage(w.telegramId as string, text)),
  );
  const dispatchedTo = results.filter((r) => r.status === "fulfilled").length;

  return { request, dispatchedTo };
}
