// Аудит ТЗ №7 #2 — sales.ts transactional mutators (sellUnit / sellBatchVolume /
// sellWholeBatch / returnSale / confirmReturnedUnit) не покрыты тестами. Здесь
// mock-tx: db.$transaction(cb) → cb(tx), tx — все нужные Prisma-методы vi.fn'ами.
// Минимальный набор на мутатор: чужая бронь → fail, oversell → fail, успех →
// счётчики верны и не отрицательны + SaleRecord и AuditLog записаны.

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted — моки должны существовать ДО того, как vi.mock их подтянет.
const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    // db.user
    userFindUnique: fn(),
    // db.slab
    slabFindUnique: fn(),
    slabUpdateMany: fn(),
    // db.piece
    pieceFindUnique: fn(),
    pieceUpdateMany: fn(),
    // db.batch
    batchFindUnique: fn(),
    batchUpdateMany: fn(),
    batchUpdate: fn(),
    // db.reservation
    reservationUpdateMany: fn(),
    // db.saleRecord
    saleFindUnique: fn(),
    saleCreate: fn(),
    saleUpdateMany: fn(),
    // db.batchPattern (для полноты — sellPatternVolume не тестируем здесь)
    patternFindUnique: fn(),
    patternUpdate: fn(),
    // TZ №9 — Debt (returnSale cancel; credit create)
    debtFindUnique: fn(),
    debtCreate: fn(),
    debtUpdateMany: fn(),
    // $queryRaw — lockBatchForUpdate
    queryRaw: fn(),
    // db.auditLog
    auditCreate: fn(),
  };
});

// tx-объект: те же методы, что и db (в проде $transaction даёт другой tx, но
// поведенчески — те же mock-функции).
const tx = {
  user: { findUnique: M.userFindUnique },
  slab: { findUnique: M.slabFindUnique, updateMany: M.slabUpdateMany },
  piece: { findUnique: M.pieceFindUnique, updateMany: M.pieceUpdateMany },
  batch: {
    findUnique: M.batchFindUnique,
    updateMany: M.batchUpdateMany,
    update: M.batchUpdate,
  },
  reservation: { updateMany: M.reservationUpdateMany },
  saleRecord: {
    findUnique: M.saleFindUnique,
    create: M.saleCreate,
    updateMany: M.saleUpdateMany,
  },
  batchPattern: { findUnique: M.patternFindUnique, update: M.patternUpdate },
  debt: {
    findUnique: M.debtFindUnique,
    create: M.debtCreate,
    updateMany: M.debtUpdateMany,
  },
  auditLog: { create: M.auditCreate },
  $queryRaw: M.queryRaw,
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  },
}));

// ── Импорт ПОСЛЕ моков ──
import {
  sellUnit,
  sellBatchVolume,
  sellWholeBatch,
  returnSale,
  confirmReturnedUnit,
} from "@/lib/sales";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  // Разумные дефолты — actor OWNER, все updateMany возвращают {count:1}.
  M.userFindUnique.mockResolvedValue({ id: "mgr1", role: "MANAGER", isActive: true });
  M.slabUpdateMany.mockResolvedValue({ count: 1 });
  M.pieceUpdateMany.mockResolvedValue({ count: 1 });
  M.batchUpdateMany.mockResolvedValue({ count: 1 });
  M.batchUpdate.mockResolvedValue({});
  M.reservationUpdateMany.mockResolvedValue({ count: 1 });
  M.saleCreate.mockResolvedValue({ id: "sale1" });
  M.saleUpdateMany.mockResolvedValue({ count: 1 });
  M.auditCreate.mockResolvedValue({});
  M.queryRaw.mockResolvedValue([]);
  M.patternUpdate.mockResolvedValue({});
  // TZ №9: no debt by default (cash/legacy sales; return with no debt).
  M.debtFindUnique.mockResolvedValue(null);
  M.debtCreate.mockResolvedValue({ id: "debt1" });
  M.debtUpdateMany.mockResolvedValue({ count: 1 });
});

// W11-C: sellUnit / sellBatchVolume use wall-clock `new Date()` for
// isHoldEffective(expiresAt, now). Absolute FUTURE="2026-08-01" became past on
// that day → "active hold" fixtures expired and assertions inverted. Relative
// to load-time NOW so holds stay active / past stays past forever.
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const FUTURE = new Date(NOW.getTime() + 7 * DAY_MS);
const PAST = new Date(NOW.getTime() - 7 * DAY_MS);

// ═══════════════ sellUnit (SLAB) ═══════════════

