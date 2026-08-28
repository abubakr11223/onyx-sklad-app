// W1-T3 — «Продать из шоу-рума» больше не создаёт SaleRecord одним кликом без
// цены/валюты/оплаты/клиента. Диалог отправляет те же поля, что основная
// продажа; здесь — deny-by-default валидация action'а: без цены / способа
// оплаты / клиента продажа НЕ доходит до sellUnit, а на успехе уходит той же
// доменной функцией (sellUnit — SHOWROOM→SOLD guard, svodka, Debt, история).
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const sellUnit = vi.fn();
const notifyWarehouseSafe = vi.fn();
const revalidatePath = vi.fn();
const clientFindUnique = vi.fn();

class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));
vi.mock("@/lib/shipment-notify-hook", () => ({
  notifyWarehouseSafe: (...a: unknown[]) => notifyWarehouseSafe(...a),
}));
vi.mock("@/lib/showroom", () => ({
  sendToShowroom: vi.fn(),
  sendBatchSlabToShowroom: vi.fn(),
  returnFromShowroom: vi.fn(),
  ShowroomError: class extends Error {},
}));
vi.mock("@/lib/sales", () => ({
  sellUnit: (...a: unknown[]) => sellUnit(...a),
}));
vi.mock("@/lib/samples", () => ({ issueSample: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) } },
}));

import {
  sellFromShowroomAction,
  type ShowroomSellState,
} from "@/app/shourum/actions";

const prev: ShowroomSellState = { errors: {}, conflict: null };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Полный валидный набор полей (CASH / сум) — тесты убирают по одному. */
const VALID = {
  targetType: "SLAB",
  unitId: "slab1",
  clientId: "cl1",
  price: "1500000",
  currency: "UZS",
  paymentMethod: "CASH",
  customerContact: "",
  debtDueDate: "",
  debtComment: "",
};

async function run(
  fields: Record<string, string>,
): Promise<{ state: ShowroomSellState | null; redirect: string | null }> {
  try {
    const state = await sellFromShowroomAction(prev, fd(fields));
    return { state, redirect: null };
  } catch (e) {
    if (e instanceof RedirectError) return { state: null, redirect: e.url };
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getCapabilities.mockResolvedValue({ canSell: true });
  currentActorId.mockResolvedValue("mgr1");
  clientFindUnique.mockResolvedValue({
    id: "cl1",
    name: "Иван Петров",
    phone: "+998901112233",
  });
  sellUnit.mockResolvedValue({
    ok: true,
    saleId: "sale1",
    unitId: "slab1",
    viaReservation: false,
    completedReservationId: null,
    shipmentId: "ship1",
  });
});

