// TZ №10 — samples: overdue, scope, deposit currency split, double-issue semantics.
import { describe, expect, it, vi, beforeEach } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    userFindUnique: fn(),
    clientFindUnique: fn(),
    slabUpdateMany: fn(),
    slabFindUnique: fn(),
    pieceUpdateMany: fn(),
    pieceFindUnique: fn(),
    sampleCreate: fn(),
    sampleUpdateMany: fn(),
    sampleFindUnique: fn(),
    sampleFindMany: fn(),
    saleCreate: fn(),
    debtCreate: fn(),
    auditCreate: fn(),
    batchFindUnique: fn(),
    batchUpdateMany: fn(),
    queryRaw: fn(),
    reservationFindMany: fn(),
    // TZ №15 Slice 2 — sibling SAMPLE shipment
    shipmentCreate: fn(),
    shipmentFindUnique: fn(),
    shipmentUpdateMany: fn(),
  };
});

const tx = {
  user: { findUnique: M.userFindUnique },
  client: { findUnique: M.clientFindUnique },
  slab: { updateMany: M.slabUpdateMany, findUnique: M.slabFindUnique },
  piece: { updateMany: M.pieceUpdateMany, findUnique: M.pieceFindUnique },
  sample: {
    create: M.sampleCreate,
    updateMany: M.sampleUpdateMany,
    findUnique: M.sampleFindUnique,
    findMany: M.sampleFindMany,
  },
  saleRecord: { create: M.saleCreate },
  debt: { create: M.debtCreate },
  auditLog: { create: M.auditCreate },
  batch: { findUnique: M.batchFindUnique, updateMany: M.batchUpdateMany },
  reservation: { findMany: M.reservationFindMany },
  shipment: {
    create: M.shipmentCreate,
    findUnique: M.shipmentFindUnique,
    updateMany: M.shipmentUpdateMany,
  },
  $queryRaw: M.queryRaw,
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    sample: { findMany: M.sampleFindMany },
  },
}));

import {
  canAccessSample,
  isSampleOverdue,
  issueSample,
  returnSample,
  sellSample,
  sampleListScope,
  sumDepositsByCurrency,
  sampleHoldsFromRows,
  checkSampleVolumeAgainstFree,
} from "@/lib/samples";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.userFindUnique.mockResolvedValue({
    id: "mgr1",
    role: "MANAGER",
    isActive: true,
  });
  M.clientFindUnique.mockResolvedValue({ id: "c1" });
  M.slabUpdateMany.mockResolvedValue({ count: 1 });
  M.pieceUpdateMany.mockResolvedValue({ count: 1 });
  M.slabFindUnique.mockResolvedValue({ block: "А", landmark: "1" });
  M.pieceFindUnique.mockResolvedValue({ block: "А", landmark: "1" });
  M.sampleCreate.mockResolvedValue({ id: "samp1" });
  M.sampleUpdateMany.mockResolvedValue({ count: 1 });
  M.saleCreate.mockResolvedValue({ id: "sale1" });
  M.debtCreate.mockResolvedValue({ id: "d1" });
  M.auditCreate.mockResolvedValue({});
  M.shipmentCreate.mockResolvedValue({ id: "ship-s1" });
  M.shipmentFindUnique.mockResolvedValue(null);
  M.shipmentUpdateMany.mockResolvedValue({ count: 1 });
});

const DUE = new Date("2026-09-01T00:00:00.000Z");

describe("isSampleOverdue — computed, not stored", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  it("ACTIVE + past due → overdue", () => {
    expect(
      isSampleOverdue(
        { status: "ACTIVE", returnDueDate: new Date("2026-08-01") },
        now,
      ),
    ).toBe(true);
  });
  it("ACTIVE + future due → not overdue", () => {
    expect(
      isSampleOverdue(
        { status: "ACTIVE", returnDueDate: new Date("2026-08-20") },
        now,
      ),
    ).toBe(false);
  });
  it("RETURNED/SOLD never overdue", () => {
    expect(
      isSampleOverdue(
        { status: "RETURNED", returnDueDate: new Date("2026-08-01") },
        now,
      ),
    ).toBe(false);
    expect(
      isSampleOverdue(
        { status: "SOLD", returnDueDate: new Date("2026-08-01") },
        now,
      ),
    ).toBe(false);
  });
});

