"use server";

// Продажа и списание — server actions (TZ §5.4, §6.1 шаг 8, §6.2, §7.6).
// Вся доменная логика — в src/lib/sales.ts (одна транзакция: условный
// UPDATE + SaleRecord + AuditLog, ADR-006); здесь только разбор формы,
// русские сообщения и редирект с итогом.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import {
  confirmReturnedUnit,
  returnSale,
  sellBatchVolume,
  sellPatternVolume,
  sellUnit,
  sellWholeBatch,
  type SaleError,
} from "@/lib/sales";
import {
  parsePositiveDecimal,
  parsePositiveInt,
} from "@/lib/validators/intake";
import { strOf } from "@/lib/form";

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

/** Итог продажи для баннера успеха — «что, сколько, кому». */
async function saleSummary(saleId: string): Promise<string> {
  const sale = await db.saleRecord.findUnique({
    where: { id: saleId },
    include: {
      slab: { select: { label: true, stoneType: { select: { name: true } } } },
      piece: { select: { kind: true, stoneType: { select: { name: true } } } },
      batch: { select: { stoneType: { select: { name: true } } } },
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
    return `${sale.batch.stoneType.name} — объём из партии${qty ? ` (${qty})` : ""}`;
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

  const customerName = str("customerName");
  if (!customerName) errors.customerName = "Укажите клиента — обязательное поле";
  const customerContact = str("customerContact") || null;

  const price = parsePositiveDecimal(str("price"));
  if (price === undefined) errors.price = "Цена — положительное число, например 1500";

  const isVolume = mode === "BATCH_VOLUME" || mode === "PATTERN_VOLUME";
  let qtySlabs: number | null = null;
  let qtyAreaM2: number | null = null;
  if (isVolume) {
    const qs = parsePositiveInt(str("qtySlabs"));
    const qa = parsePositiveDecimal(str("qtyAreaM2"));
    if (qs === undefined) errors.qtySlabs = "Число плит — целое положительное число";
    if (qa === undefined) errors.qtyAreaM2 = "Площадь — положительное число, например 12,5";
    if (qs === null && qa === null) {
      errors.qty = "Укажите объём: число плит и/или площадь (м²)";
    }
    qtySlabs = qs ?? null;
    qtyAreaM2 = qa ?? null;
  }

  const unitId = str("unitId");
  const batchId = str("batchId");
  const batchPatternId = str("batchPatternId");
  if ((mode === "SLAB" || mode === "PIECE") && !unitId) {
    errors.form = "Не выбран камень — вернитесь на шаг выбора";
  }
  if ((mode === "BATCH_VOLUME" || mode === "WHOLE_BATCH") && !batchId) {
    errors.form = "Не выбрана партия — вернитесь на шаг выбора";
  }
  if (mode === "PATTERN_VOLUME" && !batchPatternId) {
    errors.form = "Не выбран узор — вернитесь на шаг выбора";
  }

  if (Object.keys(errors).length > 0) return { errors, conflict: null };

  const managerId = await currentActorId();
  if (!managerId) {
    return {
      errors: { form: "В системе нет активного менеджера (seed) — обратитесь к администратору" },
      conflict: null,
    };
  }

  const common = { customerName, customerContact, price: price ?? null, managerId };
  const result =
    mode === "SLAB" || mode === "PIECE"
      ? await sellUnit({ targetType: mode, unitId, ...common })
      : mode === "BATCH_VOLUME"
        ? await sellBatchVolume({ batchId, qtySlabs, qtyAreaM2, ...common })
        : mode === "PATTERN_VOLUME"
          ? await sellPatternVolume({ batchPatternId, qtySlabs, qtyAreaM2, ...common })
          : await sellWholeBatch({ batchId, ...common });

  if (!result.ok) return failState(result.error);

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

  const result = await returnSale({ saleRecordId, managerId: managerId! });
  if (!result.ok) {
    redirect(`/prodazha?retErr=${encodeURIComponent(result.error.message)}`);
  }

  const isUnit = result.targetType === "SLAB" || result.targetType === "PIECE";
  const note = isUnit
    ? "Возврат оформлен — камень требует проверки перед возвратом в наличие"
    : "Возврат оформлен — объём возвращён в остаток, партия помечена «проверить»";
  redirect(`/prodazha?retOk=${encodeURIComponent(note)}`);
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

  redirect(`/prodazha?retOk=${encodeURIComponent("Камень возвращён в наличие")}`);
}
