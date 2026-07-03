// Onyx — продажа и списание (S2-B). Нормативная база: TZ §5.4, §6.1 (шаг 8),
// §6.2, §7.1, §7.5, §7.6; docs/data-model.md §2 (переходы 2 и 4, запреты,
// условный UPDATE), §3 (свободный остаток + охранные правила); ADR-005/006.
//
// Модуль вызывается и из server actions, и из будущего Telegram-бота —
// поэтому здесь нет ничего Next-специфичного. Чистые функции решений
// (decideUnitSale, checkVolumeSaleGuard, computeWholeBatchSale) вынесены
// отдельно и тестируются без БД (src/tests/sales.test.ts).

import { db } from "./db";
import { computeFreeRemainder, type FreeRemainder } from "./inventory";
import type { Prisma } from "@prisma/client";

// ───────────────────────── Типизированные ошибки ─────────────────────────

export type SaleErrorCode =
  | "NOT_FOUND" // объект/пользователь не найден
  | "FORBIDDEN_ROLE" // продаёт не OWNER/MANAGER (матрица ролей, data-model §1.7)
  | "NEEDS_CHECK" // TZ §7.4: «проверить» блокирует продажу
  | "ALREADY_SOLD" // TZ §7.1: условный UPDATE дал 0 строк / статус SOLD
  | "RESERVED_BY_OTHER" // data-model §2, запрет: бронь другого менеджера
  | "INVALID_STATUS" // BROKEN_OFFCUT / RETURNED — продавать нельзя
  | "INVALID_INPUT" // пустой клиент, некорректные количества/цена
  | "INSUFFICIENT_REMAINDER" // §3: остатка не хватает (с учётом чужих volume-броней)
  | "CONFLICT"; // параллельное изменение — оптимистическая проверка не прошла

export interface SaleError {
  code: SaleErrorCode;
  /** Русское сообщение для UI (TZ §8: язык интерфейса — русский). */
  message: string;
}

export type SaleFail = { ok: false; error: SaleError };

/** Ошибка внутри $transaction — откатывает её и превращается в SaleFail. */
class SaleLogicError extends Error {
  constructor(public readonly saleError: SaleError) {
    super(saleError.message);
  }
}

function fail(code: SaleErrorCode, message: string): SaleFail {
  return { ok: false, error: { code, message } };
}

// ───────────────────── Чистые решения (без БД) ─────────────────────

export type ActorRole = "OWNER" | "MANAGER" | "WAREHOUSE" | "PARTNER";
export type SellableUnitStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "SOLD"
  | "BROKEN_OFFCUT"
  | "RETURNED";

export interface UnitSaleDecisionInput {
  unitStatus: SellableUnitStatus;
  needsCheck: boolean;
  /** managerId активной (ACTIVE) брони на единицу; null = активной брони нет. */
  activeReservationManagerId: string | null;
  actingManagerId: string;
  actingRole: ActorRole;
}

export type UnitSaleDecision =
  | {
      ok: true;
      /** Ожидаемый статус для условного UPDATE (data-model §2). */
      expectedStatus: "AVAILABLE" | "RESERVED";
      /** true → бронь переводится в COMPLETED той же транзакцией (переход №4). */
      viaReservation: boolean;
    }
  | SaleFail;

/** Матрица ролей (data-model §1.7): продажа — только OWNER и MANAGER. */
export function roleCanSell(role: ActorRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}

/**
 * Можно ли продать единицу (Slab/Piece) — data-model §2:
 * переход №2 (AVAILABLE → SOLD), №4 (RESERVED → SOLD только владельцем брони
 * или Owner), запреты (needsCheck, BROKEN_OFFCUT терминален, SOLD повторно,
 * RETURNED — только через проверку).
 */
