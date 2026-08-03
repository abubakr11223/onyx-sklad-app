// TZ №9 / CONTRACT — способ оплаты + цена + валюта на шаге оформления продажи.
// Чистая валидация (без БД): server action и unit-тесты. Имена enum
// (PaymentMethod / Currency) — binding из CONTRACT.md.

import { MAX_DECIMAL_14_2, parseBoundedDecimal } from "@/lib/decimal";

/** CONTRACT: enum PaymentMethod { CASH CARD CREDIT } */
export type PaymentMethod = "CASH" | "CARD" | "CREDIT";

/** CONTRACT: enum Currency { UZS USD } */
export type SaleCurrency = "UZS" | "USD";

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "CASH",
  "CARD",
  "CREDIT",
] as const;

export const SALE_CURRENCIES: readonly SaleCurrency[] = ["UZS", "USD"] as const;

/** Русские подписи для UI (форма / подтверждение). */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Наличные",
  CARD: "Карта",
  CREDIT: "В долг",
};

export const CURRENCY_LABEL: Record<SaleCurrency, string> = {
  UZS: "сум",
  USD: "$",
};

export interface SalePaymentInput {
  /** raw form: CASH | CARD | CREDIT | "" */
  paymentMethod: string;
  /** raw form: UZS | USD | "" */
  currency: string;
  /** raw: «1500» / «12,5» — обязательна, > 0, Decimal(14,2) sale total */
  price: string;
  /** телефон клиента (для CREDIT обязателен) */
  customerContact: string;
  /** «ГГГГ-ММ-ДД» или пусто — только смысл при CREDIT */
  debtDueDate: string;
  /** произвольный текст, только смысл при CREDIT */
  debtComment: string;
}

export interface ValidSalePayment {
  paymentMethod: PaymentMethod;
  currency: SaleCurrency;
  /** Положительное число в пределах Decimal(14,2) (sale total, не unit price). */
  price: number;
  /** null если пусто; для CREDIT — непустая строка. */
  customerContact: string | null;
  /** null если не CREDIT или дата не указана. */
  debtDueDate: Date | null;
  debtComment: string | null;
}

export type SalePaymentErrors = Record<string, string>;

export type SalePaymentResult =
  | { ok: true; data: ValidSalePayment }
  | { ok: false; errors: SalePaymentErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPaymentMethod(s: string): s is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(s);
}

function isCurrency(s: string): s is SaleCurrency {
  return (SALE_CURRENCIES as readonly string[]).includes(s);
}

/**
 * Валидирует блок «Оплата» финального шага продажи (TZ9 §3–4 + CONTRACT).
 *
 * Правила:
 *  - paymentMethod обязателен (CASH | CARD | CREDIT);
 *  - currency обязателен (UZS | USD);
 *  - price обязателен, > 0, ≤ MAX_DECIMAL_14_2 (sale total; catalog unit prices
 *    остаются на MAX_DECIMAL_12_2 / parseMoneyField — не смешивать);
 *  - CREDIT → customerContact обязателен; dueDate/comment опциональны;
 *  - CASH/CARD → contact опционален; dueDate/comment игнорируются (null).
 */
export function validateSalePayment(input: SalePaymentInput): SalePaymentResult {
  const errors: SalePaymentErrors = {};

  const methodRaw = (input.paymentMethod ?? "").trim();
  let paymentMethod: PaymentMethod | null = null;
  if (!methodRaw) {
    errors.paymentMethod = "Выберите способ оплаты";
  } else if (!isPaymentMethod(methodRaw)) {
    errors.paymentMethod = "Неизвестный способ оплаты — обновите страницу";
  } else {
    paymentMethod = methodRaw;
  }

  const currencyRaw = (input.currency ?? "").trim();
  let currency: SaleCurrency | null = null;
  if (!currencyRaw) {
    errors.currency = "Выберите валюту";
  } else if (!isCurrency(currencyRaw)) {
    errors.currency = "Неизвестная валюта — обновите страницу";
  } else {
    currency = currencyRaw;
  }

  // Sale TOTAL: Decimal(14,2), строго > 0. parseBoundedDecimal — единый bounded-
  // парсер (не Number()/parseFloat). B2B so'm totals ~11–12B fit; unit catalog
  // prices still use MAX_DECIMAL_12_2 via parseMoneyField (stone-edit).
  const priceRes = parseBoundedDecimal(input.price ?? "", {
    max: MAX_DECIMAL_14_2,
    allowZero: false,
  });
  let price: number | null = null;
  if (!priceRes.ok) {
    if (priceRes.reason === "overflow") {
      errors.price = "Слишком большая сумма";
    } else if (priceRes.reason === "zero" || priceRes.reason === "negative") {
      errors.price = "Цена должна быть больше нуля";
    } else {
      errors.price = "Цена — положительное число, например 1500 или 12,5";
    }
  } else if (priceRes.value === null) {
    errors.price = "Укажите цену продажи";
  } else {
    price = priceRes.value;
  }

  const contact = (input.customerContact ?? "").trim();
  let customerContact: string | null = contact || null;

  let debtDueDate: Date | null = null;
  let debtComment: string | null = null;

  if (paymentMethod === "CREDIT") {
    if (!contact) {
      errors.customerContact =
        "Для продажи в долг укажите телефон клиента";
    } else {
      customerContact = contact;
    }

    const rawDate = (input.debtDueDate ?? "").trim();
    if (rawDate !== "") {
      if (
        !DATE_RE.test(rawDate) ||
        Number.isNaN(new Date(`${rawDate}T00:00:00`).getTime())
      ) {
        errors.debtDueDate = "Неверная дата (нужен формат ГГГГ-ММ-ДД)";
      } else {
        debtDueDate = new Date(`${rawDate}T00:00:00`);
      }
    }

    const comment = (input.debtComment ?? "").trim();
    debtComment = comment || null;
  }
  // CASH/CARD: dueDate/comment не сохраняем (даже если пришли в форме).

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      paymentMethod: paymentMethod!,
      currency: currency!,
      price: price!,
      customerContact,
      debtDueDate,
      debtComment,
    },
  };
}
