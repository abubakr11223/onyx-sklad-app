// Аудит ТЗ №7 #4 — breaking.ts transactional mutators (breakSlab / splitSlab /
// registerDirectPiece / registerDirectPiecesMany) без тестов. breaking.test.ts
// покрывает только чистые деcidеры. Здесь mock-tx: db.$transaction(cb) → cb(tx);
// tx — все Prisma-методы vi.fn'ами.

import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    slabFindUnique: fn(),
    slabUpdateMany: fn(),
    batchFindUnique: fn(),
    pieceCreate: fn(),
    reservationFindFirst: fn(),
    reservationUpdate: fn(),
    saleCreate: fn(),
    auditCreate: fn(),
    queryRaw: fn(),
  };
});

const tx = {
  slab: { findUnique: M.slabFindUnique, updateMany: M.slabUpdateMany },
  batch: { findUnique: M.batchFindUnique },
  piece: { create: M.pieceCreate },
  reservation: {
    findFirst: M.reservationFindFirst,
    update: M.reservationUpdate,
  },
  saleRecord: { create: M.saleCreate },
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
  breakSlab,
  splitSlab,
  registerDirectPiece,
  registerDirectPiecesMany,
  BreakError,
  type BreakCause,
  type PieceInput,
} from "@/lib/breaking";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.slabUpdateMany.mockResolvedValue({ count: 1 });
  M.pieceCreate.mockImplementation(async () => ({
    id: `piece-${Math.floor(Math.random() * 1e9)}`,
  }));
  M.reservationFindFirst.mockResolvedValue(null);
  M.reservationUpdate.mockResolvedValue({});
  M.saleCreate.mockResolvedValue({ id: "sale1" });
  M.auditCreate.mockResolvedValue({});
  M.queryRaw.mockResolvedValue([]);
});

const PIECE: PieceInput = {
  kind: "BROKEN",
  sidesMm: [11, 64, 95, 61],
  boundingLengthMm: 118,
  boundingWidthMm: 64,
  thicknessMm: 2,
  areaM2: 0.6,
  block: "А",
  landmark: "2",
};

/** TZ §5.6 cause — required metadata on every path. */
const CAUSE: BreakCause = {
  code: "MOVE_BREAK",
  labelRu: "Бой при перемещении",
  otherNote: null,
};

// ═══════════════ breakSlab ═══════════════

