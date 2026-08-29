// W3-T1 — значения полей брони как единое состояние формы.
//
// React 19: <form action={…}> сбрасывает НЕуправляемые поля после каждого
// вызова экшена — включая отказ по валидации. Менеджер терял имя клиента,
// контакт, количество и срок, хотя бронь не создалась. Проверенный в проекте
// паттерн (SaleForm / IntakeForm / SellSampleForm): управляемые поля +
// useActionState, значения живут в React-состоянии и переживают отказ.
//
// Здесь — чистая часть решения (без React), поэтому тестируется отдельно.

import type { ReserveFormState } from "./actions";

export interface ReserveValues {
  customerName: string;
  customerContact: string;
  days: string;
  qtySlabs: string;
  qtyAreaM2: string;
}

export const emptyReserveValues = (): ReserveValues => ({
  customerName: "",
  customerContact: "",
  days: "",
  qtySlabs: "",
  qtyAreaM2: "",
});

/** Отказ = экшен вернул хотя бы одну ошибку (ensureFormError гарантирует form). */
export function reserveFailed(state: ReserveFormState): boolean {
  return Object.keys(state.errors).length > 0;
}

/**
 * Что показывать в полях после ответа сервера:
 * отказ → ровно то, что менеджер уже ввёл (ничего не теряем);
 * успех → чистая форма (осознанный сброс, а не побочный эффект React).
 *
 * На успехе экшен делает redirect("/bron?ok=1") — баннер «Бронь оформлена»
 * рисует страница по ответу сервера, форма сама успех не празднует.
 */
export function nextReserveValues(
  prev: ReserveValues,
  state: ReserveFormState,
): ReserveValues {
  return reserveFailed(state) ? prev : emptyReserveValues();
}
