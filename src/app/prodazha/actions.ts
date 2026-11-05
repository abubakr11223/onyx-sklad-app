"use server";

// Продажа и списание — server actions (TZ §5.4, §6.1 шаг 8, §6.2, §7.6).
// Вся доменная логика — в src/lib/sales.ts (одна транзакция: условный
// UPDATE + SaleRecord + AuditLog, ADR-006); здесь только разбор формы,
// русские сообщения и редирект с итогом.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { notifyWarehouseSafe } from "@/lib/shipment-notify-hook";
import { checkMinStockSafe } from "@/lib/min-stock-hook";
import {
  confirmReturnedUnit,
  returnSale,
  sellBatchVolume,
  sellPatternVolume,
  sellUnit,
  sellWholeBatch,
  type SaleError,
} from "@/lib/sales";
import { formatReturnQty, returnSalePartial } from "@/lib/sale-returns";
import { isPayMethod, formatMoneyCents } from "@/lib/payments";
import { normalizeMoneyForSubmit } from "./money-input";
import { validateSalePayment } from "@/lib/validators/sale-payment";
import { validateSaleClientLink } from "@/lib/validators/sale-client";
import { parseVolumeQtyFields } from "@/lib/validators/volume-qty";
import { strOf } from "@/lib/form";
import { ensureFormError } from "@/lib/form-errors";

export type SaleMode =
  | "SLAB"
  | "PIECE"
  | "BATCH_VOLUME"
  | "PATTERN_VOLUME" // ТЗ №3 — продажа из узор-подгруппы
  | "WHOLE_BATCH";

export interface SaleFormState {
  /** Полевые ошибки формы (ключ — имя поля). */
  errors: Record<string, string>;
  /**
   * Конфликт продажи — показывается КРУПНО (TZ §7.1: «уже продан»,
   * чужая бронь, не хватает остатка, параллельное изменение).
   */
  conflict: string | null;
}

const CONFLICT_CODES: ReadonlySet<SaleError["code"]> = new Set([
  "ALREADY_SOLD",
  "RESERVED_BY_OTHER",
  "CONFLICT",
  "NEEDS_CHECK",
  "INSUFFICIENT_REMAINDER",
  "INVALID_STATUS",
]);

function failState(error: SaleError): SaleFormState {
  if (CONFLICT_CODES.has(error.code)) {
    return { errors: {}, conflict: error.message };
  }
  return { errors: { form: error.message }, conflict: null };
}

/** Field validation fail — always include errors.form (silent-form second net). */
function fieldFail(errors: Record<string, string>): SaleFormState {
  return { errors: ensureFormError(errors), conflict: null };
}

/** Итог продажи для баннера успеха — «что, сколько, кому». */
async function saleSummary(saleId: string): Promise<string> {
  const sale = await db.saleRecord.findUnique({
    where: { id: saleId },
    include: {
      slab: { select: { label: true, stoneType: { select: { name: true } } } },
      piece: { select: { kind: true, stoneType: { select: { name: true } } } },
      batch: { select: { stoneType: { select: { name: true } } } },
      batchPattern: { select: { description: true } },
    },
  });
  if (!sale) return "Продажа оформлена";
  if (sale.slab) return `${sale.slab.stoneType.name} — ${sale.slab.label}`;
  if (sale.piece) {
    const kindRu = sale.piece.kind === "BROKEN" ? "бой" : "остаток";
    return `${sale.piece.stoneType.name} — ${kindRu}`;
  }
  if (sale.batch) {
    const qty = [
      sale.qtySlabs !== null && `${sale.qtySlabs} плит`,
      sale.qtyAreaM2 !== null && `${Number(sale.qtyAreaM2)} м²`,
    ]
      .filter(Boolean)
      .join(" / ");
    const what = sale.batchPattern
      ? `узор «${sale.batchPattern.description}»`
      : "объём из партии";
    return `${sale.batch.stoneType.name} — ${what}${qty ? ` (${qty})` : ""}`;
  }
  return "Продажа оформлена";
}

