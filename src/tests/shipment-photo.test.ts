// TZ №15 §8.1 / §3.3 — shipment fact photo (fake client, no real DB).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ShipmentPhotoError,
  assertPhotoStorageKey,
  attachShipmentFactPhoto,
  createShipmentFactPhotoInTx,
  resolveShipmentPhotoAnchors,
  shipmentFactPhotoKind,
  type ShipmentPhotoDeps,
} from "@/lib/shipment-photo";

describe("shipmentFactPhotoKind", () => {
  it("SAMPLE shipment → SAMPLE kind", () => {
    expect(
      shipmentFactPhotoKind({ shipmentKind: "SAMPLE", targetType: "SLAB" }),
    ).toBe("SAMPLE");
  });
  it("PIECE target → PIECE", () => {
    expect(
      shipmentFactPhotoKind({ shipmentKind: "SALE", targetType: "PIECE" }),
    ).toBe("PIECE");
  });
  it("SLAB / BATCH_VOLUME / SHOWROOM → SLAB", () => {
    expect(
      shipmentFactPhotoKind({ shipmentKind: "SALE", targetType: "SLAB" }),
    ).toBe("SLAB");
    expect(
      shipmentFactPhotoKind({
        shipmentKind: "SALE",
        targetType: "BATCH_VOLUME",
      }),
    ).toBe("SLAB");
    expect(
      shipmentFactPhotoKind({ shipmentKind: "SHOWROOM", targetType: "SLAB" }),
    ).toBe("SLAB");
  });
});

describe("assertPhotoStorageKey", () => {
  it("accepts Blob URL and Telegram file_id", () => {
    expect(assertPhotoStorageKey("https://blob.vercel-storage.com/a.jpg")).toBe(
      "https://blob.vercel-storage.com/a.jpg",
    );
    expect(assertPhotoStorageKey("AgACAgIAAxkBAAI")).toBe("AgACAgIAAxkBAAI");
  });
  it("rejects empty / garbage", () => {
    expect(() => assertPhotoStorageKey("")).toThrow(ShipmentPhotoError);
    expect(() => assertPhotoStorageKey("not a key!")).toThrow(ShipmentPhotoError);
  });
});

describe("resolveShipmentPhotoAnchors", () => {
  it("SLAB requires slabId", () => {
    expect(() =>
      resolveShipmentPhotoAnchors({
        shipmentKind: "SALE",
        targetType: "SLAB",
        stoneTypeId: "st1",
      }),
    ).toThrow(/slabId/);
    expect(
      resolveShipmentPhotoAnchors({
        shipmentKind: "SALE",
        targetType: "SLAB",
        slabId: "slab1",
        stoneTypeId: "st1",
      }),
    ).toMatchObject({
      kind: "SLAB",
      slabId: "slab1",
      pieceId: null,
      stoneTypeId: "st1",
    });
  });

  it("PIECE requires pieceId; SAMPLE shipment → SAMPLE kind", () => {
    const a = resolveShipmentPhotoAnchors({
      shipmentKind: "SAMPLE",
      targetType: "PIECE",
      pieceId: "p1",
      stoneTypeId: "st1",
    });
    expect(a).toMatchObject({
      kind: "SAMPLE",
      pieceId: "p1",
      slabId: null,
    });
  });

  it("BATCH_VOLUME requires stoneTypeId", () => {
    expect(() =>
      resolveShipmentPhotoAnchors({
        shipmentKind: "SALE",
        targetType: "BATCH_VOLUME",
      }),
    ).toThrow(/stoneTypeId/);
    expect(
      resolveShipmentPhotoAnchors({
        shipmentKind: "SALE",
        targetType: "BATCH_VOLUME",
        stoneTypeId: "st9",
      }),
    ).toMatchObject({ kind: "SLAB", stoneTypeId: "st9", slabId: null });
  });
});

