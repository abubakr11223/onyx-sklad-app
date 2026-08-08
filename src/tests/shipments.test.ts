// TZ №15 Slice 1 — pure derive + confirm mock-tx (no UnitStatus change).
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    userFindUnique: fn(),
    shipmentFindUnique: fn(),
    shipmentUpdate: fn(),
    shipmentUpdateMany: fn(),
    shipmentLineUpdateMany: fn(),
    auditCreate: fn(),
  };
});

const tx = {
  user: { findUnique: M.userFindUnique },
  shipment: {
    findUnique: M.shipmentFindUnique,
    update: M.shipmentUpdate,
    updateMany: M.shipmentUpdateMany,
  },
  shipmentLine: { updateMany: M.shipmentLineUpdateMany },
  auditLog: { create: M.auditCreate },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  },
}));

import {
  confirmShipment,
  deriveShipmentStatus,
  lineIsFullyShipped,
  shipmentStatusLabelRu,
} from "@/lib/shipments";

describe("deriveShipmentStatus (legacy + lines)", () => {
  it("null shipment → DONE (grandfather legacy sale)", () => {
    expect(deriveShipmentStatus(null)).toBe("DONE");
    expect(shipmentStatusLabelRu("DONE")).toMatch(/Отгружено/);
  });

  it("cancelled → CANCELLED", () => {
    expect(
      deriveShipmentStatus({
        cancelledAt: new Date(),
        completedAt: null,
        lines: [],
      }),
    ).toBe("CANCELLED");
  });

  it("open unit line → OPEN", () => {
    expect(
      deriveShipmentStatus({
        cancelledAt: null,
        completedAt: null,
        lines: [
          {
            targetType: "SLAB",
            qtyOrderedSlabs: 1,
            qtyOrderedAreaM2: null,
            qtyShippedSlabs: 0,
            qtyShippedAreaM2: 0,
          },
        ],
      }),
    ).toBe("OPEN");
  });

  it("volume partial → PARTIAL", () => {
    expect(
      deriveShipmentStatus({
        cancelledAt: null,
        completedAt: null,
        lines: [
          {
            targetType: "BATCH_VOLUME",
            qtyOrderedSlabs: 10,
            qtyOrderedAreaM2: null,
            qtyShippedSlabs: 3,
            qtyShippedAreaM2: 0,
          },
        ],
      }),
    ).toBe("PARTIAL");
  });

  it("completedAt set → DONE", () => {
    expect(
      deriveShipmentStatus({
        cancelledAt: null,
        completedAt: new Date(),
        lines: [
          {
            targetType: "SLAB",
            qtyOrderedSlabs: 1,
            qtyOrderedAreaM2: null,
            qtyShippedSlabs: 1,
            qtyShippedAreaM2: 0,
          },
        ],
      }),
    ).toBe("DONE");
  });
});

describe("lineIsFullyShipped", () => {
  it("unit needs qtyShippedSlabs >= 1", () => {
    expect(
      lineIsFullyShipped({
        targetType: "PIECE",
        qtyOrderedSlabs: 1,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 0,
        qtyShippedAreaM2: 0,
      }),
    ).toBe(false);
    expect(
      lineIsFullyShipped({
        targetType: "PIECE",
        qtyOrderedSlabs: 1,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 1,
        qtyShippedAreaM2: 0,
      }),
    ).toBe(true);
  });
});

describe("confirmShipment — mock-tx", () => {
  beforeEach(() => {
    Object.values(M).forEach((f) => f.mockReset());
    M.userFindUnique.mockResolvedValue({
      id: "wh1",
      role: "WAREHOUSE",
      isActive: true,
    });
    M.shipmentLineUpdateMany.mockResolvedValue({ count: 1 });
    M.shipmentUpdate.mockResolvedValue({});
    M.auditCreate.mockResolvedValue({});
  });

  it("unit confirm → full ship + completedAt + SHIPMENT_CONFIRM audit; no slab update", async () => {
    M.shipmentFindUnique.mockResolvedValue({
      id: "ship1",
      kind: "SALE",
      cancelledAt: null,
      completedAt: null,
      lines: [
        {
          id: "ln1",
          targetType: "SLAB",
          qtyOrderedSlabs: 1,
          qtyOrderedAreaM2: null,
          qtyShippedSlabs: 0,
          qtyShippedAreaM2: 0,
        },
      ],
    });

    const res = await confirmShipment({
      shipmentId: "ship1",
      actorId: "wh1",
    });
    expect(res.status).toBe("DONE");
    expect(M.shipmentLineUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ qtyShippedSlabs: 1 }),
      }),
    );
    expect(M.shipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completedAt: expect.any(Date) }),
      }),
    );
    expect(M.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "SHIPMENT_CONFIRM",
      entityType: "Shipment",
      payload: expect.objectContaining({ unitStatusTouched: false }),
    });
    // No UnitStatus write path in this module
    expect(JSON.stringify(M)).not.toMatch(/slabUpdateMany|pieceUpdateMany/);
  });

  it("volume partial cannot exceed remainder", async () => {
    M.shipmentFindUnique.mockResolvedValue({
      id: "ship1",
      kind: "SALE",
      cancelledAt: null,
      completedAt: null,
      lines: [
        {
          id: "ln1",
          targetType: "BATCH_VOLUME",
          qtyOrderedSlabs: 10,
          qtyOrderedAreaM2: null,
          qtyShippedSlabs: 8,
          qtyShippedAreaM2: 0,
        },
      ],
    });

    await expect(
      confirmShipment({
        shipmentId: "ship1",
        actorId: "wh1",
        qtySlabs: 5, // rem only 2
      }),
    ).rejects.toMatchObject({ code: "INVALID_QTY" });
    expect(M.shipmentLineUpdateMany).not.toHaveBeenCalled();
  });

  it("volume partial within remainder → PARTIAL (no completedAt)", async () => {
    M.shipmentFindUnique.mockResolvedValue({
      id: "ship1",
      kind: "SALE",
      cancelledAt: null,
      completedAt: null,
      lines: [
        {
          id: "ln1",
          targetType: "BATCH_VOLUME",
          qtyOrderedSlabs: 10,
          qtyOrderedAreaM2: null,
          qtyShippedSlabs: 0,
          qtyShippedAreaM2: 0,
        },
      ],
    });

    const res = await confirmShipment({
      shipmentId: "ship1",
      actorId: "wh1",
      qtySlabs: 3,
    });
    expect(res.status).toBe("PARTIAL");
    expect(M.shipmentUpdate).not.toHaveBeenCalled();
  });

  it("MANAGER cannot confirm", async () => {
    M.userFindUnique.mockResolvedValue({
      id: "mgr1",
      role: "MANAGER",
      isActive: true,
    });
    M.shipmentFindUnique.mockResolvedValue({
      id: "ship1",
      kind: "SALE",
      cancelledAt: null,
      completedAt: null,
      lines: [
        {
          id: "ln1",
          targetType: "SLAB",
          qtyOrderedSlabs: 1,
          qtyOrderedAreaM2: null,
          qtyShippedSlabs: 0,
          qtyShippedAreaM2: 0,
        },
      ],
    });
    await expect(
      confirmShipment({ shipmentId: "ship1", actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
