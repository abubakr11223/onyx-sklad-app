// TZ №15 Slice 3 — showroom: send/return, mutual exclusion, confirm no status change,
// search not ordinarily sellable, badge helpers.
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    userFindUnique: fn(),
    slabUpdateMany: fn(),
    slabFindUnique: fn(),
    pieceUpdateMany: fn(),
    pieceFindUnique: fn(),
    placementCreate: fn(),
    placementUpdateMany: fn(),
    placementFindFirst: fn(),
    shipmentCreate: fn(),
    shipmentUpdateMany: fn(),
    shipmentFindUnique: fn(),
    shipmentLineUpdateMany: fn(),
    shipmentUpdate: fn(),
    auditCreate: fn(),
  };
});

const tx = {
  user: { findUnique: M.userFindUnique },
  slab: { updateMany: M.slabUpdateMany, findUnique: M.slabFindUnique },
  piece: { updateMany: M.pieceUpdateMany, findUnique: M.pieceFindUnique },
  showroomPlacement: {
    create: M.placementCreate,
    updateMany: M.placementUpdateMany,
    findFirst: M.placementFindFirst,
  },
  shipment: {
    create: M.shipmentCreate,
    updateMany: M.shipmentUpdateMany,
    findUnique: M.shipmentFindUnique,
    update: M.shipmentUpdate,
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
  sendToShowroom,
  returnFromShowroom,
  isOrdinarilySellableStatus,
  roleCanSendToShowroom,
} from "@/lib/showroom";
import { confirmShipment } from "@/lib/shipments";
import { decideUnitSale } from "@/lib/sales";
import {
  piecesWhere,
  slabsWhere,
  showroomSlabsWhere,
  showroomPiecesWhere,
} from "@/lib/poisk-search";
import { canBreak } from "@/lib/breaking";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.userFindUnique.mockResolvedValue({
    id: "mgr1",
    role: "MANAGER",
    isActive: true,
  });
  M.slabUpdateMany.mockResolvedValue({ count: 1 });
  M.pieceUpdateMany.mockResolvedValue({ count: 1 });
  M.slabFindUnique.mockResolvedValue({
    block: "А",
    landmark: "1",
    status: "AVAILABLE",
  });
  M.placementCreate.mockResolvedValue({ id: "pl1" });
  M.placementUpdateMany.mockResolvedValue({ count: 1 });
  M.placementFindFirst.mockResolvedValue({ shipmentId: "ship-sh1" });
  M.shipmentCreate.mockResolvedValue({ id: "ship-sh1" });
  M.shipmentUpdateMany.mockResolvedValue({ count: 1 });
  M.shipmentLineUpdateMany.mockResolvedValue({ count: 1 });
  M.shipmentUpdate.mockResolvedValue({});
  M.auditCreate.mockResolvedValue({});
});

describe("sendToShowroom — AVAILABLE→SHOWROOM + placement + OPEN shipment", () => {
  it("happy: conditional SHOWROOM + shipment kind SHOWROOM + audit", async () => {
    const res = await sendToShowroom({
      targetType: "SLAB",
      unitId: "slab1",
      actorId: "mgr1",
      standNote: "Витрина 1",
    });
    expect(res.ok).toBe(true);
    expect(M.slabUpdateMany).toHaveBeenCalledWith({
      where: { id: "slab1", status: "AVAILABLE", needsCheck: false },
      data: { status: "SHOWROOM" },
    });
    expect(M.shipmentCreate).toHaveBeenCalledTimes(1);
    expect(M.shipmentCreate.mock.calls[0][0].data).toMatchObject({
      kind: "SHOWROOM",
      managerId: "mgr1",
      note: "Витрина 1",
    });
    expect(M.placementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slabId: "slab1",
          standNote: "Витрина 1",
          shipmentId: "ship-sh1",
        }),
      }),
    );
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("SHOWROOM_SEND");
  });

  it("failure (already SHOWROOM): no placement/shipment", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });
    M.slabFindUnique.mockResolvedValue({ status: "SHOWROOM" });
    const res = await sendToShowroom({
      targetType: "SLAB",
      unitId: "slab1",
      actorId: "mgr1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ALREADY_IN_SHOWROOM");
    expect(M.shipmentCreate).not.toHaveBeenCalled();
    expect(M.placementCreate).not.toHaveBeenCalled();
  });

  it("SOLD unit → UNIT_UNAVAILABLE, no shipment", async () => {
    M.slabUpdateMany.mockResolvedValue({ count: 0 });
    M.slabFindUnique.mockResolvedValue({ status: "SOLD" });
    const res = await sendToShowroom({
      targetType: "SLAB",
      unitId: "slab1",
      actorId: "mgr1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("UNIT_UNAVAILABLE");
    expect(M.shipmentCreate).not.toHaveBeenCalled();
  });
});

