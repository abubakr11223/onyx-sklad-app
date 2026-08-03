// TZ №9 — debts domain (fake client). No live DB. No sales.ts mock here —
// CREDIT sell path lives in sales-mutators.test.ts to avoid dual vi.mock(@/lib/db).
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  cancelDebtForReturnedSale,
  createDebtForSale,
  debtSummary,
  endOfTashkentCalendarDay,
  isDebtOverdue,
  listDebts,
  normalizeDebtDueDate,
  repayDebt,
} from "@/lib/debts";
import { MAX_DECIMAL_14_2 } from "@/lib/decimal";

// Fixed clock — overdue boundary never depends on wall time.
// Tashkent = UTC+5. Midday UTC on 3 Aug = 17:00 Tashkent same day.
const NOW = new Date("2026-08-03T12:00:00.000Z");
const PAST_END = endOfTashkentCalendarDay("2026-08-01"); // overdue vs NOW
const DUE_TODAY_END = endOfTashkentCalendarDay("2026-08-03"); // still OK at midday
const FUTURE_END = endOfTashkentCalendarDay("2026-08-10");
// After end of 3 Aug Tashkent (= 2026-08-03T18:59:59.999Z)
const AFTER_DUE_DAY = new Date("2026-08-03T19:00:00.000Z");

describe("normalizeDebtDueDate — end of Asia/Tashkent day", () => {
  it("null stays null", () => {
    expect(normalizeDebtDueDate(null)).toBeNull();
  });
  it("maps calendar day to 23:59:59.999+05:00", () => {
    // Bare local-midnight style (what sale-payment used to produce)
    const bare = new Date("2026-08-03T00:00:00.000Z");
    const n = normalizeDebtDueDate(bare)!;
    expect(n.toISOString()).toBe(endOfTashkentCalendarDay("2026-08-03").toISOString());
  });
});

describe("isDebtOverdue — pure, injected now, end-of-day storage", () => {
  it("ACTIVE + dueDate end-of-past-day < now → overdue", () => {
    expect(
      isDebtOverdue({ status: "ACTIVE", dueDate: PAST_END }, NOW),
    ).toBe(true);
  });
  it("ACTIVE + due today (end of day still ahead) → not overdue at midday", () => {
    expect(
      isDebtOverdue({ status: "ACTIVE", dueDate: DUE_TODAY_END }, NOW),
    ).toBe(false);
  });
  it("ACTIVE + due today → overdue after Tashkent midnight next day", () => {
    expect(
      isDebtOverdue({ status: "ACTIVE", dueDate: DUE_TODAY_END }, AFTER_DUE_DAY),
    ).toBe(true);
  });
  it("ACTIVE + dueDate > now → not overdue", () => {
    expect(
      isDebtOverdue({ status: "ACTIVE", dueDate: FUTURE_END }, NOW),
    ).toBe(false);
  });
  it("ACTIVE + no dueDate → not overdue", () => {
    expect(isDebtOverdue({ status: "ACTIVE", dueDate: null }, NOW)).toBe(false);
  });
  it("REPAID with past dueDate → not overdue", () => {
    expect(
      isDebtOverdue({ status: "REPAID", dueDate: PAST_END }, NOW),
    ).toBe(false);
  });
  it("CANCELLED with past dueDate → not overdue", () => {
    expect(
      isDebtOverdue({ status: "CANCELLED", dueDate: PAST_END }, NOW),
    ).toBe(false);
  });
});