describe("sellUnit — единичная продажа плиты (mock-tx)", () => {
  const INPUT = {
    targetType: "SLAB" as const,
    unitId: "slab1",
    customerName: "Клиент",
    managerId: "mgr1",
  };

  it("чужая активная бронь (не истёкшая) → RESERVED_BY_OTHER, НИ SaleRecord НИ status.SOLD не пишутся", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "RESERVED",
      needsCheck: false,
      reservations: [
        { id: "r1", managerId: "OTHER_MANAGER", expiresAt: FUTURE },
      ],
    });

    const res = await sellUnit(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("RESERVED_BY_OTHER");
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("уже продан параллельно (условный UPDATE вернул 0 строк) → ALREADY_SOLD, SaleRecord не пишется", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
    M.slabUpdateMany.mockResolvedValue({ count: 0 }); // гонка

    const res = await sellUnit(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("ALREADY_SOLD");
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("AVAILABLE → SOLD (happy) → status.SOLD + SaleRecord + AuditLog(SALE)", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });

    const res = await sellUnit(INPUT);

    expect(res.ok).toBe(true);
    // Условный UPDATE: WHERE фиксирует ожидаемый статус AVAILABLE.
    expect(M.slabUpdateMany).toHaveBeenCalledTimes(1);
    const upd = M.slabUpdateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: "slab1", status: "AVAILABLE", needsCheck: false });
    expect(upd.data).toEqual({ status: "SOLD" });
    // SaleRecord + AuditLog.
    expect(M.saleCreate).toHaveBeenCalledTimes(1);
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "SALE",
      entityType: "Slab",
    });
    // Из-под своей брони не шли — reservation не трогается.
    expect(M.reservationUpdateMany).not.toHaveBeenCalled();
  });

  it("из-под СВОЕЙ брони → SOLD + бронь COMPLETED (переход №4)", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "RESERVED",
      needsCheck: false,
      reservations: [{ id: "myR", managerId: "mgr1", expiresAt: FUTURE }],
    });

    const res = await sellUnit(INPUT);

    expect(res.ok).toBe(true);
    expect((res as { completedReservationId: string }).completedReservationId).toBe("myR");
    // Условный UPDATE — WHERE ожидает RESERVED.
    expect(M.slabUpdateMany.mock.calls[0][0].where.status).toBe("RESERVED");
    // Бронь COMPLETED — 1 раз, только своя.
    expect(M.reservationUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.reservationUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "myR", status: "ACTIVE" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
  });

  // ── TZ №9 payment / debt ──

  it("TZ9: CASH → SaleRecord with paymentMethod, no Debt", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
    const res = await sellUnit({
      ...INPUT,
      price: 100,
      paymentMethod: "CASH",
      currency: "UZS",
      customerContact: "+99890",
    });
    expect(res.ok).toBe(true);
    expect(M.debtCreate).not.toHaveBeenCalled();
    expect(M.saleCreate.mock.calls[0][0].data).toMatchObject({
      paymentMethod: "CASH",
      currency: "UZS",
      price: "100.00",
    });
  });

  it("TZ9: CARD → no Debt", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
    await sellUnit({
      ...INPUT,
      price: 50,
      paymentMethod: "CARD",
      currency: "USD",
    });
    expect(M.debtCreate).not.toHaveBeenCalled();
  });

  it("TZ9: CREDIT → exactly one Debt with sale amount + currency", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
    const due = new Date(NOW.getTime() + 3 * DAY_MS);
    const res = await sellUnit({
      ...INPUT,
      price: 2500.5,
      paymentMethod: "CREDIT",
      currency: "USD",
      customerContact: "+998901112233",
      debtDueDate: due,
      debtComment: "до пятницы",
    });
    expect(res.ok).toBe(true);
    expect(M.debtCreate).toHaveBeenCalledTimes(1);
    const d = M.debtCreate.mock.calls[0][0].data;
    expect(d.saleRecordId).toBe("sale1");
    expect(d.currency).toBe("USD");
    expect(d.status).toBe("ACTIVE");
    expect(d.amount.toString()).toBe("2500.5");
    // dueDate normalized to end of Asia/Tashkent day (not bare Date).
    expect(d.dueDate).toBeInstanceOf(Date);
    expect(d.dueDate.getTime()).toBeGreaterThan(due.getTime() - DAY_MS);
  });

  it("TZ9: CREDIT without phone → INVALID_INPUT, no sale/debt", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
    const res = await sellUnit({
      ...INPUT,
      price: 10,
      paymentMethod: "CREDIT",
      currency: "UZS",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_INPUT");
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.debtCreate).not.toHaveBeenCalled();
  });

  it("TZ9: debt create failure after saleCreate → throws (tx rolls back in real Prisma)", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
    M.debtCreate.mockRejectedValue(new Error("db down"));
    await expect(
      sellUnit({
        ...INPUT,
        price: 10,
        paymentMethod: "CREDIT",
        currency: "UZS",
        customerContact: "+1",
      }),
    ).rejects.toThrow("db down");
    expect(M.saleCreate).toHaveBeenCalled();
    expect(M.debtCreate).toHaveBeenCalled();
  });

  it("TZ9: returnSale cancels ACTIVE debt", async () => {
    M.saleFindUnique.mockResolvedValue({
      id: "sale1",
      targetType: "SLAB",
      slabId: "slab1",
      pieceId: null,
      batchId: null,
      batchPatternId: null,
      qtySlabs: null,
      qtyAreaM2: null,
      returnedAt: null,
      paymentMethod: "CREDIT",
    });
    M.debtFindUnique.mockResolvedValue({ id: "debt1", status: "ACTIVE" });
    M.debtUpdateMany.mockResolvedValue({ count: 1 });

    const res = await returnSale({ saleRecordId: "sale1", managerId: "mgr1" });
    expect(res.ok).toBe(true);
    expect(M.debtUpdateMany).toHaveBeenCalledWith({
      where: { id: "debt1", status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });
  });

  it("TZ9: returnSale leaves REPAID debt (scenario A — money collected)", async () => {
    M.saleFindUnique.mockResolvedValue({
      id: "sale1",
      targetType: "SLAB",
      slabId: "slab1",
      pieceId: null,
      batchId: null,
      batchPatternId: null,
      qtySlabs: null,
      qtyAreaM2: null,
      returnedAt: null,
      paymentMethod: "CREDIT",
    });
    M.debtFindUnique.mockResolvedValue({ id: "debt1", status: "REPAID" });

    const res = await returnSale({ saleRecordId: "sale1", managerId: "mgr1" });
    expect(res.ok).toBe(true);
    // Must NOT flip REPAID → CANCELLED / ACTIVE
    expect(M.debtUpdateMany).not.toHaveBeenCalled();
  });

  it("TZ9: executeVolumeSale CREDIT path creates debt (B2B not invisible)", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    const res = await sellBatchVolume({
      batchId: "b1",
      qtySlabs: 2,
      qtyAreaM2: null,
      customerName: "Опт",
      customerContact: "+99890",
      price: 5000,
      paymentMethod: "CREDIT",
      currency: "UZS",
      managerId: "mgr1",
    });
    expect(res.ok).toBe(true);
    expect(M.debtCreate).toHaveBeenCalledTimes(1);
    expect(M.debtCreate.mock.calls[0][0].data).toMatchObject({
      saleRecordId: "sale1",
      currency: "UZS",
      status: "ACTIVE",
    });
  });
});