describe("returnFromShowroom — SHOWROOM→AVAILABLE", () => {
  it("happy: status AVAILABLE + close placement + cancel open ship", async () => {
    const res = await returnFromShowroom({
      targetType: "SLAB",
      unitId: "slab1",
      actorId: "mgr1",
    });
    expect(res.ok).toBe(true);
    expect(M.slabUpdateMany).toHaveBeenCalledWith({
      where: { id: "slab1", status: "SHOWROOM" },
      data: { status: "AVAILABLE" },
    });
    expect(M.placementUpdateMany).toHaveBeenCalled();
    expect(M.shipmentUpdateMany).toHaveBeenCalled();
    expect(M.auditCreate.mock.calls[0][0].data.action).toBe("SHOWROOM_RETURN");
  });
});

describe("confirm SHOWROOM shipment — no UnitStatus change", () => {
  beforeEach(() => {
    M.userFindUnique.mockResolvedValue({
      id: "wh1",
      role: "WAREHOUSE",
      isActive: true,
    });
    M.shipmentFindUnique.mockResolvedValue({
      id: "ship-sh1",
      kind: "SHOWROOM",
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
  });

  it("confirm completes ship; does not call slab/piece updateMany", async () => {
    const res = await confirmShipment({
      shipmentId: "ship-sh1",
      actorId: "wh1",
    });
    expect(res.status).toBe("DONE");
    expect(M.shipmentLineUpdateMany).toHaveBeenCalled();
    expect(M.auditCreate.mock.calls[0][0].data.payload).toMatchObject({
      unitStatusTouched: false,
    });
    // Status already SHOWROOM from send — confirm must not re-write unit.
    expect(M.slabUpdateMany).not.toHaveBeenCalled();
    expect(M.pieceUpdateMany).not.toHaveBeenCalled();
  });
});

describe("mutual exclusion — decideUnitSale / send / reserve patterns", () => {
  it("SHOWROOM is sellable via sell-from-showroom (expected SHOWROOM)", () => {
    const d = decideUnitSale({
      unitStatus: "SHOWROOM",
      needsCheck: false,
      activeReservationManagerId: null,
      actingManagerId: "mgr1",
      actingRole: "MANAGER",
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.expectedStatus).toBe("SHOWROOM");
  });

  it("AVAILABLE sell uses expected AVAILABLE (competes with send)", () => {
    const d = decideUnitSale({
      unitStatus: "AVAILABLE",
      needsCheck: false,
      activeReservationManagerId: null,
      actingManagerId: "mgr1",
      actingRole: "MANAGER",
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.expectedStatus).toBe("AVAILABLE");
  });

  it("SAMPLE cannot sell ordinarily", () => {
    const d = decideUnitSale({
      unitStatus: "SAMPLE",
      needsCheck: false,
      activeReservationManagerId: null,
      actingManagerId: "mgr1",
      actingRole: "MANAGER",
    });
    expect(d.ok).toBe(false);
  });

  it("canBreak forbids SHOWROOM", () => {
    expect(canBreak("SHOWROOM").allowed).toBe(false);
  });

  it("warehouse may send", () => {
    expect(roleCanSendToShowroom("WAREHOUSE")).toBe(true);
    expect(roleCanSendToShowroom("PARTNER")).toBe(false);
  });
});

describe("search — SHOWROOM not ordinary free stock", () => {
  it("piecesWhere / slabsWhere use AVAILABLE only", () => {
    expect(piecesWhere("", 100, 50).status).toBe("AVAILABLE");
    expect(slabsWhere("", 100, 50).status).toBe("AVAILABLE");
  });

  it("showroom*Where uses SHOWROOM", () => {
    expect(showroomSlabsWhere("", 100, 50).status).toBe("SHOWROOM");
    expect(showroomPiecesWhere("", 100, 50).status).toBe("SHOWROOM");
  });

  it("isOrdinarilySellableStatus", () => {
    expect(isOrdinarilySellableStatus("AVAILABLE")).toBe(true);
    expect(isOrdinarilySellableStatus("RESERVED")).toBe(true);
    expect(isOrdinarilySellableStatus("SHOWROOM")).toBe(false);
    expect(isOrdinarilySellableStatus("SOLD")).toBe(false);
  });
});
