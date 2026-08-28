"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { notifyWarehouseSafe } from "@/lib/shipment-notify-hook";
import {
  sendBatchSlabToShowroom,
  sendToShowroom,
  returnFromShowroom,
  ShowroomError,
} from "@/lib/showroom";
import { sellUnit, type SaleError } from "@/lib/sales";
import { validateSalePayment } from "@/lib/validators/sale-payment";
import { issueSample } from "@/lib/samples";
import { strOf } from "@/lib/form";
import { ensureFormError } from "@/lib/form-errors";

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

// ─────────────── Продажа из шоу-рума (W1-T3) ───────────────
// Раньше «Продать» создавала SaleRecord БЕЗ цены/валюты/оплаты/клиента одним
// кликом — продажа не попадала в выручку (svodka) и долг не открывался. Теперь
// диалог собирает те же поля, что основная форма продажи, и валидация здесь —
// deny-by-default (тот же validateSalePayment, тот же sellUnit-путь: SaleRecord
// + Debt при CREDIT + Shipment + AuditLog + закрытие ShowroomPlacement — одна
// транзакция в src/lib/sales.ts).

export interface ShowroomSellState {
  /** Полевые ошибки (ключ — имя поля); errors.form — общий баннер. */
  errors: Record<string, string>;
  /** Конфликт продажи («уже продан», чужая бронь …) — показывается крупно. */
  conflict: string | null;
}

// Как CONFLICT_CODES в prodazha/actions.ts (не экспортирован оттуда —
// «use server» файлы экспортируют только async-функции).
const SHOWROOM_CONFLICT_CODES: ReadonlySet<SaleError["code"]> = new Set([
  "ALREADY_SOLD",
  "RESERVED_BY_OTHER",
  "CONFLICT",
  "NEEDS_CHECK",
  "INSUFFICIENT_REMAINDER",
  "INVALID_STATUS",
]);

function sellFail(error: SaleError): ShowroomSellState {
  if (SHOWROOM_CONFLICT_CODES.has(error.code)) {
    return { errors: {}, conflict: error.message };
  }
  return { errors: { form: error.message }, conflict: null };
}

function sellFieldFail(errors: Record<string, string>): ShowroomSellState {
  return { errors: ensureFormError(errors), conflict: null };
}

/**
 * Sell from showroom — the SAME code path as a normal sale (sellUnit with the
 * SHOWROOM→SOLD guard): price + currency + payment method + client are
 * REQUIRED, CREDIT opens a Debt with clientId, revenue reaches svodka.
 * useActionState-контракт: на ошибке возвращает состояние (диалог сохраняет
 * введённые значения), на успехе — redirect.
 */
export async function sellFromShowroomAction(
  _prev: ShowroomSellState,
  formData: FormData,
): Promise<ShowroomSellState> {
  // Role gate unchanged: продажа из шоу-рума — canSell (OWNER/MANAGER).
  const caps = await getCapabilities();
  if (!caps.canSell) {
    return sellFieldFail({ form: "Нет доступа: продажа" });
  }
  const actorId = await currentActorId();
  if (!actorId) {
    return sellFieldFail({ form: "Нет пользователя" });
  }

  const str = strOf(formData);
  const targetType = str("targetType");
  const unitId = str("unitId");
  const errors: Record<string, string> = {};
  if (targetType !== "SLAB" && targetType !== "PIECE") {
    errors.form = "Неверный тип камня — обновите страницу";
  } else if (!unitId) {
    errors.form = "Не указан камень — обновите страницу";
  }

  // TZ №9 — способ оплаты, валюта, цена (>0); тот же валидатор, что в
  // основной продаже (строгий money-парсер parseBoundedDecimal).
  const payment = validateSalePayment({
    paymentMethod: str("paymentMethod"),
    currency: str("currency"),
    price: str("price"),
    customerContact: str("customerContact"),
    debtDueDate: str("debtDueDate"),
    debtComment: str("debtComment"),
  });
  if (!payment.ok) {
    Object.assign(errors, payment.errors);
  }

  // TZ №10+11 §6 — клиент из справочника обязателен (не свободный текст).
  const clientId = str("clientId");
  if (!clientId) {
    errors.clientId = "Выберите клиента — найдите в справочнике или создайте нового";
  }

  if (Object.keys(errors).length > 0 || !payment.ok || !clientId) {
    return sellFieldFail(errors);
  }

  // Defense-in-depth: clientId мог быть подделан/устареть — резолвим карточку.
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, phone: true },
  });
  if (!client) {
    return sellFieldFail({
      clientId: "Клиент не найден — выберите или создайте заново",
    });
  }

  const pay = payment.data;
  // Телефон: из формы, иначе с карточки клиента (CREDIT требует телефон).
  const customerContact =
    pay.customerContact?.trim() || client.phone.trim() || null;
  if (pay.paymentMethod === "CREDIT" && !customerContact) {
    return sellFieldFail({
      customerContact: "Для продажи в долг укажите телефон клиента",
    });
  }

  const res = await sellUnit({
    targetType: targetType as "SLAB" | "PIECE",
    unitId,
    customerName: client.name,
    customerContact,
    price: pay.price,
    managerId: actorId,
    paymentMethod: pay.paymentMethod,
    currency: pay.currency,
    debtDueDate: pay.debtDueDate,
    debtComment: pay.debtComment,
    clientId: client.id,
  });
  if (!res.ok) return sellFail(res.error);

  // ТЗ №15 §8.2 — задача на отгрузку создана в той же транзакции; складчика
  // зовём ПОСЛЕ коммита (внешний I/O не откатывает продажу).
  await notifyWarehouseSafe(res.shipmentId, actorId);

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
