"use server";

// SK-1 — Правка локации партии: server action (TZ §5.7 «отметить/изменить
// локацию»). Чистая логика валидации/дельты — src/lib/locations.ts (kelajakdagi
// bot ham qayta ishlatadi); bu yerda faqat forma razbor, defense-in-depth
// avtorizatsiya, DB-tranzaksiya (update + AuditLog(MOVE)) va xatoni UI ga
// yo'naltirish. Domen o'zgarishi + AuditLog — ОДНОЙ транзакцией (data-model §1.10).
//
// SK-1b — реализовано ниже: addLocation (добавить локацию к партии), moveQty
// (перенос количества A→B в пределах одной партии, с FOR UPDATE замком) и
// updateSlabLocation (локация на уровне плиты). Те же принципы: чистая логика в
// src/lib/locations.ts, defense-in-depth canManageWarehouse, изменение + AuditLog
// одной транзакцией, redirect с ?locOk/?locErr.

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import {
  buildMovePayload,
  isNoopMove,
  validateLocationEdit,
  validateNewLocation,
  validateQtyMove,
  validateSlabLocation,
} from "@/lib/locations";
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
 * SK-1b (1) — Добавить НОВУЮ локацию к партии (TZ §5.7). Складчик заводит ещё
 * одну точку хранения (block/landmark, опционально ~плиты/≈м²/примечание) для
 * существующей партии. Чистая валидация — validateNewLocation; здесь разбор
 * формы, defense-in-depth авторизация и транзакция create + AuditLog(MOVE).
 */
export async function addLocation(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // R2 — DEFENSE-IN-DEPTH (первый оператор): локацию заводит только склад.
  if (!(await getCapabilities()).canManageWarehouse) {
    redirect(`${next}?locErr=${encodeURIComponent("Нет доступа: локацию меняет склад")}`);
  }

  const batchId = String(formData.get("batchId") ?? "").trim();
  if (!batchId) {
    redirect(`${next}?locErr=${encodeURIComponent("Партия не указана")}`);
  }

  const result = validateNewLocation({
    block: String(formData.get("block") ?? ""),
    landmark: String(formData.get("landmark") ?? ""),
    slabsHere: String(formData.get("slabsHere") ?? ""),
    areaHereM2: String(formData.get("areaHereM2") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!result.ok) {
    redirect(`${next}?locErr=${encodeURIComponent(result.error)}`);
  }
  const data = result.data;

  const actorId = (await getCurrentUser())?.id ?? null;

  await db.$transaction(async (tx) => {
    // Партия должна существовать (иначе FK 500 → отдаём дружелюбный locErr).
    const batch = await tx.batch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      redirect(`${next}?locErr=${encodeURIComponent("Партия не найдена — обновите страницу")}`);
    }

    const created = await tx.batchLocation.create({
      data: {
        batchId,
        block: data.block,
        landmark: data.landmark,
        slabsHere: data.slabsHere,
        areaHereM2: data.areaHereM2,
        note: data.note,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "MOVE",
        entityType: "BatchLocation",
        entityId: created.id,
        payload: {
          created: {
            block: data.block,
            landmark: data.landmark,
            slabsHere: data.slabsHere,
            areaHereM2: data.areaHereM2,
            note: data.note,
          },
        } as Prisma.InputJsonValue,
      },
    });
  });

  redirect(`${next}?locOk=1`);
}

/**
 * SK-1b (2) — Перенос количества между двумя локациями ОДНОЙ партии (A→B).
 *
 * REMAINDER-НЕЙТРАЛЬНО: slabsHere/areaHereM2 — физическое распределение, НЕ вход
 * формулы свободного остатка §3 (batch totals − sold − adjusted), поэтому
 * batch-lock ADR-007 здесь не требуется. Но локация не должна уйти в минус под
 * гонкой, поэтому ПЕРВЫМ оператором транзакции берём row-lock FOR UPDATE на обе
 * строки (источник И приёмник) в порядке id — это сериализует параллельные
 * переносы из одного источника (защита от отрицательного slabsHere) и
 * одновременно исключает потерю инкремента у приёмника (lost update), а
 * фиксированный порядок id исключает дедлок при встречных переносах A→B / B→A.
 * (mirror src/lib/batch-lock.ts — tagged-template $queryRaw, bind-параметры.)
 */
export async function moveQty(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // R2 — DEFENSE-IN-DEPTH (первый оператор): перенос делает только склад.
  if (!(await getCapabilities()).canManageWarehouse) {
    redirect(`${next}?locErr=${encodeURIComponent("Нет доступа: локацию меняет склад")}`);
  }

  const sourceId = String(formData.get("sourceLocationId") ?? "").trim();
  const destId = String(formData.get("destLocationId") ?? "").trim();
  if (!sourceId || !destId) {
    redirect(`${next}?locErr=${encodeURIComponent("Укажите источник и приёмник")}`);
  }
  if (sourceId === destId) {
    redirect(`${next}?locErr=${encodeURIComponent("Источник и приёмник совпадают")}`);
  }

  const qtySlabsRaw = String(formData.get("qtySlabs") ?? "");
  const qtyAreaM2Raw = String(formData.get("qtyAreaM2") ?? "");

  const actorId = (await getCurrentUser())?.id ?? null;

  await db.$transaction(async (tx) => {
    // Row-lock FOR UPDATE на обе локации в порядке id (см. док-комментарий выше).
    await tx.$queryRaw`SELECT id FROM "BatchLocation" WHERE id IN (${sourceId}, ${destId}) ORDER BY id FOR UPDATE`;

    // Читаем ПОСЛЕ замка → авторитетное наличие для проверки «не в минус».
    const [source, dest] = await Promise.all([
      tx.batchLocation.findUnique({
        where: { id: sourceId },
        select: { id: true, batchId: true, block: true, landmark: true, slabsHere: true, areaHereM2: true },
      }),
      tx.batchLocation.findUnique({
        where: { id: destId },
        select: { id: true, batchId: true, block: true, landmark: true, slabsHere: true, areaHereM2: true },
      }),
    ]);
    if (!source || !dest) {
      redirect(`${next}?locErr=${encodeURIComponent("Локация не найдена — обновите страницу")}`);
    }
    // Перенос ТОЛЬКО в пределах одной партии (иначе исказится распределение).
    if (source.batchId !== dest.batchId) {
      redirect(`${next}?locErr=${encodeURIComponent("Локации из разных партий")}`);
    }

    const sourceSlabs = source.slabsHere;
    const sourceArea = source.areaHereM2 === null ? null : Number(source.areaHereM2);
    const result = validateQtyMove(
      { qtySlabs: qtySlabsRaw, qtyAreaM2: qtyAreaM2Raw },
      { slabsHere: sourceSlabs, areaHereM2: sourceArea },
    );
    if (!result.ok) {
      redirect(`${next}?locErr=${encodeURIComponent(result.error)}`);
    }
    const { qtySlabs, qtyAreaM2 } = result.data;

    // Считаем новые значения из свежепрочитанных под замком строк. null у
    // приёмника → 0 (появляется количество). Источник не уйдёт в минус —
    // validateQtyMove это уже проверил против прочитанного наличия.
    const destSlabs = dest.slabsHere;
    const destArea = dest.areaHereM2 === null ? null : Number(dest.areaHereM2);

    const sourceUpdate: { slabsHere?: number; areaHereM2?: number } = {};
    const destUpdate: { slabsHere?: number; areaHereM2?: number } = {};
    if (qtySlabs !== null) {
      sourceUpdate.slabsHere = (sourceSlabs ?? 0) - qtySlabs;
      destUpdate.slabsHere = (destSlabs ?? 0) + qtySlabs;
    }
    if (qtyAreaM2 !== null) {
      sourceUpdate.areaHereM2 = (sourceArea ?? 0) - qtyAreaM2;
      destUpdate.areaHereM2 = (destArea ?? 0) + qtyAreaM2;
    }

    await tx.batchLocation.update({ where: { id: sourceId }, data: sourceUpdate });
    await tx.batchLocation.update({ where: { id: destId }, data: destUpdate });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "MOVE",
        entityType: "BatchLocation",
        entityId: sourceId,
        payload: {
          from: { locationId: sourceId, block: source.block, landmark: source.landmark },
          to: { locationId: destId, block: dest.block, landmark: dest.landmark },
          qtySlabs,
          qtyAreaM2,
        } as Prisma.InputJsonValue,
      },
    });
  });

  redirect(`${next}?locOk=1`);
}

