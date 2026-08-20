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
import { MAX_DECIMAL_14_2 } from "./decimal";
import {
  cancelDebtForReturnedSale,
  createDebtForSale,
  DebtLogicError,
} from "./debts";
import {
  cancelOpenShipmentForSale,
  createSaleShipment,
} from "./shipments";
import {
  cancelOpenShowroomShipmentForUnit,
  closeOpenShowroomPlacement,
} from "./showroom";
import type { Currency, PaymentMethod, Prisma } from "@prisma/client";
import { formatLocation } from "@/lib/locations";

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
  | "CONFLICT" // параллельное изменение — оптимистическая проверка не прошла
  | "ALREADY_RETURNED" // TZ §4.3: возврат уже оформлен (идемпотентность)
  | "CANNOT_RETURN" // TZ §4.3: единица не в статусе «продан» — реверс невозможен
  | "NOT_RETURNED"; // TZ §4.3: подтверждать «в наличии» можно только из «возврата»

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

export type ActorRole =
  | "OWNER"
  | "MANAGER"
  | "WAREHOUSE"
  | "WAREHOUSE_LEAD"
  | "PARTNER";
export type SellableUnitStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "SOLD"
  | "BROKEN_OFFCUT"
  | "RETURNED"
  | "SAMPLE"
  | "SHOWROOM";

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
      expectedStatus: "AVAILABLE" | "RESERVED" | "SHOWROOM";
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
    case "SAMPLE":
      return fail(
        "INVALID_STATUS",
        "Камень выдан как образец — оформите через раздел «Образцы»",
      );
    case "SHOWROOM":
      // TZ №15 Slice 3 — sell from showroom (SHOWROOM → SOLD, conditional).
      return { ok: true, expectedStatus: "SHOWROOM", viaReservation: false };
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
 * ТЗ №3 фаза 4 — охрана продажи ИЗ УЗОРА: продажа не может превысить остаток
 * подгруппы (slabsCount − slabsSold / areaM2 − areaSoldM2). Batch-охрана
 * (checkVolumeSaleGuard) применяется отдельно и дополнительно — узор-остаток
 * всегда ≤ batch-остатка, но проверяем оба для точной ошибки.
 */
export function checkPatternSaleGuard(input: {
  remainingSlabs: number;
  remainingArea: number;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
}): { ok: true } | SaleFail {
  if (input.qtySlabs !== null && input.qtySlabs > input.remainingSlabs) {
    return fail(
      "INSUFFICIENT_REMAINDER",
      `В узоре столько нет: осталось ${input.remainingSlabs} плит`,
    );
  }
  if (input.qtyAreaM2 !== null && input.qtyAreaM2 > input.remainingArea + AREA_EPS) {
    const remTxt = input.remainingArea.toFixed(3).replace(/\.?0+$/, "");
    return fail("INSUFFICIENT_REMAINDER", `В узоре столько нет: осталось ≈${remTxt} м²`);
  }
  return { ok: true };
}

/**
 * «Партию выкупили оптом целиком» (TZ §7.6): весь текущий свободный остаток
 * одним действием уходит в slabsSoldDirect/areaSoldDirectM2. Плиты НЕ создаются
 * (ADR-004). Возвращает количества для продажи; нечего продавать → ошибка.
 * Площадь усекается до 3 знаков (Decimal(12,3) в БД).
 *
 * Аудит ТЗ №7 #21 — раньше Math.round мог округлить ВВЕРХ (когда после
 * average-slab-fallback возникает бесконечная дробь, напр. areaFreeM2=14.28571...
 * → 14.286). Затем executeVolumeSale инкрементил areaSoldDirectM2 на 14.286,
 * а свободный остаток становился −0.00029. checkVolumeSaleGuard пропускал
 * (AREA_EPS=0.001 > max round-up ≈0.0005), но breaking.ts:646 (guard `-1e-9`)
 * потом блокировал легитимный area-only registerDirectPiece («партия пуста, а
 * бой не даёт списать»). Math.floor гарантирует НИКОГДА не переконсумить —
 * остаток может обнулиться, но не уйти в минус.
 */
