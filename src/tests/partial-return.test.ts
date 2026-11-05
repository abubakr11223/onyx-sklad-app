// ТЗ №20 F — частичный возврат и приём возврата складом (mock-tx со
// состоянием: маленькая «БД» в памяти, чтобы проверять счётчики после
// нескольких операций подряд — 3 из 10, потом ещё, потом приём).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const S = vi.hoisted(() => ({
  users: [] as Row[],
  sales: [] as Row[],
  batches: [] as Row[],
  patterns: [] as Row[],
  locations: [] as Row[],
  shipments: [] as Row[],
  lines: [] as Row[],
  debts: [] as Row[],
  payments: [] as Row[],
  returns: [] as Row[],
  pieces: [] as Row[],
  audits: [] as Row[],
}));

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const o = v as { increment?: unknown; decrement?: unknown };
      const cur = Number(row[k] ?? 0);
      if (o.increment !== undefined) row[k] = cur + Number(o.increment);
      else if (o.decrement !== undefined) row[k] = cur - Number(o.decrement);
      else row[k] = v;
    } else row[k] = v;
  }
}
const byId = (rows: Row[], id: unknown) => rows.find((r) => r.id === id) ?? null;
let seq = 0;

const tx = {
  $queryRaw: async () => [],
  user: { findUnique: async ({ where }: { where: Row }) => byId(S.users, where.id) },
  saleRecord: {
    findUnique: async ({ where }: { where: Row }) => byId(S.sales, where.id),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const r = byId(S.sales, where.id);
      if (!r || ("returnedAt" in where && r.returnedAt !== where.returnedAt)) return { count: 0 };
      applyData(r, data);
      return { count: 1 };
    },
  },
  batch: {
    findUnique: async ({ where }: { where: Row }) => byId(S.batches, where.id),
    update: async ({ where, data }: { where: Row; data: Row }) => {
      applyData(byId(S.batches, where.id)!, data);
      return {};
    },
  },
  batchPattern: {
    findUnique: async ({ where }: { where: Row }) => byId(S.patterns, where.id),
    update: async ({ where, data }: { where: Row; data: Row }) => {
      applyData(byId(S.patterns, where.id)!, data);
      return {};
    },
  },
  batchLocation: {
    findUnique: async ({ where }: { where: Row }) => byId(S.locations, where.id),
    findFirst: async ({ where }: { where: Row }) =>
      S.locations.find((l) => l.batchId === where.batchId) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      applyData(byId(S.locations, where.id)!, data);
      return {};
    },
  },
  shipment: {
    findUnique: async ({ where }: { where: Row }) => {
      const sh = S.shipments.find((x) => x.saleRecordId === where.saleRecordId);
      return sh ? { ...sh, lines: S.lines.filter((l) => l.shipmentId === sh.id) } : null;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      applyData(byId(S.shipments, where.id)!, data);
      return {};
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const sh = byId(S.shipments, where.id);
      if (!sh || sh.cancelledAt) return { count: 0 };
      applyData(sh, data);
      return { count: 1 };
    },
  },
  shipmentLine: {
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const l = byId(S.lines, where.id);
      if (!l || l.qtyShippedSlabs !== where.qtyShippedSlabs) return { count: 0 };
      applyData(l, data);
      return { count: 1 };
    },
  },
  debt: {
    findUnique: async ({ where }: { where: Row }) =>
      S.debts.find((d) => (where.id ? d.id === where.id : d.saleRecordId === where.saleRecordId)) ??
      null,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      applyData(byId(S.debts, where.id)!, data);
      return {};
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const d = byId(S.debts, where.id);
      if (!d || d.status !== where.status) return { count: 0 };
      applyData(d, data);
      return { count: 1 };
    },
  },
  payment: {
    create: async ({ data }: { data: Row }) => {
      S.payments.push({ ...data });
      return {};
    },
    groupBy: async ({ where }: { where: Row }) => {
      const sums = new Map<string, number>();
      for (const p of S.payments.filter((x) => x.saleRecordId === where.saleRecordId)) {
        sums.set(p.kind as string, (sums.get(p.kind as string) ?? 0) + Number(p.amount));
      }
      return [...sums].map(([kind, v]) => ({ kind, _sum: { amount: v } }));
    },
  },
  saleReturn: {
    create: async ({ data }: { data: Row }) => {
      const r = { id: `ret${++seq}`, acceptedAt: null, ...data };
      S.returns.push(r);
      return { id: r.id };
    },
    findUnique: async ({ where }: { where: Row }) => byId(S.returns, where.id),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const r = byId(S.returns, where.id);
      if (!r || r.acceptedAt !== null) return { count: 0 };
      applyData(r, data);
      return { count: 1 };
    },
  },
  piece: {
    create: async ({ data }: { data: Row }) => {
      const p = { id: `piece${++seq}`, ...data };
      S.pieces.push(p);
      return { id: p.id };
    },
  },
  auditLog: {
    create: async ({ data }: { data: Row }) => {
      S.audits.push(data);
      return {};
    },
  },
};

