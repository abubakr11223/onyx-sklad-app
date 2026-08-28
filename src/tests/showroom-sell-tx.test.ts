// W1-T3 — продажа из шоу-рума идёт ЕДИНОЙ транзакцией через sellUnit
// (SHOWROOM→SOLD): SaleRecord с ценой/валютой/оплатой/клиентом + закрытие
// ShowroomPlacement + отмена открытой шоу-рум-задачи + Debt при CREDIT +
// Shipment(SALE) + AuditLog. Паттерн mock-tx — как sales-mutators.test.ts:
// db.$transaction(cb) → cb(tx), все Prisma-методы — vi.fn.

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    userFindUnique: fn(),
    slabFindUnique: fn(),
    slabUpdateMany: fn(),
    pieceFindUnique: fn(),
    pieceUpdateMany: fn(),
    reservationUpdateMany: fn(),
    saleCreate: fn(),
    debtCreate: fn(),
    auditCreate: fn(),
    shipmentCreate: fn(),
    shipmentUpdateMany: fn(),
    placementFindFirst: fn(),
    placementUpdateMany: fn(),
  };
});

const tx = {
  user: { findUnique: M.userFindUnique },
  slab: { findUnique: M.slabFindUnique, updateMany: M.slabUpdateMany },
  piece: { findUnique: M.pieceFindUnique, updateMany: M.pieceUpdateMany },
  reservation: { updateMany: M.reservationUpdateMany },
  saleRecord: { create: M.saleCreate },
  debt: { create: M.debtCreate },
  shipment: { create: M.shipmentCreate, updateMany: M.shipmentUpdateMany },
  showroomPlacement: {
    findFirst: M.placementFindFirst,
    updateMany: M.placementUpdateMany,
  },
  auditLog: { create: M.auditCreate },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  },
}));

import { sellUnit } from "@/lib/sales";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.userFindUnique.mockResolvedValue({ id: "mgr1", role: "MANAGER", isActive: true });
  M.slabFindUnique.mockResolvedValue({
    id: "slab1",
    status: "SHOWROOM",
    needsCheck: false,
    block: "А",
    landmark: "3",
    reservations: [],
  });
  M.slabUpdateMany.mockResolvedValue({ count: 1 });
  M.pieceUpdateMany.mockResolvedValue({ count: 1 });
  M.reservationUpdateMany.mockResolvedValue({ count: 1 });
  M.saleCreate.mockResolvedValue({ id: "sale1" });
  M.debtCreate.mockResolvedValue({ id: "debt1" });
  M.auditCreate.mockResolvedValue({});
  M.shipmentCreate.mockResolvedValue({ id: "shipSale" });
  M.shipmentUpdateMany.mockResolvedValue({ count: 1 });
  // Открытая витринная задача этой плиты — её надо отменить при продаже.
  M.placementFindFirst.mockResolvedValue({ shipmentId: "shipShowroom" });
  M.placementUpdateMany.mockResolvedValue({ count: 1 });
});

const INPUT = {
  targetType: "SLAB" as const,
  unitId: "slab1",
  customerName: "Иван Петров",
  customerContact: "+998901112233",
  price: 1500000,
  managerId: "mgr1",
  paymentMethod: "CASH" as const,
  currency: "UZS" as const,
  debtDueDate: null,
  debtComment: null,
  clientId: "cl1",
};