export function computeWholeBatchSale(
  free: FreeRemainder,
): { ok: true; qtySlabs: number | null; qtyAreaM2: number | null } | SaleFail {
  const qtySlabs = free.slabsFree !== null && free.slabsFree > 0 ? free.slabsFree : null;
  const areaTruncated =
    free.areaFreeM2 !== null ? Math.floor(free.areaFreeM2 * 1000) / 1000 : null;
  const qtyAreaM2 = areaTruncated !== null && areaTruncated > 0 ? areaTruncated : null;
  if (qtySlabs === null && qtyAreaM2 === null) {
    return fail("INSUFFICIENT_REMAINDER", "Свободного остатка в партии нет — продавать нечего");
  }
  return { ok: true, qtySlabs, qtyAreaM2 };
}

// ─────────────────── ВОЗВРАТ от клиента (TZ §4.3) — чистые решения ───────────────────

/**
 * Можно ли оформить возврат по продаже (TZ §4.3). Возврат реверсирует продажу,
 * поэтому право то же, что и на продажу (OWNER/MANAGER). Идемпотентность:
 * повторный возврат уже возвращённой продажи запрещён (returnedAt заполнён).
 */
export function decideReturn(input: {
  actingRole: ActorRole;
  alreadyReturned: boolean;
}): { ok: true } | SaleFail {
  if (!roleCanSell(input.actingRole)) {
    return fail("FORBIDDEN_ROLE", "Возврат оформляет менеджер или владелец");
  }
  if (input.alreadyReturned) {
    return fail("ALREADY_RETURNED", "По этой продаже возврат уже оформлен");
  }
  return { ok: true };
}

/**
 * Можно ли подтвердить «проверено → в наличии» для вернувшейся единицы
 * (TZ §4.3: «требует проверки перед возвратом в наличие»). Разрешено только из
 * статуса RETURNED — иначе AVAILABLE достигается в обход обязательной проверки.
 */
export function decideConfirmReturn(input: {
  actingRole: ActorRole;
  unitStatus: SellableUnitStatus;
}): { ok: true } | SaleFail {
  if (!roleCanSell(input.actingRole)) {
    return fail("FORBIDDEN_ROLE", "Проверку подтверждает менеджер или владелец");
  }
  if (input.unitStatus !== "RETURNED") {
    return fail("NOT_RETURNED", "Камень не в статусе «возврат» — подтверждать нечего");
  }
  return { ok: true };
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

/**
 * Legacy price gate: null still allowed when paymentMethod is omitted
 * (old callers / history-only paths). When paymentMethod is set,
 * validateSalePayment requires a positive price. o2 form uses sale-payment.ts
 * which always requires price — but any direct sell* call without paymentMethod
 * can still write SaleRecord.price = null (QA flag / dual-validator risk).
 */
function validatePrice(price: number | null | undefined): number | null {
  if (price === null || price === undefined) return null;
  if (!Number.isFinite(price) || price <= 0) {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Цена — положительное число",
    });
  }
  // Sale total — Decimal(14,2), not area MAX_DECIMAL_FIELD (12,3).
  if (price > MAX_DECIMAL_14_2) {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Цена слишком велика",
    });
  }
  return price;
}

/** TZ №9 — payment fields. When paymentMethod is set, currency + price required. */
export interface SalePaymentFields {
  paymentMethod?: PaymentMethod | null;
  currency?: Currency | null;
  /** Due date for CREDIT debts (optional). */
  debtDueDate?: Date | null;
  debtComment?: string | null;
}

/** TZ №10+11 — optional directory links (nullable for legacy / pre-directory rows). */
export interface SaleClientFields {
  clientId?: string | null;
  siteId?: string | null;
}