vi.mock("@/lib/db", () => ({
  db: { $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx) },
}));

import { acceptSaleReturn, planReturnParts, resolveReturnQty, returnSalePartial } from "@/lib/sale-returns";
import { returnSale } from "@/lib/sales";
import { netDecStr, netSaleFields } from "@/lib/sale-net";
import { purchaseTotalsFromSales, volumeTotalsFromSales } from "@/lib/clients-directory";

const OPTS = {
  qtySlabs: null as number | null,
  qtyAreaM2: null as number | null,
  refundCents: null as number | null,
  method: "CASH" as const,
  destination: "SAME_PATTERN" as const,
  reason: null,
};

function seed(args: { sold: number; area?: number | null; shipped: number; price: number; paid: number; repaid?: number }) {
  for (const k of Object.keys(S) as (keyof typeof S)[]) S[k].length = 0;
  S.users.push(
    { id: "mgr1", role: "MANAGER", isActive: true },
    { id: "mgr2", role: "MANAGER", isActive: true },
    { id: "own", role: "OWNER", isActive: true },
    { id: "wh", role: "WAREHOUSE", isActive: true },
  );
  S.batches.push({
    id: "b1",
    stoneTypeId: "st1",
    lengthMm: 300,
    widthMm: 70,
    thicknessMm: "2",
    slabsTotal: 20,
    areaTotalM2: 42,
    slabsSoldDirect: args.sold,
    areaSoldDirectM2: args.area ?? 0,
  });
  S.patterns.push({ id: "p1", lengthMm: 300, widthMm: 70, thicknessMm: "2", slabsCount: 20, areaM2: 42, slabsSold: args.sold, areaSoldM2: args.area ?? 0 });
  S.locations.push({ id: "loc1", batchId: "b1", block: "А", landmark: "2", slabsHere: 20 - args.sold, areaHereM2: null });
  S.sales.push({
    id: "sale1",
    managerId: "mgr1",
    targetType: "BATCH_VOLUME",
    slabId: null,
    pieceId: null,
    batchId: "b1",
    batchPatternId: "p1",
    qtySlabs: args.sold,
    qtyAreaM2: args.area ?? null,
    price: String(args.price),
    currency: "UZS",
    returnedAt: null,
    returnedSlabs: 0,
    returnedAreaM2: 0,
    returnedAmount: 0,
    paymentMethod: "CASH",
  });
  S.shipments.push({ id: "sh1", saleRecordId: "sale1", cancelledAt: null, completedAt: args.shipped >= args.sold ? new Date() : null });
  S.lines.push({
    id: "l1",
    shipmentId: "sh1",
    targetType: "BATCH_VOLUME",
    batchPatternId: "p1",
    batchLocationId: "loc1",
    qtyOrderedSlabs: args.sold,
    qtyOrderedAreaM2: args.area ?? null,
    qtyShippedSlabs: args.shipped,
    qtyShippedAreaM2: 0,
  });
  if (args.paid > 0) {
    S.payments.push({ saleRecordId: "sale1", kind: "PAYMENT", amount: String(args.paid), method: "CASH" });
  }
  if (args.paid < args.price) {
    S.debts.push({
      id: "d1",
      saleRecordId: "sale1",
      amount: String(args.price - args.paid),
      repaidAmount: args.repaid ? String(args.repaid) : null,
      status: "ACTIVE",
    });
    if (args.repaid) {
      S.payments.push({ saleRecordId: "sale1", kind: "PAYMENT", amount: String(args.repaid), method: "CASH" });
    }
  }
}

const sale = () => S.sales[0];
const batch = () => S.batches[0];
const refunds = () => S.payments.filter((p) => p.kind === "REFUND");

