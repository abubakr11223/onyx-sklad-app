// ТЗ №14 §3 — applyBatchEdit: floor, audit old→new, concurrent sale conflict.
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    queryRaw: fn(),
    batchFindUnique: fn(),
    batchUpdateMany: fn(),
    patternUpdateMany: fn(),
    locationDeleteMany: fn(),
    locationCreateMany: fn(),
    photoCreate: fn(),
    photoUpdateMany: fn(),
    auditCreate: fn(),
    getRemainders: fn(),
    getHolds: fn(),
  };
});

const tx = {
  $queryRaw: M.queryRaw,
  batch: {
    findUnique: M.batchFindUnique,
    updateMany: M.batchUpdateMany,
  },
  batchPattern: { updateMany: M.patternUpdateMany },
  batchLocation: {
    deleteMany: M.locationDeleteMany,
    createMany: M.locationCreateMany,
  },
  photo: {
    create: M.photoCreate,
    updateMany: M.photoUpdateMany,
  },
  auditLog: { create: M.auditCreate },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  },
}));

vi.mock("@/lib/batch-remainders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/batch-remainders")>();
  return {
    ...actual,
    getBatchRemainders: M.getRemainders,
    getBatchReservationHolds: M.getHolds,
  };
});

import {
  applyBatchEdit,
  BatchEditError,
  type BatchEditInput,
} from "@/lib/batch-edit";
import { EMPTY_AGGREGATE, EMPTY_HOLD } from "@/lib/batch-remainders";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.queryRaw.mockResolvedValue([]);
  M.batchUpdateMany.mockResolvedValue({ count: 1 });
  M.patternUpdateMany.mockResolvedValue({ count: 1 });
  M.locationDeleteMany.mockResolvedValue({ count: 0 });
  M.locationCreateMany.mockResolvedValue({ count: 0 });
  M.photoCreate.mockResolvedValue({ id: "ph-new" });
  M.photoUpdateMany.mockResolvedValue({ count: 1 });
  M.auditCreate.mockResolvedValue({});
  M.getRemainders.mockResolvedValue(
    new Map([["b1", { ...EMPTY_AGGREGATE }]]),
  );
  M.getHolds.mockResolvedValue(new Map([["b1", { ...EMPTY_HOLD }]]));
});

function batchRow(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    stoneTypeId: "st1",
    slabsTotal: 10,
    areaTotalM2: { toString: () => "50.000" },
    slabsAdjusted: 0,
    areaAdjustedM2: { toString: () => "0" },
    slabsSoldDirect: 0,
    areaSoldDirectM2: { toString: () => "0" },
    lengthMm: 118,
    widthMm: 64,
    thicknessMm: 2,
    supplierNote: "doc-1",
    arrivedAt: new Date("2026-08-01T12:00:00Z"),
    stoneType: { name: "Травертин" },
    patterns: [],
    locations: [],
    ...over,
  };
}

function baseInput(over: Partial<BatchEditInput> = {}): BatchEditInput {
  return {
    batchId: "b1",
    expected: {
      slabsTotal: 10,
      areaTotalM2: 50,
      slabsSoldDirect: 0,
      areaSoldDirectM2: 0,
      lengthMm: 118,
      widthMm: 64,
      thicknessMm: 2,
      supplierNote: "doc-1",
      arrivedAtIso: "2026-08-01",
    },
    slabsTotal: 10,
    areaTotalM2: 50,
    lengthMm: 118,
    widthMm: 64,
    thicknessMm: 2,
    supplierNote: "doc-1",
    arrivedAt: new Date("2026-08-01T12:00:00Z"),
    locations: [],
    patterns: [],
    actorId: "u-owner",
    canEditQuantity: true,
    ...over,
  };
}

