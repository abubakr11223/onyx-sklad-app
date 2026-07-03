// S2-A — Бронь (reservations): TZ §4.4, §6.6, §7.5; data-model.md §1.6, §2, §3.
// Bu modul server action'lardan HAM kelajakdagi Telegram botdan HAM chaqiriladi —
// UI ga bog'liq narsa yo'q. Sof hisob-helperlar (DB-siz) alohida export qilinadi
// va unit-testlanadi; DB-amallar Prisma $transaction ichida:
//  • statusga o'tish — SHARTLI UPDATE (`updateMany WHERE status=…`, §2 oxiri),
//    0 qator = birlik allaqachon boshqa holatda → do'stona xato;
//  • DB partial unique (Reservation_slabId/pieceId_active_key) — poyga zaxirasi,
//    P2002 o'sha do'stona xatoga mapping qilinadi (TZ §7.5);
//  • AuditLog asosiy amal bilan BITTA tranzaksiyada (§1.10).

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeFreeRemainder } from "@/lib/inventory";
import { lockBatchForUpdate } from "@/lib/batch-lock";

// ─────────────────────────── Konstantalar / xatolar ───────────────────────────

/** ADR-003: default 3 kun; haqiqiy qiymat AppConfig.reservationDays da. */
export const DEFAULT_RESERVATION_DAYS = 3;
export const RESERVATION_DAYS_KEY = "reservationDays";
/** Sog'lom yuqori chegara — «vechniy rezerv»ga qarshi (TZ §4.4). */
export const MAX_RESERVATION_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReservationErrorCode =
  | "VALIDATION" // kiritilgan ma'lumot noto'g'ri
  | "NOT_FOUND" // bron/partiya topilmadi
  | "UNIT_UNAVAILABLE" // birlik AVAILABLE emas yoki needsCheck (§2 taqiqlar)
  | "VOLUME_EXCEEDED" // BATCH_VOLUME invarianti (§1.6/§3)
  | "FORBIDDEN" // faqat bron egasi yoki OWNER (§2 o'tish №5)
  | "NOT_ACTIVE" // bron allaqachon ACTIVE emas
  | "CONFLICT"; // parallel tranzaksiya to'qnashuvi — qayta urinish kerak

/** Foydalanuvchiga ko'rsatsa bo'ladigan (ruscha) xabarli tipli xato. */
export class ReservationError extends Error {
  constructor(
    public readonly code: ReservationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReservationError";
  }
}

const MSG_UNIT_UNAVAILABLE =
  "Камень недоступен: уже забронирован, продан или помечен «проверить»";

// ──────────────────── Sof helperlar (DB YO'Q — unit-test) ────────────────────

/** AppConfig.reservationDays qiymatini parse qiladi; buzuq/yo'q → default 3. */
export function parseReservationDaysConfig(
  value: string | null | undefined,
): number {
  if (value == null) return DEFAULT_RESERVATION_DAYS;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_RESERVATION_DAYS
    ? n
    : DEFAULT_RESERVATION_DAYS;
}

/**
 * Amaldagi bron muddati (kun): foydalanuvchi kiritgani ?? config ?? 3.
 * Foydalanuvchi qiymati chegaradan tashqarida bo'lsa — VALIDATION xato
 * (jim «to'g'irlab» yubormaymiz — menejer nima kiritganini bilishi kerak).
 */
export function resolveReservationDays(
  daysInput: number | null | undefined,
  configValue: string | null | undefined,
): number {
  if (daysInput == null) return parseReservationDaysConfig(configValue);
  if (
    !Number.isInteger(daysInput) ||
    daysInput < 1 ||
    daysInput > MAX_RESERVATION_DAYS
  ) {
    throw new ReservationError(
      "VALIDATION",
      `Срок брони — целое число от 1 до ${MAX_RESERVATION_DAYS} дней`,
    );
  }
  return daysInput;
}

