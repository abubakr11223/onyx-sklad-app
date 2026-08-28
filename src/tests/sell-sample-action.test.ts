// W1-T2 — sellSampleAction: цена образца парсится ТОЙ ЖЕ функцией и с той же
// семантикой, что у главной формы продажи (validateSalePayment →
// parseBoundedDecimal, MAX_DECIMAL_14_2). Регрессия: раньше
// Number("1,500".replace(",", ".")) → 1.5 — занижение суммы в 1000×,
// утекало в сводку и долги. Домен sellSample замокан (паттерн
// issue-sample-action.test.ts): проверяем контракт ACTION.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const sellSample = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
  throw err;
});

vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));

vi.mock("@/lib/samples", () => ({
  issueSample: vi.fn(),
  returnSample: vi.fn(),
  extendSampleDueDate: vi.fn(),
  sellSample: (...a: unknown[]) => sellSample(...a),
}));

vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...(a as [string])),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

import { sellSampleAction } from "@/app/obraztsy/actions";
import {
  emptySellSampleState,
  validateSellSampleFields,
} from "@/app/obraztsy/sell-sample-state";
import { validateSalePayment } from "@/lib/validators/sale-payment";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const prev = emptySellSampleState();

function sellFd(over: Record<string, string> = {}): FormData {
  return fd({
    sampleId: "samp1",
    price: "1500",
    currency: "UZS",
    paymentMethod: "CASH",
    ...over,
  });
}

beforeEach(() => {
  getCapabilities.mockReset();
  currentActorId.mockReset();
  sellSample.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
  getCapabilities.mockResolvedValue({ canSell: true });
  currentActorId.mockResolvedValue("mgr1");
  sellSample.mockResolvedValue({ ok: true, saleId: "sale1" });
});

