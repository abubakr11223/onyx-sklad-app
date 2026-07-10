"use server";

// S2-A — бронь: server actions (TZ §4.4, §6.6). Логика — в src/lib/reservations.ts
// (переиспользуется будущим Telegram-ботом); здесь только разбор формы,
// стаб-авторизация и маршрутизация ошибок в UI.

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  ReservationError,
  cancelReservation,
  reserveBatchVolume,
  reserveUnit,
} from "@/lib/reservations";

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

function parseIntField(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** «12,5» и «12.5» — оба валидны (менеджер вводит с телефона). */
function parseDecimalField(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

export async function createReservation(
  _prev: ReserveFormState,
  formData: FormData,
): Promise<ReserveFormState> {
  const str = (name: string) => String(formData.get(name) ?? "");

  const target = str("target"); // "SLAB:<id>" | "PIECE:<id>" | "BATCH:<id>"
  const customerName = str("customerName");
  const customerContact = str("customerContact").trim() || null;
  const daysRaw = parseIntField(str("days"));

  const errors: Record<string, string> = {};
  const [targetKind, targetId] = target.split(":", 2);
  if (!targetId || !["SLAB", "PIECE", "BATCH"].includes(targetKind)) {
    errors.target = "Выберите камень или объём из партии";
  }
  if (!customerName.trim()) {
    errors.customerName = "Укажите клиента — анонимных броней не бывает";
  }
  if (Number.isNaN(daysRaw)) {
    errors.days = "Срок — целое число дней";
  }

  let qtySlabs: number | null = null;
  let qtyAreaM2: number | null = null;
  if (targetKind === "BATCH") {
    qtySlabs = parseIntField(str("qtySlabs"));
    qtyAreaM2 = parseDecimalField(str("qtyAreaM2"));
    if (Number.isNaN(qtySlabs)) errors.qtySlabs = "Целое число плит";
    if (Number.isNaN(qtyAreaM2)) errors.qtyAreaM2 = "Число, например 12,5";
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
        days: daysRaw,
        managerId,
      });
    } else {
      await reserveUnit({
        targetType: targetKind as "SLAB" | "PIECE",
        unitId: targetId,
        customerName,
        customerContact,
        days: daysRaw,
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