/** expiresAt = now + days (ADR-003). */
export function computeExpiresAt(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Partiya bo'yicha «hajm broni mumkinmi» qarori uchun oddiy kirish. */
export interface VolumeAvailability {
  /** computeFreeRemainder natijasi; null = shu o'lchov nazorati o'chgan (§3). */
  slabsFree: number | null;
  areaFreeM2: number | null;
  /** Faol BATCH_VOLUME bronlarning yig'indisi (shu partiya bo'yicha). */
  reservedSlabs: number;
  reservedAreaM2: number;
}

export type VolumeReserveDecision =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * §1.6 invarianti: faol volume-bronlar yig'indisi ≤ erkin qoldiq.
 * So'ralgan miqdor (istalgan o'lchovda) «erkin − band» dan oshsa — rad.
 * slabsFree/areaFreeM2 = null → o'sha o'lchov nazorati o'chgan (§3) —
 * tekshirilmaydi, lekin kamida bitta miqdor ko'rsatilishi shart (DB CHECK).
 */
export function canReserveVolume(
  avail: VolumeAvailability,
  qtySlabs: number | null,
  qtyAreaM2: number | null,
): VolumeReserveDecision {
  if (qtySlabs == null && qtyAreaM2 == null) {
    return { ok: false, reason: "Укажите количество: плиты и/или м²" };
  }
  if (qtySlabs != null && (!Number.isInteger(qtySlabs) || qtySlabs < 1)) {
    return { ok: false, reason: "Число плит — целое число от 1" };
  }
  if (qtyAreaM2 != null && (!Number.isFinite(qtyAreaM2) || qtyAreaM2 <= 0)) {
    return { ok: false, reason: "Площадь — число больше нуля" };
  }
  if (qtySlabs != null && avail.slabsFree != null) {
    const freeLeft = avail.slabsFree - avail.reservedSlabs;
    if (qtySlabs > freeLeft) {
      return {
        ok: false,
        reason: `Недостаточно свободных плит: доступно ${Math.max(freeLeft, 0)}, запрошено ${qtySlabs}`,
      };
    }
  }
  if (qtyAreaM2 != null && avail.areaFreeM2 != null) {
    const freeLeft = avail.areaFreeM2 - avail.reservedAreaM2;
    if (qtyAreaM2 > freeLeft) {
      return {
        ok: false,
        reason: `Недостаточно свободной площади: доступно ${Math.max(freeLeft, 0).toFixed(1)} м², запрошено ${qtyAreaM2} м²`,
      };
    }
  }
  return { ok: true };
}

/**
 * §2 o'tish №4/№5: bron ustida amal — faqat bron egasi (managerId) yoki OWNER.
 * STUB eslatmasi: to'liq rol-tekshiruv auth sprintida keladi; hozir shu qoida
 * server action'dagi stub-foydalanuvchi bilan ishlaydi.
 */
export function canManageReservation(
  actor: { id: string; role: string },
  reservation: { managerId: string },
): boolean {
  return actor.role === "OWNER" || actor.id === reservation.managerId;
}

// ─────────────────────────────── DB amallar ───────────────────────────────

export interface ReserveUnitInput {
  targetType: "SLAB" | "PIECE";
  unitId: string;
  customerName: string;
  customerContact?: string | null;
  /** null/undefined → AppConfig.reservationDays (default 3). */
  days?: number | null;
  managerId: string;
}

export interface ReserveResult {
  reservationId: string;
  expiresAt: Date;
}

function requireCustomerName(customerName: string): string {
  const name = customerName.trim();
  if (!name) {
    throw new ReservationError(
      "VALIDATION",
      "Укажите клиента — анонимных броней не бывает",
    );
  }
  return name;
}

/**
 * Konkret plita/qoldiqni bron qilish (§2 o'tish №1, TZ §6.6).
 * BITTA tranzaksiya: shartli status-flip → Reservation ACTIVE → AuditLog.
 */