export function decideUnitSale(input: UnitSaleDecisionInput): UnitSaleDecision {
  if (!roleCanSell(input.actingRole)) {
    return fail("FORBIDDEN_ROLE", "Продажа доступна только менеджеру или владельцу");
  }
  if (input.needsCheck) {
    return fail(
      "NEEDS_CHECK",
      "Камень помечен «проверить» (пересорт) — продажа заблокирована до выяснения",
    );
  }
  switch (input.unitStatus) {
    case "AVAILABLE":
      return { ok: true, expectedStatus: "AVAILABLE", viaReservation: false };
    case "RESERVED": {
      if (input.activeReservationManagerId === null) {
        // Статус RESERVED, а активной брони нет — состояние меняется параллельно
        // (снятие/истечение брони). Пусть пользователь обновит данные.
        return fail("CONFLICT", "Состояние брони изменилось — обновите страницу и повторите");
      }
      const isOwnerOverride = input.actingRole === "OWNER";
      const isReservationOwner =
        input.activeReservationManagerId === input.actingManagerId;
      if (!isOwnerOverride && !isReservationOwner) {
        return fail(
          "RESERVED_BY_OTHER",
          "Камень забронирован другим менеджером — продажа из-под чужой брони запрещена",
        );
      }
      return { ok: true, expectedStatus: "RESERVED", viaReservation: true };
    }
    case "SOLD":
      return fail("ALREADY_SOLD", "Камень уже продан");
    case "BROKEN_OFFCUT":
      return fail(
        "INVALID_STATUS",
        "Плита переведена в бой/остаток — продаются связанные куски, а не плита целиком",
      );
    case "RETURNED":
      return fail(
        "INVALID_STATUS",
        "Камень в статусе «возврат» — сначала проверка и возврат в наличие",
      );
  }
}

/** Допуск сравнения м² (Decimal → number даёт двоичную погрешность). */
const AREA_EPS = 1e-6;

export interface VolumeSaleGuardInput {
  /** Свободный остаток партии (computeFreeRemainder, data-model §3). */
  free: FreeRemainder;
  /** Σ qtySlabs активных volume-броней ДРУГИХ менеджеров (null → 0 при суммировании). */
  othersReservedSlabs: number;
  /** Σ qtyAreaM2 активных volume-броней ДРУГИХ менеджеров. */
  othersReservedAreaM2: number;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
}

/**
 * Охранная математика объёмной продажи (data-model §3):
 * остаток МИНУС чужие активные volume-брони должен покрывать продажу;
 * ничего не может увести остаток в минус. Если контроль по измерению
 * отключён (slabsTotal/areaTotalM2 = null → free = null) — по нему
 * проверки нет (§3: «дона-назорат ўчади»).
 */
export function checkVolumeSaleGuard(
  input: VolumeSaleGuardInput,
): { ok: true } | SaleFail {
  const { free, qtySlabs, qtyAreaM2 } = input;
  if (qtySlabs === null && qtyAreaM2 === null) {
    return fail("INVALID_INPUT", "Укажите объём: число плит и/или площадь (м²)");
  }
  if (qtySlabs !== null && (!Number.isSafeInteger(qtySlabs) || qtySlabs <= 0)) {
    return fail("INVALID_INPUT", "Число плит — целое положительное число");
  }
  if (qtyAreaM2 !== null && (!Number.isFinite(qtyAreaM2) || qtyAreaM2 <= 0)) {
    return fail("INVALID_INPUT", "Площадь — положительное число, например 12,5");
  }
  if (qtySlabs !== null && free.slabsFree !== null) {
    if (qtySlabs + input.othersReservedSlabs > free.slabsFree) {
      return fail(
        "INSUFFICIENT_REMAINDER",
        `В партии столько нет: свободно ${free.slabsFree} плит` +
          (input.othersReservedSlabs > 0
            ? `, из них ${input.othersReservedSlabs} под чужой бронью`
            : ""),
      );
    }
  }
  if (qtyAreaM2 !== null && free.areaFreeM2 !== null) {
    if (qtyAreaM2 + input.othersReservedAreaM2 > free.areaFreeM2 + AREA_EPS) {
      const freeTxt = free.areaFreeM2.toFixed(3).replace(/\.?0+$/, "");
      return fail(
        "INSUFFICIENT_REMAINDER",
        `В партии столько нет: свободно ≈${freeTxt} м²` +
          (input.othersReservedAreaM2 > 0
            ? `, из них ${input.othersReservedAreaM2} м² под чужой бронью`
            : ""),
      );
    }
  }
  return { ok: true };
}