/**
 * SK-1b (3) — Правка локации на уровне ПЛИТЫ (Slab): block/landmark. У Slab нет
 * поля note (schema), поэтому валидируем через validateSlabLocation и пишем
 * аудит MOVE с той же delta-структурой buildMovePayload (note всегда null).
 */
export async function updateSlabLocation(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  // R2 — DEFENSE-IN-DEPTH (первый оператор): локацию плиты правит только склад.
  if (!(await getCapabilities()).canManageWarehouse) {
    redirect(`${next}?locErr=${encodeURIComponent("Нет доступа: локацию меняет склад")}`);
  }

  const slabId = String(formData.get("slabId") ?? "").trim();
  if (!slabId) {
    redirect(`${next}?locErr=${encodeURIComponent("Плита не указана")}`);
  }

  const result = validateSlabLocation({
    block: String(formData.get("block") ?? ""),
    landmark: String(formData.get("landmark") ?? ""),
  });
  if (!result.ok) {
    redirect(`${next}?locErr=${encodeURIComponent(result.error)}`);
  }
  const after = result.data;

  const actorId = (await getCurrentUser())?.id ?? null;

  await db.$transaction(async (tx) => {
    const before = await tx.slab.findUnique({
      where: { id: slabId },
      select: { block: true, landmark: true },
    });
    if (!before) {
      redirect(`${next}?locErr=${encodeURIComponent("Плита не найдена — обновите страницу")}`);
    }

    // buildMovePayload переиспользуем с note=null (у Slab note нет).
    const payload = buildMovePayload(
      { block: before.block, landmark: before.landmark, note: null },
      { block: after.block, landmark: after.landmark, note: null },
    );

    // No-op: «Сохранить» без правок → пустая дельта, не трогаем строку/аудит.
    if (isNoopMove(payload)) return;

    await tx.slab.update({
      where: { id: slabId },
      data: { block: after.block, landmark: after.landmark },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "MOVE",
        entityType: "Slab",
        entityId: slabId,
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
