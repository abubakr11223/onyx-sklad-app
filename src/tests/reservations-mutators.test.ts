// Аудит ТЗ №7 #3 — reservations.ts transactional mutators
// (reserveUnit / reserveBatchVolume / cancelReservation / expireOverdueReservations)
// не покрыты тестами. Mock-tx: db.$transaction(cb) → cb(tx); tx — Prisma-методы
// как vi.fn'ы. Мин. набор: чужая бронь / oversell → fail БЕЗ записи; успех →
// счётчики / статусы верны + Reservation.create + AuditLog.

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    userFindUnique: fn(),
    appConfigFindUnique: fn(),
    slabUpdateMany: fn(),
    pieceUpdateMany: fn(),
    batchFindUnique: fn(),
    reservationCreate: fn(),
    reservationFindUnique: fn(),
    reservationUpdateMany: fn(),
    reservationFindMany: fn(), // expireOverdueReservations
    auditCreate: fn(),
    queryRaw: fn(), // lockBatchForUpdate
  };
});

const tx = {
  user: { findUnique: M.userFindUnique },
  appConfig: { findUnique: M.appConfigFindUnique },
  slab: { updateMany: M.slabUpdateMany },
  piece: { updateMany: M.pieceUpdateMany },
  batch: { findUnique: M.batchFindUnique },
  reservation: {
    create: M.reservationCreate,
    findUnique: M.reservationFindUnique,
    updateMany: M.reservationUpdateMany,
  },
  auditLog: { create: M.auditCreate },
  $queryRaw: M.queryRaw,
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (
      cbOrArgs:
        | ((tx: unknown) => Promise<unknown>)
        | Array<unknown>,
      // Второй аргумент — { isolationLevel: ... } у reserveBatchVolume; игнорируем.
      _opts?: unknown,
    ) => {
      if (typeof cbOrArgs === "function") return cbOrArgs(tx);
      return Promise.all(cbOrArgs);
    },
    reservation: { findMany: M.reservationFindMany }, // используется expireOverdue до транзакции
  },
}));

// ── Импорт ПОСЛЕ моков ──
import {
  reserveUnit,
  reserveBatchVolume,
  cancelReservation,
  expireOverdueReservations,
  ReservationError,
} from "@/lib/reservations";

// W11-C: product code compares expiresAt to wall-clock `new Date()` inside
// reserveBatchVolume (sumActiveVolumeHolds). Absolute FUTURE="2026-08-01" expired
// on that calendar day and made ACTIVE-hold fixtures look expired. Keep fixtures
// relative to load-time NOW so they never cross "today".
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const FUTURE = new Date(NOW.getTime() + 7 * DAY_MS);
const PAST = new Date(NOW.getTime() - 7 * DAY_MS);

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  // Разумные дефолты.
  M.userFindUnique.mockResolvedValue({ id: "mgr1", role: "MANAGER", isActive: true });
  M.appConfigFindUnique.mockResolvedValue(null); // default дней
  M.slabUpdateMany.mockResolvedValue({ count: 1 });
  M.pieceUpdateMany.mockResolvedValue({ count: 1 });
  M.reservationCreate.mockResolvedValue({ id: "res1" });
  M.reservationUpdateMany.mockResolvedValue({ count: 1 });
  M.reservationFindMany.mockResolvedValue([]);
  M.auditCreate.mockResolvedValue({});
  M.queryRaw.mockResolvedValue([]);
});

// ═══════════════ reserveUnit ═══════════════

describe("reserveUnit — единичная бронь (mock-tx, ТЗ №7 #3)", () => {
  const INPUT = {
    targetType: "SLAB" as const,
    unitId: "slab1",
    customerName: "Клиент",
    managerId: "mgr1",
    days: 3,
  };

  it("единица уже RESERVED/SOLD (условный flip вернул 0 строк) → UNIT_UNAVAILABLE; ни Reservation, ни Audit", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });

    await expect(reserveUnit(INPUT)).rejects.toMatchObject({
      name: "ReservationError",
      code: "UNIT_UNAVAILABLE",
    });
    expect(M.reservationCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("гонка P2002 (partial unique одной активной брони на единицу) → UNIT_UNAVAILABLE", async () => {
    // Slab flip прошёл, но параллельная бронь уже создана → P2002 на reservation.create.
    const { Prisma } = await import("@prisma/client");
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "n/a",
    });
    M.reservationCreate.mockRejectedValue(conflict);

    await expect(reserveUnit(INPUT)).rejects.toMatchObject({
      code: "UNIT_UNAVAILABLE",
    });
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("happy: AVAILABLE → RESERVED + Reservation ACTIVE + AuditLog(RESERVE) с expiresAt", async () => {
    const res = await reserveUnit(INPUT);

    expect(res.reservationId).toBe("res1");
    // Условный flip: WHERE фиксирует AVAILABLE + needsCheck=false.
    expect(M.slabUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.slabUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: "slab1",
      status: "AVAILABLE",
      needsCheck: false,
    });
    // Reservation ACTIVE с expiresAt.
    const created = M.reservationCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      targetType: "SLAB",
      slabId: "slab1",
      managerId: "mgr1",
      customerName: "Клиент",
      status: "ACTIVE",
    });
    expect(created.expiresAt).toBeInstanceOf(Date);
    // Audit.
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("RESERVE");
  });
});