// ═══════════════ sellBatchVolume ═══════════════

// Хелпер: partiya для volume-продажи.
function batchRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "b1",
    needsCheck: false,
    slabsTotal: 10,
    areaTotalM2: null,
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 0,
    areaSoldDirectM2: 0,
    slabs: [],
    pieces: [],
    reservations: [],
    ...over,
  };
}

describe("sellBatchVolume — объёмная продажа партии (mock-tx)", () => {
  const INPUT = {
    batchId: "b1",
    qtySlabs: 3 as number | null,
    qtyAreaM2: null as number | null,
    customerName: "Оптовик",
    managerId: "mgr1",
  };

  it("oversell по плитам → INSUFFICIENT_REMAINDER, batch.updateMany НЕ вызывается", async () => {
    // slabsTotal=10, продано 9 → free=1; просят 3.
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 9 }));

    const res = await sellBatchVolume(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("INSUFFICIENT_REMAINDER");
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
    // Замок ВСЁ РАВНО должен был взяться первым — регрессия ловится (lock-first).
    expect(M.queryRaw).toHaveBeenCalled();
  });

  it("чужая активная бронь режет доступный остаток → INSUFFICIENT_REMAINDER", async () => {
    // free=10, чужая бронь на 8 (активная) → доступно 2; просят 3.
    M.batchFindUnique.mockResolvedValue(
      batchRow({
        reservations: [
          {
            id: "rOther",
            managerId: "OTHER",
            qtySlabs: 8,
            qtyAreaM2: null,
            expiresAt: FUTURE,
            createdAt: PAST,
          },
        ],
      }),
    );

    const res = await sellBatchVolume(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("INSUFFICIENT_REMAINDER");
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("happy: 3 плиты в 10-плитовую партию → slabsSoldDirect +3, SaleRecord + AuditLog", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());

    const res = await sellBatchVolume(INPUT);

    expect(res.ok).toBe(true);
    expect(M.batchUpdateMany).toHaveBeenCalledTimes(1);
    const upd = M.batchUpdateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: "b1", slabsSoldDirect: 0 });
    expect(upd.data.slabsSoldDirect).toEqual({ increment: 3 });
    expect(M.saleCreate).toHaveBeenCalledTimes(1);
    expect(M.saleCreate.mock.calls[0][0].data.targetType).toBe("BATCH_VOLUME");
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "SALE",
      entityType: "Batch",
    });
  });
});

