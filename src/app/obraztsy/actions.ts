"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { notifyWarehouseSafe } from "@/lib/shipment-notify-hook";
import {
  returnSample,
  extendSampleDueDate,
  sellSample,
  issueSample,
} from "@/lib/samples";
import { strOf } from "@/lib/form";
import type { IssueSampleFormState } from "./issue-sample-state";
import { validateSellSampleFields } from "./sell-sample-state";
import type { SellSampleFormState } from "./sell-sample-state";

function revalidateSamples() {
  revalidatePath("/obraztsy");
  revalidatePath("/klienty");
  revalidatePath("/prodazha");
  revalidatePath("/poisk");
}

/**
 * Field errors that must also surface as `errors.form` (or step-4 list).
 * SaleForm historically only rendered conflict + errors.form — clientId /
 * returnDueDate-only returns were silent (TZ14 BUG-01 warehouse demo).
 * Local helper — not exported (would break "use server" export rules).
 */
function failFields(
  fieldErrors: Record<string, string>,
): IssueSampleFormState {
  const first = Object.values(fieldErrors)[0] ?? "Проверьте поля формы";
  return {
    errors: { ...fieldErrors, form: fieldErrors.form ?? first },
    conflict: null,
  };
}

export async function returnSampleAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSell) redirect("/obraztsy?err=" + encodeURIComponent("Нет доступа"));
  const managerId = await currentActorId();
  if (!managerId) redirect("/obraztsy?err=" + encodeURIComponent("Нет менеджера"));
  const sampleId = String(formData.get("sampleId") ?? "").trim();
  const res = await returnSample({ sampleId, managerId });
  if (!res.ok) redirect("/obraztsy?err=" + encodeURIComponent(res.error.message));
  revalidateSamples();
  redirect("/obraztsy?ok=returned");
}

export async function extendSampleAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSell) redirect("/obraztsy?err=" + encodeURIComponent("Нет доступа"));
  const managerId = await currentActorId();
  if (!managerId) redirect("/obraztsy?err=" + encodeURIComponent("Нет менеджера"));
  const sampleId = String(formData.get("sampleId") ?? "").trim();
  const raw = String(formData.get("returnDueDate") ?? "").trim();
  const returnDueDate = new Date(`${raw}T23:59:59.999+05:00`);
  const res = await extendSampleDueDate({ sampleId, managerId, returnDueDate });
  if (!res.ok) redirect("/obraztsy?err=" + encodeURIComponent(res.error.message));
  revalidateSamples();
  redirect("/obraztsy?ok=extended");
}

/**
 * Продажа образца (useActionState в SellSampleForm).
 * W1-T2: раньше цена шла через Number(replace(",", ".")) — «1,500» → 1.5
 * (занижение в 1000×, утекало в сводку и долги). Теперь валидация через
 * validateSellSampleFields — тот же parseBoundedDecimal/семантика, что у
 * главной формы продажи (validateSalePayment). Валюта и способ оплаты
 * обязательны — БЕЗ тихого дефолта в UZS/CASH.
 * Failure → state с errors.form (форма держит введённые значения),
 * success → redirect /obraztsy?ok=sold.
 */
export async function sellSampleAction(
  _prev: SellSampleFormState,
  formData: FormData,
): Promise<SellSampleFormState> {
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return failFields({ form: "Нет доступа: продажу оформляет менеджер" });
  }
  const managerId = await currentActorId();
  if (!managerId) {
    return failFields({ form: "Нет менеджера — войдите снова" });
  }
  const str = strOf(formData);
  const sampleId = str("sampleId");
  if (!sampleId) {
    return failFields({ form: "Образец не найден — обновите страницу" });
  }
  const v = validateSellSampleFields({
    price: str("price"),
    currency: str("currency"),
    paymentMethod: str("paymentMethod"),
  });
  if (!v.ok) {
    return failFields(v.errors);
  }
  const res = await sellSample({
    sampleId,
    managerId,
    price: v.data.price,
    paymentMethod: v.data.paymentMethod,
    currency: v.data.currency,
  });
  if (!res.ok) {
    if (res.error.code === "CONFLICT" || res.error.code === "NOT_ACTIVE") {
      return { errors: {}, conflict: res.error.message };
    }
    return failFields({ form: res.error.message });
  }
  revalidateSamples();
  redirect("/obraztsy?ok=sold");
}

/**
 * Issue sample from sale form (prodazha).
 * Success → redirect /obraztsy (Sample row status ACTIVE).
 * Failure → always populates errors.form (and field keys) so step-4 is never silent.
 */