export async function submitSale(
  _prev: SaleFormState,
  formData: FormData,
): Promise<SaleFormState> {
  // R2 — DEFENSE-IN-DEPTH: сайт открыт («kodsiz»), поэтому прямой POST должен
  // блокироваться на сервере, а не только скрытием UI. Продажа — canSell.
  if (!(await getCapabilities()).canSell) {
    return {
      errors: { form: "Нет доступа: продажа доступна менеджеру" },
      conflict: null,
    };
  }

  const str = strOf(formData);
  const mode = str("mode") as SaleMode;
  const errors: Record<string, string> = {};

  if (!["SLAB", "PIECE", "BATCH_VOLUME", "PATTERN_VOLUME", "WHOLE_BATCH"].includes(mode)) {
    return { errors: { form: "Неизвестный тип продажи — обновите страницу" }, conflict: null };
  }

  // TZ №10+11 §6 — клиент из справочника обязателен (clientId).
  // customerName/contact берутся с карточки; legacy text-only POST отсекается.
  const clientLink = validateSaleClientLink({
    clientId: str("clientId"),
    siteId: str("siteId"),
    siteMode: str("siteMode"),
  });
  if (!clientLink.ok) {
    Object.assign(errors, clientLink.errors);
  }

  // TZ9-A / CONTRACT: способ оплаты, валюта, цена (>0), для CREDIT — телефон.
  // Валидация только на сервере недостаточна? Нет — форма тоже гейтит, но
  // прямой POST без UI обязан отсекаться здесь (defense-in-depth).
  // customerContact: form may send phone; for CREDIT we prefer Client.phone.
  const payment = validateSalePayment({
    paymentMethod: str("paymentMethod"),
    currency: str("currency"),
    price: str("price"),
    customerContact: str("customerContact"),
    debtDueDate: str("debtDueDate"),
    debtComment: str("debtComment"),
    // ТЗ №20 A — строки «Оплата сейчас» (50/50, предоплата).
    payments: str("payments"),
  });
  if (!payment.ok) {
    Object.assign(errors, payment.errors);
  }

  const isVolume = mode === "BATCH_VOLUME" || mode === "PATTERN_VOLUME";
  let qtySlabs: number | null = null;
  let qtyAreaM2: number | null = null;
  if (isVolume) {
    // Reject "55 12.5" etc. — never strip spaces into 5512.5 (salebug / TZ9).
    const vol = parseVolumeQtyFields(str("qtySlabs"), str("qtyAreaM2"));
    if (!vol.ok) {
      Object.assign(errors, vol.errors);
    } else {
      qtySlabs = vol.qtySlabs;
      qtyAreaM2 = vol.qtyAreaM2;
    }
  }

  const unitId = str("unitId");
  const batchId = str("batchId");
  const batchPatternId = str("batchPatternId");
  // W1-T1: явное согласие «закрыть мою бронь этой продажей» (только объёмные
  // режимы). Принадлежность и активность брони проверяет sales.ts в транзакции.
  const consumeReservationId = str("consumeReservationId") || null;
  // ТЗ №19 B1 — из какого места брать (принадлежность месту проверяет sales.ts:
  // чужой id просто не попадёт в раскладку узора).
  const batchLocationId = str("batchLocationId") || null;
  if ((mode === "SLAB" || mode === "PIECE") && !unitId) {
    errors.form = "Не выбран камень — вернитесь на шаг выбора";
  }
  if ((mode === "BATCH_VOLUME" || mode === "WHOLE_BATCH") && !batchId) {
    errors.form = "Не выбрана партия — вернитесь на шаг выбора";
  }
  if (mode === "PATTERN_VOLUME" && !batchPatternId) {
    errors.form = "Не выбран узор — вернитесь на шаг выбора";
  }

  if (Object.keys(errors).length > 0 || !payment.ok || !clientLink.ok) {
    return fieldFail(errors);
  }

  const pay = payment.data;
  const link = clientLink.data;

  const managerId = await currentActorId();
  if (!managerId) {
    return fieldFail({
      form: "В системе нет активного менеджера (seed) — обратитесь к администратору",
    });
  }

  // Resolve directory row — defense-in-depth if clientId was forged/stale.
  const client = await db.client.findUnique({
    where: { id: link.clientId },
    select: { id: true, name: true, phone: true },
  });
  if (!client) {
    return fieldFail({
      clientId: "Клиент не найден — выберите или создайте заново",
    });
  }

  const siteId: string | null = link.siteId;
  if (siteId) {
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { id: true, clientId: true },
    });
    if (!site || site.clientId !== client.id) {
      return fieldFail({
        siteId: "Объект не принадлежит выбранному клиенту",
      });
    }
  }

  // Denormalized text for history / legacy screens (customerName still filled).
  const customerName = client.name;
  // Prefer form contact if provided; else client phone (CREDIT needs a phone).
  const customerContact =
    pay.customerContact?.trim() || client.phone.trim() || null;

  // Re-check CREDIT phone after resolving client card (ТЗ №20: любой остаток в долг).
  const leavesDebt =
    pay.paymentMethod === "CREDIT" ||
    (pay.payments !== null &&
      pay.payments.reduce((s, r) => s + Math.round(r.amount * 100), 0) <
        Math.round(pay.price * 100));
  if (leavesDebt && !customerContact) {
    return fieldFail({
      customerContact: "Для продажи в долг укажите телефон клиента",
    });
  }

  // ТЗ №20 B — плановая отгрузка (Ташкент, UTC+5; время необязательно).
  const plannedDate = str("plannedDate");
  const plannedTime = str("plannedTime");
  const modeRaw = str("deliveryMode");
  let plannedAt: Date | null = null;
  if (plannedDate) {
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(plannedDate);
    const okTime = !plannedTime || /^\d{2}:\d{2}$/.test(plannedTime);
    plannedAt = okDate && okTime
      ? new Date(`${plannedDate}T${plannedTime || "00:00"}:00+05:00`)
      : null;
    if (!plannedAt || Number.isNaN(plannedAt.getTime())) {
      return fieldFail({ plannedDate: "Неверная дата или время отгрузки" });
    }
  }
  const shipmentPlan = {
    plannedAt,
    plannedHasTime: Boolean(plannedAt && plannedTime),
    deliveryMode:
      modeRaw === "PICKUP" || modeRaw === "DELIVERY" ? (modeRaw as "PICKUP" | "DELIVERY") : null,
  };

  const common = {
    customerName,
    customerContact,
    price: pay.price,
    managerId,
    paymentMethod: pay.paymentMethod,
    payments: pay.payments,
    currency: pay.currency,
    debtDueDate: pay.debtDueDate,
    debtComment: pay.debtComment,
    clientId: client.id,
    siteId,
    shipmentPlan,
  };
  const result =
    mode === "SLAB" || mode === "PIECE"
      ? await sellUnit({ targetType: mode, unitId, ...common })
      : mode === "BATCH_VOLUME"
        ? await sellBatchVolume({
            batchId,
            qtySlabs,
            qtyAreaM2,
            consumeReservationId,
            batchLocationId,
            ...common,
          })
        : mode === "PATTERN_VOLUME"
          ? await sellPatternVolume({
              batchPatternId,
              qtySlabs,
              qtyAreaM2,
              consumeReservationId,
              batchLocationId,
              ...common,
            })
          : await sellWholeBatch({ batchId, consumeReservationId, ...common });

  if (!result.ok) return failState(result.error);

  // ТЗ №15 §8.2 — задача на отгрузку создана в той же транзакции; теперь, ПОСЛЕ
  // коммита, зовём складчика в Telegram. Продажа уже состоялась: сбой отправки
  // не откатывает её и не показывается менеджеру как ошибка — очередь
  // /otgruzki остаётся источником правды.
  await notifyWarehouseSafe(result.shipmentId, managerId);
  // ТЗ №20 C — списание: проверить «Минимальный остаток» вида (после коммита,
  // сбой не роняет продажу).
  await checkMinStockSafe({
    saleRecordIds: [result.saleId],
    batchIds: [batchId],
    batchPatternIds: [batchPatternId],
  });

  const params = new URLSearchParams({
    ok: "1",
    what: await saleSummary(result.saleId),
    customer: customerName,
  });
  redirect(`/prodazha?${params.toString()}`);
}

