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
import { lockBatchForUpdate } from "./batch-lock";
import { MAX_DECIMAL_FIELD, MAX_INT_FIELD } from "./validators/intake";
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
  /**
   * managerId ЭФФЕКТИВНОЙ (ACTIVE и ещё НЕ истёкшей) брони на единицу;
   * null = эффективной брони нет (A2: истёкшая бронь сюда не попадает).
   */
  activeReservationManagerId: string | null;
  /**
   * A2: на единице есть ACTIVE-бронь, но она ИСТЕКЛА (sweep ещё не прошёл).
   * Истёкшая бронь фактически свободна и не должна блокировать продажу.
   */
  expiredReservationPresent?: boolean;
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
        // A2: единственная бронь на единице ИСТЕКЛА → она фактически свободна,
        // продажу не блокирует. Единица в БД ещё RESERVED (sweep не прошёл),
        // поэтому условный UPDATE ждёт RESERVED; брони к погашению нет.
        if (input.expiredReservationPresent) {
          return { ok: true, expectedStatus: "RESERVED", viaReservation: false };
        }
        // Статус RESERVED, а активной брони нет — состояние меняется параллельно
        // (снятие брони). Пусть пользователь обновит данные.
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
  // A1-b: верхний предел ДО инкремента slabsSoldDirect/areaSoldDirectM2 —
  // для m²-only партий (slabsFree = null) slab-проверка ниже пропускается, и
  // огромный qtySlabs иначе переполнил бы Int4. Обычная ошибка, не 500.
  if (qtySlabs !== null && qtySlabs > MAX_INT_FIELD) {
    return fail("INVALID_INPUT", "Слишком большое число плит");
  }
  if (qtyAreaM2 !== null && qtyAreaM2 > MAX_DECIMAL_FIELD) {
    return fail("INVALID_INPUT", "Слишком большая площадь");
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

// ─────────────── A2/A3: истечение и погашение volume-броней (чистое) ───────────────

/** Строка volume-брони, приведённая к number (Decimal → number вызывающим). */
export interface VolumeHoldRow {
  id: string;
  managerId: string;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * A2: активная (ACTIVE) бронь учитывается, ТОЛЬКО пока не истекла (expiresAt >
 * now). Истёкшая бронь фактически свободна — не режет остаток и не гасится.
 */
export function isHoldEffective(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

/**
 * A2: Σ активных, ещё НЕ истёкших volume-броней ДРУГИХ менеджеров. Истёкшие в
 * сумму не входят (иначе продолжали бы «съедать» свободный остаток до sweep).
 */
export function sumEffectiveOthersHolds(
  reservations: readonly VolumeHoldRow[],
  actorId: string,
  now: Date,
): { slabs: number; areaM2: number } {
  const others = reservations.filter(
    (r) => r.managerId !== actorId && isHoldEffective(r.expiresAt, now),
  );
  return {
    slabs: others.reduce((s, r) => s + (r.qtySlabs ?? 0), 0),
    areaM2: others.reduce((s, r) => s + (r.qtyAreaM2 ?? 0), 0),
  };
}

/** Собственная volume-бронь (уже отфильтрована по актору и эффективности). */
export interface OwnHold {
  id: string;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
}

/**
 * A3 — консервативное погашение СВОИХ volume-броней объёмной продажей.
 * Правило (никогда не закрывает бронь, которую продажа не покрыла):
 *  • брони обрабатываются СТАРЕЙШИЕ ПЕРВЫМИ;
 *  • бюджет = проданное количество в каждой единице (плиты и/или м²);
 *  • бронь гасится ТОЛЬКО если бюджет ПОЛНОСТЬЮ покрывает её во ВСЕХ единицах,
 *    в которых она измерена (продажа обязана давать эту единицу); тогда её
 *    количество вычитается из бюджета;
 *  • на ПЕРВОЙ непокрытой броне — стоп (последующие не трогаем).
 * Если бронь измерена в единице, которой продажа не даёт (напр. бронь в м²,
 * продажа в плитах) — она непокрыта → стоп. Когда сомневаемся — НЕ гасим.
 */
export function selectCoveredOwnHolds(
  holdsOldestFirst: readonly OwnHold[],
  soldSlabs: number | null,
  soldAreaM2: number | null,
): string[] {
  let budgetSlabs = soldSlabs; // null = продажа не даёт этой единицы
  let budgetArea = soldAreaM2;
  const completed: string[] = [];
  for (const h of holdsOldestFirst) {
    const needsSlabs = h.qtySlabs !== null;
    const needsArea = h.qtyAreaM2 !== null;
    if (!needsSlabs && !needsArea) break; // бронь без размера — не трогаем
    if (needsSlabs && (budgetSlabs === null || h.qtySlabs! > budgetSlabs)) break;
    if (needsArea && (budgetArea === null || h.qtyAreaM2! > budgetArea + AREA_EPS)) break;
    if (needsSlabs) budgetSlabs = (budgetSlabs as number) - (h.qtySlabs as number);
    if (needsArea) budgetArea = (budgetArea as number) - (h.qtyAreaM2 as number);
    completed.push(h.id);
  }
  return completed;
}

/**
 * A2+A3: из всех volume-броней партии отбирает СВОИ, ещё НЕ истёкшие,
 * сортирует старейшими вперёд и возвращает id тех, что продажа реально
 * покрыла (selectCoveredOwnHolds). Чужие и истёкшие брони не трогаются.
 */
export function selectOwnHoldsToComplete(
  reservations: readonly VolumeHoldRow[],
  actorId: string,
  soldSlabs: number | null,
  soldAreaM2: number | null,
  now: Date,
): string[] {
  const ownEffective = reservations
    .filter((r) => r.managerId === actorId && isHoldEffective(r.expiresAt, now))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return selectCoveredOwnHolds(ownEffective, soldSlabs, soldAreaM2);
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

      const now = new Date();
      const unitSelect = {
        id: true,
        status: true,
        needsCheck: true,
        reservations: {
          where: { status: "ACTIVE" as const },
          select: { id: true, managerId: true, expiresAt: true },
        },
      };
      const unit =
        input.targetType === "SLAB"
          ? await tx.slab.findUnique({ where: { id: input.unitId }, select: unitSelect })
          : await tx.piece.findUnique({ where: { id: input.unitId }, select: unitSelect });
      if (!unit) {
        throw new SaleLogicError({ code: "NOT_FOUND", message: "Камень не найден" });
      }

      // A2: истёкшая ACTIVE-бронь (sweep ещё не прошёл) фактически свободна —
      // не блокирует продажу и не гасится как выполненная. Эффективная — только
      // ещё не истёкшая; истёкшие закрываем EXPIRED в этой же транзакции.
      const effectiveReservation =
        unit.reservations.find((r) => isHoldEffective(r.expiresAt, now)) ?? null;
      const expiredReservations = unit.reservations.filter(
        (r) => !isHoldEffective(r.expiresAt, now),
      );
      const decision = decideUnitSale({
        unitStatus: unit.status,
        needsCheck: unit.needsCheck,
        activeReservationManagerId: effectiveReservation?.managerId ?? null,
        expiredReservationPresent: expiredReservations.length > 0,
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
      if (decision.viaReservation && effectiveReservation) {
        const res = await tx.reservation.updateMany({
          where: { id: effectiveReservation.id, status: "ACTIVE" },
          data: { status: "COMPLETED", resolvedAt: new Date() },
        });
        if (res.count === 0) {
          throw new SaleLogicError({
            code: "CONFLICT",
            message: "Бронь изменилась параллельно — обновите страницу и повторите",
          });
        }
        completedReservationId = effectiveReservation.id;
      }

      // A2: продали из-под ИСТЁКШИХ броней (viaReservation=false) — закрываем их
      // EXPIRED в этой же транзакции, чтобы на проданной единице не осталась
      // «висящая» ACTIVE-бронь до следующего sweep.
      if (!decision.viaReservation && expiredReservations.length > 0) {
        await tx.reservation.updateMany({
          where: {
            id: { in: expiredReservations.map((r) => r.id) },
            status: "ACTIVE",
          },
          data: { status: "EXPIRED", resolvedAt: new Date() },
        });
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
    expiresAt: Date;
    createdAt: Date;
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
      // A2: грузим ВСЕ активные volume-брони (в т.ч. истёкшие — статус ещё
      // ACTIVE до sweep) вместе с expiresAt/createdAt; фильтрация по истечению
      // и порядок «старейшие вперёд» — в чистых хелперах ниже.
      reservations: {
        where: { status: "ACTIVE", targetType: "BATCH_VOLUME" },
        select: {
          id: true,
          managerId: true,
          qtySlabs: true,
          qtyAreaM2: true,
          expiresAt: true,
          createdAt: true,
        },
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
    now: Date;
  },
): Promise<SellVolumeOk> {
  const { actor, batch, free, qtySlabs, qtyAreaM2, now } = params;

  // A2: brони приводим к number и фильтруем истёкшие в чистых хелперах.
  const holds: VolumeHoldRow[] = batch.reservations.map((r) => ({
    id: r.id,
    managerId: r.managerId,
    qtySlabs: r.qtySlabs,
    qtyAreaM2: toNum(r.qtyAreaM2),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));

  // A2: только НЕ истёкшие чужие брони режут доступный остаток.
  const others = sumEffectiveOthersHolds(holds, actor.id, now);
  const guard = checkVolumeSaleGuard({
    free,
    othersReservedSlabs: others.slabs,
    othersReservedAreaM2: others.areaM2,
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

  // A3: гасим ТОЛЬКО те свои volume-брони, которые продажа реально покрыла
  // (старейшие вперёд, бюджет = проданное кол-во). Никогда не закрываем бронь,
  // которую продажа не покрыла (иначе камень другого клиента молча освободится).
  const completedReservationIds = selectOwnHoldsToComplete(
    holds,
    actor.id,
    qtySlabs,
    qtyAreaM2,
    now,
  );
  if (completedReservationIds.length > 0) {
    await tx.reservation.updateMany({
      where: { id: { in: completedReservationIds }, status: "ACTIVE" },
      data: { status: "COMPLETED", resolvedAt: new Date() },
    });
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
      // S2-conc: пессимистический замок на строку партии ДО чтения счётчиков —
      // сериализует все операции, меняющие свободный остаток (§3), исключая
      // межоперационный oversell (продажа vs выделение/прямой бой).
      await lockBatchForUpdate(tx, input.batchId);
      const now = new Date();
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
        now,
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
      // S2-conc: замок на строку партии ДО чтения счётчиков (см. sellBatchVolume).
      await lockBatchForUpdate(tx, input.batchId);
      const now = new Date();
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
        now,
      });
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}