export interface ValidatedSalePayment {
  paymentMethod: PaymentMethod | null;
  currency: Currency | null;
  debtDueDate: Date | null;
  debtComment: string | null;
}

/**
 * TZ №9 validation. Legacy callers omit paymentMethod → nulls (no debt).
 * New UI always passes paymentMethod; then price + currency are required.
 * CREDIT also requires customer phone (customerContact).
 */
export function validateSalePayment(
  fields: SalePaymentFields,
  price: number | null,
  customerContact: string | null,
): ValidatedSalePayment {
  const method = fields.paymentMethod ?? null;
  if (method == null) {
    return {
      paymentMethod: null,
      currency: null,
      debtDueDate: null,
      debtComment: null,
    };
  }
  if (method !== "CASH" && method !== "CARD" && method !== "CREDIT") {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Способ оплаты: наличные, карта или в долг",
    });
  }
  if (price === null) {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Укажите цену продажи",
    });
  }
  const currency = fields.currency ?? null;
  if (currency !== "UZS" && currency !== "USD") {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Укажите валюту: сум (UZS) или доллар (USD)",
    });
  }
  if (method === "CREDIT") {
    const phone = customerContact?.trim() ?? "";
    if (!phone) {
      throw new SaleLogicError({
        code: "INVALID_INPUT",
        message: "Для продажи в долг укажите телефон клиента",
      });
    }
  }
  return {
    paymentMethod: method,
    currency,
    debtDueDate: fields.debtDueDate ?? null,
    debtComment: fields.debtComment?.trim() || null,
  };
}

/** After saleRecord.create — open Debt when CREDIT (same tx). */
async function maybeCreateDebtForCreditSale(
  tx: Prisma.TransactionClient,
  args: {
    saleId: string;
    payment: ValidatedSalePayment;
    price: number | null;
    clientId?: string | null;
  },
): Promise<void> {
  if (args.payment.paymentMethod !== "CREDIT") return;
  if (args.price === null || args.payment.currency == null) {
    throw new SaleLogicError({
      code: "INVALID_INPUT",
      message: "Продажа в долг требует цену и валюту",
    });
  }
  try {
    await createDebtForSale(tx, {
      saleRecordId: args.saleId,
      amount: args.price.toFixed(2),
      currency: args.payment.currency,
      dueDate: args.payment.debtDueDate,
      comment: args.payment.debtComment,
      clientId: args.clientId ?? null,
    });
  } catch (e) {
    if (e instanceof DebtLogicError) {
      // Map debt codes into SaleError surface (same INVALID_INPUT / NOT_FOUND).
      const code =
        e.debtError.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_INPUT";
      throw new SaleLogicError({ code, message: e.debtError.message });
    }
    throw e;
  }
}

export interface SellUnitInput extends SalePaymentFields, SaleClientFields {
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
  /**
   * ТЗ №15 §8.2 — id созданной задачи на отгрузку. Нужен вызывающему, чтобы
   * ПОСЛЕ коммита уведомить складчика в Telegram: сама отправка — внешний
   * I/O и внутри транзакции ей не место.
   */
  shipmentId: string;
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
      const customerContact = input.customerContact?.trim() || null;
      const payment = validateSalePayment(input, price, customerContact);

