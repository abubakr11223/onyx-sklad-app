// TZ №9 Part B — pure UI helpers (no DB). Currency never combined.
import { describe, expect, it } from "vitest";
import {
  applyKeysetPage,
  centsToDecimalString,
  decimalStringToCents,
  formatCurrencySummaryLine,
  formatDebtMoney,
  formatDebtPurchase,
  formatRevenueByMethod,
  groupDebtsByClient,
  isOverdueAtBoundary,
} from "@/lib/debts-ui";
import type { CurrencyMoney, DebtListItem } from "@/lib/debts";

const NOW = new Date("2026-08-03T12:00:00.000Z");

function item(over: Partial<DebtListItem> & { id: string }): DebtListItem {
  return {
    id: over.id,
    saleRecordId: over.saleRecordId ?? `sale-${over.id}`,
    amount: over.amount ?? "1000.00",
    currency: over.currency ?? "UZS",
    status: over.status ?? "ACTIVE",
    dueDate: over.dueDate ?? null,
    comment: over.comment ?? null,
    repaidAt: over.repaidAt ?? null,
    repaidAmount: over.repaidAmount ?? null,
    createdAt: over.createdAt ?? NOW,
    overdue: over.overdue ?? false,
    sale: over.sale ?? {
      customerName: "Клиент",
      customerContact: "+998",
      soldAt: NOW,
      price: "1000.00",
      targetType: "SLAB",
      qtySlabs: 1,
      qtyAreaM2: null,
      managerId: "m1",
      managerName: "Менеджер",
    },
  };
}

describe("formatCurrencySummaryLine — never mixes currencies", () => {
  it("formats UZS and USD side-by-side without adding", () => {
    const rows: CurrencyMoney[] = [
      { currency: "UZS", amount: "45000000", count: 3 },
      { currency: "USD", amount: "12300", count: 2 },
    ];
    const line = formatCurrencySummaryLine(rows);
    expect(line).toContain("сум");
    expect(line).toContain("$");
    expect(line).toContain("·");
    // Must not invent a single combined total
    expect(line).not.toMatch(/Всего/);
  });

  it("omits empty currencies (count 0)", () => {
    expect(
      formatCurrencySummaryLine([
        { currency: "UZS", amount: "0", count: 0 },
        { currency: "USD", amount: "100", count: 1 },
      ]),
    ).toBe(formatDebtMoney("100", "USD"));
  });

  it("null when no rows", () => {
    expect(formatCurrencySummaryLine([])).toBeNull();
  });
});

describe("isOverdueAtBoundary", () => {
  it("dueDate strictly before now → overdue", () => {
    expect(
      isOverdueAtBoundary(
        { status: "ACTIVE", dueDate: new Date(NOW.getTime() - 1) },
        NOW,
      ),
    ).toBe(true);
  });

  it("dueDate === now → NOT overdue (boundary)", () => {
    expect(
      isOverdueAtBoundary({ status: "ACTIVE", dueDate: NOW }, NOW),
    ).toBe(false);
  });

  it("dueDate after now → not overdue", () => {
    expect(
      isOverdueAtBoundary(
        { status: "ACTIVE", dueDate: new Date(NOW.getTime() + 86_400_000) },
        NOW,
      ),
    ).toBe(false);
  });

  it("REPAID or null dueDate → not overdue", () => {
    expect(
      isOverdueAtBoundary(
        { status: "REPAID", dueDate: new Date(NOW.getTime() - 1) },
        NOW,
      ),
    ).toBe(false);
    expect(isOverdueAtBoundary({ status: "ACTIVE", dueDate: null }, NOW)).toBe(
      false,
    );
  });
});

describe("groupDebtsByClient — per-currency client totals", () => {
  it("groups and totals per currency without mixing", () => {
    const groups = groupDebtsByClient([
      item({
        id: "d1",
        amount: "100.50",
        currency: "USD",
        sale: {
          customerName: "Ali",
          customerContact: "90",
          soldAt: new Date("2026-08-01T00:00:00Z"),
          price: "100.50",
          targetType: "SLAB",
          qtySlabs: 1,
          qtyAreaM2: null,
          managerId: "m",
          managerName: "M",
        },
      }),
      item({
        id: "d2",
        amount: "200.00",
        currency: "UZS",
        sale: {
          customerName: "Ali",
          customerContact: "90",
          soldAt: new Date("2026-08-02T00:00:00Z"),
          price: "200",
          targetType: "PIECE",
          qtySlabs: null,
          qtyAreaM2: "1.5",
          managerId: "m",
          managerName: "M",
        },
      }),
      item({
        id: "d3",
        amount: "50.00",
        currency: "USD",
        sale: {
          customerName: "Ali",
          customerContact: "90",
          soldAt: new Date("2026-07-01T00:00:00Z"),
          price: "50",
          targetType: "SLAB",
          qtySlabs: 2,
          qtyAreaM2: null,
          managerId: "m",
          managerName: "M",
        },
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].debts).toHaveLength(3);
    const usd = groups[0].totalsByCurrency.find((t) => t.currency === "USD");
    const uzs = groups[0].totalsByCurrency.find((t) => t.currency === "UZS");
    expect(usd?.amount).toBe("150.50");
    expect(usd?.count).toBe(2);
    expect(uzs?.amount).toBe("200.00");
    expect(uzs?.count).toBe(1);
  });
});

describe("applyKeysetPage — no skip/dup at boundary", () => {
  it("exact pageSize → no more", () => {
    const rows = [1, 2, 3];
    const r = applyKeysetPage(rows, 3);
    expect(r.page).toEqual([1, 2, 3]);
    expect(r.hasMore).toBe(false);
    expect(r.nextCursorIndex).toBeNull();
  });

  it("pageSize+1 fetched → hasMore, cursor at last kept row", () => {
    const rows = ["a", "b", "c", "d"];
    const r = applyKeysetPage(rows, 3);
    expect(r.page).toEqual(["a", "b", "c"]);
    expect(r.hasMore).toBe(true);
    expect(r.nextCursorIndex).toBe(2);
    expect(r.page[r.nextCursorIndex!]).toBe("c");
  });
});

describe("decimalStringToCents / centsToDecimalString", () => {
  it("round-trips fixed 2 decimals", () => {
    expect(centsToDecimalString(decimalStringToCents("12.5"))).toBe("12.50");
    expect(centsToDecimalString(decimalStringToCents("100"))).toBe("100.00");
  });
});

describe("formatDebtPurchase", () => {
  it("labels target types with volume", () => {
    expect(
      formatDebtPurchase({
        customerName: "A",
        customerContact: null,
        soldAt: NOW,
        price: null,
        targetType: "BATCH_VOLUME",
        qtySlabs: 10,
        qtyAreaM2: "5.5",
        managerId: "m",
        managerName: "M",
      }),
    ).toContain("Объём партии");
  });
});

describe("formatRevenueByMethod", () => {
  it("keeps methods separate and currencies side-by-side", () => {
    const lines = formatRevenueByMethod([
      { method: "CASH", currency: "UZS", amount: "1000", count: 2 },
      { method: "CASH", currency: "USD", amount: "50", count: 1 },
      { method: "CREDIT", currency: "UZS", amount: "500", count: 1 },
    ]);
    expect(lines.find((l) => l.methodRu === "Наличные")?.line).toMatch(/сум/);
    expect(lines.find((l) => l.methodRu === "Наличные")?.line).toMatch(/\$/);
    expect(lines.find((l) => l.methodRu === "В долг")?.line).toMatch(/сум/);
  });
});
