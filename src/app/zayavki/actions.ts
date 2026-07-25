"use server";

// A1 (TZ §6.8) — обработка заявок (лидов) менеджером/владельцем. Логика смены
// статуса — в src/lib/leads.ts; здесь только разбор формы, повторная проверка
// прав на сервере (defense-in-depth, не доверяем гейту страницы) и маршрут
// ошибки в UI.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, requireCapabilityOrRedirect } from "@/lib/session";
import { LeadError, updateLeadStatus } from "@/lib/leads";

/**
 * Гейт заявок + id действующего менеджера. canSeeLeads (OWNER/MANAGER) — иначе
 * отказ ещё ДО записи. Возвращает id, чтобы закрепить его как assignedManager.
 */
async function requireLeadsAccess(): Promise<string> {
  await requireCapabilityOrRedirect("canSeeLeads", "/zayavki?error=denied");
  const me = await getCurrentUser();
  if (!me) redirect("/zayavki?error=denied");
  return me.id;
}

/**
 * Продвинуть заявку по статусу (NEW → CONTACTED → CLOSED) и закрепить текущего
 * менеджера как ответственного. Недопустимый переход/статус/ненайденная заявка →
 * ошибка в баннер.
 */
export async function advanceLead(formData: FormData): Promise<void> {
  const managerId = await requireLeadsAccess();
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) redirect("/zayavki?error=notfound");

  try {
    await updateLeadStatus(db, { id, status, managerId });
  } catch (e) {
    if (e instanceof LeadError) redirect(`/zayavki?error=${e.code}`);
    throw e;
  }

  revalidatePath("/zayavki");
  redirect("/zayavki?ok=updated");
}
