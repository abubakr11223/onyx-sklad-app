// Plain module (NO "use server") — state + чистая валидация для sellSampleAction.
// Next.js: every export from a "use server" file must be an async function,
// поэтому тип состояния и синхронный валидатор живут здесь (как issue-sample-state).
//
// W1-T2: раньше цена парсилась Number(raw.replace(",", ".")) — «1,500» → 1.5
// (занижение в 1000×, утекало в сводку и долги). Теперь ровно те же функция и
// семантика, что у главной формы продажи (validators/sale-payment.ts):
// parseBoundedDecimal + MAX_DECIMAL_14_2, allowZero:false. Запятая — десятичный
// разделитель («12,5» = 12.5), внутренние пробелы отклоняются («1 500» — ошибка;
// группировку убирает клиентский money-input ДО отправки, как в SaleForm).
// Тексты ошибок скопированы 1:1 из validateSalePayment — parity закреплён тестом.

import { MAX_DECIMAL_14_2, parseBoundedDecimal } from "@/lib/decimal";
import {
  PAYMENT_METHODS,
  SALE_CURRENCIES,
  type PaymentMethod,
  type SaleCurrency,
} from "@/lib/validators/sale-payment";

/** State shape for useActionState(sellSampleAction) — same contract as issue-sample. */
export type SellSampleFormState = {
  errors: Record<string, string>;
  conflict: string | null;
};

/** Initial / empty state for useActionState — sync helper, not a Server Action. */
export function emptySellSampleState(): SellSampleFormState {
  return { errors: {}, conflict: null };
}

export interface SellSampleFieldsInput {
  /** raw form: «1500» / «12,5» — обязательна, > 0, Decimal(14,2) */
  price: string;
  /** raw form: UZS | USD | "" — обязательна, БЕЗ тихого дефолта */
  currency: string;
  /** raw form: CASH | CARD | CREDIT | "" — обязателен, БЕЗ тихого дефолта */
  paymentMethod: string;
}

export type ValidSellSampleFields = {
  price: number;
  currency: SaleCurrency;
  paymentMethod: PaymentMethod;
};

export type SellSampleFieldsResult =
  | { ok: true; data: ValidSellSampleFields }
  | { ok: false; errors: Record<string, string> };

/**
 * Валидирует поля «Оформить продажу» образца. Семантика = validateSalePayment
 * (не переиспользуем его целиком: там CREDIT требует customerContact из формы,
 * а у образца телефон клиента проверяет sellSample по справочнику).
 */
export function validateSellSampleFields(
  input: SellSampleFieldsInput,
): SellSampleFieldsResult {
  const errors: Record<string, string> = {};

  const methodRaw = (input.paymentMethod ?? "").trim();
  let paymentMethod: PaymentMethod | null = null;
  if (!methodRaw) {
    errors.paymentMethod = "Выберите способ оплаты";
  } else if (!(PAYMENT_METHODS as readonly string[]).includes(methodRaw)) {
    errors.paymentMethod = "Неизвестный способ оплаты — обновите страницу";
  } else {
    paymentMethod = methodRaw as PaymentMethod;
  }

  const currencyRaw = (input.currency ?? "").trim();
  let currency: SaleCurrency | null = null;
  if (!currencyRaw) {
    errors.currency = "Выберите валюту";
  } else if (!(SALE_CURRENCIES as readonly string[]).includes(currencyRaw)) {
    errors.currency = "Неизвестная валюта — обновите страницу";
  } else {
    currency = currencyRaw as SaleCurrency;
  }

  // Sale TOTAL: Decimal(14,2), строго > 0 — единый bounded-парсер
  // (НЕ Number()/parseFloat), тот же вызов, что в validateSalePayment.
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

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      price: price!,
      currency: currency!,
      paymentMethod: paymentMethod!,
    },
  };
}