describe("scope / access", () => {
  it("manager own only", () => {
    expect(
      sampleListScope({ canSeeAll: false, actorId: "m1" }),
    ).toEqual({ managerId: "m1" });
    expect(
      canAccessSample({
        canSeeAll: false,
        actorId: "m1",
        sampleManagerId: "m2",
      }),
    ).toBe(false);
  });
  it("owner sees all", () => {
    expect(sampleListScope({ canSeeAll: true, actorId: "o" })).toEqual({});
    expect(
      canAccessSample({
        canSeeAll: true,
        actorId: "o",
        sampleManagerId: "m2",
      }),
    ).toBe(true);
  });
});

describe("sumDepositsByCurrency — never mix UZS+USD", () => {
  it("separate lines", () => {
    expect(
      sumDepositsByCurrency([
        { depositAmount: "100000", depositCurrency: "UZS" },
        { depositAmount: "20", depositCurrency: "USD" },
        { depositAmount: "50000", depositCurrency: "UZS" },
      ]),
    ).toEqual([
      { currency: "UZS", amount: "150000.00", count: 2 },
      { currency: "USD", amount: "20.00", count: 1 },
    ]);
  });
});

describe("issueSample — unit becomes SAMPLE", () => {
  it("happy SLAB: AVAILABLE→SAMPLE + Sample ACTIVE + OPEN SAMPLE shipment (same TX)", async () => {
    const res = await issueSample({
      targetType: "SLAB",
      unitId: "slab1",
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    expect(res.ok).toBe(true);
    expect(M.slabUpdateMany).toHaveBeenCalledWith({
      where: { id: "slab1", status: "AVAILABLE", needsCheck: false },
      data: { status: "SAMPLE" },
    });
    // Exactly one Sample row (single writer) + one sibling shipment.
    expect(M.sampleCreate).toHaveBeenCalledTimes(1);
    expect(M.sampleCreate.mock.calls[0][0].data).toMatchObject({
      status: "ACTIVE",
      clientId: "c1",
      slabId: "slab1",
    });
    expect(M.shipmentCreate).toHaveBeenCalledTimes(1);
    expect(M.shipmentCreate.mock.calls[0][0].data).toMatchObject({
      kind: "SAMPLE",
      sampleId: "samp1",
      managerId: "mgr1",
      clientId: "c1",
      lines: {
        create: expect.objectContaining({
          targetType: "SLAB",
          slabId: "slab1",
          qtyShippedSlabs: 0,
        }),
      },
    });
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("SAMPLE_ISSUE");
  });

  it("failure (ALREADY_ISSUED) creates neither Sample nor Shipment", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });
    M.slabFindUnique.mockResolvedValue({ status: "SAMPLE" });
    const res = await issueSample({
      targetType: "SLAB",
      unitId: "slab1",
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ALREADY_ISSUED");
    expect(M.sampleCreate).not.toHaveBeenCalled();
    expect(M.shipmentCreate).not.toHaveBeenCalled();
  });

  it("second issue on same slab (updateMany 0 + status SAMPLE) → ALREADY_ISSUED", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });
    M.slabFindUnique.mockResolvedValue({ status: "SAMPLE" });
    const res = await issueSample({
      targetType: "SLAB",
      unitId: "slab1",
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ALREADY_ISSUED");
    expect(M.sampleCreate).not.toHaveBeenCalled();
  });

  it("P2002 partial unique race → ALREADY_ISSUED", async () => {
    M.sampleCreate.mockRejectedValue({ code: "P2002" });
    const res = await issueSample({
      targetType: "SLAB",
      unitId: "slab1",
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ALREADY_ISSUED");
    expect(M.shipmentCreate).not.toHaveBeenCalled();
  });

  it("SOLD unit → UNIT_UNAVAILABLE", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });
    M.slabFindUnique.mockResolvedValue({ status: "SOLD" });
    const res = await issueSample({
      targetType: "SLAB",
      unitId: "slab1",
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("UNIT_UNAVAILABLE");
    expect(M.shipmentCreate).not.toHaveBeenCalled();
  });
});

describe("returnSample — stone back to AVAILABLE", () => {
  it("SAMPLE→AVAILABLE + Sample RETURNED + OPEN shipment cancelled", async () => {
    M.sampleFindUnique.mockResolvedValue({
      id: "samp1",
      status: "ACTIVE",
      targetType: "SLAB",
      slabId: "slab1",
      pieceId: null,
      depositAmount: "10",
    });
    M.shipmentFindUnique.mockResolvedValue({
      id: "ship-s1",
      cancelledAt: null,
      completedAt: null,
      lines: [{ qtyShippedSlabs: 0, qtyShippedAreaM2: 0 }],
    });
    const res = await returnSample({ sampleId: "samp1", managerId: "mgr1" });
    expect(res.ok).toBe(true);
    expect(M.sampleUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "samp1", status: "ACTIVE" },
        data: expect.objectContaining({ status: "RETURNED" }),
      }),
    );
    // TZ №15 — cancel OPEN SAMPLE shipment on return.
    expect(M.shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ship-s1", cancelledAt: null },
        data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
      }),
    );
    expect(M.slabUpdateMany).toHaveBeenCalledWith({
      where: { id: "slab1", status: "SAMPLE" },
      data: { status: "AVAILABLE" },
    });
  });
});