export async function reserveUnit(
  input: ReserveUnitInput,
): Promise<ReserveResult> {
  const customerName = requireCustomerName(input.customerName);
  try {
    return await db.$transaction(async (tx) => {
      const cfg = await tx.appConfig.findUnique({
        where: { key: RESERVATION_DAYS_KEY },
        select: { value: true },
      });
      const days = resolveReservationDays(input.days ?? null, cfg?.value);
      const expiresAt = computeExpiresAt(new Date(), days);

      // Shartli o'tish AVAILABLE → RESERVED (needsCheck=true blokda, §2 taqiq).
      const where = {
        id: input.unitId,
        status: "AVAILABLE" as const,
        needsCheck: false,
      };
      const flipped =
        input.targetType === "SLAB"
          ? await tx.slab.updateMany({ where, data: { status: "RESERVED" } })
          : await tx.piece.updateMany({ where, data: { status: "RESERVED" } });
      if (flipped.count === 0) {
        throw new ReservationError("UNIT_UNAVAILABLE", MSG_UNIT_UNAVAILABLE);
      }

      const reservation = await tx.reservation.create({
        data: {
          targetType: input.targetType,
          slabId: input.targetType === "SLAB" ? input.unitId : null,
          pieceId: input.targetType === "PIECE" ? input.unitId : null,
          managerId: input.managerId,
          customerName,
          customerContact: input.customerContact?.trim() || null,
          expiresAt,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: input.managerId,
          action: "RESERVE",
          entityType: input.targetType === "SLAB" ? "Slab" : "Piece",
          entityId: input.unitId,
          payload: {
            reservationId: reservation.id,
            targetType: input.targetType,
            customerName,
            customerContact: input.customerContact?.trim() || null,
            days,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      return { reservationId: reservation.id, expiresAt };
    });
  } catch (e) {
    // Poyga zaxirasi: partial unique (bitta birlikka bitta faol bron, TZ §7.5).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ReservationError("UNIT_UNAVAILABLE", MSG_UNIT_UNAVAILABLE);
    }
    throw e;
  }
}

export interface ReserveBatchVolumeInput {
  batchId: string;
  qtySlabs?: number | null;
  qtyAreaM2?: number | null;
  customerName: string;
  customerContact?: string | null;
  days?: number | null;
  managerId: string;
}

/** Prisma Decimal | null → number | null. */
function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

/**
 * B2B hajm broni (ADR-006 BATCH_VOLUME): partiya + ajratilganlar + faol
 * volume-bronlar bitta tranzaksiyada o'qiladi, erkin qoldiq HISOBLANADI
 * (ADR-005, inventory.computeFreeRemainder) va invariant tekshiriladi.
 * Volume uchun partial-unique zaxira yo'q — Serializable izolyatsiya
 * parallel ikki bron oversell qilmasligini kafolatlaydi.
 */
export async function reserveBatchVolume(
  input: ReserveBatchVolumeInput,
): Promise<ReserveResult> {
  const customerName = requireCustomerName(input.customerName);
  const qtySlabs = input.qtySlabs ?? null;
  const qtyAreaM2 = input.qtyAreaM2 ?? null;
  try {
    return await db.$transaction(
      async (tx) => {
        // S2-conc: замок на строку партии ПЕРВЫМ — сериализует объёмную бронь
        // с продажей/выделением/прямым боем, чтобы Σ активных volume-броней не
        // могла превысить свободный остаток из-за параллельного изменения
        // ДРУГОГО входа формулы §3. (Serializable оставлен как есть — замок и
        // изоляция дополняют друг друга; замок закрывает межоперационную гонку.)
        await lockBatchForUpdate(tx, input.batchId);
        const cfg = await tx.appConfig.findUnique({
          where: { key: RESERVATION_DAYS_KEY },
          select: { value: true },
        });
        const days = resolveReservationDays(input.days ?? null, cfg?.value);
        const expiresAt = computeExpiresAt(new Date(), days);

        const batch = await tx.batch.findUnique({
          where: { id: input.batchId },
          include: {
            slabs: { select: { areaM2: true } },
            // §3: faqat to'g'ridan-to'g'ri boy (originSlabId IS NULL) formulada.
            pieces: {
              where: { originSlabId: null },
              select: { areaM2: true },
            },
            reservations: {
              where: { status: "ACTIVE", targetType: "BATCH_VOLUME" },
              select: { qtySlabs: true, qtyAreaM2: true },
            },
          },
        });
        if (!batch) {
          throw new ReservationError("NOT_FOUND", "Партия не найдена");
        }
        if (batch.needsCheck) {
          throw new ReservationError(
            "UNIT_UNAVAILABLE",
            "Партия помечена «проверить» — бронь запрещена до выяснения (TZ §7.4)",
          );
        }

        const free = computeFreeRemainder(
          {
            slabsTotal: batch.slabsTotal,
            areaTotalM2: toNum(batch.areaTotalM2),
            slabsAdjusted: batch.slabsAdjusted,
            areaAdjustedM2: Number(batch.areaAdjustedM2),
            slabsSoldDirect: batch.slabsSoldDirect,
            areaSoldDirectM2: Number(batch.areaSoldDirectM2),
          },
          batch.slabs.map((s) => ({ areaM2: toNum(s.areaM2) })),
          batch.pieces.map((p) => ({ areaM2: toNum(p.areaM2) })),
        );
        const reservedSlabs = batch.reservations.reduce(
          (n, r) => n + (r.qtySlabs ?? 0),
          0,
        );
        const reservedAreaM2 = batch.reservations.reduce(
          (n, r) => n + (toNum(r.qtyAreaM2) ?? 0),
          0,
        );

        const decision = canReserveVolume(
          {
            slabsFree: free.slabsFree,
            areaFreeM2: free.areaFreeM2,
            reservedSlabs,
            reservedAreaM2,
          },
          qtySlabs,
          qtyAreaM2,
        );
        if (!decision.ok) {
          throw new ReservationError("VOLUME_EXCEEDED", decision.reason);
        }

        const reservation = await tx.reservation.create({
          data: {
            targetType: "BATCH_VOLUME",
            batchId: batch.id,
            qtySlabs,
            qtyAreaM2: qtyAreaM2 === null ? null : String(qtyAreaM2),
            managerId: input.managerId,
            customerName,
            customerContact: input.customerContact?.trim() || null,
            expiresAt,
            status: "ACTIVE",
          },
          select: { id: true },
        });

        await tx.auditLog.create({
          data: {
            userId: input.managerId,
            action: "RESERVE",
            entityType: "Batch",
            entityId: batch.id,
            payload: {
              reservationId: reservation.id,
              targetType: "BATCH_VOLUME",
              qtySlabs,
              qtyAreaM2,
              customerName,
              customerContact: input.customerContact?.trim() || null,
              days,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });

        return { reservationId: reservation.id, expiresAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      throw new ReservationError(
        "CONFLICT",
        "Не удалось сохранить из-за параллельной операции — попробуйте ещё раз",
      );
    }
    throw e;
  }
}

/**
 * Bronni qo'lda bekor qilish (§2 o'tish №5): faqat bron egasi yoki OWNER.
 * BITTA tranzaksiya: bron ACTIVE→CANCELLED + resolvedAt, birlik shartli
 * RESERVED→AVAILABLE, AuditLog(RESERVE_CANCEL). BATCH_VOLUME hech qanday
 * birlik statusiga tegmaydi.
 */
export async function cancelReservation(
  id: string,
  byUserId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        targetType: true,
        slabId: true,
        pieceId: true,
        batchId: true,
        managerId: true,
        customerName: true,
      },
    });
    if (!reservation) {
      throw new ReservationError("NOT_FOUND", "Бронь не найдена");
    }

    // STUB (auth — keyingi sprint): amaldagi foydalanuvchi id bo'yicha olinadi,
    // qoidaning o'zi (egasi yoki OWNER) allaqachon amalda.
    const actor = await tx.user.findUnique({
      where: { id: byUserId },
      select: { id: true, role: true, isActive: true },
    });
    if (!actor || !actor.isActive) {
      throw new ReservationError("FORBIDDEN", "Пользователь не найден");
    }
    if (!canManageReservation(actor, reservation)) {
      throw new ReservationError(
        "FORBIDDEN",
        "Снять бронь может только её менеджер или владелец",
      );
    }

    const resolved = await tx.reservation.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
    if (resolved.count === 0) {
      throw new ReservationError(
        "NOT_ACTIVE",
        "Бронь уже не активна — обновите страницу",
      );
    }

    // Birlikni qaytarish — shartli (§2 oxiri). BATCH_VOLUME: birlik yo'q.
    let unitReverted: boolean | null = null;
    const revertWhere = { status: "RESERVED" as const };
    if (reservation.targetType === "SLAB" && reservation.slabId) {
      const r = await tx.slab.updateMany({
        where: { id: reservation.slabId, ...revertWhere },
        data: { status: "AVAILABLE" },
      });
      unitReverted = r.count === 1;
    } else if (reservation.targetType === "PIECE" && reservation.pieceId) {
      const r = await tx.piece.updateMany({
        where: { id: reservation.pieceId, ...revertWhere },
        data: { status: "AVAILABLE" },
      });
      unitReverted = r.count === 1;
    }

    await tx.auditLog.create({
      data: {
        userId: byUserId,
        action: "RESERVE_CANCEL",
        entityType:
          reservation.targetType === "SLAB"
            ? "Slab"
            : reservation.targetType === "PIECE"
              ? "Piece"
              : "Batch",
        entityId:
          reservation.slabId ?? reservation.pieceId ?? reservation.batchId ?? "",
        payload: {
          reservationId: reservation.id,
          targetType: reservation.targetType,
          customerName: reservation.customerName,
          unitReverted,
        },
      },
    });
  });
}

/**
 * Muddati o'tgan bronlarni yopish (ADR-003, §1.6 «lazy tekshiruv»).
 * /bron sahifasi render boshida chaqiriladi (kelajakda cron ham shu funksiyani
 * ishlatadi). Har bron ALOHIDA tranzaksiyada — bitta buzuq yozuv qolganlarini
 * to'xtatmaydi; shartli UPDATE parallel ishga tushgan ikkinchi sweep bilan
 * to'qnashmaydi. AuditLog.userId = null — tizim amali (§1.10).
 * @returns nechta bron EXPIRED qilindi.
 */
export async function expireOverdueReservations(): Promise<number> {
  const overdue = await db.reservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    select: {
      id: true,
      targetType: true,
      slabId: true,
      pieceId: true,
      batchId: true,
      customerName: true,
      expiresAt: true,
    },
  });

  let expired = 0;
  for (const r of overdue) {
    const done = await db.$transaction(async (tx) => {
      const resolved = await tx.reservation.updateMany({
        where: { id: r.id, status: "ACTIVE" },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      if (resolved.count === 0) return false; // parallel sweep yopib bo'lgan

      let unitReverted: boolean | null = null;
      if (r.targetType === "SLAB" && r.slabId) {
        const u = await tx.slab.updateMany({
          where: { id: r.slabId, status: "RESERVED" },
          data: { status: "AVAILABLE" },
        });
        unitReverted = u.count === 1;
      } else if (r.targetType === "PIECE" && r.pieceId) {
        const u = await tx.piece.updateMany({
          where: { id: r.pieceId, status: "RESERVED" },
          data: { status: "AVAILABLE" },
        });
        unitReverted = u.count === 1;
      }

      await tx.auditLog.create({
        data: {
          userId: null, // avtomatik amal — bajaruvchi yo'q (§1.10)
          action: "RESERVE_EXPIRE",
          entityType:
            r.targetType === "SLAB"
              ? "Slab"
              : r.targetType === "PIECE"
                ? "Piece"
                : "Batch",
          entityId: r.slabId ?? r.pieceId ?? r.batchId ?? "",
          payload: {
            reservationId: r.id,
            targetType: r.targetType,
            customerName: r.customerName,
            expiresAt: r.expiresAt.toISOString(),
            unitReverted,
          },
        },
      });
      return true;
    });
    if (done) expired += 1;
  }
  return expired;
}