/**
 * «Партию выкупили оптом целиком» (TZ §7.6): весь текущий свободный остаток
 * одним действием уходит в slabsSoldDirect/areaSoldDirectM2. Плиты НЕ создаются
 * (ADR-004). Возвращает количества для продажи; нечего продавать → ошибка.
 * Площадь округляется до 3 знаков (Decimal(12,3) в БД).
 */
export function computeWholeBatchSale(
  free: FreeRemainder,
): { ok: true; qtySlabs: number | null; qtyAreaM2: number | null } | SaleFail {
  const qtySlabs = free.slabsFree !== null && free.slabsFree > 0 ? free.slabsFree : null;
  const areaRounded =
    free.areaFreeM2 !== null ? Math.round(free.areaFreeM2 * 1000) / 1000 : null;
  const qtyAreaM2 = areaRounded !== null && areaRounded > 0 ? areaRounded : null;
  if (qtySlabs === null && qtyAreaM2 === null) {
    return fail("INSUFFICIENT_REMAINDER", "Свободного остатка в партии нет — продавать нечего");
  }
  return { ok: true, qtySlabs, qtyAreaM2 };
}

// ───────────────────── Транзакционные операции (БД) ─────────────────────

/** Prisma Decimal | null → number | null. */
function toNum(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

interface ActorRow {
  id: string;
  role: ActorRole;
}

async function loadActor(
  tx: Prisma.TransactionClient,
  managerId: string,
): Promise<ActorRow> {
  const actor = await tx.user.findUnique({
    where: { id: managerId },
    select: { id: true, role: true, isActive: true },
  });
  if (!actor || !actor.isActive) {
    throw new SaleLogicError({
      code: "NOT_FOUND",
      message: "Пользователь не найден или заблокирован",
    });
  }
  if (!roleCanSell(actor.role)) {
    throw new SaleLogicError({
      code: "FORBIDDEN_ROLE",
      message: "Продажа доступна только менеджеру или владельцу",
    });
  }
  return { id: actor.id, role: actor.role };
}

function validateCustomer(customerName: string): string {
  const name = customerName.trim();
  if (!name) {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Укажите клиента — история «кому ушло» обязательна (TZ §5.4)",
    });
  }
  return name;
}

function validatePrice(price: number | null | undefined): number | null {
  if (price === null || price === undefined) return null;
  if (!Number.isFinite(price) || price <= 0) {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Цена — положительное число",
    });
  }
  return price;
}

export interface SellUnitInput {
  targetType: "SLAB" | "PIECE";
  unitId: string;
  customerName: string;
  customerContact?: string | null;
  price?: number | null;
  managerId: string;
}

export interface SellUnitOk {
  ok: true;
  saleId: string;
  unitId: string;
  viaReservation: boolean;
  /** id брони, переведённой в COMPLETED (переход №4), иначе null. */
  completedReservationId: string | null;
}

/**
 * Продажа конкретной единицы (Slab / Piece) — ОДНА транзакция:
 * условный UPDATE статуса (+ COMPLETED брони при продаже из-под своей брони)
 * + SaleRecord + AuditLog(SALE) (ADR-006). 0 строк условного UPDATE →
 * типизированная ошибка «уже продан» (TZ §7.1).
 */