export async function issueSampleAction(
  _prev: IssueSampleFormState,
  formData: FormData,
): Promise<IssueSampleFormState> {
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return failFields({ form: "Нет доступа: образцы оформляет менеджер" });
  }
  const managerId = await currentActorId();
  if (!managerId) {
    return failFields({ form: "Нет менеджера — войдите снова" });
  }
  const str = strOf(formData);
  const mode = str("mode");
  const fieldErrors: Record<string, string> = {};

  const clientId = str("clientId");
  if (!clientId) {
    fieldErrors.clientId = "Выберите клиента";
  }
  const dueRaw = str("returnDueDate");
  if (!dueRaw) {
    fieldErrors.returnDueDate = "Укажите срок возврата образца";
  }
  let returnDueDate: Date | null = null;
  if (dueRaw) {
    returnDueDate = new Date(`${dueRaw}T23:59:59.999+05:00`);
    if (Number.isNaN(returnDueDate.getTime())) {
      fieldErrors.returnDueDate = "Некорректная дата возврата образца";
      returnDueDate = null;
    }
  }

  const depositRaw = str("depositAmount");
  let depositAmount: number | null = null;
  let depositCurrency: "UZS" | "USD" | null = null;
  if (depositRaw) {
    depositAmount = Number(depositRaw.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      fieldErrors.depositAmount = "Залог — положительное число (или пусто)";
      depositAmount = null;
    } else {
      const cur = str("depositCurrency");
      depositCurrency = cur === "USD" ? "USD" : "UZS";
    }
  }

  // Map sale form modes → Sample.targetType (SaleTarget: SLAB|PIECE|BATCH_VOLUME).
  let targetType: "SLAB" | "PIECE" | "BATCH_VOLUME" | null = null;
  if (mode === "SLAB" || mode === "PIECE") {
    targetType = mode;
  } else if (
    mode === "BATCH_VOLUME" ||
    mode === "WHOLE_BATCH" ||
    mode === "PATTERN_VOLUME"
  ) {
    targetType = "BATCH_VOLUME";
  } else {
    fieldErrors.form = "Неизвестный тип — обновите страницу";
  }

  const unitId = str("unitId") || undefined;
  let batchId = str("batchId") || undefined;

  if (mode === "SLAB" || mode === "PIECE") {
    if (!unitId) {
      fieldErrors.unitId = "Не выбран камень";
    }
  } else if (mode === "PATTERN_VOLUME") {
    // Form sends batchPatternId (pattern row), not batchId. Resolve batch FK.
    const patternId = str("batchPatternId");
    if (!patternId) {
      fieldErrors.batchId = "Не выбран узор партии";
    } else {
      const pat = await db.batchPattern.findUnique({
        where: { id: patternId },
        select: { batchId: true },
      });
      if (!pat) {
        fieldErrors.batchId = "Узор партии не найден — обновите страницу";
      } else {
        batchId = pat.batchId;
      }
    }
  } else if (mode === "BATCH_VOLUME" || mode === "WHOLE_BATCH") {
    if (!batchId) {
      fieldErrors.batchId = "Не выбрана партия";
    }
  }

  // Volume sample needs qty (WHOLE_BATCH is not isVolume on the form — reject clearly).
  let qtySlabs: number | null = str("qtySlabs")
    ? Number(str("qtySlabs").replace(/\s/g, ""))
    : null;
  let qtyAreaM2: number | null = str("qtyAreaM2")
    ? Number(str("qtyAreaM2").replace(/\s/g, "").replace(",", "."))
    : null;
  if (qtySlabs != null && (!Number.isFinite(qtySlabs) || qtySlabs <= 0)) {
    fieldErrors.qtySlabs = "Плит — целое положительное число";
    qtySlabs = null;
  }
  if (qtyAreaM2 != null && (!Number.isFinite(qtyAreaM2) || qtyAreaM2 <= 0)) {
    fieldErrors.qtyAreaM2 = "Площадь — положительное число";
    qtyAreaM2 = null;
  }
  if (targetType === "BATCH_VOLUME") {
    if (mode === "WHOLE_BATCH") {
      fieldErrors.form =
        "Образец «на всю партию» не оформляется — укажите объём (плиты или м²) через «Объём из партии»";
    } else if (
      (qtySlabs == null || qtySlabs <= 0) &&
      (qtyAreaM2 == null || qtyAreaM2 <= 0)
    ) {
      fieldErrors.qty = "Укажите объём образца (плиты или м²)";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return failFields(fieldErrors);
  }

  const res = await issueSample({
    targetType: targetType!,
    unitId,
    batchId,
    qtySlabs,
    qtyAreaM2,
    clientId,
    managerId,
    returnDueDate: returnDueDate!,
    depositAmount,
    depositCurrency,
    comment: str("sampleComment") || null,
    locationNote: str("locationNote") || null,
  });

  if (!res.ok) {
    if (
      res.error.code === "ALREADY_ISSUED" ||
      res.error.code === "UNIT_UNAVAILABLE" ||
      res.error.code === "INSUFFICIENT_REMAINDER" ||
      res.error.code === "CONFLICT"
    ) {
      return { errors: {}, conflict: res.error.message };
    }
    // INVALID_INPUT / NOT_FOUND / FORBIDDEN_ROLE — form + never silent
    return failFields({ form: res.error.message });
  }

  // ТЗ №15 §8.2 + §4 — образец идёт той же цепочкой отгрузки, с пометкой
  // «ОБРАЗЕЦ». Зовём складчика ПОСЛЕ коммита; сбой Telegram не отменяет выдачу.
  await notifyWarehouseSafe(res.shipmentId, managerId);

  revalidateSamples();
  redirect(`/obraztsy?ok=issued&id=${res.sampleId}`);
}
