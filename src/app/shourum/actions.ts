"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCapabilities, currentActorId } from "@/lib/session";
import { notifyWarehouseSafe } from "@/lib/shipment-notify-hook";
import {
  sendBatchSlabToShowroom,
  sendToShowroom,
  returnFromShowroom,
  ShowroomError,
} from "@/lib/showroom";
import { sellUnit } from "@/lib/sales";
import { issueSample } from "@/lib/samples";
import { strOf } from "@/lib/form";

function redir(err: string): never {
  redirect("/shourum?err=" + encodeURIComponent(err));
}

export async function sendToShowroomAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSendToShowroom) {
    redir("Нет доступа: отправить в шоу-рум");
  }
  const actorId = await currentActorId();
  if (!actorId) redir("Нет пользователя");
  const str = strOf(formData);
  const standNote = str("standNote");

  // ТЗ №16 §4 — три источника: из партии / готовая плита / бой-остаток.
  // «Из партии» — основной путь: на складе поимённых плит почти нет, камень
  // лежит партиями (ADR-004), и раньше витрине было нечего показывать.
  const source = str("source") || "UNIT";

  if (source === "BATCH") {
    const batchId = str("batchId");
    if (!batchId) redir("Не выбрана партия");
    const qtyRaw = str("qty").trim();
    const qty = qtyRaw === "" ? 1 : Number(qtyRaw.replace(",", "."));
    if (!Number.isInteger(qty) || qty < 1) {
      redir("Сколько плит — целое число от 1");
    }

    const res = await sendBatchSlabToShowroom({
      batchId,
      qty,
      actorId,
      standNote: standNote || null,
    });
    if (!res.ok) redir(res.error.message);

    // Каждая плита — своя задача складчику (ТЗ №15 §5.1/§8.2).
    for (const s of res.slabs) {
      await notifyWarehouseSafe(s.shipmentId, actorId);
    }

    revalidatePath("/shourum");
    revalidatePath("/otgruzki");
    revalidatePath("/poisk");
    revalidatePath("/prodazha");
    revalidatePath("/razbit");
    redirect("/shourum?ok=sent");
  }

  // Единица приходит либо парой полей (быстрые кнопки из списка наличия),
  // либо одним значением «SLAB:<id>» из выпадающего списка.
  //
  // Раньше select слал только `unitPick`, а действие читало targetType/unitId —
  // их никто не заполнял, и форма всегда падала в «Неверный тип камня». В
  // подсказке под формой это было описано как ожидаемое поведение. Разбираем
  // значение здесь.
  const pick = str("unitPick");
  const [pickType, pickId] = pick.includes(":")
    ? (pick.split(":", 2) as [string, string])
    : ["", ""];
  const targetType = str("targetType") || pickType;
  const unitId = str("unitId") || pickId;
  if (targetType !== "SLAB" && targetType !== "PIECE") {
    redir("Неверный тип камня");
  }
  if (!unitId) redir("Не указан камень");

  const res = await sendToShowroom({
    targetType,
    unitId,
    actorId,
    standNote: standNote || null,
  });
  if (!res.ok) redir(res.error.message);

  // ТЗ №15 §5.1/§8.2 — «Создаётся задача на отгрузку типа „Шоу-рум" →
  // складчик физически переносит и подтверждает». Зовём его после коммита.
  await notifyWarehouseSafe(res.shipmentId, actorId);

  revalidatePath("/shourum");
  revalidatePath("/otgruzki");
  revalidatePath("/poisk");
  revalidatePath("/prodazha");
  redirect("/shourum?ok=sent");
}

export async function returnFromShowroomAction(
  formData: FormData,
): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSeeShowroom) {
    redir("Нет доступа");
  }
  const actorId = await currentActorId();
  if (!actorId) redir("Нет пользователя");
  const str = strOf(formData);
  const targetType = str("targetType");
  const unitId = str("unitId");
  if (targetType !== "SLAB" && targetType !== "PIECE") {
    redir("Неверный тип");
  }
  if (!unitId) redir("Не указан камень");

  const res = await returnFromShowroom({
    targetType,
    unitId,
    actorId,
  });
  if (!res.ok) redir(res.error.message);
  revalidatePath("/shourum");
  revalidatePath("/otgruzki");
  revalidatePath("/poisk");
  redirect("/shourum?ok=returned");
}

/** Sell from showroom — ordinary sellUnit with SHOWROOM→SOLD guard. */
export async function sellFromShowroomAction(
  formData: FormData,
): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSell) redir("Нет доступа: продажа");
  const actorId = await currentActorId();
  if (!actorId) redir("Нет пользователя");
  const str = strOf(formData);
  const targetType = str("targetType");
  const unitId = str("unitId");
  const customerName = str("customerName") || "Клиент шоу-рума";
  if (targetType !== "SLAB" && targetType !== "PIECE") {
    redir("Неверный тип");
  }
  if (!unitId) redir("Не указан камень");

  const res = await sellUnit({
    targetType,
    unitId,
    customerName,
    managerId: actorId,
  });
  if (!res.ok) redir(res.error.message);
  revalidatePath("/shourum");
  revalidatePath("/prodazha");
  revalidatePath("/otgruzki");
  redirect("/shourum?ok=sold");
}

/** Issue sample from showroom unit. */
export async function sampleFromShowroomAction(
  formData: FormData,
): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSell) redir("Нет доступа: образец");
  const actorId = await currentActorId();
  if (!actorId) redir("Нет пользователя");
  const str = strOf(formData);
  const targetType = str("targetType");
  const unitId = str("unitId");
  const clientId = str("clientId");
  const dueRaw = str("returnDueDate");
  if (targetType !== "SLAB" && targetType !== "PIECE") {
    redir("Неверный тип");
  }
  if (!unitId || !clientId || !dueRaw) {
    redir("Укажите камень, клиента и срок возврата");
  }
  const returnDueDate = new Date(dueRaw);
  if (Number.isNaN(returnDueDate.getTime())) {
    redir("Неверная дата возврата");
  }

  const res = await issueSample({
    targetType,
    unitId,
    clientId,
    managerId: actorId,
    returnDueDate,
  });
  if (!res.ok) redir(res.error.message);
  revalidatePath("/shourum");
  revalidatePath("/obraztsy");
  revalidatePath("/otgruzki");
  redirect("/shourum?ok=sampled");
}

// Avoid unused import warning if tree-shaken oddly
void ShowroomError;