describe("частичный возврат: 3 из 10 плит", () => {
  beforeEach(() => seed({ sold: 10, shipped: 0, price: 1_000_000, paid: 400_000 }));

  it("остаток узора и места +3, задача «К отгрузке» −3, сначала уменьшается долг", async () => {
    const r = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "mgr1",
      opts: { ...OPTS, qtySlabs: 3 },
    });
    expect(r.ok).toBe(true);
    expect(batch().slabsSoldDirect).toBe(7);
    expect(S.patterns[0].slabsSold).toBe(7);
    expect(S.locations[0].slabsHere).toBe(13);
    expect(S.lines[0].qtyOrderedSlabs).toBe(7);
    // Сумма пропорционально: 1 000 000 × 3/10 = 300 000 — целиком в долг.
    expect(Number(S.debts[0].amount)).toBe(300_000);
    expect(S.debts[0].status).toBe("ACTIVE");
    expect(refunds()).toHaveLength(0);
    expect(sale()).toMatchObject({ returnedSlabs: 3, returnedAt: null });
    expect(Number(sale().returnedAmount)).toBe(300_000);
    expect(S.returns[0]).toMatchObject({ immediateSlabs: 3, pendingSlabs: 0, isFull: false });
    expect(S.audits.some((a) => a.action === "RETURN")).toBe(true);
  });

  it("деньги клиенту — только сверх долга (долг закрыт, остаток — REFUND)", async () => {
    seed({ sold: 10, shipped: 0, price: 1_000_000, paid: 400_000, repaid: 100_000 });
    // Долг 600 000, внесено 100 000 → остаток 500 000. Возврат 800 000.
    const r = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "mgr1",
      opts: { ...OPTS, qtySlabs: 8, refundCents: 80_000_000 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.debtReductionCents).toBe(50_000_000);
    expect(r.cashCents).toBe(30_000_000);
    expect(S.debts[0].status).toBe("REPAID");
    expect(refunds()).toHaveLength(1);
    expect(Number(refunds()[0].amount)).toBe(300_000);
  });

  it("повторный возврат больше 7 плит не проходит", async () => {
    await returnSalePartial({ saleRecordId: "sale1", managerId: "mgr1", opts: { ...OPTS, qtySlabs: 3 } });
    const r = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "mgr1",
      opts: { ...OPTS, qtySlabs: 8 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("не больше 7");
    expect(batch().slabsSoldDirect).toBe(7);
  });

  it("сумма больше допустимой (цена − уже возвращено) не проходит", async () => {
    const r = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "mgr1",
      opts: { ...OPTS, qtySlabs: 3, refundCents: 100_000_001 },
    });
    expect(r.ok).toBe(false);
    expect(batch().slabsSoldDirect).toBe(10);
  });

  it("менеджер не может вернуть чужую продажу; владелец — может", async () => {
    const r = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "mgr2",
      opts: { ...OPTS, qtySlabs: 1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN_ROLE");
    const own = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "own",
      opts: { ...OPTS, qtySlabs: 1 },
    });
    expect(own.ok).toBe(true);
  });

  it("последний возврат на весь остаток = полный возврат (returnedAt, задача отменена)", async () => {
    await returnSalePartial({ saleRecordId: "sale1", managerId: "mgr1", opts: { ...OPTS, qtySlabs: 3 } });
    const r = await returnSalePartial({ saleRecordId: "sale1", managerId: "mgr1", opts: { ...OPTS } });
    expect(r.ok).toBe(true);
    expect(sale().returnedAt).toBeInstanceOf(Date);
    expect(sale().returnedSlabs).toBe(10);
    expect(batch().slabsSoldDirect).toBe(0);
    expect(S.shipments[0].cancelledAt).toBeInstanceOf(Date);
    // Долг отменён, клиенту — всё, что он заплатил (400 000).
    expect(S.debts[0].status).toBe("CANCELLED");
    expect(Number(refunds()[0].amount)).toBe(400_000);
  });

  it("«в бой/остаток»: вместо плит в место — куски «остаток» того же узора", async () => {
    const r = await returnSalePartial({
      saleRecordId: "sale1",
      managerId: "mgr1",
      opts: { ...OPTS, qtySlabs: 2, destination: "REMAINDER" },
    });
    expect(r.ok).toBe(true);
    expect(batch().slabsSoldDirect).toBe(8);
    expect(S.locations[0].slabsHere).toBe(10); // в место плиты НЕ вернулись
    expect(S.pieces).toHaveLength(2);
    expect(S.pieces[0]).toMatchObject({ kind: "OFFCUT", batchPatternId: "p1", needsCheck: true, block: "А" });
  });
});