// ═══════════════ reserveBatchVolume ═══════════════

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
    samples: [],
    ...over,
  };
}

describe("reserveBatchVolume — B2B volume-бронь (mock-tx, ТЗ №7 #3)", () => {
  const INPUT = {
    batchId: "b1",
    qtySlabs: 3 as number | null,
    qtyAreaM2: null as number | null,
    customerName: "Оптовик",
    managerId: "mgr1",
    days: 3,
  };

  it("oversell по плитам (free=1, просят 3) → VOLUME_EXCEEDED; Reservation НЕ создаётся", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 9 })); // free=1

    await expect(reserveBatchVolume(INPUT)).rejects.toMatchObject({
      code: "VOLUME_EXCEEDED",
    });
    expect(M.reservationCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
    // Замок ВСЁ РАВНО взят первым (регрессия на lock-first).
    expect(M.queryRaw).toHaveBeenCalled();
  });

  it("чужие активные volume-брони съедают остаток (free=10, hold=8, просят 3) → VOLUME_EXCEEDED", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({
        reservations: [
          { qtySlabs: 8, qtyAreaM2: null, expiresAt: FUTURE },
        ],
      }),
    );

    await expect(reserveBatchVolume(INPUT)).rejects.toMatchObject({
      code: "VOLUME_EXCEEDED",
    });
    expect(M.reservationCreate).not.toHaveBeenCalled();
  });

  it("W1-T1: активные BATCH_VOLUME-образцы тоже съедают остаток (free=10, образец=8, просят 3) → VOLUME_EXCEEDED", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({ samples: [{ qtySlabs: 8, qtyAreaM2: null }] }),
    );

    await expect(reserveBatchVolume(INPUT)).rejects.toMatchObject({
      code: "VOLUME_EXCEEDED",
    });
    expect(M.reservationCreate).not.toHaveBeenCalled();
  });

  it("W1-T1: истёкшая бронь + образец: считается только образец (free=10, dead-бронь 9, образец 3, просят 3) → ok", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({
        reservations: [{ qtySlabs: 9, qtyAreaM2: null, expiresAt: PAST }],
        samples: [{ qtySlabs: 3, qtyAreaM2: null }],
      }),
    );

    const res = await reserveBatchVolume(INPUT); // просят 3, доступно 10−3=7
    expect(res.reservationId).toBe("res1");
  });

  it("happy: free=10, holds=0, просят 3 → Reservation BATCH_VOLUME ACTIVE + AuditLog", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());

    const res = await reserveBatchVolume(INPUT);

    expect(res.reservationId).toBe("res1");
    const created = M.reservationCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      targetType: "BATCH_VOLUME",
      batchId: "b1",
      qtySlabs: 3,
      status: "ACTIVE",
    });
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "RESERVE",
      entityType: "Batch",
    });
  });

  it("partiya needsCheck=true → UNIT_UNAVAILABLE, Reservation НЕ создаётся", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow({ needsCheck: true }));

    await expect(reserveBatchVolume(INPUT)).rejects.toMatchObject({
      code: "UNIT_UNAVAILABLE",
    });
    expect(M.reservationCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════ cancelReservation ═══════════════

describe("cancelReservation — отмена брони (mock-tx, ТЗ №7 #3)", () => {
  it("не владелец и не OWNER → FORBIDDEN; статус НЕ меняется", async () => {
    M.reservationFindUnique.mockResolvedValue({
      id: "r1",
      targetType: "SLAB",
      slabId: "s1",
      pieceId: null,
      batchId: null,
      managerId: "OTHER",
      customerName: "K",
    });
    // Actor — MANAGER (не OWNER) и не владелец брони.
    M.userFindUnique.mockResolvedValue({
      id: "mgr2",
      role: "MANAGER",
      isActive: true,
    });

    await expect(cancelReservation("r1", "mgr2")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(M.reservationUpdateMany).not.toHaveBeenCalled();
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("бронь уже не ACTIVE (0 строк) → NOT_ACTIVE; единица не возвращается", async () => {
    M.reservationFindUnique.mockResolvedValue({
      id: "r1",
      targetType: "SLAB",
      slabId: "s1",
      pieceId: null,
      batchId: null,
      managerId: "mgr1",
      customerName: "K",
    });
    M.reservationUpdateMany.mockResolvedValue({ count: 0 }); // гонка

    await expect(cancelReservation("r1", "mgr1")).rejects.toMatchObject({
      code: "NOT_ACTIVE",
    });
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("happy (владелец, SLAB): CANCELLED + Slab RESERVED→AVAILABLE + AuditLog(RESERVE_CANCEL)", async () => {
    M.reservationFindUnique.mockResolvedValue({
      id: "r1",
      targetType: "SLAB",
      slabId: "s1",
      pieceId: null,
      batchId: null,
      managerId: "mgr1",
      customerName: "K",
    });

    await cancelReservation("r1", "mgr1");

    expect(M.reservationUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.reservationUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "r1", status: "ACTIVE" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(M.slabUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.slabUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "s1", status: "RESERVED" },
      data: { status: "AVAILABLE" },
    });
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("RESERVE_CANCEL");
  });

  it("OWNER может отменить ЧУЖУЮ бронь", async () => {
    M.reservationFindUnique.mockResolvedValue({
      id: "r1",
      targetType: "SLAB",
      slabId: "s1",
      pieceId: null,
      batchId: null,
      managerId: "OTHER",
      customerName: "K",
    });
    M.userFindUnique.mockResolvedValue({
      id: "owner1",
      role: "OWNER",
      isActive: true,
    });

    await cancelReservation("r1", "owner1");
    expect(M.reservationUpdateMany).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════ expireOverdueReservations ═══════════════

describe("expireOverdueReservations — sweep (mock-tx, ТЗ №7 #3)", () => {
  it("нет просроченных → 0, ни один updateMany не вызывается", async () => {
    M.reservationFindMany.mockResolvedValue([]);

    const n = await expireOverdueReservations();

    expect(n).toBe(0);
    expect(M.reservationUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("выбираются только status=ACTIVE И expiresAt<now (регрессия на фильтре)", async () => {
    M.reservationFindMany.mockResolvedValue([]);
    await expireOverdueReservations();

    expect(M.reservationFindMany).toHaveBeenCalledTimes(1);
    const where = M.reservationFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    // expiresAt: { lt: now } — сохраняем ключевую защиту.
    expect(where.expiresAt).toEqual(expect.objectContaining({ lt: expect.any(Date) }));
  });

  it("одна просроченная SLAB-бронь → EXPIRED + Slab AVAILABLE + Audit RESERVE_EXPIRE (userId:null)", async () => {
    M.reservationFindMany.mockResolvedValue([
      {
        id: "r1",
        targetType: "SLAB",
        slabId: "s1",
        pieceId: null,
        batchId: null,
        customerName: "K",
        expiresAt: PAST,
      },
    ]);

    const n = await expireOverdueReservations();

    expect(n).toBe(1);
    // Бронь → EXPIRED (условно, only if ACTIVE).
    expect(M.reservationUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.reservationUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "r1", status: "ACTIVE" },
      data: expect.objectContaining({ status: "EXPIRED" }),
    });
    // Slab RESERVED → AVAILABLE.
    expect(M.slabUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "s1", status: "RESERVED" },
      data: { status: "AVAILABLE" },
    });
    // Audit: userId=null (системное действие §1.10).
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: null,
      action: "RESERVE_EXPIRE",
    });
  });

  it("параллельный sweep уже закрыл бронь (0 строк) → счётчик не растёт, audit не пишется", async () => {
    M.reservationFindMany.mockResolvedValue([
      {
        id: "r1",
        targetType: "SLAB",
        slabId: "s1",
        pieceId: null,
        batchId: null,
        customerName: "K",
        expiresAt: PAST,
      },
    ]);
    M.reservationUpdateMany.mockResolvedValue({ count: 0 }); // гонка

    const n = await expireOverdueReservations();

    expect(n).toBe(0);
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });
});

// Санити: класс ошибки экспортирован (бот/UI смогут отличить причину без парсинга строк).
describe("ReservationError — экспорт", () => {
  it("код передаётся вызывающему", () => {
    const e = new ReservationError("VOLUME_EXCEEDED", "нет остатка");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("VOLUME_EXCEEDED");
  });
});