describe("createShipmentFactPhotoInTx", () => {
  it("creates Photo with hybrid storageKey and anchors", async () => {
    const photoCreate = vi.fn().mockResolvedValue({ id: "ph1" });
    const tx = { photo: { create: photoCreate } };

    const res = await createShipmentFactPhotoInTx(tx, {
      storageKey: "https://blob.example/fact.jpg",
      takenById: "wh1",
      shipmentKind: "SALE",
      targetType: "SLAB",
      slabId: "slab1",
      stoneTypeId: "st1",
      takenAt: new Date("2026-08-01T10:00:00Z"),
    });

    expect(res.photoId).toBe("ph1");
    expect(res.kind).toBe("SLAB");
    expect(photoCreate).toHaveBeenCalledWith({
      data: {
        storageKey: "https://blob.example/fact.jpg",
        kind: "SLAB",
        takenAt: new Date("2026-08-01T10:00:00Z"),
        takenById: "wh1",
        stoneTypeId: "st1",
        slabId: "slab1",
        pieceId: null,
      },
      select: { id: true },
    });
  });

  it("accepts Telegram file_id as storageKey", async () => {
    const photoCreate = vi.fn().mockResolvedValue({ id: "ph2" });
    const res = await createShipmentFactPhotoInTx(
      { photo: { create: photoCreate } },
      {
        storageKey: "BAACAgIAAxkBAAExampleFileId",
        takenById: "wh1",
        shipmentKind: "SAMPLE",
        targetType: "PIECE",
        pieceId: "piece1",
        stoneTypeId: "st1",
      },
    );
    expect(res.kind).toBe("SAMPLE");
    expect(photoCreate.mock.calls[0][0].data.storageKey).toBe(
      "BAACAgIAAxkBAAExampleFileId",
    );
    expect(photoCreate.mock.calls[0][0].data.pieceId).toBe("piece1");
  });

  it("throws VALIDATION without takenById", async () => {
    await expect(
      createShipmentFactPhotoInTx(
        { photo: { create: vi.fn() } },
        {
          storageKey: "https://x/y.jpg",
          takenById: "  ",
          shipmentKind: "SALE",
          targetType: "SLAB",
          slabId: "s1",
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("attachShipmentFactPhoto", () => {
  const shipmentFindUnique = vi.fn();
  const photoCreate = vi.fn();
  const auditLogCreate = vi.fn();

  function makeDeps(): ShipmentPhotoDeps {
    return {
      db: {
        shipment: {
          findUnique: (...a: unknown[]) => shipmentFindUnique(...a),
        },
        photo: { create: (...a: unknown[]) => photoCreate(...a) },
        auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
      },
    } as unknown as ShipmentPhotoDeps;
  }

  beforeEach(() => {
    shipmentFindUnique.mockReset();
    photoCreate.mockReset();
    auditLogCreate.mockReset();
    shipmentFindUnique.mockResolvedValue({
      id: "sh1",
      kind: "SAMPLE",
      cancelledAt: null,
      lines: [
        {
          targetType: "PIECE",
          slabId: null,
          pieceId: "piece1",
          batchId: null,
          slab: null,
          piece: { stoneTypeId: "st1" },
          batch: null,
        },
      ],
    });
    photoCreate.mockResolvedValue({ id: "ph99" });
    auditLogCreate.mockResolvedValue({});
  });

  it("loads shipment (bounded), creates photo, audits photoId", async () => {
    const res = await attachShipmentFactPhoto(
      {
        shipmentId: "sh1",
        storageKey: "https://blob/x.jpg",
        takenById: "wh1",
      },
      makeDeps(),
    );

    expect(shipmentFindUnique.mock.calls[0][0].select.lines.take).toBe(5);
    expect(res.photoId).toBe("ph99");
    expect(res.kind).toBe("SAMPLE");
    expect(res.pieceId).toBe("piece1");
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SHIPMENT_CONFIRM",
          entityId: "sh1",
          payload: expect.objectContaining({
            event: "shipment_fact_photo",
            photoId: "ph99",
          }),
        }),
      }),
    );
  });

  it("skips audit when writeAudit=false", async () => {
    await attachShipmentFactPhoto(
      {
        shipmentId: "sh1",
        storageKey: "https://blob/x.jpg",
        takenById: "wh1",
        writeAudit: false,
      },
      makeDeps(),
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("throws on missing / cancelled shipment", async () => {
    shipmentFindUnique.mockResolvedValue(null);
    await expect(
      attachShipmentFactPhoto(
        { shipmentId: "x", storageKey: "https://a/b", takenById: "u" },
        makeDeps(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    shipmentFindUnique.mockResolvedValue({
      id: "sh1",
      kind: "SALE",
      cancelledAt: new Date(),
      lines: [],
    });
    await expect(
      attachShipmentFactPhoto(
        { shipmentId: "sh1", storageKey: "https://a/b", takenById: "u" },
        makeDeps(),
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