describe("breakSlab — плита → BROKEN_OFFCUT + Piece[] + AuditLog (mock-tx)", () => {
  const PARAMS = {
    slabId: "slab1",
    pieces: [PIECE],
    byUserId: "u1",
    cause: CAUSE,
  };

  it("нет ни одного куска → NO_PIECES, БЕЗ transitionSlab", async () => {
    await expect(
      breakSlab({ slabId: "slab1", pieces: [], byUserId: "u1", cause: CAUSE }),
    ).rejects.toMatchObject({ code: "NO_PIECES" });
    expect(M.slabFindUnique).not.toHaveBeenCalled();
    expect(M.pieceCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("плита SOLD (canBreak запрещает) → BreakError, куски НЕ создаются", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      status: "SOLD",
    });

    await expect(breakSlab(PARAMS)).rejects.toBeInstanceOf(BreakError);
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.pieceCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("параллельно уже сломали (0 строк условного UPDATE) → SLAB_STATUS_CHANGED, Piece НЕ создаются", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      status: "AVAILABLE",
    });
    M.slabUpdateMany.mockResolvedValue({ count: 0 });

    await expect(breakSlab(PARAMS)).rejects.toMatchObject({
      code: "SLAB_STATUS_CHANGED",
    });
    expect(M.pieceCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("happy: AVAILABLE → BROKEN_OFFCUT + Piece(originSlabId=slab1) + Audit BREAK", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      status: "AVAILABLE",
    });

    const res = await breakSlab(PARAMS);

    expect(res.pieceIds).toHaveLength(1);
    // Условный WHERE: id + status=AVAILABLE.
    expect(M.slabUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "slab1", status: "AVAILABLE" },
      data: { status: "BROKEN_OFFCUT" },
    });
    // Piece с originSlabId=slab1 (в §3 НЕ участвует).
    expect(M.pieceCreate).toHaveBeenCalledTimes(1);
    expect(M.pieceCreate.mock.calls[0][0].data).toMatchObject({
      batchId: "b1",
      originSlabId: "slab1",
      block: "А",
      landmark: "2",
    });
    // Audit + §5.6 cause fields (metadata, not inventory).
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "BREAK",
      entityType: "Slab",
      entityId: "slab1",
      payload: {
        breakReason: "MOVE_BREAK",
        breakReasonLabel: "Бой при перемещении",
        breakReasonNote: null,
      },
    });
  });

  it("причина с битым code → INVALID_CAUSE, учёт не тронут", async () => {
    await expect(
      breakSlab({
        slabId: "slab1",
        pieces: [PIECE],
        byUserId: "u1",
        // @ts-expect-error intentional bad code
        cause: { code: "NOT_A_REASON", labelRu: "x", otherNote: null },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CAUSE" });
    expect(M.slabFindUnique).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("RESERVED (canBreak.cancelsReservation) → бронь CANCELLED + Audit RESERVE_CANCEL + BREAK", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      status: "RESERVED",
    });
    M.reservationFindFirst.mockResolvedValue({
      id: "r1",
      managerId: "mgrX",
      customerName: "K",
    });

    const res = await breakSlab(PARAMS);

    expect(res.cancelledReservationId).toBe("r1");
    // Бронь CANCELLED — одна запись.
    expect(M.reservationUpdate).toHaveBeenCalledTimes(1);
    expect(M.reservationUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: "r1" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
    // Два audit'а: RESERVE_CANCEL + BREAK.
    expect(M.auditCreate).toHaveBeenCalledTimes(2);
    const actions = M.auditCreate.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(expect.arrayContaining(["RESERVE_CANCEL", "BREAK"]));
  });
});

// ═══════════════ splitSlab ═══════════════

describe("splitSlab — распил: часть клиенту + остатки (mock-tx)", () => {
  const WORKSHOP: BreakCause = {
    code: "WORKSHOP_CUT",
    labelRu: "Распил в цехе (изделие)",
    otherNote: null,
  };

  it("пустые остатки → NO_PIECES, ни SaleRecord ни Piece не пишутся", async () => {
    await expect(
      splitSlab({
        slabId: "slab1",
        remainderPieces: [],
        byUserId: "u1",
        soldPart: { customerName: "K", price: 100 },
        cause: WORKSHOP,
      }),
    ).rejects.toMatchObject({ code: "NO_PIECES" });
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.pieceCreate).not.toHaveBeenCalled();
  });

  it("happy без sold: плита BROKEN_OFFCUT + Piece[]; SaleRecord НЕ создаётся; cause в AuditLog", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      status: "AVAILABLE",
    });

    const res = await splitSlab({
      slabId: "slab1",
      remainderPieces: [PIECE],
      byUserId: "u1",
      cause: WORKSHOP,
    });

    expect(res.soldSaleId).toBeNull();
    expect(M.saleCreate).not.toHaveBeenCalled();
    expect(M.pieceCreate).toHaveBeenCalledTimes(1);
    // Piece — с originSlabId (в §3 не участвует).
    expect(M.pieceCreate.mock.calls[0][0].data.originSlabId).toBe("slab1");
    // Один AuditLog SPLIT + cause.
    const splitAudit = M.auditCreate.mock.calls.find(
      (c) => c[0].data.action === "SPLIT",
    );
    expect(splitAudit?.[0].data.payload).toMatchObject({
      breakReason: "WORKSHOP_CUT",
      breakReasonLabel: "Распил в цехе (изделие)",
    });
  });

  it("happy с soldPart: SaleRecord(targetType:SLAB, slabId) создан ОДНОЙ транзакцией", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "slab1",
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      status: "AVAILABLE",
    });

    const res = await splitSlab({
      slabId: "slab1",
      remainderPieces: [PIECE],
      byUserId: "u1",
      soldPart: { customerName: "K", price: 1500 },
      cause: WORKSHOP,
    });

    expect(res.soldSaleId).toBe("sale1");
    expect(M.saleCreate).toHaveBeenCalledTimes(1);
    expect(M.saleCreate.mock.calls[0][0].data).toMatchObject({
      targetType: "SLAB",
      slabId: "slab1",
    });
  });
});

// ═══════════════ registerDirectPiece ═══════════════

function batchRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "b1",
    stoneTypeId: "st1",
    slabsTotal: 10,
    areaTotalM2: null,
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 0,
    areaSoldDirectM2: 0,
    slabs: [],
    pieces: [],
    ...over,
  };
}

describe("registerDirectPiece — прямой бой (без плиты) + guard §3 (mock-tx)", () => {
  const PARAMS = {
    ...PIECE,
    batchId: "b1",
    decrementSlabs: true,
    byUserId: "u1",
    cause: CAUSE,
  };

  it("oversell: партия полностью распродана (free=0), decrementSlabs=true → INSUFFICIENT_REMAINDER; Piece НЕ пишется", async () => {
    // slabsTotal=10, sold=10 → free=0; новый прямой бой даст slabsFree=-1.
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 10 }));

    await expect(registerDirectPiece(PARAMS)).rejects.toMatchObject({
      code: "INSUFFICIENT_REMAINDER",
    });
    expect(M.pieceCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
    // Замок ВСЁ РАВНО взят первым (регрессия на lock-first).
    expect(M.queryRaw).toHaveBeenCalled();
  });

  it("happy: free=5, decrementSlabs=true → Piece(originSlabId:null) + Audit + slabsFreeAfter=4", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 5 }));

    const res = await registerDirectPiece(PARAMS);

    expect(M.pieceCreate).toHaveBeenCalledTimes(1);
    expect(M.pieceCreate.mock.calls[0][0].data).toMatchObject({
      originSlabId: null,
      batchId: "b1",
      block: "А",
    });
    expect(res.slabsFreeAfter).toBe(4);
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "BREAK",
      entityType: "Piece",
      payload: expect.objectContaining({
        direct: true,
        decrementSlabs: true,
        breakReason: "MOVE_BREAK",
        breakReasonLabel: "Бой при перемещении",
      }),
    });
  });

  it("партия не найдена → BATCH_NOT_FOUND, Piece НЕ пишется", async () => {
    M.batchFindUnique.mockResolvedValue(null);

    await expect(registerDirectPiece(PARAMS)).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
    });
    expect(M.pieceCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════ registerDirectPiecesMany ═══════════════

describe("registerDirectPiecesMany — многострочный бой, all-or-nothing (mock-tx)", () => {
  it("одна из строк невалидна (assertValidPieceInput) → все отклоняются, НИ ОДИН Piece", async () => {
    const bad: PieceInput = {
      ...PIECE,
      block: "", // невалидный — assertValidPieceInput кинет
    };

    await expect(
      registerDirectPiecesMany({
        rows: [PIECE, bad],
        batchId: "b1",
        decrementSlabs: false,
        byUserId: "u1",
        cause: CAUSE,
      }),
    ).rejects.toBeInstanceOf(BreakError);
    // Даже первую (валидную) строку не сохранили.
    expect(M.pieceCreate).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("агрегат превышает free (free=2, просят 3) → INSUFFICIENT_REMAINDER; ни одна строка не сохранена", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 8 })); // free=2

    await expect(
      registerDirectPiecesMany({
        rows: [PIECE, PIECE, PIECE], // 3 куска, каждый −1 slab
        batchId: "b1",
        decrementSlabs: true,
        byUserId: "u1",
        cause: CAUSE,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_REMAINDER" });
    expect(M.pieceCreate).not.toHaveBeenCalled();
  });

  it("happy: 3 строки в свободные 5 → 3 Piece + AuditLog с cause + slabsFreeAfter=2", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow({ slabsSoldDirect: 5 })); // free=5

    const res = await registerDirectPiecesMany({
      rows: [PIECE, PIECE, PIECE],
      batchId: "b1",
      decrementSlabs: true,
      byUserId: "u1",
      cause: CAUSE,
    });

    expect(res.pieceIds).toHaveLength(3);
    expect(M.pieceCreate).toHaveBeenCalledTimes(3);
    // Все с originSlabId:null.
    for (const call of M.pieceCreate.mock.calls) {
      expect(call[0].data.originSlabId).toBeNull();
    }
    expect(res.slabsFreeAfter).toBe(2);
    // Один агрегированный AuditLog BREAK (не по одному на кусок).
    const breakCalls = M.auditCreate.mock.calls.filter(
      (c) => c[0].data.action === "BREAK",
    );
    expect(breakCalls.length).toBeGreaterThanOrEqual(1);
  });
});