// ─────────────────────── ВОЗВРАТ от клиента (TZ §4.3) ───────────────────────
// Флоу из истории продаж: «Оформить возврат» реверсирует продажу (returnSale),
// затем вернувшаяся единица «требует проверки» → «Подтвердить: в наличии»
// (confirmReturnedUnit). Обе — form-actions с redirect (?retOk/?retErr), как
// setNeedsCheck/updateLocation. Вся доменная логика — в src/lib/sales.ts.

/**
 * «Оформить возврат» по продаже (TZ §4.3). Defense-in-depth: возврат — как
 * продажа, только canSell (OWNER/MANAGER); сайт открыт («kodsiz»), поэтому
 * прямой POST блокируется на сервере, а не только скрытием кнопки.
 */
export async function returnSaleAction(formData: FormData): Promise<void> {
  if (!(await getCapabilities()).canSell) {
    redirect(`/prodazha?retErr=${encodeURIComponent("Нет доступа: возврат оформляет менеджер")}`);
  }

  const saleRecordId = String(formData.get("saleRecordId") ?? "").trim();
  if (!saleRecordId) {
    redirect(`/prodazha?retErr=${encodeURIComponent("Продажа не указана")}`);
  }

  const managerId = await currentActorId();
  if (!managerId) {
    redirect(`/prodazha?retErr=${encodeURIComponent("В системе нет активного менеджера")}`);
  }

  const methodRaw = String(formData.get("method") ?? "").trim();
  const result = await returnSale({
    saleRecordId,
    managerId: managerId!,
    method: isPayMethod(methodRaw) ? methodRaw : "CASH",
    reason: String(formData.get("reason") ?? "").trim() || null,
  });
  if (!result.ok) {
    redirect(`/prodazha?retErr=${encodeURIComponent(result.error.message)}`);
  }
  // ТЗ №20 C — объём вернулся в остаток: снять пометку «мало», если выше порога.
  await checkMinStockSafe({ saleRecordIds: [saleRecordId] });

  const isUnit = result.targetType === "SLAB" || result.targetType === "PIECE";
  const note = isUnit
    ? "Возврат оформлен — камень требует проверки перед возвратом в наличие"
    : volumeReturnNote(result);
  redirect(`/prodazha?retOk=${encodeURIComponent(note)}`);
}

