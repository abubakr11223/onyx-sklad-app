"use server";

// SK-1 — Правка локации партии: server action (TZ §5.7 «отметить/изменить
// локацию»). Чистая логика валидации/дельты — src/lib/locations.ts (kelajakdagi
// bot ham qayta ishlatadi); bu yerda faqat forma razbor, defense-in-depth
// avtorizatsiya, DB-tranzaksiya (update + AuditLog(MOVE)) va xatoni UI ga
// yo'naltirish. Domen o'zgarishi + AuditLog — ОДНОЙ транзакцией (data-model §1.10).
//
// SK-1b (ОТЛОЖЕНО): добавление новой локации, перенос количества между
// локациями, локация на уровне плиты — здесь НЕ реализуется.

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import { buildMovePayload, isNoopMove, validateLocationEdit } from "@/lib/locations";

/**
 * Куда вернуться после правки. По умолчанию /poisk (как и в poisk/actions).
 * Защита от open-redirect: путь локальный (начинается с «/», но не «//» и не
 * «/\» — иначе браузер трактует как внешний хост).
 */
function safeNext(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) {
    return "/poisk";
  }
  return s;
}

export async function updateLocation(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // R2 — DEFENSE-IN-DEPTH (первый оператор): править локацию может только склад
  // (canManageWarehouse: OWNER/WAREHOUSE). Сайт открыт («kodsiz»), поэтому прямой
  // POST от менеджера/партнёра блокируется на сервере, а не только скрытием UI.
  if (!(await getCapabilities()).canManageWarehouse) {
    redirect(`${next}?locErr=${encodeURIComponent("Нет доступа: локацию меняет склад")}`);
  }

  const locationId = String(formData.get("locationId") ?? "").trim();
  if (!locationId) {
    redirect(`${next}?locErr=${encodeURIComponent("Локация не указана")}`);
  }

  const result = validateLocationEdit({
    block: String(formData.get("block") ?? ""),
    landmark: String(formData.get("landmark") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!result.ok) {
    redirect(`${next}?locErr=${encodeURIComponent(result.error)}`);
  }
  const after = result.data;

  // Действующий пользователь — ДО транзакции (как actorId в priemka).
  // userId в AuditLog nullable → пустая база не ломает правку.
  const actorId = (await getCurrentUser())?.id ?? null;

  await db.$transaction(async (tx) => {
    const before = await tx.batchLocation.findUnique({
      where: { id: locationId },
      select: { block: true, landmark: true, note: true },
    });
    if (!before) {
      // 404: транзакция откатится, наружу — дружелюбный locErr (не throw).
      redirect(`${next}?locErr=${encodeURIComponent("Локация не найдена — обновите страницу")}`);
    }

    const payload = buildMovePayload(
      { block: before.block, landmark: before.landmark, note: before.note },
      after,
    );

    // No-op: «Сохранить» без реальных правок → пустая дельта. Не трогаем строку
    // и НЕ пишем аудит MOVE, чтобы не засорять журнал пустыми записями. Сохранение
    // тихо «успешно» (fall through к locOk=1).
    if (isNoopMove(payload)) return;

    await tx.batchLocation.update({
      where: { id: locationId },
      data: { block: after.block, landmark: after.landmark, note: after.note },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "MOVE",
        entityType: "BatchLocation",
        entityId: locationId,
        // buildMovePayload — sof Record; Prisma Json input tipiga keltiramiz.
        payload: payload as Prisma.InputJsonValue,
      },
    });
  });

  redirect(`${next}?locOk=1`);
}