export async function sellUnit(input: SellUnitInput): Promise<SellUnitOk | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);
      const customerName = validateCustomer(input.customerName);
      const price = validatePrice(input.price);

      const unitSelect = {
        id: true,
        status: true,
        needsCheck: true,
        reservations: {
          where: { status: "ACTIVE" as const },
          select: { id: true, managerId: true },
        },
      };
      const unit =
        input.targetType === "SLAB"
          ? await tx.slab.findUnique({ where: { id: input.unitId }, select: unitSelect })
          : await tx.piece.findUnique({ where: { id: input.unitId }, select: unitSelect });
      if (!unit) {
        throw new SaleLogicError({ code: "NOT_FOUND", message: "Камень не найден" });
      }

      const activeReservation = unit.reservations[0] ?? null;
      const decision = decideUnitSale({
        unitStatus: unit.status,
        needsCheck: unit.needsCheck,
        activeReservationManagerId: activeReservation?.managerId ?? null,
        actingManagerId: actor.id,
        actingRole: actor.role,
      });
      if (!decision.ok) throw new SaleLogicError(decision.error);

      // Условный UPDATE (data-model §2, требование к реализации): WHERE фиксирует
      // ожидаемый статус и needsCheck=false. 0 строк = параллельная продажа/бронь.
      const where = {
        id: unit.id,
        status: decision.expectedStatus,
        needsCheck: false,
      };
      const updated =
        input.targetType === "SLAB"
          ? await tx.slab.updateMany({ where, data: { status: "SOLD" } })
          : await tx.piece.updateMany({ where, data: { status: "SOLD" } });
      if (updated.count === 0) {
        throw new SaleLogicError({
          code: "ALREADY_SOLD",
          message: "Уже продан — другой менеджер закрыл продажу первым (TZ §7.1)",
        });
      }

      // Переход №4: бронь → COMPLETED той же транзакцией.
      let completedReservationId: string | null = null;
      if (decision.viaReservation && activeReservation) {
        const res = await tx.reservation.updateMany({
          where: { id: activeReservation.id, status: "ACTIVE" },
          data: { status: "COMPLETED", resolvedAt: new Date() },
        });
        if (res.count === 0) {
          throw new SaleLogicError({
            code: "CONFLICT",
            message: "Бронь изменилась параллельно — обновите страницу и повторите",
          });
        }
        completedReservationId = activeReservation.id;
      }

      const sale = await tx.saleRecord.create({
        data: {
          managerId: actor.id,
          customerName,
          customerContact: input.customerContact?.trim() || null,
          targetType: input.targetType,
          slabId: input.targetType === "SLAB" ? unit.id : null,
          pieceId: input.targetType === "PIECE" ? unit.id : null,
          price: price === null ? null : price.toFixed(2),
          soldAt: new Date(),
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SALE",
          entityType: input.targetType === "SLAB" ? "Slab" : "Piece",
          entityId: unit.id,
          payload: {
            saleId: sale.id,
            customerName,
            customerContact: input.customerContact?.trim() || null,
            price,
            prevStatus: unit.status,
            newStatus: "SOLD",
            viaReservation: decision.viaReservation,
            completedReservationId,
          },
        },
      });

      return {
        ok: true as const,
        saleId: sale.id,
        unitId: unit.id,
        viaReservation: decision.viaReservation,
        completedReservationId,
      };
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

export interface SellBatchVolumeInput {
  batchId: string;
  qtySlabs?: number | null;
  qtyAreaM2?: number | null;
  customerName: string;
  customerContact?: string | null;
  price?: number | null;
  managerId: string;
}

export interface SellVolumeOk {
  ok: true;
  saleId: string;
  batchId: string;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
  /** Свои volume-брони, погашенные продажей (COMPLETED). */
  completedReservationIds: string[];
}