// ═══════════════ sellWholeBatch ═══════════════

describe("sellWholeBatch — «партию выкупили оптом целиком» (mock-tx)", () => {
  const INPUT = { batchId: "b1", customerName: "Оптовик", managerId: "mgr1" };

  it("остаток пуст (всё уже продано) → INSUFFICIENT_REMAINDER, ничего не пишется", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 10 }));

    const res = await sellWholeBatch(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("INSUFFICIENT_REMAINDER");
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
    expect(M.saleCreate).not.toHaveBeenCalled();
  });

  it("happy: свободные 10 плит уходят целиком → slabsSoldDirect +10, остаток становится 0 (не отрицательный)", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow()); // free=10

    const res = await sellWholeBatch(INPUT);

    expect(res.ok).toBe(true);
    const upd = M.batchUpdateMany.mock.calls[0][0];
    // WHERE: slabsSoldDirect=0 (ожидаемое до продажи); DATA: +10 = ровно free.
    expect(upd.where.slabsSoldDirect).toBe(0);
    expect(upd.data.slabsSoldDirect).toEqual({ increment: 10 });
    // AuditLog помечен wholeBatch:true.
    expect(M.auditCreate.mock.calls[0][0].data.payload.wholeBatch).toBe(true);
  });
});

// ═══════════════ returnSale ═══════════════

describe("returnSale — возврат от клиента (mock-tx)", () => {
  const INPUT = { saleRecordId: "sale1", managerId: "mgr1" };

  it("уже возвращена ранее (returnedAt !== null) → ALREADY_RETURNED, счётчики не двигаются", async () => {
    M.saleFindUnique.mockResolvedValue({
      id: "sale1",
      targetType: "SLAB",
      slabId: "slab1",
      pieceId: null,
      batchId: null,
      batchPatternId: null,
      qtySlabs: null,
      qtyAreaM2: null,
      returnedAt: PAST, // уже возвращена
    });

    const res = await returnSale(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("ALREADY_RETURNED");
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.batchUpdate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("SLAB happy: SOLD → RETURNED+needsCheck; SaleRecord.returnedAt проставлен; AuditLog(RETURN)", async () => {
    M.saleFindUnique.mockResolvedValue({
      id: "sale1",
      targetType: "SLAB",
      slabId: "slab1",
      pieceId: null,
      batchId: null,
      batchPatternId: null,
      qtySlabs: null,
      qtyAreaM2: null,
      returnedAt: null,
    });

    const res = await returnSale(INPUT);

    expect(res.ok).toBe(true);
    // Идемпотентная пометка возврата.
    expect(M.saleUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.saleUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "sale1", returnedAt: null },
    });
    // Slab: SOLD → RETURNED+needsCheck (условный WHERE на SOLD).
    expect(M.slabUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.slabUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "slab1", status: "SOLD" },
      data: { status: "RETURNED", needsCheck: true },
    });
    // AuditLog RETURN.
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("RETURN");
  });

  it("BATCH_VOLUME happy: batch.slabsSoldDirect ДЕКРЕМЕНТ на qtySlabs + needsCheck=true; замок партии взят", async () => {
    M.saleFindUnique.mockResolvedValue({
      id: "sale1",
      targetType: "BATCH_VOLUME",
      slabId: null,
      pieceId: null,
      batchId: "b1",
      batchPatternId: null,
      qtySlabs: 4,
      qtyAreaM2: null,
      returnedAt: null,
    });

    const res = await returnSale(INPUT);

    expect(res.ok).toBe(true);
    // Замок партии ДО декремента.
    expect(M.queryRaw).toHaveBeenCalled();
    expect(M.batchUpdate).toHaveBeenCalledTimes(1);
    const upd = M.batchUpdate.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "b1" });
    expect(upd.data.slabsSoldDirect).toEqual({ decrement: 4 });
    expect(upd.data.needsCheck).toBe(true);
  });
});

// ═══════════════ confirmReturnedUnit ═══════════════

