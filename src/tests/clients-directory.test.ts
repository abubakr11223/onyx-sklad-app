// TZ №10+11 Этап 3 — итоги клиента/объекта, возврат, scope (pure, no DB).
import { describe, expect, it } from "vitest";
import {
  canAccessDirectoryRecord,
  debtTotalsFromDebts,
  formatVolumeLine,
  isActiveSale,
  purchaseTotalsFromSales,
  volumeTotalsFromSales,
  type SaleTotRow,
} from "@/lib/clients-directory";

function sale(over: Partial<SaleTotRow> = {}): SaleTotRow {
  return {
    returnedAt: over.returnedAt === undefined ? null : over.returnedAt,
    price: over.price ?? "100",
    currency: over.currency ?? "UZS",
    qtySlabs: over.qtySlabs ?? null,
    qtyAreaM2: over.qtyAreaM2 ?? null,
  };
}

describe("purchaseTotalsFromSales — per currency, no mix", () => {
  it("sums UZS and USD as separate lines", () => {
    const totals = purchaseTotalsFromSales([
      sale({ price: "1000000", currency: "UZS" }),
      sale({ price: "50.5", currency: "USD" }),
      sale({ price: "500000", currency: "UZS" }),
      sale({ price: "10", currency: "USD" }),
    ]);
    expect(totals).toEqual([
      { currency: "UZS", amount: "1500000.00", count: 2 },
      { currency: "USD", amount: "60.50", count: 2 },
    ]);
  });

  it("returned sale is excluded from «итого куплено»", () => {
    const before = purchaseTotalsFromSales([
      sale({ price: "200", currency: "USD" }),
      sale({ price: "100", currency: "USD" }),
    ]);
    expect(before).toEqual([{ currency: "USD", amount: "300.00", count: 2 }]);

    // Simulate return: one sale gets returnedAt
    const after = purchaseTotalsFromSales([
      sale({ price: "200", currency: "USD" }),
      sale({
        price: "100",
        currency: "USD",
        returnedAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ]);
    expect(after).toEqual([{ currency: "USD", amount: "200.00", count: 1 }]);
    // Totals decreased after return
    expect(Number(after[0].amount)).toBeLessThan(Number(before[0].amount));
  });

  it("legacy sale without price/currency skipped", () => {
    const totals = purchaseTotalsFromSales([
      { returnedAt: null, price: null, currency: null, qtySlabs: 1, qtyAreaM2: null },
      sale({ price: "10", currency: "UZS" }),
    ]);
    expect(totals).toEqual([{ currency: "UZS", amount: "10.00", count: 1 }]);
  });

  it("empty / all-returned → empty totals (not zero mixed)", () => {
    expect(purchaseTotalsFromSales([])).toEqual([]);
    expect(
      purchaseTotalsFromSales([
        sale({
          price: "99",
          currency: "UZS",
          returnedAt: new Date(),
        }),
      ]),
    ).toEqual([]);
  });
});

describe("volumeTotalsFromSales — object card volume", () => {
  it("sums slabs and m² from active sales only", () => {
    const v = volumeTotalsFromSales([
      sale({ qtySlabs: 2, qtyAreaM2: "10.5", price: "1", currency: "UZS" }),
      sale({ qtySlabs: 1, qtyAreaM2: "2.25", price: "1", currency: "UZS" }),
      sale({
        qtySlabs: 5,
        qtyAreaM2: "100",
        price: "1",
        currency: "UZS",
        returnedAt: new Date(),
      }),
    ]);
    expect(v.qtySlabs).toBe(3);
    expect(v.qtyAreaM2).toBe("12.750");
    expect(v.saleCount).toBe(2);
  });

  it("sale without object (no qty) still counts sale, zero volume ok", () => {
    const v = volumeTotalsFromSales([
      sale({ qtySlabs: null, qtyAreaM2: null, price: "500", currency: "USD" }),
    ]);
    expect(v.saleCount).toBe(1);
    expect(v.qtySlabs).toBe(0);
    expect(v.qtyAreaM2).toBe("0.000");
  });
});

describe("debtTotalsFromDebts", () => {
  it("only ACTIVE, per currency", () => {
    const t = debtTotalsFromDebts([
      { status: "ACTIVE", amount: "100", currency: "USD" },
      { status: "REPAID", amount: "999", currency: "USD" },
      { status: "ACTIVE", amount: "50", currency: "UZS" },
      { status: "CANCELLED", amount: "10", currency: "UZS" },
    ]);
    expect(t).toEqual([
      { currency: "UZS", amount: "50.00", count: 1 },
      { currency: "USD", amount: "100.00", count: 1 },
    ]);
  });
});

describe("canAccessDirectoryRecord — manager scope", () => {
  it("owner (canSeeAll) sees any manager's client", () => {
    expect(
      canAccessDirectoryRecord({
        canSeeAllClients: true,
        actorId: "owner",
        recordManagerId: "mgr-other",
      }),
    ).toBe(true);
  });

  it("manager does not see another manager's client", () => {
    expect(
      canAccessDirectoryRecord({
        canSeeAllClients: false,
        actorId: "mgr-1",
        recordManagerId: "mgr-2",
      }),
    ).toBe(false);
  });

  it("manager sees own client", () => {
    expect(
      canAccessDirectoryRecord({
        canSeeAllClients: false,
        actorId: "mgr-1",
        recordManagerId: "mgr-1",
      }),
    ).toBe(true);
  });

  it("no actor → deny", () => {
    expect(
      canAccessDirectoryRecord({
        canSeeAllClients: false,
        actorId: null,
        recordManagerId: "mgr-1",
      }),
    ).toBe(false);
  });
});

describe("isActiveSale / formatVolumeLine", () => {
  it("isActiveSale mirrors returnedAt null", () => {
    expect(isActiveSale({ returnedAt: null })).toBe(true);
    expect(isActiveSale({ returnedAt: new Date() })).toBe(false);
  });

  it("formatVolumeLine builds RU volume string", () => {
    expect(formatVolumeLine({ qtySlabs: 3, qtyAreaM2: "12.5" })).toMatch(/3 плит/);
    expect(formatVolumeLine({ qtySlabs: 0, qtyAreaM2: "0.000" })).toBeNull();
  });
});
