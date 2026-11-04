// ТЗ №20 E — рейтинг клиентов и продажи по менеджерам: чистая сборка + мок-БД
// (проверяем where-фильтры: возвраты исключены, скоуп менеджера, период).
import { describe, expect, it, vi } from "vitest";
import {
  buildClientRating,
  buildManagerSales,
  loadClientRating,
  loadManagerSales,
  parseRatingCurrency,
  parseRatingPeriodKey,
  parseRatingSort,
  resolveRatingPeriod,
  type SaleGroup,
} from "@/lib/svodka-ratings";

const sg = (
  key: string | null,
  currency: string | null,
  price: string | null,
  area: string | null,
  count: number,
): SaleGroup => ({ key, currency, priceSum: price, areaSum: area, count });

const CLIENTS = [
  { id: "a", name: "Алия", type: "B2C" },
  { id: "b", name: "Бекстрой", type: "B2B" },
  { id: "c", name: "Вали", type: "B2C" },
];

describe("периоды (Asia/Tashkent)", () => {
  const now = new Date("2026-11-03T20:30:00.000Z"); // 4 ноября 01:30 в Ташкенте

  it("этот месяц — по ташкентскому дню, а не UTC", () => {
    const p = resolveRatingPeriod("month", now);
    expect(p.fromISO).toBe("2026-11-01");
    expect(p.toISO).toBe("2026-11-30");
    expect(p.from!.toISOString()).toBe("2026-10-31T19:00:00.000Z");
    expect(p.toExclusive!.toISOString()).toBe("2026-11-30T19:00:00.000Z");
  });

  it("прошлый месяц / квартал / год / всё время", () => {
    expect(resolveRatingPeriod("prev-month", now)).toMatchObject({
      fromISO: "2026-10-01",
      toISO: "2026-10-31",
    });
    expect(resolveRatingPeriod("quarter", now)).toMatchObject({
      fromISO: "2026-10-01",
      toISO: "2026-12-31",
    });
    expect(resolveRatingPeriod("year", now)).toMatchObject({
      fromISO: "2026-01-01",
      toISO: "2026-12-31",
    });
    expect(resolveRatingPeriod("all", now)).toMatchObject({ from: null, toExclusive: null });
  });

  it("прошлый месяц в январе — декабрь прошлого года", () => {
    const p = resolveRatingPeriod("prev-month", new Date("2026-01-10T10:00:00.000Z"));
    expect(p.fromISO).toBe("2025-12-01");
    expect(p.toISO).toBe("2025-12-31");
  });

  it("парсеры с безопасными значениями по умолчанию", () => {
    expect(parseRatingPeriodKey("xxx")).toBe("month");
    expect(parseRatingPeriodKey("year")).toBe("year");
    expect(parseRatingSort("")).toBe("amount");
    expect(parseRatingSort("area")).toBe("area");
    expect(parseRatingCurrency("usd")).toBe("UZS");
    expect(parseRatingCurrency("USD")).toBe("USD");
  });
});

describe("buildClientRating — сортировка и валюты", () => {
  const sales = [
    // a: 5 млн сум, 2 продажи, 10 м²
    sg("a", "UZS", "5000000.00", "10.000", 2),
    // b: 1 млн сум + $900, 4 продажи (3+1), 3,5 м²
    sg("b", "UZS", "1000000.00", "1.500", 3),
    sg("b", "USD", "900.00", "2.000", 1),
    // c: только $1000, 1 продажа, 30 м²
    sg("c", "USD", "1000.00", "30.000", 1),
  ];

  it("по сумме (сум) — по умолчанию; $ в сортировку не подмешивается", () => {
    const r = buildClientRating({ sales, debts: [], clients: CLIENTS, sort: "amount", currency: "UZS" });
    expect(r.map((x) => x.clientId)).toEqual(["a", "b", "c"]);
    expect(r.map((x) => x.place)).toEqual([1, 2, 3]);
    const b = r[1];
    expect(b.sold).toEqual({ UZS: "1000000.00", USD: "900.00" });
    expect(b.saleCount).toBe(4);
    expect(b.areaM2).toBe("3.500");
    expect(b.type).toBe("B2B");
  });

  it("по сумме ($) — внутри выбранной валюты", () => {
    const r = buildClientRating({ sales, debts: [], clients: CLIENTS, sort: "amount", currency: "USD" });
    expect(r.map((x) => x.clientId)).toEqual(["c", "b", "a"]);
  });

  it("по м² и по числу продаж", () => {
    const byArea = buildClientRating({ sales, debts: [], clients: CLIENTS, sort: "area", currency: "UZS" });
    expect(byArea.map((x) => x.clientId)).toEqual(["c", "a", "b"]);
    const byCount = buildClientRating({ sales, debts: [], clients: CLIENTS, sort: "count", currency: "UZS" });
    expect(byCount.map((x) => x.clientId)).toEqual(["b", "a", "c"]);
  });

  it("текущий долг = amount − repaidAmount, раздельно по валютам", () => {
    const r = buildClientRating({
      sales,
      debts: [
        { key: "b", currency: "UZS", amountSum: "600000.00", repaidSum: "100000.00" },
        { key: "b", currency: "USD", amountSum: "300.00", repaidSum: null },
      ],
      clients: CLIENTS,
      sort: "amount",
      currency: "UZS",
    });
    expect(r.find((x) => x.clientId === "b")!.debt).toEqual({ UZS: "500000.00", USD: "300.00" });
    expect(r.find((x) => x.clientId === "a")!.debt).toEqual({ UZS: "0.00", USD: "0.00" });
  });

  it("legacy-продажа без валюты: в счётчик и м², но не в деньги", () => {
    const r = buildClientRating({
      sales: [sg("a", null, null, "2.000", 1), sg("a", "UZS", "100.00", null, 1)],
      debts: [],
      clients: CLIENTS,
      sort: "amount",
      currency: "UZS",
    });
    expect(r[0]).toMatchObject({ saleCount: 2, areaM2: "2.000", sold: { UZS: "100.00", USD: "0.00" } });
  });
});