describe("confirmReturnedUnit — подтверждение возврата (mock-tx)", () => {
  const INPUT = {
    targetType: "SLAB" as const,
    unitId: "slab1",
    managerId: "mgr1",
  };

  it("не в статусе RETURNED (условный UPDATE вернул 0 строк) → NOT_RETURNED, audit не пишется", async () => {
    M.slabFindUnique.mockResolvedValue({ id: "slab1", status: "RETURNED" });
    M.slabUpdateMany.mockResolvedValue({ count: 0 }); // гонка / уже подтверждён

    const res = await confirmReturnedUnit(INPUT);

    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("NOT_RETURNED");
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("happy: RETURNED → AVAILABLE (needsCheck=false), AuditLog пишется", async () => {
    M.slabFindUnique.mockResolvedValue({ id: "slab1", status: "RETURNED" });
    M.slabUpdateMany.mockResolvedValue({ count: 1 });

    const res = await confirmReturnedUnit(INPUT);

    expect(res.ok).toBe(true);
    expect(M.slabUpdateMany).toHaveBeenCalledTimes(1);
    const upd = M.slabUpdateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: "slab1", status: "RETURNED" });
    expect(upd.data).toMatchObject({ status: "AVAILABLE", needsCheck: false });
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
  });
});


// ═══════════════ TZ №10+11 Этап 2 — clientId / siteId ═══════════════

describe("sellUnit — client directory links (TZ №10+11 §6)", () => {
  const BASE = {
    targetType: "SLAB" as const,
    unitId: "slab1",
    customerName: "Иван",
    managerId: "mgr1",
    price: 100,
    paymentMethod: "CASH" as const,
    currency: "UZS" as const,
    customerContact: "+998901234567",
  };

  function availableSlab() {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
      reservations: [],
    });
  }

  it("selected client, no site → SaleRecord.clientId set, siteId null", async () => {
    availableSlab();
    const res = await sellUnit({
      ...BASE,
      clientId: "client-1",
      siteId: null,
    });
    expect(res.ok).toBe(true);
    const data = M.saleCreate.mock.calls[0][0].data;
    expect(data.clientId).toBe("client-1");
    expect(data.siteId).toBeNull();
    expect(data.customerName).toBe("Иван");
  });

  it("selected client + site → both FKs written", async () => {
    availableSlab();
    const res = await sellUnit({
      ...BASE,
      clientId: "client-1",
      siteId: "site-9",
    });
    expect(res.ok).toBe(true);
    const data = M.saleCreate.mock.calls[0][0].data;
    expect(data.clientId).toBe("client-1");
    expect(data.siteId).toBe("site-9");
  });

  it("legacy sale without clientId still works (nullable compatibility)", async () => {
    availableSlab();
    const res = await sellUnit({
      targetType: "SLAB",
      unitId: "slab1",
      customerName: "Старый текст",
      managerId: "mgr1",
    });
    expect(res.ok).toBe(true);
    const data = M.saleCreate.mock.calls[0][0].data;
    expect(data.clientId).toBeNull();
    expect(data.siteId).toBeNull();
    expect(data.customerName).toBe("Старый текст");
  });

  it("CREDIT + clientId → Debt gets clientId denormalized", async () => {
    availableSlab();
    const res = await sellUnit({
      ...BASE,
      paymentMethod: "CREDIT",
      currency: "USD",
      price: 50,
      clientId: "client-debt",
      customerContact: "+998901112233",
    });
    expect(res.ok).toBe(true);
    expect(M.debtCreate).toHaveBeenCalledTimes(1);
    expect(M.debtCreate.mock.calls[0][0].data.clientId).toBe("client-debt");
  });

  it("empty customerName still rejected (history invariant)", async () => {
    availableSlab();
    const res = await sellUnit({
      targetType: "SLAB",
      unitId: "slab1",
      customerName: "   ",
      managerId: "mgr1",
      clientId: "c1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_INPUT");
    expect(M.saleCreate).not.toHaveBeenCalled();
  });
});

describe("sellBatchVolume — clientId/siteId passthrough", () => {
  it("volume sale stores client + site", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    M.batchUpdateMany.mockResolvedValue({ count: 1 });
    const res = await sellBatchVolume({
      batchId: "b1",
      qtySlabs: 2,
      qtyAreaM2: null,
      customerName: "ООО Строй",
      managerId: "mgr1",
      price: 1000,
      paymentMethod: "CARD",
      currency: "UZS",
      clientId: "c-b2b",
      siteId: "s-riviera",
    });
    expect(res.ok).toBe(true);
    const data = M.saleCreate.mock.calls[0][0].data;
    expect(data.clientId).toBe("c-b2b");
    expect(data.siteId).toBe("s-riviera");
  });
});