describe("deny-by-default: без обязательных полей продажа не создаётся", () => {
  it("без цены → errors.price, sellUnit НЕ вызывается", async () => {
    const { state, redirect } = await run({ ...VALID, price: "" });
    expect(redirect).toBeNull();
    expect(state!.errors.price).toBeTruthy();
    expect(state!.errors.form).toBeTruthy(); // second net
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("цена с внутренним пробелом («1 500») → отказ строгого парсера", async () => {
    const { state } = await run({ ...VALID, price: "1 500" });
    expect(state!.errors.price).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("цена 0 → отказ (строго > 0)", async () => {
    const { state } = await run({ ...VALID, price: "0" });
    expect(state!.errors.price).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("без способа оплаты → errors.paymentMethod", async () => {
    const { state } = await run({ ...VALID, paymentMethod: "" });
    expect(state!.errors.paymentMethod).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("без валюты → errors.currency", async () => {
    const { state } = await run({ ...VALID, currency: "" });
    expect(state!.errors.currency).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("неизвестная валюта (EUR) → отказ — только UZS или USD, смешивания нет", async () => {
    const { state } = await run({ ...VALID, currency: "EUR" });
    expect(state!.errors.currency).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("без клиента → errors.clientId", async () => {
    const { state } = await run({ ...VALID, clientId: "" });
    expect(state!.errors.clientId).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
    expect(clientFindUnique).not.toHaveBeenCalled();
  });

  it("clientId не из справочника (подделан/устарел) → errors.clientId", async () => {
    clientFindUnique.mockResolvedValue(null);
    const { state } = await run(VALID);
    expect(state!.errors.clientId).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("CREDIT без телефона (ни в форме, ни на карточке) → errors.customerContact", async () => {
    clientFindUnique.mockResolvedValue({
      id: "cl1",
      name: "Без телефона",
      phone: "  ",
    });
    const { state } = await run({ ...VALID, paymentMethod: "CREDIT" });
    expect(state!.errors.customerContact).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });

  it("несколько пропусков сразу → все полевые ошибки в одном состоянии", async () => {
    const { state } = await run({
      ...VALID,
      price: "",
      paymentMethod: "",
      clientId: "",
    });
    expect(state!.errors.price).toBeTruthy();
    expect(state!.errors.paymentMethod).toBeTruthy();
    expect(state!.errors.clientId).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });
});

describe("happy path — тот же доменный путь, что обычная продажа", () => {
  it("CASH: sellUnit получает цену/валюту/оплату/клиента, затем redirect", async () => {
    const { redirect } = await run(VALID);
    expect(redirect).toBe("/shourum?ok=sold");
    expect(sellUnit).toHaveBeenCalledTimes(1);
    expect(sellUnit).toHaveBeenCalledWith({
      targetType: "SLAB",
      unitId: "slab1",
      customerName: "Иван Петров",
      customerContact: "+998901112233", // с карточки клиента
      price: 1500000,
      managerId: "mgr1",
      paymentMethod: "CASH",
      currency: "UZS",
      debtDueDate: null,
      debtComment: null,
      clientId: "cl1",
    });
    // ТЗ №15 §8.2 — складчик зовётся ПОСЛЕ коммита по shipmentId транзакции.
    expect(notifyWarehouseSafe).toHaveBeenCalledWith("ship1", "mgr1");
    expect(revalidatePath).toHaveBeenCalledWith("/shourum");
    expect(revalidatePath).toHaveBeenCalledWith("/prodazha");
  });

  it("CREDIT: способ/валюта/срок уходят в sellUnit (Debt откроется в той же транзакции)", async () => {
    const { redirect } = await run({
      ...VALID,
      paymentMethod: "CREDIT",
      currency: "USD",
      price: "2500.5",
      // Диалог шлёт телефон выбранного клиента скрытым полем (как SaleForm).
      customerContact: "+998901112233",
      debtDueDate: "2026-09-15",
      debtComment: "до середины сентября",
    });
    expect(redirect).toBe("/shourum?ok=sold");
    const arg = sellUnit.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.paymentMethod).toBe("CREDIT");
    expect(arg.currency).toBe("USD");
    expect(arg.price).toBe(2500.5);
    expect(arg.clientId).toBe("cl1");
    expect(arg.debtDueDate).toBeInstanceOf(Date);
    expect(arg.debtComment).toBe("до середины сентября");
  });

  it("PIECE тоже продаётся через диалог", async () => {
    await run({ ...VALID, targetType: "PIECE", unitId: "piece9" });
    expect(sellUnit).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "PIECE", unitId: "piece9" }),
    );
  });
});

describe("отказ домена и доступ", () => {
  it("конфликт («уже продан») → state.conflict, БЕЗ redirect и уведомления", async () => {
    sellUnit.mockResolvedValue({
      ok: false,
      error: { code: "ALREADY_SOLD", message: "Камень уже продан" },
    });
    const { state, redirect } = await run(VALID);
    expect(redirect).toBeNull();
    expect(state!.conflict).toBe("Камень уже продан");
    expect(notifyWarehouseSafe).not.toHaveBeenCalled();
  });

  it("обычная доменная ошибка → errors.form (диалог сохраняет значения)", async () => {
    sellUnit.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Камень не найден" },
    });
    const { state, redirect } = await run(VALID);
    expect(redirect).toBeNull();
    expect(state!.errors.form).toBe("Камень не найден");
  });

  it("роль без canSell → отказ до всего остального (гейт не расширен)", async () => {
    getCapabilities.mockResolvedValue({ canSell: false });
    const { state, redirect } = await run(VALID);
    expect(redirect).toBeNull();
    expect(state!.errors.form).toContain("Нет доступа");
    expect(sellUnit).not.toHaveBeenCalled();
    expect(clientFindUnique).not.toHaveBeenCalled();
  });

  it("мусорный targetType → отказ до sellUnit", async () => {
    const { state } = await run({ ...VALID, targetType: "BATCH" });
    expect(state!.errors.form).toBeTruthy();
    expect(sellUnit).not.toHaveBeenCalled();
  });
});
