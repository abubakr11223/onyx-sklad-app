"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { confirmShipment, ShipmentError } from "@/lib/shipments";
import { attachShipmentFactPhoto } from "@/lib/shipment-photo";
import { putPhotoBlob } from "@/lib/photo-blob";
import { strOf } from "@/lib/form";

/** ТЗ №15 §3.3/§8.1 — фото факта отгрузки. Тот же предел, что у фото узора. */
const MAX_FACT_PHOTO_BYTES = 15 * 1024 * 1024;

export async function confirmShipmentAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canConfirmShipment) {
    redirect(
      "/otgruzki?err=" +
        encodeURIComponent("Нет доступа: отгрузку подтверждает склад"),
    );
  }
  const actorId = await currentActorId();
  if (!actorId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Нет пользователя"));
  }
  const str = strOf(formData);
  const shipmentId = str("shipmentId");
  if (!shipmentId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Не указана отгрузка"));
  }
  const qtySlabsRaw = str("qtySlabs");
  const qtyAreaRaw = str("qtyAreaM2");
  const qtySlabs = qtySlabsRaw
    ? Number(qtySlabsRaw.replace(/\s/g, ""))
    : null;
  const qtyAreaM2 = qtyAreaRaw
    ? Number(qtyAreaRaw.replace(/\s/g, "").replace(",", "."))
    : null;

  // ТЗ №15 §3.3/§8.1 — «фото факта отгрузки: что именно выдали». Грузим в Blob
  // ДО доменной транзакции (сеть), как это уже сделано для фото узора в
  // приёмке. Пустой input — обычный случай: фото желательно, а не обязательно.
  const file = formData.get("factPhoto");
  let photoStorageKey: string | null = null;
  let photoWarn: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith("image/")) {
      photoWarn = "Фото отгрузки — только изображение, отгрузка записана без него";
    } else if (file.size > MAX_FACT_PHOTO_BYTES) {
      photoWarn = "Фото отгрузки слишком большое (макс. 15 МБ), отгрузка записана без него";
    } else {
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const { storageKey } = await putPhotoBlob({
          pathPrefix: `shipments/${shipmentId}/${Date.now()}`,
          bytes: buf,
          mediaType: file.type || "image/jpeg",
        });
        photoStorageKey = storageKey;
      } catch {
        photoWarn = "Не удалось загрузить фото, отгрузка записана без него";
      }
    }
  }

  try {
    await confirmShipment({
      shipmentId,
      actorId,
      qtySlabs,
      qtyAreaM2,
      // ТЗ №19 C1 — строка задачи (узор · место), которую отмечает складчик.
      lineId: str("lineId") || null,
    });
  } catch (e) {
    const msg =
      e instanceof ShipmentError
        ? e.message
        : "Не удалось подтвердить отгрузку";
    redirect("/otgruzki?err=" + encodeURIComponent(msg));
  }

  // Фото цепляем ПОСЛЕ подтверждения и никогда не роняем им отгрузку: камень
  // уже физически выдан, откатывать факт из-за картинки нельзя. Неудача
  // становится предупреждением в баннере, а не ошибкой.
  if (photoStorageKey) {
    try {
      await attachShipmentFactPhoto(
        { shipmentId, storageKey: photoStorageKey, takenById: actorId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deps описаны структурно; PrismaClient шире контракта
        { db: db as any },
      );
    } catch {
      photoWarn = "Отгрузка записана, но фото приложить не удалось";
    }
  }

  revalidatePath("/otgruzki");
  revalidatePath("/prodazha");
  const q = new URLSearchParams({ ok: "shipped" });
  if (photoWarn) q.set("warn", photoWarn);
  redirect(`/otgruzki?${q.toString()}`);
}

/**
 * ТЗ №15 §8.5 — пометить задачу срочной / снять пометку.
 *
 * Ставит тот, кто оформил (менеджер) или владелец: срочность — это сообщение
 * «клиент ждёт», и решает его тот, кто говорит с клиентом. Складчик пометку
 * видит, но не меняет — иначе очередь перестанет что-либо значить.
 */
export async function toggleShipmentUrgentAction(
  formData: FormData,
): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSell) {
    redirect("/otgruzki?err=" + encodeURIComponent("Срочность отмечает менеджер"));
  }
  const actorId = await currentActorId();
  if (!actorId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Нет пользователя"));
  }

  const shipmentId = String(formData.get("shipmentId") ?? "").trim();
  const next = String(formData.get("urgent") ?? "") === "1";
  if (!shipmentId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Не указана отгрузка"));
  }

  // Менеджер меняет только свои задачи; владелец — любые.
  const where = caps.canSeeAllClients
    ? { id: shipmentId }
    : { id: shipmentId, managerId: actorId };
  const res = await db.shipment.updateMany({ where, data: { isUrgent: next } });
  if (res.count === 0) {
    redirect("/otgruzki?err=" + encodeURIComponent("Отгрузка не найдена"));
  }

  revalidatePath("/otgruzki");
  redirect("/otgruzki?ok=urgent");
}

/**
 * ТЗ №20 B — менеджер меняет плановую дату / способ отгрузки после продажи
 * (свои продажи; владелец — любые). Изменение пишется в «Историю».
 */
export async function updateShipmentPlanAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  const actorId = await currentActorId();
  if (!caps.canSell || !actorId) {
    redirect("/otgruzki?err=" + encodeURIComponent("Дату отгрузки меняет менеджер"));
  }
  const shipmentId = String(formData.get("shipmentId") ?? "").trim();
  const date = String(formData.get("plannedDate") ?? "").trim();
  const time = String(formData.get("plannedTime") ?? "").trim();
  const modeRaw = String(formData.get("deliveryMode") ?? "");
  let plannedAt: Date | null = null;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) {
      redirect("/otgruzki?err=" + encodeURIComponent("Неверная дата или время"));
    }
    plannedAt = new Date(`${date}T${time || "00:00"}:00+05:00`);
  }
  const deliveryMode = modeRaw === "PICKUP" || modeRaw === "DELIVERY" ? modeRaw : null;
  const where = caps.canSeeAllClients
    ? { id: shipmentId }
    : { id: shipmentId, managerId: actorId! };
  const before = await db.shipment.findFirst({
    where,
    select: { id: true, plannedAt: true, plannedHasTime: true, deliveryMode: true },
  });
  if (!before) {
    redirect("/otgruzki?err=" + encodeURIComponent("Отгрузка не найдена"));
  }
  await db.$transaction([
    db.shipment.update({
      where: { id: before!.id },
      data: { plannedAt, plannedHasTime: Boolean(plannedAt && time), deliveryMode },
    }),
    db.auditLog.create({
      data: {
        userId: actorId!,
        action: "ADJUSTMENT",
        entityType: "Shipment",
        entityId: before!.id,
        payload: {
          kind: "shipment.plan",
          changes: [
            { field: "plannedAt", old: before!.plannedAt?.toISOString() ?? null, new: plannedAt?.toISOString() ?? null },
            { field: "deliveryMode", old: before!.deliveryMode, new: deliveryMode },
          ],
        },
      },
    }),
  ]);
  revalidatePath("/otgruzki");
  redirect("/otgruzki?ok=plan");
}
