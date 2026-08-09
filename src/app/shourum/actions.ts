"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCapabilities, currentActorId } from "@/lib/session";
import {
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
  const targetType = str("targetType");
  const unitId = str("unitId");
  const standNote = str("standNote");
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