describe("раздел 1: продано 2, отгружено 1, полный возврат", () => {
  beforeEach(() => seed({ sold: 2, shipped: 1, price: 200_000, paid: 200_000 }));

  it("неотгруженная — сразу, отгруженная — после приёма складом (один раз)", async () => {
    const r = await returnSale({ saleRecordId: "sale1", managerId: "mgr1" });
    expect(r.ok).toBe(true);
    expect(batch().slabsSoldDirect).toBe(1); // одна плита уже в наличии
    expect(S.locations[0].slabsHere).toBe(19);
    expect(sale().returnedAt).toBeInstanceOf(Date);
    expect(S.returns[0]).toMatchObject({ immediateSlabs: 1, pendingSlabs: 1, isFull: true });
    expect(Number(refunds()[0].amount)).toBe(200_000);

    // Менеджер принять не может.
    const byMgr = await acceptSaleReturn({ saleReturnId: S.returns[0].id as string, actorId: "mgr1" });
    expect(byMgr.ok).toBe(false);
    expect(batch().slabsSoldDirect).toBe(1);

    const acc = await acceptSaleReturn({ saleReturnId: S.returns[0].id as string, actorId: "wh" });
    expect(acc.ok).toBe(true);
    expect(batch().slabsSoldDirect).toBe(0);
    expect(S.patterns[0].slabsSold).toBe(0);
    expect(S.locations[0].slabsHere).toBe(20);
    expect(S.audits.some((a) => a.action === "RETURN_ACCEPT")).toBe(true);

    // Повторный приём — отказ, остаток второй раз не растёт.
    const again = await acceptSaleReturn({ saleReturnId: S.returns[0].id as string, actorId: "wh" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ALREADY_RETURNED");
    expect(batch().slabsSoldDirect).toBe(0);
    expect(S.locations[0].slabsHere).toBe(20);
  });
});

describe("чистые правила", () => {
  it("раскладка: сначала неотгруженное, потом отгруженное; м² пропорционально", () => {
    const parts = planReturnParts({
      lines: [{ lineId: "l1", batchPatternId: "p1", batchLocationId: "loc1", ordered: 10, shipped: 8 }],
      primary: "slabs",
      qtyPrimary: 3,
      areaForSlabs: 6.3,
      fallbackPatternId: "p1",
    });
    expect(parts).toEqual([
      { lineId: "l1", batchPatternId: "p1", batchLocationId: "loc1", slabs: 2, areaM2: 4.2, shipped: false },
      { lineId: "l1", batchPatternId: "p1", batchLocationId: "loc1", slabs: 1, areaM2: 2.1, shipped: true },
    ]);
  });

  it("м² по умолчанию — пропорционально плитам; весь остаток → полный", () => {
    const q = resolveReturnQty({ soldSlabs: 10, soldAreaM2: 21, returnedSlabs: 0, returnedAreaM2: 0, reqSlabs: 3, reqAreaM2: null });
    expect(q).toEqual({ ok: true, qty: { slabs: 3, areaM2: 6.3, primary: "slabs", isFull: false } });
    const all = resolveReturnQty({ soldSlabs: 10, soldAreaM2: 21, returnedSlabs: 3, returnedAreaM2: 6.3, reqSlabs: null, reqAreaM2: null });
    expect(all.ok && all.qty).toMatchObject({ slabs: 7, areaM2: 14.7, isFull: true });
  });
});

describe("итоги вычитают возвраты", () => {
  it("цена, плиты и м² продажи — за вычетом частичных возвратов", () => {
    const s = { price: "1000000.00", qtySlabs: 10, qtyAreaM2: "21.000", returnedSlabs: 3, returnedAreaM2: "6.300", returnedAmount: "300000.00" };
    expect(netSaleFields(s)).toEqual({ price: "700000.00", qtySlabs: 7, qtyAreaM2: "14.700" });
    expect(netDecStr("500.10", "0.10", 2)).toBe("500.00");
    const rows = [
      { returnedAt: null, currency: "UZS" as const, ...netSaleFields(s) },
      { returnedAt: null, currency: "UZS" as const, ...netSaleFields({ price: "200000", qtySlabs: 2, qtyAreaM2: null }) },
    ];
    expect(purchaseTotalsFromSales(rows)).toEqual([expect.objectContaining({ currency: "UZS", amount: "900000.00" })]);
    expect(volumeTotalsFromSales(rows)).toMatchObject({ qtySlabs: 9 });
  });
});