describe("sellSample — creates sale, closes sample, CREDIT→debt", () => {
  function activeSlabSample() {
    M.sampleFindUnique.mockResolvedValue({
      id: "samp1",
      status: "ACTIVE",
      targetType: "SLAB",
      slabId: "slab1",
      pieceId: null,
      batchId: null,
      qtySlabs: null,
      qtyAreaM2: null,
      clientId: "c1",
      depositAmount: null,
      depositCurrency: null,
      client: { name: "Иван", phone: "+99890" },
    });
  }

  it("CASH sale from sample", async () => {
    activeSlabSample();
    const res = await sellSample({
      sampleId: "samp1",
      managerId: "mgr1",
      price: 500,
      paymentMethod: "CASH",
      currency: "UZS",
    });
    expect(res.ok).toBe(true);
    expect(M.slabUpdateMany).toHaveBeenCalledWith({
      where: { id: "slab1", status: "SAMPLE" },
      data: { status: "SOLD" },
    });
    expect(M.saleCreate.mock.calls[0][0].data).toMatchObject({
      clientId: "c1",
      paymentMethod: "CASH",
      slabId: "slab1",
      price: "500.00",
    });
    expect(M.sampleUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SOLD",
          saleRecordId: "sale1",
        }),
      }),
    );
    expect(M.debtCreate).not.toHaveBeenCalled();
  });

  it("CREDIT → Debt created with clientId", async () => {
    activeSlabSample();
    const res = await sellSample({
      sampleId: "samp1",
      managerId: "mgr1",
      price: 100,
      paymentMethod: "CREDIT",
      currency: "USD",
    });
    expect(res.ok).toBe(true);
    expect(M.debtCreate).toHaveBeenCalled();
    expect(M.debtCreate.mock.calls[0][0].data.clientId).toBe("c1");
  });
});

describe("sampleHoldsFromRows — batch free stock like reservations", () => {
  it("ACTIVE batch samples reduce free volume", () => {
    const map = sampleHoldsFromRows([
      {
        batchId: "b1",
        qtySlabs: 2,
        qtyAreaM2: 5,
        status: "ACTIVE",
      },
      {
        batchId: "b1",
        qtySlabs: 1,
        qtyAreaM2: null,
        status: "ACTIVE",
      },
      {
        batchId: "b1",
        qtySlabs: 9,
        qtyAreaM2: 99,
        status: "RETURNED",
      },
    ]);
    expect(map.get("b1")).toEqual({ reservedSlabs: 3, reservedAreaM2: 5 });
  });
});