interface BatchForVolume {
  id: string;
  needsCheck: boolean;
  slabsTotal: number | null;
  areaTotalM2: { toString(): string } | null;
  slabsAdjusted: number;
  areaAdjustedM2: { toString(): string };
  slabsSoldDirect: number;
  areaSoldDirectM2: { toString(): string };
  slabs: { areaM2: { toString(): string } | null }[];
  pieces: { areaM2: { toString(): string } | null }[];
  reservations: {
    id: string;
    managerId: string;
    qtySlabs: number | null;
    qtyAreaM2: { toString(): string } | null;
  }[];
}

async function loadBatchForVolume(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<BatchForVolume> {
  const batch = await tx.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      needsCheck: true,
      slabsTotal: true,
      areaTotalM2: true,
      slabsAdjusted: true,
      areaAdjustedM2: true,
      slabsSoldDirect: true,
      areaSoldDirectM2: true,
      // §3: выделенные плиты — в ЛЮБОМ статусе; куски — только прямые (originSlabId null).
      slabs: { select: { areaM2: true } },
      pieces: { where: { originSlabId: null }, select: { areaM2: true } },
      reservations: {
        where: { status: "ACTIVE", targetType: "BATCH_VOLUME" },
        select: { id: true, managerId: true, qtySlabs: true, qtyAreaM2: true },
      },
    },
  });
  if (!batch) {
    throw new SaleLogicError({ code: "NOT_FOUND", message: "Партия не найдена" });
  }
  if (batch.needsCheck) {
    throw new SaleLogicError({
      code: "NEEDS_CHECK",
      message: "Партия помечена «проверить» (пересорт) — продажа заблокирована до выяснения",
    });
  }
  return batch;
}