describe("buildManagerSales — «сумма» и «собрано» различаются", () => {
  const managers = [
    { id: "m1", name: "Азиз", isActive: true },
    { id: "m2", name: "Бобур", isActive: true },
    { id: "m3", name: "Пустой", isActive: true },
  ];

  it("продажа в долг: сумма сразу, собрано — только внесённое; возврат денег вычитается", () => {
    const r = buildManagerSales({
      sales: [sg("m1", "USD", "300.00", "5.000", 1), sg("m2", "UZS", "10000000.00", null, 1)],
      payments: [
        { key: "m1", currency: "USD", kind: "PAYMENT", amountSum: "150.00" },
        { key: "m1", currency: "USD", kind: "REFUND", amountSum: "50.00" },
        { key: "m2", currency: "UZS", kind: "PAYMENT", amountSum: "10000000.00" },
      ],
      debts: [{ key: "m1", currency: "USD", amountSum: "200.00", repaidSum: "50.00" }],
      managers,
    });
    expect(r.map((x) => x.managerId)).toEqual(["m1", "m2"]); // m3 без данных скрыт
    const m1 = r[0];
    expect(m1.sold).toEqual({ UZS: "0.00", USD: "300.00" });
    expect(m1.collected).toEqual({ UZS: "0.00", USD: "100.00" });
    expect(m1.debt).toEqual({ UZS: "0.00", USD: "150.00" });
    expect(m1.areaM2).toBe("5.000");
    expect(r[1].collected.UZS).toBe("10000000.00");
  });

  it("менеджер без продаж за период, но с поступлением по старому долгу — виден", () => {
    const r = buildManagerSales({
      sales: [],
      payments: [{ key: "m2", currency: "UZS", kind: "PAYMENT", amountSum: "500.00" }],
      debts: [],
      managers,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ managerId: "m2", saleCount: 0, collected: { UZS: "500.00" } });
  });
});

describe("loaders — фильтры БД", () => {
  const period = resolveRatingPeriod("month", new Date("2026-11-03T10:00:00.000Z"));

  function fakeDb() {
    return {
      saleRecord: {
        groupBy: vi.fn().mockResolvedValue([
          { clientId: "a", managerId: "m1", currency: "UZS", _sum: { price: "100.00", qtyAreaM2: "1.000" }, _count: { _all: 1 } },
        ]),
      },
      client: { findMany: vi.fn().mockResolvedValue([CLIENTS[0]]) },
      debt: { groupBy: vi.fn().mockResolvedValue([]) },
      payment: {
        groupBy: vi.fn().mockResolvedValue([
          { currency: "UZS", kind: "PAYMENT", _sum: { amount: "40.00" } },
        ]),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "m1", name: "Азиз", isActive: true }]) },
    };
  }

  it("менеджер: только его клиенты (как «Клиенты»), возвраты исключены, период", async () => {
    const db = fakeDb();
    const rows = await loadClientRating(db as never, {
      period,
      sort: "amount",
      currency: "UZS",
      canSeeAllClients: false,
      actorId: "m1",
    });
    expect(rows).toHaveLength(1);
    const where = db.saleRecord.groupBy.mock.calls[0][0].where;
    expect(where.returnedAt).toBeNull();
    expect(where.client).toEqual({ managerId: "m1" });
    expect(where.soldAt).toEqual({ gte: period.from, lt: period.toExclusive });
    expect(db.debt.groupBy.mock.calls[0][0].where).toEqual({
      status: "ACTIVE",
      clientId: { in: ["a"] },
    });
  });

  it("владелец: без фильтра по менеджеру; «всё время» — без фильтра по дате", async () => {
    const db = fakeDb();
    await loadClientRating(db as never, {
      period: resolveRatingPeriod("all"),
      sort: "amount",
      currency: "UZS",
      canSeeAllClients: true,
      actorId: "owner",
    });
    const where = db.saleRecord.groupBy.mock.calls[0][0].where;
    expect(where.client).toBeUndefined();
    expect(where.soldAt).toBeUndefined();
  });

  it("менеджер без actorId ничего чужого не видит", async () => {
    const db = fakeDb();
    await loadClientRating(db as never, {
      period,
      sort: "amount",
      currency: "UZS",
      canSeeAllClients: false,
      actorId: null,
    });
    expect(db.saleRecord.groupBy.mock.calls[0][0].where.client).toEqual({
      managerId: "__no_actor__",
    });
  });

  it("по менеджерам: платежи по paidAt и менеджеру ПРОДАЖИ; долг — ACTIVE", async () => {
    const db = fakeDb();
    const rows = await loadManagerSales(db as never, { period });
    expect(rows[0]).toMatchObject({
      managerId: "m1",
      saleCount: 1,
      sold: { UZS: "100.00" },
      collected: { UZS: "40.00" },
    });
    expect(db.saleRecord.groupBy.mock.calls[0][0].where.returnedAt).toBeNull();
    expect(db.payment.groupBy.mock.calls[0][0].where).toEqual({
      saleRecord: { managerId: "m1" },
      paidAt: { gte: period.from, lt: period.toExclusive },
    });
    expect(db.debt.groupBy.mock.calls[0][0].where).toEqual({
      status: "ACTIVE",
      saleRecord: { managerId: "m1" },
    });
  });
});