describe("applyBatchEdit mutators", () => {
  it("free edit when no movements: dims change → audit old→new", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    const res = await applyBatchEdit(
      baseInput({
        lengthMm: 120,
        widthMm: 70,
      }),
    );
    expect(res.changes).toEqual(
      expect.arrayContaining([
        { field: "lengthMm", old: 118, new: 120 },
        { field: "widthMm", old: 64, new: 70 },
      ]),
    );
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
    const payload = M.auditCreate.mock.calls[0][0].data.payload;
    expect(payload.kind).toBe("BATCH_EDIT");
    expect(payload.stoneName).toBe("Травертин");
    expect(payload.changes).toEqual(res.changes);
    expect(M.batchUpdateMany).toHaveBeenCalledTimes(1);
    // Conditional pin on sold + previous totals
    expect(M.batchUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: "b1",
      slabsSoldDirect: 0,
    });
  });

  it("cannot reduce qty below sold+reserved floor", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({
        slabsSoldDirect: 4,
        areaSoldDirectM2: { toString: () => "0" },
      }),
    );
    M.getRemainders.mockResolvedValue(
      new Map([
        [
          "b1",
          {
            ...EMPTY_AGGREGATE,
            slabCount: 1,
            pieceCount: 1,
          },
        ],
      ]),
    );
    M.getHolds.mockResolvedValue(
      new Map([["b1", { reservedSlabs: 2, reservedAreaM2: 0 }]]),
    );
    // floor = 4+2+1+1 = 8
    await expect(
      applyBatchEdit(
        baseInput({
          expected: {
            ...baseInput().expected,
            slabsSoldDirect: 4,
            areaSoldDirectM2: 0,
          },
          slabsTotal: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "BELOW_FLOOR" });
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("warehouse cannot change quantity (FORBIDDEN_QTY)", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    await expect(
      applyBatchEdit(
        baseInput({
          canEditQuantity: false,
          slabsTotal: 12,
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN_QTY" });
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("warehouse can change dimensions only", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    const res = await applyBatchEdit(
      baseInput({
        canEditQuantity: false,
        lengthMm: 130,
        // qty same as expected
        slabsTotal: 10,
        areaTotalM2: 50,
      }),
    );
    expect(res.changes.some((c) => c.field === "lengthMm")).toBe(true);
    expect(M.batchUpdateMany).toHaveBeenCalled();
  });

  it("concurrent sale (sold counters drift) → CONFLICT, no write", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({
        slabsSoldDirect: 3, // form expected 0
      }),
    );
    await expect(applyBatchEdit(baseInput({ lengthMm: 200 }))).rejects.toMatchObject(
      {
        code: "CONFLICT",
      },
    );
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("updateMany count 0 (race after lock) → CONFLICT", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    M.batchUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      applyBatchEdit(baseInput({ supplierNote: "new-doc" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("qty raise with movements allowed when above floor + audit", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({ slabsSoldDirect: 2 }),
    );
    M.getHolds.mockResolvedValue(
      new Map([["b1", { reservedSlabs: 1, reservedAreaM2: 0 }]]),
    );
    const res = await applyBatchEdit(
      baseInput({
        expected: {
          ...baseInput().expected,
          slabsSoldDirect: 2,
        },
        slabsTotal: 15,
      }),
    );
    expect(res.changes).toContainEqual({
      field: "slabsTotal",
      old: 10,
      new: 15,
    });
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("ADJUSTMENT");
  });
});

describe("BatchEditError", () => {
  it("is constructible with code", () => {
    const e = new BatchEditError("BELOW_FLOOR", "x", "slabsTotal");
    expect(e.code).toBe("BELOW_FLOOR");
    expect(e.field).toBe("slabsTotal");
  });
});

describe("applyBatchEdit — pattern photo (ТЗ №14 §3)", () => {
  const patternRow = {
    id: "pat1",
    description: "светлый",
    thicknessMm: 2,
    lengthMm: 100,
    widthMm: 50,
    slabsCount: 5,
    areaM2: { toString: () => "20.000" },
    slabsSold: 0,
    areaSoldM2: { toString: () => "0" },
    photos: [] as { id: string }[],
  };

  function withPattern(photos: { id: string }[] = []) {
    return batchRow({
      patterns: [{ ...patternRow, photos }],
    });
  }

  function patternInput(
    photoOps?: BatchEditInput["patternPhotoOps"],
  ): BatchEditInput {
    return baseInput({
      patterns: [
        {
          id: "pat1",
          description: "светлый",
          thicknessMm: 2,
          lengthMm: 100,
          widthMm: 50,
          slabsCount: 5,
          areaM2: 20,
        },
      ],
      patternPhotoOps: photoOps,
    });
  }

  it("set photo only → Photo.create in TX + audit pattern.*.photo", async () => {
    M.batchFindUnique.mockResolvedValue(withPattern());
    const res = await applyBatchEdit(
      patternInput([
        {
          patternId: "pat1",
          op: "set",
          storageKey: "https://blob.example/p.jpg",
          takenAt: new Date("2026-08-09T00:00:00Z"),
        },
      ]),
    );
    expect(M.photoCreate).toHaveBeenCalledTimes(1);
    expect(M.photoCreate.mock.calls[0][0].data).toMatchObject({
      storageKey: "https://blob.example/p.jpg",
      kind: "SAMPLE",
      batchPatternId: "pat1",
      stoneTypeId: "st1",
    });
    expect(M.photoUpdateMany).not.toHaveBeenCalled();
    expect(res.changes).toContainEqual({
      field: "pattern.pat1.photo",
      old: null,
      new: "new",
    });
    expect(M.auditCreate.mock.calls[0][0].data.payload.changes).toEqual(
      res.changes,
    );
  });

  it("clear photo → updateMany unlink (no hard delete) + audit", async () => {
    M.batchFindUnique.mockResolvedValue(withPattern([{ id: "ph-old" }]));
    const res = await applyBatchEdit(
      patternInput([{ patternId: "pat1", op: "clear" }]),
    );
    expect(M.photoCreate).not.toHaveBeenCalled();
    expect(M.photoUpdateMany).toHaveBeenCalledTimes(1);
    expect(M.photoUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { batchPatternId: "pat1", kind: "SAMPLE" },
      data: { batchPatternId: null, stoneTypeId: "st1" },
    });
    expect(res.changes).toContainEqual({
      field: "pattern.pat1.photo",
      old: "ph-old",
      new: null,
    });
  });

  it("clear with no existing photo → NO_CHANGES (not silent write)", async () => {
    M.batchFindUnique.mockResolvedValue(withPattern());
    await expect(
      applyBatchEdit(patternInput([{ patternId: "pat1", op: "clear" }])),
    ).rejects.toMatchObject({ code: "NO_CHANGES" });
    expect(M.photoUpdateMany).not.toHaveBeenCalled();
  });

  it("set + field change in one TX (atomic)", async () => {
    M.batchFindUnique.mockResolvedValue(withPattern([{ id: "ph-old" }]));
    const res = await applyBatchEdit({
      ...patternInput([
        {
          patternId: "pat1",
          op: "set",
          storageKey: "https://blob.example/new.jpg",
        },
      ]),
      patterns: [
        {
          id: "pat1",
          description: "тёмный", // field change
          thicknessMm: 2,
          lengthMm: 100,
          widthMm: 50,
          slabsCount: 5,
          areaM2: 20,
        },
      ],
    });
    expect(M.patternUpdateMany).toHaveBeenCalled();
    expect(M.photoCreate).toHaveBeenCalledTimes(1);
    expect(res.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining([
        "pattern.pat1.description",
        "pattern.pat1.photo",
      ]),
    );
  });
});

