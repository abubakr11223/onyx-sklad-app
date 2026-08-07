// W7-D — §6.7 QR showroom: photo fallback order + public vs staff surface.
import { describe, expect, it } from "vitest";
import {
  QR_PUBLIC_PHOTO_KINDS,
  buildQrPublicView,
  buildQrStaffExtras,
  orderShowroomPhotos,
  photoKindLabelRu,
  showroomMediaMode,
} from "@/lib/qr-showroom";

describe("orderShowroomPhotos — INTERIOR first, then warehouse fallback", () => {
  it("puts INTERIOR_AI before SAMPLE before SLAB regardless of createdAt order", () => {
    const ordered = orderShowroomPhotos([
      { id: "slab1", kind: "SLAB", createdAt: "2026-07-30T12:00:00Z" },
      { id: "int1", kind: "INTERIOR_AI", createdAt: "2026-07-01T12:00:00Z" },
      { id: "sam1", kind: "SAMPLE", createdAt: "2026-07-20T12:00:00Z" },
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["int1", "sam1", "slab1"]);
  });

  it("within one kind, newer createdAt first", () => {
    const ordered = orderShowroomPhotos([
      { id: "old", kind: "SAMPLE", createdAt: "2026-01-01T00:00:00Z" },
      { id: "new", kind: "SAMPLE", createdAt: "2026-07-01T00:00:00Z" },
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("warehouse-only set (no interiors) still returns SAMPLE then SLAB", () => {
    const ordered = orderShowroomPhotos([
      { id: "s", kind: "SLAB" },
      { id: "a", kind: "SAMPLE" },
    ]);
    expect(ordered.map((p) => p.kind)).toEqual(["SAMPLE", "SLAB"]);
    expect(showroomMediaMode(ordered)).toBe("warehouse_photos_only");
  });

  it("empty list → no_photos mode", () => {
    expect(showroomMediaMode([])).toBe("no_photos");
    expect(orderShowroomPhotos([])).toEqual([]);
  });

  it("has_interiors when any INTERIOR_AI present", () => {
    expect(
      showroomMediaMode([
        { kind: "SAMPLE" },
        { kind: "INTERIOR_AI" },
      ]),
    ).toBe("has_interiors");
  });
});

describe("QR_PUBLIC_PHOTO_KINDS — safe for public api/photo allowlist", () => {
  const API_ALLOW = ["SAMPLE", "SLAB", "PIECE", "INTERIOR_AI", "DRAWING"];

  it("every showroom kind is already on the public photo route allowlist", () => {
    for (const k of QR_PUBLIC_PHOTO_KINDS) {
      expect(API_ALLOW).toContain(k);
    }
  });

  it("does not include DRAWING or PIECE (not added without safety review)", () => {
    expect(QR_PUBLIC_PHOTO_KINDS).not.toContain("DRAWING");
    expect(QR_PUBLIC_PHOTO_KINDS).not.toContain("PIECE");
  });
});

describe("buildQrPublicView — public exposure contract", () => {
  const base = {
    name: "Травертин Noce",
    rockType: "травертин",
    color: "бежевый" as string | null,
    description: "Мягкий рисунок" as string | null,
    properties: [["толщина", "20 см"]] as Array<[string, string]>,
    hasStock: true,
    textureFileUrl: null as string | null,
    photos: [
      { id: "p-slab", kind: "SLAB" },
      { id: "p-int", kind: "INTERIOR_AI" },
    ],
  };

  it("exposes only client-safe identity + neutral stock + ordered photo ids", () => {
    const v = buildQrPublicView(base);
    expect(v).toEqual({
      name: "Травертин Noce",
      rockType: "травертин",
      color: "бежевый",
      description: "Мягкий рисунок",
      properties: [["толщина", "20 см"]],
      stockLabel: "в наличии",
      textureFileUrl: null,
      photoIds: ["p-int", "p-slab"],
      photoKinds: ["INTERIOR_AI", "SLAB"],
      mediaMode: "has_interiors",
    });
    // Must never carry exact remainder / location / price fields.
    expect(v).not.toHaveProperty("slabsFree");
    expect(v).not.toHaveProperty("block");
    expect(v).not.toHaveProperty("landmark");
    expect(v).not.toHaveProperty("basePrice");
    expect(v).not.toHaveProperty("purchasePrice");
  });

  it("stockLabel is only the neutral badge text", () => {
    expect(buildQrPublicView({ ...base, hasStock: false }).stockLabel).toBe(
      "под заказ",
    );
  });

  it("warehouse-only photos surface as warehouse_photos_only", () => {
    const v = buildQrPublicView({
      ...base,
      photos: [{ id: "s", kind: "SAMPLE" }],
    });
    expect(v.mediaMode).toBe("warehouse_photos_only");
    expect(v.photoKinds).toEqual(["SAMPLE"]);
  });
});

describe("buildQrStaffExtras — staff vs public", () => {
  it("public (isStaff=false) gets null — no warehouse card href", () => {
    expect(buildQrStaffExtras(false, "st-1")).toBeNull();
  });

  it("staff (canSeeExactRemainder) gets /kamen/[id] only", () => {
    expect(buildQrStaffExtras(true, "st-42")).toEqual({
      fullCardHref: "/kamen/st-42",
    });
  });
});

describe("photoKindLabelRu", () => {
  it("labels known kinds in Russian", () => {
    expect(photoKindLabelRu("INTERIOR_AI")).toBe("В интерьере");
    expect(photoKindLabelRu("SAMPLE")).toBe("Образец");
    expect(photoKindLabelRu("SLAB")).toBe("Плита");
  });
});