describe("stone on sample is not AVAILABLE — search contract", () => {
  it("issue flips status away from AVAILABLE (search filters AVAILABLE only)", async () => {
    await issueSample({
      targetType: "SLAB",
      unitId: "slab-x",
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    const data = M.slabUpdateMany.mock.calls[0][0].data;
    expect(data.status).toBe("SAMPLE");
    expect(data.status).not.toBe("AVAILABLE");
  });
});


describe("checkSampleVolumeAgainstFree — BATCH_VOLUME remainder", () => {
  it("rejects issue when qtySlabs exceeds free − holds", () => {
    const r = checkSampleVolumeAgainstFree({
      freeSlabs: 10,
      freeAreaM2: 100,
      holdSlabs: 8,
      holdAreaM2: 0,
      qtySlabs: 3,
      qtyAreaM2: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/нет/i);
  });

  it("allows issue when free after holds is enough", () => {
    const r = checkSampleVolumeAgainstFree({
      freeSlabs: 10,
      freeAreaM2: 100,
      holdSlabs: 2,
      holdAreaM2: 10,
      qtySlabs: 3,
      qtyAreaM2: 5,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects area oversell", () => {
    const r = checkSampleVolumeAgainstFree({
      freeSlabs: null,
      freeAreaM2: 12.5,
      holdSlabs: 0,
      holdAreaM2: 10,
      qtySlabs: null,
      qtyAreaM2: 3,
    });
    expect(r.ok).toBe(false);
  });
});

describe("sellSample BATCH_VOLUME — concurrent counter conflict", () => {
  it("updateMany count 0 → CONFLICT (second parallel sale)", async () => {
    M.sampleFindUnique.mockResolvedValue({
      id: "samp1",
      status: "ACTIVE",
      targetType: "BATCH_VOLUME",
      slabId: null,
      pieceId: null,
      batchId: "b1",
      qtySlabs: 2,
      qtyAreaM2: null,
      clientId: "c1",
      depositAmount: null,
      depositCurrency: null,
      client: { name: "ООО", phone: "+99890" },
    });
    M.queryRaw.mockResolvedValue([]);
    M.batchFindUnique.mockResolvedValue({
      id: "b1",
      slabsSoldDirect: 0,
      areaSoldDirectM2: { toString: () => "0" },
      needsCheck: false,
    });
    M.batchUpdateMany.mockResolvedValue({ count: 0 });

    const res = await sellSample({
      sampleId: "samp1",
      managerId: "mgr1",
      price: 100,
      paymentMethod: "CASH",
      currency: "UZS",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFLICT");
    expect(M.saleCreate).not.toHaveBeenCalled();
  });
});

describe("issueSample BATCH_VOLUME — oversell remainder", () => {
  it("insufficient free after holds → INSUFFICIENT_REMAINDER", async () => {
    M.queryRaw.mockResolvedValue([]);
    M.batchFindUnique.mockResolvedValue({
      id: "b1",
      needsCheck: false,
      slabsTotal: 5,
      areaTotalM2: null,
      slabsAdjusted: 0,
      areaAdjustedM2: { toString: () => "0" },
      slabsSoldDirect: 0,
      areaSoldDirectM2: { toString: () => "0" },
      slabs: [],
      pieces: [],
    });
    M.reservationFindMany.mockResolvedValue([]);
    // 4 already on sample holds → free 5, request 2 → only 1 free → fail
    M.sampleFindMany.mockResolvedValue([{ qtySlabs: 4, qtyAreaM2: null }]);

    const res = await issueSample({
      targetType: "BATCH_VOLUME",
      batchId: "b1",
      qtySlabs: 2,
      clientId: "c1",
      managerId: "mgr1",
      returnDueDate: DUE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INSUFFICIENT_REMAINDER");
    expect(M.sampleCreate).not.toHaveBeenCalled();
  });
});