describe("sellSampleAction — happy path (сумма сохраняется без искажения)", () => {
  it("«1500» UZS CASH → sellSample получает ровно 1500 и redirect ok=sold", async () => {
    await expect(
      sellSampleAction(prev, sellFd({ price: "1500" })),
    ).rejects.toThrow("NEXT_REDIRECT:/obraztsy?ok=sold");
    expect(sellSample).toHaveBeenCalledTimes(1);
    expect(sellSample).toHaveBeenCalledWith({
      sampleId: "samp1",
      managerId: "mgr1",
      price: 1500,
      paymentMethod: "CASH",
      currency: "UZS",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/obraztsy");
  });

  it("«1500.50» → 1500.5 (точка — десятичный разделитель)", async () => {
    await expect(
      sellSampleAction(prev, sellFd({ price: "1500.50" })),
    ).rejects.toThrow("NEXT_REDIRECT:/obraztsy?ok=sold");
    expect(sellSample.mock.calls[0][0]).toMatchObject({ price: 1500.5 });
  });

  it("«1500,50» → 1500.5 (запятая = десятичный разделитель, как в SaleForm)", async () => {
    await expect(
      sellSampleAction(prev, sellFd({ price: "1500,50" })),
    ).rejects.toThrow("NEXT_REDIRECT:/obraztsy?ok=sold");
    expect(sellSample.mock.calls[0][0]).toMatchObject({ price: 1500.5 });
  });

  it("«1,500» → 1.5 — ровно как в главной форме (запятая НЕ разделитель тысяч)", async () => {
    // Семантика общего парсера: запятая — десятичный разделитель.
    // Группировку «1 500 000» снимает клиентский money-input ДО отправки.
    const main = validateSalePayment({
      paymentMethod: "CASH",
      currency: "UZS",
      price: "1,500",
      customerContact: "",
      debtDueDate: "",
      debtComment: "",
    });
    expect(main.ok && main.data.price).toBe(1.5);
    await expect(
      sellSampleAction(prev, sellFd({ price: "1,500" })),
    ).rejects.toThrow("NEXT_REDIRECT:/obraztsy?ok=sold");
    expect(sellSample.mock.calls[0][0]).toMatchObject({ price: 1.5 });
  });
});

describe("sellSampleAction — отказ валидации (форма не молчит, домен не зовётся)", () => {
  async function expectPriceRejected(price: string, msg?: string) {
    const state = await sellSampleAction(prev, sellFd({ price }));
    expect(state.errors.price).toBeTruthy();
    if (msg) expect(state.errors.price).toBe(msg);
    expect(state.errors.form).toBeTruthy(); // никогда не field-only silence
    expect(sellSample).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  }

  it("«1 500» (пробел-группировка в POST) — отклоняется, как в главной форме", async () => {
    const main = validateSalePayment({
      paymentMethod: "CASH",
      currency: "UZS",
      price: "1 500",
      customerContact: "",
      debtDueDate: "",
      debtComment: "",
    });
    expect(main.ok).toBe(false);
    await expectPriceRejected(
      "1 500",
      "Цена — положительное число, например 1500 или 12,5",
    );
  });

  it("пусто → «Укажите цену продажи»", async () => {
    await expectPriceRejected("", "Укажите цену продажи");
  });

  it("«0» → «Цена должна быть больше нуля»", async () => {
    await expectPriceRejected("0", "Цена должна быть больше нуля");
  });

  it("отрицательное «-5» — отклоняется", async () => {
    await expectPriceRejected("-5");
  });

  it("мусор «abc» — отклоняется", async () => {
    await expectPriceRejected("abc");
  });

  it("переполнение Decimal(14,2) → «Слишком большая сумма»", async () => {
    await expectPriceRejected("100000000000000", "Слишком большая сумма");
  });

  it("валюта пустая → ошибка, НЕ тихий дефолт в UZS", async () => {
    const state = await sellSampleAction(prev, sellFd({ currency: "" }));
    expect(state.errors.currency).toBe("Выберите валюту");
    expect(sellSample).not.toHaveBeenCalled();
  });

  it("валюта «EUR» → ошибка, НЕ тихая замена на UZS", async () => {
    const state = await sellSampleAction(prev, sellFd({ currency: "EUR" }));
    expect(state.errors.currency).toBe(
      "Неизвестная валюта — обновите страницу",
    );
    expect(sellSample).not.toHaveBeenCalled();
  });

  it("способ оплаты пустой/чужой → ошибка, НЕ тихий CASH", async () => {
    let state = await sellSampleAction(prev, sellFd({ paymentMethod: "" }));
    expect(state.errors.paymentMethod).toBe("Выберите способ оплаты");
    state = await sellSampleAction(prev, sellFd({ paymentMethod: "WIRE" }));
    expect(state.errors.paymentMethod).toBe(
      "Неизвестный способ оплаты — обновите страницу",
    );
    expect(sellSample).not.toHaveBeenCalled();
  });

  it("нет доступа → errors.form, домен не зовётся", async () => {
    getCapabilities.mockResolvedValue({ canSell: false });
    const state = await sellSampleAction(prev, sellFd());
    expect(state.errors.form).toBeTruthy();
    expect(sellSample).not.toHaveBeenCalled();
  });

  it("домен NOT_ACTIVE → conflict-сообщение (образец уже закрыт)", async () => {
    sellSample.mockResolvedValue({
      ok: false,
      error: { code: "NOT_ACTIVE", message: "Образец уже закрыт" },
    });
    const state = await sellSampleAction(prev, sellFd());
    expect(state.conflict).toBe("Образец уже закрыт");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("validateSellSampleFields ≡ validateSalePayment (parity цены)", () => {
  const CASES = [
    "1,500",
    "1 500",
    "1500.50",
    "1500,50",
    "",
    "0",
    "-5",
    "abc",
    "1500",
    "12,5",
    "999999999999.99",
    "1000000000000",
  ];

  it.each(CASES)("price=%j — тот же вердикт и значение, что у главной формы", (price) => {
    const sample = validateSellSampleFields({
      price,
      currency: "UZS",
      paymentMethod: "CASH",
    });
    const main = validateSalePayment({
      paymentMethod: "CASH",
      currency: "UZS",
      price,
      customerContact: "",
      debtDueDate: "",
      debtComment: "",
    });
    expect(sample.ok).toBe(main.ok);
    if (sample.ok && main.ok) {
      expect(sample.data.price).toBe(main.data.price);
    } else if (!sample.ok && !main.ok) {
      expect(sample.errors.price).toBe(main.errors.price);
    }
  });
});