      const now = new Date();
      const unitSelect = {
        id: true,
        status: true,
        needsCheck: true,
        block: true,
        landmark: true,
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

      // TZ №15 Slice 3 — selling from showroom closes placement + cancels OPEN showroom ship.
      if (decision.expectedStatus === "SHOWROOM") {
        await cancelOpenShowroomShipmentForUnit(tx, {
          slabId: input.targetType === "SLAB" ? unit.id : null,
          pieceId: input.targetType === "PIECE" ? unit.id : null,
          now,
        });
        await closeOpenShowroomPlacement(tx, {
          slabId: input.targetType === "SLAB" ? unit.id : null,
          pieceId: input.targetType === "PIECE" ? unit.id : null,
          now,
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

      const clientId = input.clientId?.trim() || null;
      const siteId = input.siteId?.trim() || null;

      const sale = await tx.saleRecord.create({
        data: {
          managerId: actor.id,
          customerName,
          customerContact,
          targetType: input.targetType,
          slabId: input.targetType === "SLAB" ? unit.id : null,
          pieceId: input.targetType === "PIECE" ? unit.id : null,
          price: price === null ? null : price.toFixed(2),
          paymentMethod: payment.paymentMethod,
          currency: payment.currency,
          clientId,
          siteId,
          soldAt: now,
        },
        select: { id: true },
      });

      // TZ №9 — CREDIT: Debt in the SAME transaction as SaleRecord.
      await maybeCreateDebtForCreditSale(tx, {
        saleId: sale.id,
        payment,
        price,
        clientId,
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
            customerContact,
            price,
            paymentMethod: payment.paymentMethod,
            currency: payment.currency,
            prevStatus: unit.status,
            newStatus: "SOLD",
            viaReservation: decision.viaReservation,
            completedReservationId,
          },
        },
      });

      // TZ №15 Slice 1 — OPEN shipment same TX (stock already SOLD above).
      const loc =
        "block" in unit && "landmark" in unit
          ? formatLocation(unit.block, unit.landmark)
          : null;
      const { shipmentId } = await createSaleShipment(tx, {
        saleRecordId: sale.id,
        managerId: actor.id,
        clientId,
        siteId,
        line: {
          targetType: input.targetType,
          slabId: input.targetType === "SLAB" ? unit.id : null,
          pieceId: input.targetType === "PIECE" ? unit.id : null,
          locationSnapshot: loc,
        },
      });

      return {
        ok: true as const,
        saleId: sale.id,
        unitId: unit.id,
        viaReservation: decision.viaReservation,
        completedReservationId,
        shipmentId,
      };
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

export interface SellBatchVolumeInput extends SalePaymentFields, SaleClientFields {
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
  /** ТЗ №15 §8.2 — задача на отгрузку; уведомление шлём после коммита. */
  shipmentId: string;
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
/** ТЗ №3 фаза 4 — узор-подгруппа для продажи (остаток = count − sold). */
interface PatternForSale {
  id: string;
  slabsCount: number;
  slabsSold: number;
  areaM2: number;
  areaSoldM2: number;
}

// eksport: узор-ветвь integratsion test'i (sales.test.ts §7.5) uchun — tx
// mock bilan chaqiriladi (lock/loadActor/loadBatch mock qilinmaydi).
export async function executeVolumeSale(
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
    // ТЗ №3 — продажа ИЗ УЗОРА (иначе null → обычная batch-volume продажа).
    pattern?: PatternForSale | null;
    /** TZ №9 — already validated payment (null method = legacy). */
    payment?: ValidatedSalePayment;
    /** TZ №10+11 — directory links (optional / legacy null). */
    clientId?: string | null;
    siteId?: string | null;
  },
): Promise<SellVolumeOk> {
  const { actor, batch, free, qtySlabs, qtyAreaM2, now } = params;
  const payment: ValidatedSalePayment = params.payment ?? {
    paymentMethod: null,
    currency: null,
    debtDueDate: null,
    debtComment: null,
  };

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

  // ТЗ №3 — узор-охрана: продажа не превышает остаток подгруппы (ДО записи).
  if (params.pattern) {
    const pg = checkPatternSaleGuard({
      remainingSlabs: params.pattern.slabsCount - params.pattern.slabsSold,
      remainingArea: params.pattern.areaM2 - params.pattern.areaSoldM2,
      qtySlabs,
      qtyAreaM2,
    });
    if (!pg.ok) throw new SaleLogicError(pg.error);
  }

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

  // ТЗ №3 — синхронно инкрементим счётчики УЗОРА (условно, как batch выше).
  // Batch-остаток уже уменьшен; узор-остаток тоже, чтобы карточка сходилась.
  if (params.pattern) {
    const patUpdated = await tx.batchPattern.updateMany({
      where: {
        id: params.pattern.id,
        slabsSold: params.pattern.slabsSold,
        areaSoldM2: params.pattern.areaSoldM2.toFixed(3),
      },
      data: {
        ...(qtySlabs !== null ? { slabsSold: { increment: qtySlabs } } : {}),
        ...(qtyAreaM2 !== null
          ? { areaSoldM2: { increment: qtyAreaM2.toFixed(3) } }
          : {}),
      },
    });
    if (patUpdated.count === 0) {
      throw new SaleLogicError({
        code: "CONFLICT",
        message: "Узор только что изменили параллельно — обновите страницу и повторите",
      });
    }
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

  const clientId = params.clientId?.trim() || null;
  const siteId = params.siteId?.trim() || null;

  const sale = await tx.saleRecord.create({
    data: {
      managerId: actor.id,
      customerName: params.customerName,
      customerContact: params.customerContact,
      targetType: "BATCH_VOLUME",
      batchId: batch.id,
      batchPatternId: params.pattern?.id ?? null,
      qtySlabs,
      qtyAreaM2: qtyAreaM2 === null ? null : qtyAreaM2.toFixed(3),
      price: params.price === null ? null : params.price.toFixed(2),
      paymentMethod: payment.paymentMethod,
      currency: payment.currency,
      clientId,
      siteId,
      soldAt: now,
    },
    select: { id: true },
  });

  // TZ №9 — CREDIT debt same tx as volume sale.
  await maybeCreateDebtForCreditSale(tx, {
    saleId: sale.id,
    payment,
    price: params.price,
    clientId,
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
        paymentMethod: payment.paymentMethod,
        currency: payment.currency,
        qtySlabs,
        qtyAreaM2,
        wholeBatch: params.wholeBatch,
        batchPatternId: params.pattern?.id ?? null,
        freeBefore: { slabsFree: free.slabsFree, areaFreeM2: free.areaFreeM2 },
        completedReservationIds,
      },
    },
  });

  // TZ №15 Slice 1 — volume sale shipment (same TX; soldDirect already incremented).
  const { shipmentId } = await createSaleShipment(tx, {
    saleRecordId: sale.id,
    managerId: actor.id,
    clientId,
    siteId,
    line: {
      targetType: "BATCH_VOLUME",
      batchId: batch.id,
      qtyOrderedSlabs: qtySlabs,
      qtyOrderedAreaM2: qtyAreaM2,
    },
  });

  return {
    ok: true as const,
    saleId: sale.id,
    batchId: batch.id,
    qtySlabs,
    qtyAreaM2,
    completedReservationIds,
    shipmentId,
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
      const customerContact = input.customerContact?.trim() || null;
      const payment = validateSalePayment(input, price, customerContact);
      const batch = await loadBatchForVolume(tx, input.batchId);
      const free = batchFreeRemainder(batch);
      return executeVolumeSale(tx, {
        actor,
        batch,
        free,
        qtySlabs: input.qtySlabs ?? null,
        qtyAreaM2: input.qtyAreaM2 ?? null,
        customerName,
        customerContact,
        price,
        wholeBatch: false,
        now,
        payment,
        clientId: input.clientId,
        siteId: input.siteId,
      });
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

export interface SellPatternVolumeInput extends SalePaymentFields, SaleClientFields {
  batchPatternId: string;
  qtySlabs?: number | null;
  qtyAreaM2?: number | null;
  customerName: string;
  customerContact?: string | null;
  price?: number | null;
  managerId: string;
}

/**
 * ТЗ №3 фаза 4 — продажа объёма ИЗ УЗОР-подгруппы (B2C). Как sellBatchVolume, но
 * дополнительно: проверяет остаток узора (checkPatternSaleGuard) и синхронно
 * инкрементит счётчики узора вместе с batch.slabsSoldDirect (executeVolumeSale с
 * pattern) — единый остаток. SaleRecord несёт batchPatternId.
 */
export async function sellPatternVolume(
  input: SellPatternVolumeInput,
): Promise<SellVolumeOk | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      // Узор грузим ПЕРВЫМ — узнаём его batchId, затем лочим партию (как batch-volume).
      const pat = await tx.batchPattern.findUnique({
        where: { id: input.batchPatternId },
        select: {
          id: true,
          batchId: true,
          slabsCount: true,
          slabsSold: true,
          areaM2: true,
          areaSoldM2: true,
        },
      });
      if (!pat) {
        throw new SaleLogicError({
          code: "NOT_FOUND",
          message: "Узор не найден — обновите страницу и повторите",
        });
      }
      await lockBatchForUpdate(tx, pat.batchId);
      const now = new Date();
      const actor = await loadActor(tx, input.managerId);
      const customerName = validateCustomer(input.customerName);
      const price = validatePrice(input.price);
      const customerContact = input.customerContact?.trim() || null;
      const payment = validateSalePayment(input, price, customerContact);
      const batch = await loadBatchForVolume(tx, pat.batchId);
      const free = batchFreeRemainder(batch);
      return executeVolumeSale(tx, {
        actor,
        batch,
        free,
        qtySlabs: input.qtySlabs ?? null,
        qtyAreaM2: input.qtyAreaM2 ?? null,
        customerName,
        customerContact,
        price,
        wholeBatch: false,
        now,
        payment,
        clientId: input.clientId,
        siteId: input.siteId,
        pattern: {
          id: pat.id,
          slabsCount: pat.slabsCount,
          slabsSold: pat.slabsSold,
          areaM2: toNum(pat.areaM2) ?? 0,
          areaSoldM2: toNum(pat.areaSoldM2) ?? 0,
        },
      });
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

export interface SellWholeBatchInput extends SalePaymentFields, SaleClientFields {
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
      const customerContact = input.customerContact?.trim() || null;
      const payment = validateSalePayment(input, price, customerContact);
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
        customerContact,
        price,
        wholeBatch: true,
        now,
        payment,
        clientId: input.clientId,
        siteId: input.siteId,
      });
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

// ─────────────────── ВОЗВРАТ от клиента (TZ §4.3) — транзакции ───────────────────

export interface ReturnSaleInput {
  saleRecordId: string;
  managerId: string;
}

export interface ReturnSaleOk {
  ok: true;
  saleId: string;
  targetType: "SLAB" | "PIECE" | "BATCH_VOLUME";
  /** Возвращённая единица (для SLAB/PIECE) — её нужно «проверить» → в наличие. */
  slabId: string | null;
  pieceId: string | null;
  batchId: string | null;
}

/**
 * Возврат от клиента (TZ §4.3) — ОДНА транзакция, реверс продажи:
 *  • SLAB/PIECE: условный UPDATE SOLD → RETURNED + needsCheck=true (единица
 *    требует проверки перед возвратом в наличие; §3-остаток пересчитается сам
 *    по статусу). 0 строк ⇒ единица уже не «продан» (разбита/возвращена) —
 *    CANNOT_RETURN.
 *  • BATCH_VOLUME: замок партии, ДЕКРЕМЕНТ slabsSoldDirect/areaSoldDirectM2 на
 *    записанные в продаже количества (реверс инкремента продажи — доступный
 *    остаток возвращается) + needsCheck=true на партии.
 * Идемпотентность: returnedAt на SaleRecord ставится условно (WHERE returnedAt
 * IS NULL); 0 строк ⇒ параллельный/повторный возврат — ALREADY_RETURNED.
 * Пишет AuditLog(RETURN) той же транзакцией (§1.10).
 */
export async function returnSale(
  input: ReturnSaleInput,
): Promise<ReturnSaleOk | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);
      const now = new Date();

      const sale = await tx.saleRecord.findUnique({
        where: { id: input.saleRecordId },
        select: {
          id: true,
          targetType: true,
          slabId: true,
          pieceId: true,
          batchId: true,
          batchPatternId: true,
          qtySlabs: true,
          qtyAreaM2: true,
          returnedAt: true,
          paymentMethod: true,
        },
      });
      if (!sale) {
        throw new SaleLogicError({ code: "NOT_FOUND", message: "Продажа не найдена" });
      }

      const decision = decideReturn({
        actingRole: actor.role,
        alreadyReturned: sale.returnedAt !== null,
      });
      if (!decision.ok) throw new SaleLogicError(decision.error);

      // Идемпотентность: условная пометка returnedAt (гонка/повтор → 0 строк).
      const marked = await tx.saleRecord.updateMany({
        where: { id: sale.id, returnedAt: null },
        data: { returnedAt: now },
      });
      if (marked.count === 0) {
        throw new SaleLogicError({
          code: "ALREADY_RETURNED",
          message: "Возврат уже оформлен параллельно — обновите страницу",
        });
      }

      // TZ №9 — credit sale: close ACTIVE debt (REPAID left as REPAID).
      const debtCancel = await cancelDebtForReturnedSale(tx, {
        saleRecordId: sale.id,
        actorId: actor.id,
        now,
      });

      // TZ №15 — cancel OPEN shipment task (stock reverse below is independent).
      await cancelOpenShipmentForSale(tx, sale.id, now);

      if (sale.targetType === "SLAB" || sale.targetType === "PIECE") {
        const unitId = sale.targetType === "SLAB" ? sale.slabId : sale.pieceId;
        if (!unitId) {
          // CHECK-constraint гарантирует наличие FK; защита от рассинхрона.
          throw new SaleLogicError({ code: "NOT_FOUND", message: "Камень продажи не найден" });
        }
        // Условный реверс SOLD → RETURNED (§2, обратный переход). 0 строк ⇒
        // единица уже не «продан» (разбита/возвращена) — реверс невозможен.
        const where = { id: unitId, status: "SOLD" as const };
        const data = { status: "RETURNED" as const, needsCheck: true };
        const reversed =
          sale.targetType === "SLAB"
            ? await tx.slab.updateMany({ where, data })
            : await tx.piece.updateMany({ where, data });
        if (reversed.count === 0) {
          throw new SaleLogicError({
            code: "CANNOT_RETURN",
            message:
              "Камень не в статусе «продан» (возможно, разбит или уже возвращён) — возврат невозможен",
          });
        }
      } else {
        // BATCH_VOLUME: замок партии ДО декремента — сериализует с параллельной
        // объёмной продажей/боем (иначе их guard прочитает устаревший остаток).
        if (!sale.batchId) {
          throw new SaleLogicError({ code: "NOT_FOUND", message: "Партия продажи не найдена" });
        }
        await lockBatchForUpdate(tx, sale.batchId);
        await tx.batch.update({
          where: { id: sale.batchId },
          data: {
            ...(sale.qtySlabs !== null
              ? { slabsSoldDirect: { decrement: sale.qtySlabs } }
              : {}),
            ...(sale.qtyAreaM2 !== null
              ? { areaSoldDirectM2: { decrement: sale.qtyAreaM2 } }
              : {}),
            needsCheck: true,
          },
        });
        // ТЗ №3 — если продажа была ИЗ УЗОРА, синхронно реверсим и его счётчики
        // (иначе остаток узора «застрянет» проданным при возврате партии).
        if (sale.batchPatternId) {
          await tx.batchPattern.update({
            where: { id: sale.batchPatternId },
            data: {
              ...(sale.qtySlabs !== null
                ? { slabsSold: { decrement: sale.qtySlabs } }
                : {}),
              ...(sale.qtyAreaM2 !== null
                ? { areaSoldM2: { decrement: sale.qtyAreaM2 } }
                : {}),
            },
          });
        }
      }

      const entityType =
        sale.targetType === "SLAB"
          ? "Slab"
          : sale.targetType === "PIECE"
            ? "Piece"
            : "Batch";
      const entityId =
        sale.targetType === "SLAB"
          ? sale.slabId!
          : sale.targetType === "PIECE"
            ? sale.pieceId!
            : sale.batchId!;

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "RETURN",
          entityType,
          entityId,
          payload: {
            saleId: sale.id,
            targetType: sale.targetType,
            qtySlabs: sale.qtySlabs,
            qtyAreaM2: sale.qtyAreaM2 === null ? null : Number(sale.qtyAreaM2.toString()),
            needsCheck: true,
            paymentMethod: sale.paymentMethod,
            debtCancelOutcome: debtCancel.outcome,
            debtId: debtCancel.debtId,
          },
        },
      });

      return {
        ok: true as const,
        saleId: sale.id,
        targetType: sale.targetType,
        slabId: sale.slabId,
        pieceId: sale.pieceId,
        batchId: sale.batchId,
      };
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

