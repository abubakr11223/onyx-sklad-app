// W7-C — TZ §7 «похожие варианты» after a failed reservation.
// Pure helpers + findReservationAlternatives with a mock db (no real DB).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUTTING_MARGIN_MM } from "@/lib/inventory";
import {
  gabaritNeedFromDims,
  presentReservationAlternative,
  presentReservationAlternatives,
  similarAvailablePiecesWhere,
  findReservationAlternatives,
  MAX_RESERVATION_ALTERNATIVES,
  type ReservationAlternativeRaw,
} from "@/lib/reservations";

describe("gabaritNeedFromDims — same margin as /poisk", () => {
  it("adds CUTTING_MARGIN_MM (20) and orders max/min", () => {
    expect(gabaritNeedFromDims(1200, 700)).toEqual({
      needMax: 1200 + CUTTING_MARGIN_MM,
      needMin: 700 + CUTTING_MARGIN_MM,
    });
    expect(gabaritNeedFromDims(700, 1200)).toEqual({
      needMax: 1200 + CUTTING_MARGIN_MM,
      needMin: 700 + CUTTING_MARGIN_MM,
    });
  });

  it("null/invalid dims → null (type-only similarity)", () => {
    expect(gabaritNeedFromDims(null, 700)).toBeNull();
    expect(gabaritNeedFromDims(1200, null)).toBeNull();
    expect(gabaritNeedFromDims(0, 700)).toBeNull();
    expect(gabaritNeedFromDims(-1, 700)).toBeNull();
  });
});

describe("similarAvailablePiecesWhere — reuses poisk OR rotation", () => {
  it("without need: AVAILABLE + type + exclude, no OR", () => {
    const w = similarAvailablePiecesWhere("st1", "p-failed", null);
    expect(w).toMatchObject({
      status: "AVAILABLE",
      needsCheck: false,
      stoneTypeId: "st1",
      id: { not: "p-failed" },
    });
    expect(w.OR).toBeUndefined();
  });

  it("with need: same 90° OR as piecesWhere (poisk-search)", () => {
    const need = { needMax: 1220, needMin: 720 };
    const w = similarAvailablePiecesWhere("st1", "p1", need);
    expect(w.OR).toEqual([
      {
        boundingLengthMm: { gte: 1220 },
        boundingWidthMm: { gte: 720 },
      },
      {
        boundingLengthMm: { gte: 720 },
        boundingWidthMm: { gte: 1220 },
      },
    ]);
  });
});

describe("presentReservationAlternative — canSeeExactRemainder gate", () => {
  const raw: ReservationAlternativeRaw = {
    target: "SLAB:s2",
    kind: "SLAB",
    stoneTypeName: "Травертин Classic",
    kindRu: "Плита №2",
    detail: "2800×1900 мм",
    place: "Блок А, ор. 2",
    freeText: null,
  };

  it("high visibility: place kept (manager/owner)", () => {
    const a = presentReservationAlternative(raw, true);
    expect(a.place).toBe("Блок А, ор. 2");
    expect(a.detail).toBe("2800×1900 мм");
    expect(a.inStockLabel).toBeNull();
  });

  it("low visibility: place and freeText stripped, neutral stock label", () => {
    const withFree: ReservationAlternativeRaw = {
      ...raw,
      freeText: "~5 плит",
    };
    const a = presentReservationAlternative(withFree, false);
    expect(a.place).toBeNull();
    expect(a.freeText).toBeNull();
    expect(a.inStockLabel).toBe("В наличии");
    // dimensions are not warehouse remainder secrets
    expect(a.detail).toBe("2800×1900 мм");
    expect(a.stoneTypeName).toBe("Травертин Classic");
  });

  it("presentReservationAlternatives maps a list", () => {
    const out = presentReservationAlternatives([raw], false);
    expect(out).toHaveLength(1);
    expect(out[0].place).toBeNull();
    expect(out[0].inStockLabel).toBe("В наличии");
  });
});

// ── findReservationAlternatives with mock db ──

const M = vi.hoisted(() => ({
  slabFindUnique: vi.fn(),
  slabFindMany: vi.fn(),
  pieceFindUnique: vi.fn(),
  pieceFindMany: vi.fn(),
  batchFindUnique: vi.fn(),
}));

function mockDb() {
  return {
    slab: {
      findUnique: M.slabFindUnique,
      findMany: M.slabFindMany,
    },
    piece: {
      findUnique: M.pieceFindUnique,
      findMany: M.pieceFindMany,
    },
    batch: {
      findUnique: M.batchFindUnique,
    },
  };
}

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.slabFindMany.mockResolvedValue([]);
  M.pieceFindMany.mockResolvedValue([]);
});