function batchFreeRemainder(batch: BatchForVolume): FreeRemainder {
  return computeFreeRemainder(
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
}

/**
 * Общее ядро объёмной продажи: охранная проверка → оптимистический условный
 * UPDATE счётчиков → погашение своих volume-броней → SaleRecord + AuditLog.
 * Вызывается ВНУТРИ транзакции.
 */
async function executeVolumeSale(
  tx: Prisma.TransactionClient,
  params: {
    actor: ActorRow;
    batch: BatchForVolume;
    free: FreeRemainder;
    qtySlabs: number | null;
    qtyAreaM2: number | null;
    customerName: string;
    customerContact: string | null;
    price: number | null;
    wholeBatch: boolean;
  },
): Promise<SellVolumeOk> {
  const { actor, batch, free, qtySlabs, qtyAreaM2 } = params;

  const others = batch.reservations.filter((r) => r.managerId !== actor.id);
  const own = batch.reservations.filter((r) => r.managerId === actor.id);
  const guard = checkVolumeSaleGuard({
    free,
    othersReservedSlabs: others.reduce((s, r) => s + (r.qtySlabs ?? 0), 0),
    othersReservedAreaM2: others.reduce((s, r) => s + (toNum(r.qtyAreaM2) ?? 0), 0),
    qtySlabs,
    qtyAreaM2,
  });
  if (!guard.ok) throw new SaleLogicError(guard.error);

  // Условная запись (data-model §2 по духу, ADR-005): WHERE фиксирует
  // прочитанные счётчики — параллельная объёмная продажа даст 0 строк,
  // и охранная проверка не будет обойдена.
  const updated = await tx.batch.updateMany({
    where: {
      id: batch.id,
      needsCheck: false,
      slabsSoldDirect: batch.slabsSoldDirect,
      areaSoldDirectM2: batch.areaSoldDirectM2.toString(),
    },
    data: {
      ...(qtySlabs !== null ? { slabsSoldDirect: { increment: qtySlabs } } : {}),
      ...(qtyAreaM2 !== null
        ? { areaSoldDirectM2: { increment: qtyAreaM2.toFixed(3) } }
        : {}),
    },
  });
  if (updated.count === 0) {
    throw new SaleLogicError({
      code: "CONFLICT",
      message: "Партию только что изменили параллельно — обновите страницу и повторите",
    });
  }

  // Менеджер продаёт в счёт СВОЕЙ volume-брони — бронь погашается (COMPLETED).
  let completedReservationIds: string[] = [];
  if (own.length > 0) {
    await tx.reservation.updateMany({
      where: { id: { in: own.map((r) => r.id) }, status: "ACTIVE" },
      data: { status: "COMPLETED", resolvedAt: new Date() },
    });
    completedReservationIds = own.map((r) => r.id);
  }

  const sale = await tx.saleRecord.create({
    data: {
      managerId: actor.id,
      customerName: params.customerName,
      customerContact: params.customerContact,
      targetType: "BATCH_VOLUME",
      batchId: batch.id,
      qtySlabs,
      qtyAreaM2: qtyAreaM2 === null ? null : qtyAreaM2.toFixed(3),
      price: params.price === null ? null : params.price.toFixed(2),
      soldAt: new Date(),
    },
    select: { id: true },
  });

  await tx.auditLog.create({
    data: {
      userId: actor.id,
      action: "SALE",
      entityType: "Batch",
      entityId: batch.id,
      payload: {
        saleId: sale.id,
        customerName: params.customerName,
        customerContact: params.customerContact,
        price: params.price,
        qtySlabs,
        qtyAreaM2,
        wholeBatch: params.wholeBatch,
        freeBefore: { slabsFree: free.slabsFree, areaFreeM2: free.areaFreeM2 },
        completedReservationIds,
      },
    },
  });

  return {
    ok: true as const,
    saleId: sale.id,
    batchId: batch.id,
    qtySlabs,
    qtyAreaM2,
    completedReservationIds,
  };
}

/**
 * B2B: продажа объёма прямо из партии, БЕЗ выделения плит (TZ §6.2, ADR-004).
 * Одна транзакция: свободный остаток (computeFreeRemainder) → охранная
 * проверка (минус чужие активные volume-брони) → инкремент
 * slabsSoldDirect/areaSoldDirectM2 → SaleRecord(BATCH_VOLUME) + AuditLog(SALE).
 */
export async function sellBatchVolume(
  input: SellBatchVolumeInput,
): Promise<SellVolumeOk | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);
      const customerName = validateCustomer(input.customerName);
      const price = validatePrice(input.price);
      const batch = await loadBatchForVolume(tx, input.batchId);
      const free = batchFreeRemainder(batch);
      return executeVolumeSale(tx, {
        actor,
        batch,
        free,
        qtySlabs: input.qtySlabs ?? null,
        qtyAreaM2: input.qtyAreaM2 ?? null,
        customerName,
        customerContact: input.customerContact?.trim() || null,
        price,
        wholeBatch: false,
      });
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

export interface SellWholeBatchInput {
  batchId: string;
  customerName: string;
  customerContact?: string | null;
  price?: number | null;
  managerId: string;
}

/**
 * «Партию выкупили оптом целиком» (TZ §7.6) — ОДНО действие: весь текущий
 * свободный остаток уходит в slabsSoldDirect/areaSoldDirectM2, плиты НЕ
 * создаются (ADR-004). Один SaleRecord + один AuditLog(SALE).
 */
export async function sellWholeBatch(
  input: SellWholeBatchInput,
): Promise<SellVolumeOk | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);
      const customerName = validateCustomer(input.customerName);
      const price = validatePrice(input.price);
      const batch = await loadBatchForVolume(tx, input.batchId);
      const free = batchFreeRemainder(batch);
      const whole = computeWholeBatchSale(free);
      if (!whole.ok) throw new SaleLogicError(whole.error);
      return executeVolumeSale(tx, {
        actor,
        batch,
        free,
        qtySlabs: whole.qtySlabs,
        qtyAreaM2: whole.qtyAreaM2,
        customerName,
        customerContact: input.customerContact?.trim() || null,
        price,
        wholeBatch: true,
      });
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}
