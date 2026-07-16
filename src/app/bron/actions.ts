"use server";

// S2-A — бронь: server actions (TZ §4.4, §6.6). Логика — в src/lib/reservations.ts
// (переиспользуется будущим Telegram-ботом); здесь только разбор формы,
// стаб-авторизация и маршрутизация ошибок в UI.

import { redirect } from "next/navigation";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import {
  ReservationError,
  cancelReservation,
  reserveBatchVolume,
  reserveUnit,
} from "@/lib/reservations";
import { parsePositiveDecimal, parsePositiveInt } from "@/lib/validators/intake";

export interface ReserveFormState {
  errors: Record<string, string>;
}

/**
 * Действующий менеджер = текущий пользователь (getCurrentUser, DEMO-shim R1).
 * По умолчанию демо-роль MANAGER → как и раньше. Правило «бронь снимает только
 * её менеджер или владелец» уже работает в cancelReservation.
 * R1: identity plumbing only; role enforcement — R2+.
 */
async function currentManagerId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

// A7: строгие парсеры из validators/intake — «12,5» плит и «3x» дней больше не
// молча усекаются parseInt-ом до 12/3, а дают ошибку поля (undefined). Пустое →
// null (срок берётся из конфига; количество проверяется отдельно).

export async function createReservation(
  _prev: ReserveFormState,
  formData: FormData,
): Promise<ReserveFormState> {
  // R2 — DEFENSE-IN-DEPTH: бронь доступна OWNER/MANAGER (canReserve). Прямой POST
  // склада/партнёра блокируется на сервере, не только скрытием UI.
  if (!(await getCapabilities()).canReserve) {
    return { errors: { form: "Нет доступа: бронь доступна менеджеру" } };
  }

  const str = (name: string) => String(formData.get(name) ?? "");

  const target = str("target"); // "SLAB:<id>" | "PIECE:<id>" | "BATCH:<id>"
  const customerName = str("customerName");
  const customerContact = str("customerContact").trim() || null;
  const daysRaw = parsePositiveInt(str("days"));

  const errors: Record<string, string> = {};
  const [targetKind, targetId] = target.split(":", 2);
  if (!targetId || !["SLAB", "PIECE", "BATCH"].includes(targetKind)) {
    errors.target = "Выберите камень или объём из партии";
  }
  if (!customerName.trim()) {
    errors.customerName = "Укажите клиента — анонимных броней не бывает";
  }
  if (daysRaw === undefined) {
    errors.days = "Срок — целое число дней";
  }

  let qtySlabs: number | null = null;
  let qtyAreaM2: number | null = null;
  if (targetKind === "BATCH") {
    const qs = parsePositiveInt(str("qtySlabs"));
    const qa = parsePositiveDecimal(str("qtyAreaM2"));
    if (qs === undefined) errors.qtySlabs = "Целое число плит";
    if (qa === undefined) errors.qtyAreaM2 = "Число, например 12,5";
    qtySlabs = qs ?? null;
    qtyAreaM2 = qa ?? null;
    if (qtySlabs === null && qtyAreaM2 === null && !errors.qtySlabs && !errors.qtyAreaM2) {
      errors.qtySlabs = "Укажите количество: плиты и/или м²";
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  const managerId = await currentManagerId();
  if (!managerId) {
    return {
      errors: { form: "Менеджер не найден — выполните заполнение базы (seed)" },
    };
  }

  try {
    if (targetKind === "BATCH") {
      await reserveBatchVolume({
        batchId: targetId,
        qtySlabs,
        qtyAreaM2,
        customerName,
        customerContact,
        days: daysRaw ?? null,
        managerId,
      });
    } else {
      await reserveUnit({
        targetType: targetKind as "SLAB" | "PIECE",
        unitId: targetId,
        customerName,
        customerContact,
        days: daysRaw ?? null,
        managerId,
      });
    }
  } catch (e) {
    if (e instanceof ReservationError) {
      const field =
        e.code === "VALIDATION" && e.message.includes("Срок")
          ? "days"
          : e.code === "VALIDATION" && e.message.includes("клиента")
            ? "customerName"
            : e.code === "VOLUME_EXCEEDED"
              ? "qtySlabs"
              : "form";
      return { errors: { [field]: e.message } };
    }
    throw e;
  }

  redirect("/bron?ok=1");
}

export async function cancelReservationAction(formData: FormData): Promise<void> {
  // R2 — DEFENSE-IN-DEPTH: снятие брони тоже требует canReserve (OWNER/MANAGER).
  if (!(await getCapabilities()).canReserve) {
    redirect(`/bron?err=${encodeURIComponent("Нет доступа: бронь доступна менеджеру")}`);
  }

  const id = String(formData.get("reservationId") ?? "");
  if (!id) redirect("/bron");

  const managerId = await currentManagerId();
  if (!managerId) {
    redirect(`/bron?err=${encodeURIComponent("Менеджер не найден (seed)")}`);
  }

  let errMsg: string | null = null;
  try {
    await cancelReservation(id, managerId);
  } catch (e) {
    if (e instanceof ReservationError) errMsg = e.message;
    else throw e;
  }

  if (errMsg) redirect(`/bron?err=${encodeURIComponent(errMsg)}`);
  redirect("/bron?cancelled=1");
}
