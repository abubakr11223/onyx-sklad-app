// ТЗ №20 A — платежи: 50/50, частичное погашение, раскладка одной суммы
// клиента по долгам от старого к новому.
import { describe, expect, it, vi } from "vitest";
import {
  addDebtPayment,
  checkManualAllocation,
  checkSalePayments,
  planClientPayment,
  settleSaleInTx,
  summaryMethod,
  PaymentError,
} from "@/lib/payments";

describe("оплата при продаже", () => {
  it("5 млн наличные + 5 млн карта при цене 10 млн → долга нет", () => {
    const r = checkSalePayments(10_000_000, [
      { amount: 5_000_000, method: "CASH" },
      { amount: 5_000_000, method: "CARD" },
    ]);
    expect(r.ok && r.debtCents).toBe(0);
  });
  it("$300, оплачено $100 → долг $200", () => {
    const r = checkSalePayments(300, [{ amount: 100, method: "CASH" }]);
    expect(r.ok && r.debtCents).toBe(20_000);
  });
  it("оплачено больше цены → отказ", () => {
    const r = checkSalePayments(300, [{ amount: 300.01, method: "TRANSFER" }]);
    expect(r.ok).toBe(false);
  });
  it("сводный способ: больший платёж; без платежей — CREDIT", () => {
    expect(summaryMethod([{ amount: 3, method: "CASH" }, { amount: 7, method: "TRANSFER" }])).toBe(
      "TRANSFER",
    );
    expect(summaryMethod([])).toBe("CREDIT");
  });

  it("settleSaleInTx: платежи + долг на остаток в той же транзакции", async () => {
    const tx = {
      payment: { create: vi.fn(async () => ({})) },
      debt: { create: vi.fn(async () => ({ id: "debt-1" })) },
    };
    const r = await settleSaleInTx(tx as never, {
      saleId: "s1",
      price: 300,
      currency: "USD",
      rows: [{ amount: 100, method: "CASH" }],
      receivedById: "u1",
      paidAt: new Date("2026-10-21T09:00:00Z"),
      debtDueDate: null,
      clientId: "c1",
    });
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(
      Number(String((tx.debt.create.mock.calls[0] as unknown as [{ data: { amount: unknown } }])[0].data.amount)),
    ).toBe(200);
    expect(r).toEqual({ debtId: "debt-1", paidCents: 10_000, debtCents: 20_000 });
  });
});

describe("погашение долга по частям", () => {
  function makeDb(debt: { amount: string; repaidAmount: string | null; status?: string }) {
    const state = { ...debt, status: debt.status ?? "ACTIVE" };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      debt: {
        findUnique: vi.fn(async () => ({
          id: "d1",
          status: state.status,
          amount: { toString: () => state.amount },
          repaidAmount: state.repaidAmount === null ? null : { toString: () => state.repaidAmount },
          currency: "USD",
          saleRecordId: "s1",
        })),
        update: vi.fn(async (a: { data: { repaidAmount: string; status?: string } }) => {
          state.repaidAmount = a.data.repaidAmount;
          if (a.data.status) state.status = a.data.status;
          return {};
        }),
      },
      payment: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const db = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    return { db, tx, state };
  }

  it("$300: внесено $50 → остаток $250; затем $250 → долг закрыт", async () => {
    const { db, state } = makeDb({ amount: "300.00", repaidAmount: null });
    const a = await addDebtPayment(db as never, {
      debtId: "d1",
      amount: 50,
      method: "CASH",
      paidAt: new Date(),
      actorId: "u1",
    });
    expect(a).toEqual({ remainingCents: 25_000, closed: false });
    const b = await addDebtPayment(db as never, {
      debtId: "d1",
      amount: 250,
      method: "CARD",
      paidAt: new Date(),
      actorId: "u1",
    });
    expect(b.closed).toBe(true);
    expect(state.status).toBe("REPAID");
  });

  it("платёж больше остатка не сохраняется", async () => {
    const { db, tx } = makeDb({ amount: "300.00", repaidAmount: "250.00" });
    await expect(
      addDebtPayment(db as never, {
        debtId: "d1",
        amount: 60,
        method: "CASH",
        paidAt: new Date(),
        actorId: "u1",
      }),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
});

describe("платёж клиента на несколько долгов", () => {
  const debts = [
    { debtId: "new", createdAt: new Date("2026-10-15"), remainingCents: 150_000_000 },
    { debtId: "old", createdAt: new Date("2026-10-01"), remainingCents: 200_000_000 },
    { debtId: "mid", createdAt: new Date("2026-10-10"), remainingCents: 50_000_000 },
  ];
  it("раскладка от старого к новому", () => {
    const r = planClientPayment(debts, 300_000_000);
    expect(r.ok && r.lines).toEqual([
      { debtId: "old", amountCents: 200_000_000, leftCents: 0 },
      { debtId: "mid", amountCents: 50_000_000, leftCents: 0 },
      { debtId: "new", amountCents: 50_000_000, leftCents: 100_000_000 },
    ]);
  });
  it("больше всех долгов — отказ", () => {
    expect(planClientPayment(debts, 400_000_001).ok).toBe(false);
  });
  it("ручная правка: строка больше остатка своего долга — отказ", () => {
    expect(checkManualAllocation(debts, [{ debtId: "mid", amountCents: 50_000_001 }]).ok).toBe(false);
    expect(checkManualAllocation(debts, [{ debtId: "mid", amountCents: 1 }]).ok).toBe(true);
    expect(checkManualAllocation(debts, [{ debtId: "alien", amountCents: 1 }]).ok).toBe(false);
  });
});

// ТЗ №20 B — плановая отгрузка.
import { formatShipmentPlan, isPlanOverdue } from "@/lib/shipments";

describe("плановая дата отгрузки", () => {
  const base = { plannedHasTime: true, completedAt: null, cancelledAt: null };
  it("время прошло, не выдано → просрочено; выдано → нет", () => {
    const plannedAt = new Date("2026-11-05T05:00:00Z");
    const now = new Date("2026-11-05T06:00:00Z");
    expect(isPlanOverdue({ ...base, plannedAt }, now)).toBe(true);
    expect(isPlanOverdue({ ...base, plannedAt, completedAt: now }, now)).toBe(false);
  });
  it("только дата — просрочка со следующего дня", () => {
    const plannedAt = new Date("2026-11-04T19:00:00Z"); // 05.11 00:00 Ташкент
    expect(isPlanOverdue({ ...base, plannedHasTime: false, plannedAt }, new Date("2026-11-05T15:00:00Z"))).toBe(false);
    expect(isPlanOverdue({ ...base, plannedHasTime: false, plannedAt }, new Date("2026-11-05T20:00:00Z"))).toBe(true);
  });
  it("строка «05.11.2026, 10:00 · самовывоз»", () => {
    const line = formatShipmentPlan({
      plannedAt: new Date("2026-11-05T05:00:00Z"),
      plannedHasTime: true,
      deliveryMode: "PICKUP",
    });
    expect(line).toMatch(/05\.11\.2026/);
    expect(line).toMatch(/10:00/);
    expect(line).toMatch(/самовывоз$/);
  });
});
