"use server";

// A1 (TZ §6.8) — «Запросить объём»: server action партнёрского запроса. Логика
// создания лида — в src/lib/leads.ts (переиспользуема ботом/менеджером); здесь
// только разбор формы, авторизация (только PARTNER-флоу) и маршрут ошибки в UI.
//
// Каждый запрос → Lead(NEW) для менеджера, поэтому «ни один интерес не теряется»
// (§6.8.5). Живём в отдельном файле рядом с page.tsx: страница — Server Component
// (не "use server"-модуль), а server action должен быть в "use server"-файле.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, requireCapabilityOrRedirect } from "@/lib/session";
import { createLead } from "@/lib/leads";
import { notifyPartnerLeadSafe, parseVolumeRequest } from "@/lib/partners";
import { normalizeStoneCode } from "@/lib/stone-code";
import { sendMessage } from "@/lib/telegram";

/**
 * Куда вернуться. По умолчанию /poisk. Защита от open-redirect: путь должен быть
 * локальным (та же проверка, что в poisk/actions.ts).
 */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) {
    return "/poisk";
  }
  return s;
}

export async function requestLead(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // Авторизация: «Запросить объём» — партнёрский флоу (requestsRouteToManager =
  // только PARTNER). OWNER/MANAGER продают напрямую и лидов не создают. Прямой
  // POST от другой роли блокируется на сервере, не только скрытием формы.
  await requireCapabilityOrRedirect(
    "requestsRouteToManager",
    `${next}?leadErr=denied#zayavka`,
  );

  const me = await getCurrentUser();
  if (!me) {
    redirect(
      `${next}?leadErr=denied#zayavka`,
    );
  }

  const stoneTypeId = String(formData.get("stoneTypeId") ?? "").trim() || null;

  // N1: stoneTypeId опционален (интерес может быть без конкретного камня), но
  // если задан — камень должен существовать. Иначе createLead упрётся в FK
  // (P2003) и упадёт 500 на подделанном POST. Проверяем заранее — как
  // validateNewAccount: нет камня → ошибка поля, не краш.
  if (stoneTypeId) {
    const exists = await db.stoneType.findUnique({
      where: { id: stoneTypeId },
      select: { id: true },
    });
    if (!exists) {
      redirect(`${next}?leadErr=stone#zayavka`);
    }
  }

  // ТЗ №20 L (§13.2) — «Заявка на объём»: объём обязателен (плиты или м²),
  // объект текстом, срок, комментарий.
  const parsed = parseVolumeRequest({
    requestedSlabs: String(formData.get("requestedSlabs") ?? ""),
    requestedAreaM2: String(formData.get("requestedAreaM2") ?? ""),
    siteText: String(formData.get("siteText") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.ok) {
    redirect(`${next}?leadErr=${parsed.error}#zayavka`);
  }
  const v = parsed.value;
  const contact = String(formData.get("contact") ?? "").trim().slice(0, 200) || null;
  // Код с карточки (/k/ONX-…) — только формат кода, иначе не сохраняем.
  const stoneCode = normalizeStoneCode(String(formData.get("stoneCode") ?? "")) ?? null;

  const lead = await db.$transaction(async (tx) => {
    const created = await createLead(tx, {
      createdById: me.id,
      stoneTypeId,
      kind: "REQUEST",
      requestedSlabs: v.requestedSlabs,
      requestedAreaM2: v.requestedAreaM2,
      contact,
      note: v.note,
      siteText: v.siteText,
      dueDate: v.dueDate,
      stoneCode,
    });
    // «История»: заявка партнёра (§15 «… и заявки — в Истории»).
    await tx.auditLog.create({
      data: {
        userId: me.id,
        action: "LEAD_CREATE",
        entityType: "Lead",
        entityId: created.id,
        payload: {
          stoneTypeId,
          stoneCode,
          requestedSlabs: v.requestedSlabs,
          requestedAreaM2: v.requestedAreaM2,
          siteText: v.siteText,
          dueDate: v.dueDate?.toISOString() ?? null,
        },
      },
    });
    return created;
  });

  // Закреплённому менеджеру (или всем) — после коммита; сбой не роняет заявку.
  await notifyPartnerLeadSafe(db, sendMessage, lead.id);

  redirect(`${next}?lead=ok#zayavka`);
}
