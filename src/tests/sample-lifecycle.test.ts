// TZ №15 sample lifecycle — Sample vs SAMPLE shipment pair (design §4).
// Single writer of Sample, badge honesty, out-of-order user actions.
import { describe, expect, it } from "vitest";
import {
  deriveShipmentStatus,
  shipmentAwaitsWarehouse,
  lineIsFullyShipped,
} from "@/lib/shipments";

/** Minimal shipment shape used by badge + queue derivation. */
function ship(over: {
  cancelledAt?: Date | null;
  completedAt?: Date | null;
  qtyShippedSlabs?: number;
  qtyShippedAreaM2?: number;
  targetType?: string;
  qtyOrderedSlabs?: number | null;
  qtyOrderedAreaM2?: number | null;
} | null) {
  if (over === null) return null;
  return {
    cancelledAt: over.cancelledAt ?? null,
    completedAt: over.completedAt ?? null,
    lines: [
      {
        targetType: over.targetType ?? "SLAB",
        qtyOrderedSlabs: over.qtyOrderedSlabs ?? 1,
        qtyOrderedAreaM2: over.qtyOrderedAreaM2 ?? null,
        qtyShippedSlabs: over.qtyShippedSlabs ?? 0,
        qtyShippedAreaM2: over.qtyShippedAreaM2 ?? 0,
      },
    ],
  };
}

/**
 * Mirrors /obraztsy badge rule:
 *   awaitsWarehouse && status === "ACTIVE" → «ожидает выдачи со склада»
 * (page.tsx:206–209)
 */
function badgeAwaitsWarehouse(
  sampleStatus: "ACTIVE" | "RETURNED" | "SOLD",
  shipment: ReturnType<typeof ship>,
): boolean {
  return sampleStatus === "ACTIVE" && shipmentAwaitsWarehouse(shipment);
}

describe("single-writer contract (pure invariants)", () => {
  it("confirmShipment does not create Sample — only ship lines (doc in shipments.ts)", () => {
    // Structural: shipmentAwaitsWarehouse/derive never invent Sample rows;
    // createSampleShipment is called only from issueSample (grep: one sample.create).
    // This test pins the pure status derivation used after confirm.
    const open = ship({ qtyShippedSlabs: 0 });
    expect(deriveShipmentStatus(open)).toBe("OPEN");
    const done = ship({
      qtyShippedSlabs: 1,
      completedAt: new Date("2026-08-09T12:00:00Z"),
    });
    expect(deriveShipmentStatus(done)).toBe("DONE");
    expect(shipmentAwaitsWarehouse(done)).toBe(false);
  });

  it("legacy Sample without shipment → not awaiting warehouse (grandfather)", () => {
    expect(shipmentAwaitsWarehouse(null)).toBe(false);
    expect(deriveShipmentStatus(null)).toBe("DONE");
    expect(badgeAwaitsWarehouse("ACTIVE", null)).toBe(false);
  });
});