describe("sellUnit из SHOWROOM — одна транзакция (mock-tx)", () => {
  it("happy CASH: SOLD + placement закрыт + витринная задача отменена + SaleRecord с оплатой", async () => {
    const res = await sellUnit(INPUT);
    expect(res.ok).toBe(true);

    // Условный UPDATE ждёт именно SHOWROOM (никакой обход статуса).
    const upd = M.slabUpdateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: "slab1", status: "SHOWROOM", needsCheck: false });
    expect(upd.data).toEqual({ status: "SOLD" });

    // Жизненный цикл размещения — как раньше: closedAt в той же транзакции.
    expect(M.placementUpdateMany).toHaveBeenCalledTimes(1);
    const pl = M.placementUpdateMany.mock.calls[0][0];
    expect(pl.where).toMatchObject({ slabId: "slab1", closedAt: null });
    expect(pl.data.closedAt).toBeInstanceOf(Date);

    // Открытая шоу-рум-отгрузка отменяется (складчику нечего переносить).
    expect(M.shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "shipShowroom" }),
        data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
      }),
    );

    // SaleRecord — с ценой/валютой/оплатой/клиентом → попадает в svodka.
    expect(M.saleCreate).toHaveBeenCalledTimes(1);
    expect(M.saleCreate.mock.calls[0][0].data).toMatchObject({
      managerId: "mgr1",
      customerName: "Иван Петров",
      targetType: "SLAB",
      slabId: "slab1",
      price: "1500000.00",
      paymentMethod: "CASH",
      currency: "UZS",
      clientId: "cl1",
    });

    // История + задача на отгрузку — та же транзакция.
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "SALE",
      entityType: "Slab",
    });
    expect(M.shipmentCreate).toHaveBeenCalledTimes(1);
    expect(M.shipmentCreate.mock.calls[0][0].data).toMatchObject({
      kind: "SALE",
      saleRecordId: "sale1",
    });
    // CASH — долга нет.
    expect(M.debtCreate).not.toHaveBeenCalled();
  });

  it("CREDIT: Debt открывается в ТОЙ ЖЕ валюте, что продажа (USD), с clientId", async () => {
    const res = await sellUnit({
      ...INPUT,
      paymentMethod: "CREDIT",
      currency: "USD",
      price: 2500.5,
    });
    expect(res.ok).toBe(true);
    expect(M.debtCreate).toHaveBeenCalledTimes(1);
    const d = M.debtCreate.mock.calls[0][0].data;
    expect(d.currency).toBe("USD"); // никогда не «переводится» в сумы
    expect(Number(d.amount)).toBe(2500.5);
    expect(d.status).toBe("ACTIVE");
    expect(d.saleRecordId).toBe("sale1");
    expect(d.clientId).toBe("cl1");
  });

  it("CREDIT в сумах: Debt в UZS — валюты не смешиваются", async () => {
    await sellUnit({ ...INPUT, paymentMethod: "CREDIT", currency: "UZS" });
    expect(M.debtCreate.mock.calls[0][0].data.currency).toBe("UZS");
    expect(M.saleCreate.mock.calls[0][0].data.currency).toBe("UZS");
  });

  it("гонка (условный UPDATE вернул 0 строк) → ALREADY_SOLD, НИ продажи, НИ закрытия витрины", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });
    const res = await sellUnit(INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ALREADY_SOLD");
    expect(M.placementUpdateMany).not.toHaveBeenCalled();
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.debtCreate).not.toHaveBeenCalled();
  });

  it("атомарность: сбой Debt ПОСЛЕ SaleRecord пробрасывается — вся транзакция откатится", async () => {
    M.debtCreate.mockRejectedValue(new Error("db down"));
    await expect(
      sellUnit({ ...INPUT, paymentMethod: "CREDIT", currency: "UZS" }),
    ).rejects.toThrow("db down");
    // SaleRecord и закрытие placement уже вызваны в tx — реальный Prisma
    // откатит всё вместе (единый $transaction).
    expect(M.saleCreate).toHaveBeenCalled();
    expect(M.placementUpdateMany).toHaveBeenCalled();
  });

  it("PIECE из шоу-рума: закрывается placement по pieceId", async () => {
    M.pieceFindUnique.mockResolvedValue({
      id: "piece1",
      status: "SHOWROOM",
      needsCheck: false,
      block: "Б",
      landmark: "1",
      reservations: [],
    });
    const res = await sellUnit({ ...INPUT, targetType: "PIECE", unitId: "piece1" });
    expect(res.ok).toBe(true);
    const pl = M.placementUpdateMany.mock.calls[0][0];
    expect(pl.where).toMatchObject({ pieceId: "piece1", closedAt: null });
  });
});