describe("createDebtForSale", () => {
  it("creates ACTIVE debt with amount + currency", async () => {
    const create = vi.fn().mockResolvedValue({ id: "d1" });
    const tx = { debt: { create } } as unknown as Parameters<
      typeof createDebtForSale
    >[0];

    const res = await createDebtForSale(tx, {
      saleRecordId: "sale1",
      amount: "1500.50",
      currency: "USD",
      dueDate: new Date("2026-08-10T00:00:00.000Z"),
      comment: "test",
    });

    expect(res.debtId).toBe("d1");
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.saleRecordId).toBe("sale1");
    expect(data.currency).toBe("USD");
    expect(data.status).toBe("ACTIVE");
    expect(data.amount.toString()).toBe("1500.5");
    // dueDate normalized to end of Tashkent day (not bare midnight).
    expect(data.dueDate.toISOString()).toBe(FUTURE_END.toISOString());
  });

  it("rejects non-positive amount", async () => {
    const tx = { debt: { create: vi.fn() } } as unknown as Parameters<
      typeof createDebtForSale
    >[0];
    await expect(
      createDebtForSale(tx, {
        saleRecordId: "s",
        amount: "0",
        currency: "UZS",
      }),
    ).rejects.toMatchObject({ debtError: { code: "INVALID_INPUT" } });
  });

  it("TZ9 cleanup: accepts amount at Decimal(14,2) max (MAX_DECIMAL_14_2)", async () => {
    const create = vi.fn().mockResolvedValue({ id: "d-max" });
    const tx = { debt: { create } } as unknown as Parameters<
      typeof createDebtForSale
    >[0];
    const maxStr = String(MAX_DECIMAL_14_2); // 999999999999.99
    const res = await createDebtForSale(tx, {
      saleRecordId: "sale-big",
      amount: maxStr,
      currency: "UZS",
    });
    expect(res.debtId).toBe("d-max");
    expect(create).toHaveBeenCalledTimes(1);
    const amt = create.mock.calls[0][0].data.amount;
    expect(amt.toString()).toBe("999999999999.99");
  });

  it("TZ9 cleanup: rejects amount above Decimal(14,2) max", async () => {
    const create = vi.fn();
    const tx = { debt: { create } } as unknown as Parameters<
      typeof createDebtForSale
    >[0];
    await expect(
      createDebtForSale(tx, {
        saleRecordId: "sale-too-big",
        amount: "1000000000000.00", // 1e12 > 999999999999.99
        currency: "UZS",
      }),
    ).rejects.toMatchObject({
      debtError: {
        code: "INVALID_INPUT",
        message: expect.stringMatching(/велик|Сумма/i),
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("cancelDebtForReturnedSale", () => {
  it("ACTIVE → CANCELLED", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: "d1", status: "ACTIVE" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      debt: { findUnique, updateMany },
      auditLog: { create: auditCreate },
    } as unknown as Parameters<typeof cancelDebtForReturnedSale>[0];

    const res = await cancelDebtForReturnedSale(tx, {
      saleRecordId: "sale1",
      actorId: "mgr1",
      now: NOW,
    });
    expect(res).toEqual({ outcome: "cancelled", debtId: "d1" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "d1", status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });
  });

  it("REPAID → left_repaid (does not cancel — money was collected)", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: "d1", status: "REPAID" });
    const updateMany = vi.fn();
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      debt: { findUnique, updateMany },
      auditLog: { create: auditCreate },
    } as unknown as Parameters<typeof cancelDebtForReturnedSale>[0];

    const res = await cancelDebtForReturnedSale(tx, {
      saleRecordId: "sale1",
      actorId: "mgr1",
      now: NOW,
    });
    expect(res.outcome).toBe("left_repaid");
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it("no debt → none", async () => {
    const tx = {
      debt: { findUnique: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn() },
    } as unknown as Parameters<typeof cancelDebtForReturnedSale>[0];
    const res = await cancelDebtForReturnedSale(tx, {
      saleRecordId: "sale1",
      actorId: "mgr1",
      now: NOW,
    });
    expect(res).toEqual({ outcome: "none", debtId: null });
  });
});

describe("repayDebt", () => {
  it("ACTIVE → REPAID with repaidAmount = amount", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "d1",
      status: "ACTIVE",
      amount: new Prisma.Decimal("100.00"),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      debt: { findUnique, updateMany },
      auditLog: { create: auditCreate },
    };
    const db = {
      $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    } as unknown as Parameters<typeof repayDebt>[0];

    const res = await repayDebt(db, {
      debtId: "d1",
      actorId: "owner1",
      repaidAt: NOW,
    });
    expect(res).toEqual({ ok: true, debtId: "d1", status: "REPAID" });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      status: "REPAID",
      repaidAt: NOW,
    });
  });

  it("already REPAID → ALREADY_REPAID", async () => {
    const tx = {
      debt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "d1",
          status: "REPAID",
          amount: new Prisma.Decimal(1),
        }),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const db = {
      $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    } as unknown as Parameters<typeof repayDebt>[0];
    const res = await repayDebt(db, {
      debtId: "d1",
      actorId: "o",
      repaidAt: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ALREADY_REPAID");
  });
});

describe("debtSummary — per currency, never combined", () => {
  it("keeps UZS and USD separate; omits empty currency", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        amount: new Prisma.Decimal("1000000"),
        currency: "UZS",
        dueDate: PAST_END,
        saleRecord: { customerName: "A", customerContact: "1" },
      },
      {
        amount: new Prisma.Decimal("2000000"),
        currency: "UZS",
        dueDate: FUTURE_END,
        saleRecord: { customerName: "B", customerContact: "2" },
      },
      {
        amount: new Prisma.Decimal("50.00"),
        currency: "USD",
        dueDate: PAST_END,
        saleRecord: { customerName: "A", customerContact: "1" },
      },
    ]);
    const db = { debt: { findMany } } as unknown as Parameters<
      typeof debtSummary
    >[0];

    const s = await debtSummary(db, { now: NOW });
    expect(s.activeByCurrency).toEqual([
      { currency: "UZS", amount: "3000000.00", count: 2 },
      { currency: "USD", amount: "50.00", count: 1 },
    ]);
    expect(s.overdueByCurrency).toEqual([
      { currency: "UZS", amount: "1000000.00", count: 1 },
      { currency: "USD", amount: "50.00", count: 1 },
    ]);
    expect(s).not.toHaveProperty("total");
    expect(s).not.toHaveProperty("activeTotal");
    expect(s.activeDebtorCount).toBe(2);
  });
});

describe("listDebts — bounded page", () => {
  it("returns pageSize+1 keyset and maps overdue", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "d2",
        saleRecordId: "s2",
        amount: new Prisma.Decimal(10),
        currency: "USD",
        status: "ACTIVE",
        dueDate: PAST_END,
        comment: null,
        repaidAt: null,
        repaidAmount: null,
        createdAt: NOW,
        saleRecord: {
          customerName: "X",
          customerContact: "+998",
          soldAt: NOW,
          price: new Prisma.Decimal(10),
          targetType: "SLAB",
          qtySlabs: null,
          qtyAreaM2: null,
          managerId: "m1",
          manager: { name: "Mgr" },
        },
      },
    ]);
    const db = { debt: { findMany } } as unknown as Parameters<
      typeof listDebts
    >[0];
    const res = await listDebts(db, { now: NOW, pageSize: 30 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].overdue).toBe(true);
    expect(findMany.mock.calls[0][0].take).toBe(31);
  });
});