export interface ConfirmReturnedUnitInput {
  targetType: "SLAB" | "PIECE";
  unitId: string;
  managerId: string;
}

export interface ConfirmReturnedUnitOk {
  ok: true;
  unitId: string;
  targetType: "SLAB" | "PIECE";
}

/**
 * «Проверено → в наличии» (TZ §4.3): вернувшаяся единица прошла проверку —
 * RETURNED + needsCheck снимаются, единица снова AVAILABLE. Условный UPDATE
 * WHERE status = RETURNED (0 строк ⇒ уже не в возврате — NOT_RETURNED). Прямой
 * путь RETURNED → AVAILABLE существует ТОЛЬКО здесь (в обход проверки нельзя).
 *
 * TZ №9 / QA #3: does NOT touch Debt. Money was already settled in returnSale
 * (cancelDebtForReturnedSale). Cancelling again here would corrupt the ledger.
 */
export async function confirmReturnedUnit(
  input: ConfirmReturnedUnitInput,
): Promise<ConfirmReturnedUnitOk | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);

      const unit =
        input.targetType === "SLAB"
          ? await tx.slab.findUnique({
              where: { id: input.unitId },
              select: { id: true, status: true },
            })
          : await tx.piece.findUnique({
              where: { id: input.unitId },
              select: { id: true, status: true },
            });
      if (!unit) {
        throw new SaleLogicError({ code: "NOT_FOUND", message: "Камень не найден" });
      }

      const decision = decideConfirmReturn({
        actingRole: actor.role,
        unitStatus: unit.status,
      });
      if (!decision.ok) throw new SaleLogicError(decision.error);

      const where = { id: unit.id, status: "RETURNED" as const };
      const data = { status: "AVAILABLE" as const, needsCheck: false };
      const updated =
        input.targetType === "SLAB"
          ? await tx.slab.updateMany({ where, data })
          : await tx.piece.updateMany({ where, data });
      if (updated.count === 0) {
        throw new SaleLogicError({
          code: "NOT_RETURNED",
          message: "Камень уже не в статусе «возврат» — обновите страницу",
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "STATUS_CHANGE",
          entityType: input.targetType === "SLAB" ? "Slab" : "Piece",
          entityId: unit.id,
          payload: {
            from: "RETURNED",
            to: "AVAILABLE",
            needsCheck: false,
            checked: true, // проверка после возврата подтверждена
          },
        },
      });

      return { ok: true as const, unitId: unit.id, targetType: input.targetType };
    });
  } catch (e) {
    if (e instanceof SaleLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}