describe("findReservationAlternatives", () => {
  it("no alternatives exist → empty list (failure stays a failure)", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "s1",
      lengthMm: 2000,
      widthMm: 1000,
      stoneTypeId: "st1",
      stoneType: { name: "Мрамор" },
    });
    M.slabFindMany.mockResolvedValue([]);
    M.pieceFindMany.mockResolvedValue([]);

    const alts = await findReservationAlternatives(
      {
        targetType: "SLAB",
        unitId: "s1",
        canSeeExactRemainder: true,
      },
      { db: mockDb() },
    );
    expect(alts).toEqual([]);
    expect(M.slabFindMany).toHaveBeenCalled();
    // Bound: take must not exceed cap
    const call = M.slabFindMany.mock.calls[0][0] as { take: number };
    expect(call.take).toBeLessThanOrEqual(MAX_RESERVATION_ALTERNATIVES);
  });

  it("alternatives exist → same type units, failure not reserved", async () => {
    M.slabFindUnique.mockResolvedValue({
      id: "s1",
      lengthMm: 2000,
      widthMm: 1000,
      stoneTypeId: "st1",
      stoneType: { name: "Мрамор" },
    });
    M.slabFindMany.mockResolvedValue([
      {
        id: "s2",
        label: "Плита №2",
        lengthMm: 2100,
        widthMm: 1100,
        block: "Б",
        landmark: "3",
        stoneType: { name: "Мрамор" },
      },
    ]);
    M.pieceFindMany.mockResolvedValue([]);

    const alts = await findReservationAlternatives(
      {
        targetType: "SLAB",
        unitId: "s1",
        canSeeExactRemainder: true,
      },
      { db: mockDb() },
    );
    expect(alts).toHaveLength(1);
    expect(alts[0].target).toBe("SLAB:s2");
    expect(alts[0].place).toBe("Блок Б, ор. 3");
    expect(alts[0].kindRu).toBe("Плита №2");
    // where: exclude failed + AVAILABLE only
    const where = (M.slabFindMany.mock.calls[0][0] as { where: Record<string, unknown> })
      .where;
    expect(where).toMatchObject({
      status: "AVAILABLE",
      needsCheck: false,
      stoneTypeId: "st1",
      id: { not: "s1" },
    });
  });

  it("low-visibility role: no place, has «В наличии»", async () => {
    M.pieceFindUnique.mockResolvedValue({
      id: "p1",
      boundingLengthMm: 1200,
      boundingWidthMm: 700,
      stoneTypeId: "st1",
      stoneType: { name: "Оникс" },
    });
    M.pieceFindMany.mockResolvedValue([
      {
        id: "p2",
        kind: "OFFCUT",
        boundingLengthMm: 1300,
        boundingWidthMm: 800,
        block: "А",
        landmark: "1",
        stoneType: { name: "Оникс" },
      },
    ]);
    M.slabFindMany.mockResolvedValue([]);

    const alts = await findReservationAlternatives(
      {
        targetType: "PIECE",
        unitId: "p1",
        canSeeExactRemainder: false,
      },
      { db: mockDb() },
    );
    expect(alts).toHaveLength(1);
    expect(alts[0].place).toBeNull();
    expect(alts[0].inStockLabel).toBe("В наличии");
    expect(alts[0].detail).toBe("1300×800 мм");
    expect(alts[0].stoneTypeName).toBe("Оникс");
  });

  it("unknown failed unit → empty (no throw)", async () => {
    M.slabFindUnique.mockResolvedValue(null);
    const alts = await findReservationAlternatives(
      {
        targetType: "SLAB",
        unitId: "missing",
        canSeeExactRemainder: true,
      },
      { db: mockDb() },
    );
    expect(alts).toEqual([]);
    expect(M.slabFindMany).not.toHaveBeenCalled();
  });

  it("piece path uses gabarit where (margin + rotation OR)", async () => {
    M.pieceFindUnique.mockResolvedValue({
      id: "p1",
      boundingLengthMm: 1000,
      boundingWidthMm: 500,
      stoneTypeId: "st9",
      stoneType: { name: "X" },
    });
    M.pieceFindMany.mockResolvedValue([]);
    M.slabFindMany.mockResolvedValue([]);

    await findReservationAlternatives(
      {
        targetType: "PIECE",
        unitId: "p1",
        canSeeExactRemainder: true,
      },
      { db: mockDb() },
    );

    const where = (M.pieceFindMany.mock.calls[0][0] as { where: PrismaLike }).where;
    expect(where.OR).toBeDefined();
    const needMax = 1000 + CUTTING_MARGIN_MM;
    const needMin = 500 + CUTTING_MARGIN_MM;
    expect(where.OR).toEqual([
      {
        boundingLengthMm: { gte: needMax },
        boundingWidthMm: { gte: needMin },
      },
      {
        boundingLengthMm: { gte: needMin },
        boundingWidthMm: { gte: needMax },
      },
    ]);
  });
});

type PrismaLike = {
  OR?: unknown;
  status?: string;
  stoneTypeId?: string;
};
