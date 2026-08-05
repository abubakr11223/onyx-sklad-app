"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCapabilities, currentActorId } from "@/lib/session";
import {
  returnSample,
  extendSampleDueDate,
  sellSample,
  issueSample,
} from "@/lib/samples";
import { strOf } from "@/lib/form";

function revalidateSamples() {
  revalidatePath("/obraztsy");
  revalidatePath("/klienty");
  revalidatePath("/prodazha");
  revalidatePath("/poisk");
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

export async function sellSampleAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSell) redirect("/obraztsy?err=" + encodeURIComponent("Нет доступа"));
  const managerId = await currentActorId();
  if (!managerId) redirect("/obraztsy?err=" + encodeURIComponent("Нет менеджера"));
  const sampleId = String(formData.get("sampleId") ?? "").trim();
  const price = Number(String(formData.get("price") ?? "").replace(",", "."));
  const currencyRaw = String(formData.get("currency") ?? "UZS").trim();
  const currency = currencyRaw === "USD" ? "USD" : "UZS";
  const payRaw = String(formData.get("paymentMethod") ?? "CASH").trim();
  const paymentMethod =
    payRaw === "CARD" || payRaw === "CREDIT" ? payRaw : "CASH";
  const res = await sellSample({
    sampleId,
    managerId,
    price,
    paymentMethod,
    currency,
  });
  if (!res.ok) redirect("/obraztsy?err=" + encodeURIComponent(res.error.message));
  revalidateSamples();
  redirect("/obraztsy?ok=sold");
}

/** Issue sample from sale form (prodazha). */
export async function issueSampleAction(
  _prev: { errors: Record<string, string>; conflict: string | null },
  formData: FormData,
): Promise<{ errors: Record<string, string>; conflict: string | null }> {
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return { errors: { form: "Нет доступа" }, conflict: null };
  }
  const managerId = await currentActorId();
  if (!managerId) {
    return { errors: { form: "Нет менеджера" }, conflict: null };
  }
  const str = strOf(formData);
  const mode = str("mode");
  const clientId = str("clientId");
  if (!clientId) {
    return {
      errors: { clientId: "Выберите клиента" },
      conflict: null,
    };
  }
  const dueRaw = str("returnDueDate");
  if (!dueRaw) {
    return {
      errors: { returnDueDate: "Укажите срок возврата образца" },
      conflict: null,
    };
  }
  const returnDueDate = new Date(`${dueRaw}T23:59:59.999+05:00`);
  const depositRaw = str("depositAmount");
  let depositAmount: number | null = null;
  let depositCurrency: "UZS" | "USD" | null = null;
  if (depositRaw) {
    depositAmount = Number(depositRaw.replace(",", "."));
    const cur = str("depositCurrency");
    depositCurrency = cur === "USD" ? "USD" : "UZS";
  }

  const targetType =
    mode === "SLAB" || mode === "PIECE"
      ? mode
      : mode === "BATCH_VOLUME" || mode === "WHOLE_BATCH" || mode === "PATTERN_VOLUME"
        ? "BATCH_VOLUME"
        : null;
  if (!targetType) {
    return { errors: { form: "Неизвестный тип" }, conflict: null };
  }

  const res = await issueSample({
    targetType,
    unitId: str("unitId") || undefined,
    batchId: str("batchId") || str("batchPatternId") || undefined,
    qtySlabs: str("qtySlabs") ? Number(str("qtySlabs")) : null,
    qtyAreaM2: str("qtyAreaM2")
      ? Number(str("qtyAreaM2").replace(",", "."))
      : null,
    clientId,
    managerId,
    returnDueDate,
    depositAmount,
    depositCurrency,
    comment: str("sampleComment") || null,
    locationNote: str("locationNote") || null,
  });

  if (!res.ok) {
    if (
      res.error.code === "ALREADY_ISSUED" ||
      res.error.code === "UNIT_UNAVAILABLE"
    ) {
      return { errors: {}, conflict: res.error.message };
    }
    return { errors: { form: res.error.message }, conflict: null };
  }

  revalidateSamples();
  redirect(`/obraztsy?ok=issued&id=${res.sampleId}`);
}