/** «2 плит — сразу в остаток · 1 плит — ждёт приёма складом в «Отгрузках»». */
function volumeReturnNote(r: {
  immediateSlabs?: number;
  immediateAreaM2?: number;
  pendingSlabs?: number;
  pendingAreaM2?: number;
}): string {
  const now = formatReturnQty(r.immediateSlabs ?? null, r.immediateAreaM2 ?? null);
  const later = formatReturnQty(r.pendingSlabs ?? null, r.pendingAreaM2 ?? null);
  return [
    "Возврат оформлен",
    now && `${now} — сразу в остаток (не отгружалось)`,
    later && `${later} — ждёт приёма складом в «Отгрузках»`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * ТЗ №20 F — «Оформить возврат» объёмной продажи (частичный; пусто = всё).
 * Право: canSell; менеджер — только свои продажи (проверка в транзакции).
 */
export async function returnSalePartialAction(formData: FormData): Promise<void> {
  const back = (msg: string) =>
    redirect(`/prodazha?retErr=${encodeURIComponent(msg)}#sales`);
  if (!(await getCapabilities()).canSell) back("Нет доступа: возврат оформляет менеджер");
  const managerId = await currentActorId();
  if (!managerId) back("В системе нет активного менеджера");

  const str = strOf(formData);
  const saleRecordId = str("saleRecordId");
  if (!saleRecordId) back("Продажа не указана");

  let qtySlabs: number | null = null;
  let qtyAreaM2: number | null = null;
  if (str("qtySlabs") || str("qtyAreaM2")) {
    const vol = parseVolumeQtyFields(str("qtySlabs"), str("qtyAreaM2"));
    if (!vol.ok) back(Object.values(vol.errors)[0] ?? "Неверное количество");
    else {
      qtySlabs = vol.qtySlabs;
      qtyAreaM2 = vol.qtyAreaM2;
    }
  }

  // Пусто = предложенная сумма (цена × доля).
  let refundCents: number | null = null;
  const refundRaw = normalizeMoneyForSubmit(str("refund"));
  if (refundRaw !== "") {
    const v = Number(refundRaw);
    if (!Number.isFinite(v) || v < 0) back("Сумма возврата — число не меньше нуля");
    refundCents = Math.round(v * 100);
  }
  const methodRaw = str("method");
  const destination = str("destination") === "REMAINDER" ? "REMAINDER" : "SAME_PATTERN";

  const result = await returnSalePartial({
    saleRecordId,
    managerId: managerId!,
    opts: {
      qtySlabs,
      qtyAreaM2,
      refundCents,
      method: isPayMethod(methodRaw) ? methodRaw : "CASH",
      destination,
      reason: str("reason") || null,
    },
  });
  if (!result.ok) back(result.error.message);
  if (!result.ok) return;

  // ТЗ №20 C — объём вернулся в остаток: пересчитать порог вида.
  await checkMinStockSafe({ saleRecordIds: [saleRecordId] });

  const cur = str("currency") === "USD" ? "USD" : "UZS";
  const money = [
    result.debtReductionCents > 0 && `долг −${formatMoneyCents(result.debtReductionCents, cur)}`,
    result.cashCents > 0 && `клиенту ${formatMoneyCents(result.cashCents, cur)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const note = [volumeReturnNote(result), money].filter(Boolean).join(" · ");
  redirect(`/prodazha?retOk=${encodeURIComponent(note)}#sales`);
}

/**
 * «Проверено → в наличии» (TZ §4.3): подтверждает проверку вернувшейся единицы
 * (RETURNED → AVAILABLE). Только canSell (см. returnSaleAction).
 */
export async function confirmReturnAction(formData: FormData): Promise<void> {
  if (!(await getCapabilities()).canSell) {
    redirect(`/prodazha?retErr=${encodeURIComponent("Нет доступа: проверку подтверждает менеджер")}`);
  }

  const targetTypeRaw = String(formData.get("targetType") ?? "").trim();
  if (targetTypeRaw !== "SLAB" && targetTypeRaw !== "PIECE") {
    redirect(`/prodazha?retErr=${encodeURIComponent("Неизвестный тип камня")}`);
  }
  const targetType = targetTypeRaw as "SLAB" | "PIECE";

  const unitId = String(formData.get("unitId") ?? "").trim();
  if (!unitId) {
    redirect(`/prodazha?retErr=${encodeURIComponent("Камень не указан")}`);
  }

  const managerId = await currentActorId();
  if (!managerId) {
    redirect(`/prodazha?retErr=${encodeURIComponent("В системе нет активного менеджера")}`);
  }

  const result = await confirmReturnedUnit({ targetType, unitId, managerId: managerId! });
  if (!result.ok) {
    redirect(`/prodazha?retErr=${encodeURIComponent(result.error.message)}`);
  }
  // ТЗ №20 C — плита снова в наличии: пересчитать порог вида.
  await checkMinStockSafe(
    targetType === "SLAB" ? { slabIds: [unitId] } : { pieceIds: [unitId] },
  );

  redirect(`/prodazha?retOk=${encodeURIComponent("Камень возвращён в наличие")}`);
}
