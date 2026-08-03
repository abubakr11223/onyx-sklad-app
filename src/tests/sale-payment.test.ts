// TZ9-A — чистый валидатор блока «Оплата» (src/lib/validators/sale-payment.ts).
// Без БД. Стиль — как intake.test.ts: ветка → ожидаемое сообщение / data.

import { describe, expect, it } from "vitest";
import { MAX_DECIMAL_12_2, MAX_DECIMAL_14_2 } from "@/lib/decimal";
import {
  validateSalePayment,
  type SalePaymentInput,
} from "@/lib/validators/sale-payment";

function base(overrides: Partial<SalePaymentInput> = {}): SalePaymentInput {
  return {
    paymentMethod: "CASH",
    currency: "UZS",
    price: "1500",
    customerContact: "",
    debtDueDate: "",
    debtComment: "",
    ...overrides,
  };
}

describe("validateSalePayment — happy paths", () => {
  it("CASH + UZS + цена → ok, contact null", () => {
    const r = validateSalePayment(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      paymentMethod: "CASH",
      currency: "UZS",
      price: 1500,
      customerContact: null,
      debtDueDate: null,
      debtComment: null,
    });
  });

  it("CARD + USD + цена с запятой → ok", () => {
    const r = validateSalePayment(
      base({ paymentMethod: "CARD", currency: "USD", price: "12,50" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.paymentMethod).toBe("CARD");
    expect(r.data.currency).toBe("USD");
    expect(r.data.price).toBe(12.5);
  });

  it("CREDIT + телефон + без срока/коммента → ok", () => {
    const r = validateSalePayment(
      base({
        paymentMethod: "CREDIT",
        customerContact: "+998 90 123-45-67",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.paymentMethod).toBe("CREDIT");
    expect(r.data.customerContact).toBe("+998 90 123-45-67");
    expect(r.data.debtDueDate).toBeNull();
    expect(r.data.debtComment).toBeNull();
  });

  it("CREDIT + телефон + срок + комментарий → ok", () => {
    const r = validateSalePayment(
      base({
        paymentMethod: "CREDIT",
        currency: "USD",
        price: "5000",
        customerContact: "901234567",
        debtDueDate: "2026-09-01",
        debtComment: "  доставка  ",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.currency).toBe("USD");
    expect(r.data.debtDueDate).toEqual(new Date("2026-09-01T00:00:00"));
    expect(r.data.debtComment).toBe("доставка");
  });

  it("обе валюты принимаются (CONTRACT: UZS | USD)", () => {
    expect(validateSalePayment(base({ currency: "UZS" })).ok).toBe(true);
    expect(validateSalePayment(base({ currency: "USD" })).ok).toBe(true);
  });
});

describe("validateSalePayment — paymentMethod", () => {
  it("пустой способ → ошибка", () => {
    const r = validateSalePayment(base({ paymentMethod: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.paymentMethod).toBe("Выберите способ оплаты");
  });

  it("неизвестный способ → ошибка", () => {
    const r = validateSalePayment(base({ paymentMethod: "WIRE" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.paymentMethod).toMatch(/Неизвестный способ/);
  });
});

describe("validateSalePayment — price", () => {
  it("пустая цена → ошибка", () => {
    const r = validateSalePayment(base({ price: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.price).toBe("Укажите цену продажи");
  });

  it("ноль → отклоняется", () => {
    const r = validateSalePayment(base({ price: "0" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.price).toBe("Цена должна быть больше нуля");
  });

  it("отрицательная → отклоняется", () => {
    const r = validateSalePayment(base({ price: "-10" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // parseBoundedDecimal: «-10» fails not_number (regex) or negative
    expect(r.errors.price).toBeTruthy();
  });

  it("мусор / scientific → отклоняется", () => {
    expect(validateSalePayment(base({ price: "abc" })).ok).toBe(false);
    expect(validateSalePayment(base({ price: "1e3" })).ok).toBe(false);
  });

  it("переполнение Decimal(14,2) → «Слишком большая сумма»", () => {
    // Just over the sale-total ceiling (o1 widened SaleRecord.price to 14,2).
    const r = validateSalePayment(
      base({ price: String(MAX_DECIMAL_14_2 + 1) }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.price).toBe("Слишком большая сумма");
  });

  it("граница MAX_DECIMAL_14_2 проходит (sale total ceiling)", () => {
    const r = validateSalePayment(
      base({ price: String(MAX_DECIMAL_14_2) }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.price).toBe(MAX_DECIMAL_14_2);
  });

  it("B2B so'm totals that overflowed Decimal(12,2) now pass (o1 arithmetic)", () => {
    // 1500 m² × $600 × 12_500 UZS = 11_250_000_000 — was over 12,2 (~10B).
    expect(
      validateSalePayment(base({ price: "11250000000", currency: "UZS" })).ok,
    ).toBe(true);
    // 2000 m² × $500 × 12_500 UZS = 12_500_000_000.
    expect(
      validateSalePayment(base({ price: "12500000000", currency: "UZS" })).ok,
    ).toBe(true);
    // Still above old 12,2 unit ceiling is fine for a *sale total*.
    expect(
      validateSalePayment(base({ price: String(MAX_DECIMAL_12_2 + 1) })).ok,
    ).toBe(true);
  });
});

describe("validateSalePayment — currency", () => {
  it("пустая валюта → ошибка", () => {
    const r = validateSalePayment(base({ currency: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.currency).toBe("Выберите валюту");
  });

  it("неизвестная валюта → ошибка", () => {
    const r = validateSalePayment(base({ currency: "EUR" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.currency).toMatch(/Неизвестная валюта/);
  });
});

describe("validateSalePayment — CREDIT phone rules", () => {
  it("CREDIT без телефона → ошибка customerContact", () => {
    const r = validateSalePayment(
      base({ paymentMethod: "CREDIT", customerContact: "  " }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.customerContact).toBe(
      "Для продажи в долг укажите телефон клиента",
    );
  });

  it("CASH без телефона → ok (телефон необязателен)", () => {
    const r = validateSalePayment(
      base({ paymentMethod: "CASH", customerContact: "" }),
    );
    expect(r.ok).toBe(true);
  });

  it("CARD без телефона → ok", () => {
    expect(
      validateSalePayment(base({ paymentMethod: "CARD", customerContact: "" }))
        .ok,
    ).toBe(true);
  });

  it("CREDIT с телефоном → ok", () => {
    const r = validateSalePayment(
      base({
        paymentMethod: "CREDIT",
        customerContact: "998901234567",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.customerContact).toBe("998901234567");
  });
});

describe("validateSalePayment — debt optional fields", () => {
  it("неверная дата срока → ошибка", () => {
    const r = validateSalePayment(
      base({
        paymentMethod: "CREDIT",
        customerContact: "90",
        debtDueDate: "32-13-2026",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.debtDueDate).toMatch(/Неверная дата/);
  });

  it("CASH: dueDate/comment из формы игнорируются (null в data)", () => {
    const r = validateSalePayment(
      base({
        paymentMethod: "CASH",
        debtDueDate: "2026-09-01",
        debtComment: "не должен сохраниться",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.debtDueDate).toBeNull();
    expect(r.data.debtComment).toBeNull();
  });
});

describe("validateSalePayment — несколько ошибок сразу", () => {
  it("нет способа и нет цены → оба ключа", () => {
    const r = validateSalePayment(
      base({ paymentMethod: "", price: "" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.paymentMethod).toBeTruthy();
    expect(r.errors.price).toBeTruthy();
  });
});