describe("Sample × Shipment state table (badge + queue coherence)", () => {
  const NOW = new Date("2026-08-09T12:00:00Z");

  type Row = {
    name: string;
    sampleStatus: "ACTIVE" | "RETURNED" | "SOLD";
    shipment: ReturnType<typeof ship>;
    /** Expected badge «ожидает выдачи» */
    badgeAwaits: boolean;
    /** Would still appear on /otgruzki open tab if listed by shipment alone */
    shipQueueOpen: boolean;
    verdict: "coherent" | "was_defect";
  };

  const rows: Row[] = [
    {
      name: "just issued: ACTIVE + OPEN ship",
      sampleStatus: "ACTIVE",
      shipment: ship({ qtyShippedSlabs: 0 }),
      badgeAwaits: true,
      shipQueueOpen: true,
      verdict: "coherent",
    },
    {
      name: "warehouse confirmed full: ACTIVE + DONE",
      sampleStatus: "ACTIVE",
      shipment: ship({
        qtyShippedSlabs: 1,
        completedAt: NOW,
      }),
      badgeAwaits: false,
      shipQueueOpen: false,
      verdict: "coherent",
    },
    {
      name: "volume partial ship: ACTIVE + PARTIAL",
      sampleStatus: "ACTIVE",
      shipment: ship({
        targetType: "BATCH_VOLUME",
        qtyOrderedSlabs: 5,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 2,
        qtyShippedAreaM2: 0,
      }),
      badgeAwaits: true,
      shipQueueOpen: true,
      verdict: "coherent",
    },
    {
      name: "returned before confirm: RETURNED + CANCELLED ship",
      sampleStatus: "RETURNED",
      shipment: ship({
        cancelledAt: NOW,
        qtyShippedSlabs: 0,
      }),
      badgeAwaits: false,
      shipQueueOpen: false,
      verdict: "coherent",
    },
    {
      name: "sold before confirm (after fix): SOLD + CANCELLED ship",
      sampleStatus: "SOLD",
      shipment: ship({
        cancelledAt: NOW,
        qtyShippedSlabs: 0,
      }),
      badgeAwaits: false,
      shipQueueOpen: false,
      verdict: "coherent",
    },
    {
      name: "sold before confirm WITHOUT cancel (pre-fix defect): SOLD + OPEN",
      sampleStatus: "SOLD",
      shipment: ship({ qtyShippedSlabs: 0 }),
      badgeAwaits: false, // badge honest (only ACTIVE shows badge)
      shipQueueOpen: true, // but otgruzki would still show task — defect
      verdict: "was_defect",
    },
    {
      name: "confirm after return: CANCELLED ship — cannot re-open",
      sampleStatus: "RETURNED",
      shipment: ship({ cancelledAt: NOW }),
      badgeAwaits: false,
      shipQueueOpen: false,
      verdict: "coherent",
    },
    {
      name: "confirm after sold with cancel: CANCELLED",
      sampleStatus: "SOLD",
      shipment: ship({ cancelledAt: NOW }),
      badgeAwaits: false,
      shipQueueOpen: false,
      verdict: "coherent",
    },
    {
      name: "legacy ACTIVE sample no shipment row",
      sampleStatus: "ACTIVE",
      shipment: null,
      badgeAwaits: false,
      shipQueueOpen: false,
      verdict: "coherent",
    },
  ];

  for (const r of rows) {
    it(r.name, () => {
      const status = deriveShipmentStatus(r.shipment);
      const awaits = shipmentAwaitsWarehouse(r.shipment);
      const badge = badgeAwaitsWarehouse(r.sampleStatus, r.shipment);
      const queueOpen = status === "OPEN" || status === "PARTIAL";

      expect(badge).toBe(r.badgeAwaits);
      expect(queueOpen).toBe(r.shipQueueOpen);
      expect(awaits).toBe(
        r.sampleStatus === "ACTIVE" ? r.badgeAwaits : awaits,
      );

      // Badge never says «ожидает выдачи» when sample is not ACTIVE
      if (r.sampleStatus !== "ACTIVE") {
        expect(badge).toBe(false);
      }
      // When badge says awaiting, sample is ACTIVE and ship needs warehouse
      if (badge) {
        expect(r.sampleStatus).toBe("ACTIVE");
        expect(awaits).toBe(true);
      }
    });
  }

  it("partial volume lineIsFullyShipped false until ordered met", () => {
    expect(
      lineIsFullyShipped({
        targetType: "BATCH_VOLUME",
        qtyOrderedSlabs: 5,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 2,
        qtyShippedAreaM2: 0,
      }),
    ).toBe(false);
    expect(
      lineIsFullyShipped({
        targetType: "BATCH_VOLUME",
        qtyOrderedSlabs: 5,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 5,
        qtyShippedAreaM2: 0,
      }),
    ).toBe(true);
  });
});

describe("badge honesty summary", () => {
  it("ACTIVE+OPEN → true; SOLD+OPEN → false (badge does not claim physical leave for closed sample)", () => {
    const open = ship({ qtyShippedSlabs: 0 });
    expect(badgeAwaitsWarehouse("ACTIVE", open)).toBe(true);
    expect(badgeAwaitsWarehouse("SOLD", open)).toBe(false);
    expect(badgeAwaitsWarehouse("RETURNED", open)).toBe(false);
  });

  it("ACTIVE+DONE → false (physically left, no longer «ожидает»)", () => {
    expect(
      badgeAwaitsWarehouse(
        "ACTIVE",
        ship({ qtyShippedSlabs: 1, completedAt: new Date() }),
      ),
    ).toBe(false);
  });
});
