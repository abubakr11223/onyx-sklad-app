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
import {
  buildCheckPayload,
  isValidCheckEntity,
  parseCheckValue,
  type CheckEntity,
} from "@/lib/checks";

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

/**
 * SK-2 — Ручная пометка «проверить» (пересорт): server action. TZ, обработка
 * ошибок «Камень нашли, но по факту его нет → помечается «проверить»». Складчик
 * вручную ставит/снимает needsCheck на партии/плите/обрезке, когда физически
 * обнаружил расхождение — это независимый toggle, НЕ трогает авто-пометку из
 * логики продажи/брони (src/lib/sales.ts, reservations.ts). Чистая логика
 * (allowlist/payload) — src/lib/checks.ts; здесь только разбор формы,
 * defense-in-depth авторизация и транзакция update + AuditLog(STATUS_CHANGE).
 *
 * Track B (ОТЛОЖЕНО): пометка со стороны менеджера (canManageWarehouse=false).
 * Пока переключает только склад (OWNER/WAREHOUSE); остальные видят read-only.
 */
export async function setNeedsCheck(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // R2 — DEFENSE-IN-DEPTH (первый оператор): пометку ставит только склад
  // (canManageWarehouse: OWNER/WAREHOUSE). Сайт открыт («kodsiz»), поэтому
  // прямой POST от менеджера/партнёра блокируется на сервере, а не только UI.
  if (!(await getCapabilities()).canManageWarehouse) {
    redirect(`${next}?checkErr=${encodeURIComponent("Нет доступа: отметку ставит склад")}`);
  }

  const entityTypeRaw = String(formData.get("entityType") ?? "").trim();
  if (!isValidCheckEntity(entityTypeRaw)) {
    redirect(`${next}?checkErr=${encodeURIComponent("Неизвестный объект")}`);
  }
  const entityType: CheckEntity = entityTypeRaw;

  const entityId = String(formData.get("entityId") ?? "").trim();
  if (!entityId) {
    redirect(`${next}?checkErr=${encodeURIComponent("Объект не указан")}`);
  }

  // Желаемое новое значение (скрытое поле несёт ПРОТИВОПОЛОЖНОЕ текущему).
  const after = parseCheckValue(formData.get("value"));

  // Действующий пользователь — ДО транзакции (как actorId в locations/priemka).
  // userId в AuditLog nullable → пустая база не ломает пометку.
  const actorId = (await getCurrentUser())?.id ?? null;

  await db.$transaction(async (tx) => {
    // Делегат Prisma по типу сущности — маленький type-safe switch. Каждая
    // ветвь: load текущего needsCheck (404 → checkErr), update. Схема поля
    // одинакова у Batch/Slab/Piece, но делегаты разнотипны, поэтому ветвим.
    const loadBefore = async (): Promise<boolean | null> => {
      switch (entityType) {
        case "Batch": {
          const row = await tx.batch.findUnique({
            where: { id: entityId },
            select: { needsCheck: true },
          });
          return row?.needsCheck ?? null;
        }
        case "Slab": {
          const row = await tx.slab.findUnique({
            where: { id: entityId },
            select: { needsCheck: true },
          });
          return row?.needsCheck ?? null;
        }
        case "Piece": {
          const row = await tx.piece.findUnique({
            where: { id: entityId },
            select: { needsCheck: true },
          });
          return row?.needsCheck ?? null;
        }
      }
    };

    const before = await loadBefore();
    if (before === null) {
      // 404: транзакция откатится, наружу — дружелюбный checkErr (не throw).
      redirect(`${next}?checkErr=${encodeURIComponent("Объект не найден — обновите страницу")}`);
    }

    // No-op: значение уже такое (двойной клик / гонка) → не трогаем строку и НЕ
    // пишем аудит STATUS_CHANGE, чтобы не засорять журнал. Тихо «успешно».
    if (before === after) return;

    switch (entityType) {
      case "Batch":
        await tx.batch.update({ where: { id: entityId }, data: { needsCheck: after } });
        break;
      case "Slab":
        await tx.slab.update({ where: { id: entityId }, data: { needsCheck: after } });
        break;
      case "Piece":
        await tx.piece.update({ where: { id: entityId }, data: { needsCheck: after } });
        break;
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "STATUS_CHANGE",
        entityType,
        entityId,
        // buildCheckPayload — sof Record; Prisma Json input tipiga keltiramiz.
        payload: buildCheckPayload(entityType, before, after) as Prisma.InputJsonValue,
      },
    });
  });

  redirect(`${next}?checkOk=1`);
}
