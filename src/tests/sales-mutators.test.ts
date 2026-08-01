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
