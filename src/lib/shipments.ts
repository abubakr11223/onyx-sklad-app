// TZ №15 — SALE (slice 1) + SAMPLE (slice 2) shipments.
// Stock / Sample row leave free stock at commercial TX (sale or issueSample).
// Confirm records physical hand-over only — never UnitStatus, never Sample create.

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

type Db = PrismaClient | Prisma.TransactionClient;

export type DerivedShipmentStatus = "OPEN" | "PARTIAL" | "DONE" | "CANCELLED";

export type ShipmentLineInput = {
  targetType: "SLAB" | "PIECE" | "BATCH_VOLUME";
  slabId?: string | null;
  pieceId?: string | null;
  batchId?: string | null;
  qtyOrderedSlabs?: number | null;
  qtyOrderedAreaM2?: number | null;
  locationSnapshot?: string | null;
};

const AREA_EPS = 1e-6;

/** Queue / badge: OPEN or PARTIAL still needs warehouse hand-over. */
export function shipmentAwaitsWarehouse(
  shipment: {
    cancelledAt: Date | null;
    completedAt: Date | null;
    lines: Array<{
      targetType: string;
      qtyOrderedSlabs: number | null;
      qtyOrderedAreaM2: number | null;
      qtyShippedSlabs: number;
      qtyShippedAreaM2: number;
    }>;
  } | null,
): boolean {
  const s = deriveShipmentStatus(shipment);
  return s === "OPEN" || s === "PARTIAL";
}

/** Pure: line fully shipped? Units: ordered 1 / shipped ≥1; volume: shipped ≥ ordered. */
export function lineIsFullyShipped(line: {
  targetType: string;
  qtyOrderedSlabs: number | null;
  qtyOrderedAreaM2: number | null;
  qtyShippedSlabs: number;
  qtyShippedAreaM2: number;
}): boolean {
  if (line.targetType === "SLAB" || line.targetType === "PIECE") {
    // Unit line: ordered as 1 slab conceptually
    return line.qtyShippedSlabs >= 1;
  }
  const oS = line.qtyOrderedSlabs ?? 0;
  const oA = line.qtyOrderedAreaM2 ?? 0;
  const sS = line.qtyShippedSlabs;
  const sA = line.qtyShippedAreaM2;
  const slabsDone = oS <= 0 || sS >= oS;
  const areaDone = oA <= 0 || sA + AREA_EPS >= oA;
  return slabsDone && areaDone;
}

/** Pure derived status (design §2.4). Legacy null shipment → DONE. */
export function deriveShipmentStatus(
  shipment: {
    cancelledAt: Date | null;
    completedAt: Date | null;
    lines: Array<{
      targetType: string;
      qtyOrderedSlabs: number | null;
      qtyOrderedAreaM2: number | null;
      qtyShippedSlabs: number;
      qtyShippedAreaM2: number;
    }>;
  } | null,
): DerivedShipmentStatus {
  if (!shipment) return "DONE"; // grandfather legacy sales
  if (shipment.cancelledAt) return "CANCELLED";
  if (shipment.completedAt) return "DONE";
  const anyShipped = shipment.lines.some(
    (l) =>
      l.qtyShippedSlabs > 0 ||
      (l.qtyShippedAreaM2 != null && l.qtyShippedAreaM2 > AREA_EPS),
  );
  if (shipment.lines.length > 0 && shipment.lines.every(lineIsFullyShipped)) {
    return "DONE";
  }
  if (anyShipped) return "PARTIAL";
  return "OPEN";
}

export function shipmentStatusLabelRu(s: DerivedShipmentStatus): string {
  switch (s) {
    case "OPEN":
      return "К отгрузке";
    case "PARTIAL":
      return "Отгружено частично";
    case "DONE":
      return "Отгружено";
    case "CANCELLED":
      return "Отменено";
  }
}

/**
 * Create OPEN SALE shipment + line(s) in the same TX as SaleRecord.
 * Does NOT touch UnitStatus / sold counters.
 */
export async function createSaleShipment(
  tx: Db,
  args: {
    saleRecordId: string;
    managerId: string;
    clientId?: string | null;
    siteId?: string | null;
    note?: string | null;
    line: ShipmentLineInput;
  },
): Promise<{ shipmentId: string }> {
  const line = args.line;
  const shipment = await tx.shipment.create({
    data: {
      kind: "SALE",
      saleRecordId: args.saleRecordId,
      managerId: args.managerId,
      clientId: args.clientId?.trim() || null,
      siteId: args.siteId?.trim() || null,
      note: args.note?.trim() || null,
      lines: {
        create: {
          targetType: line.targetType,
          slabId: line.slabId ?? null,
          pieceId: line.pieceId ?? null,
          batchId: line.batchId ?? null,
          qtyOrderedSlabs:
            line.targetType === "BATCH_VOLUME"
              ? (line.qtyOrderedSlabs ?? null)
              : 1,
          qtyOrderedAreaM2:
            line.targetType === "BATCH_VOLUME" && line.qtyOrderedAreaM2 != null
              ? line.qtyOrderedAreaM2.toFixed(3)
              : null,
          qtyShippedSlabs: 0,
          qtyShippedAreaM2: 0,
          locationSnapshot: line.locationSnapshot ?? null,
        },
      },
    },
    select: { id: true },
  });
  return { shipmentId: shipment.id };
}

/**
 * Create OPEN SAMPLE shipment + line in the same TX as Sample.create.
 * Does NOT create/update Sample — issueSample is the single Sample writer (design §4.4).
 * Does NOT touch UnitStatus (already SAMPLE / volume hold at issue).
 */
export async function createSampleShipment(
  tx: Db,
  args: {
    sampleId: string;
    managerId: string;
    clientId?: string | null;
    note?: string | null;
    line: ShipmentLineInput;
  },
): Promise<{ shipmentId: string }> {
  const line = args.line;
  const shipment = await tx.shipment.create({
    data: {
      kind: "SAMPLE",
      sampleId: args.sampleId,
      managerId: args.managerId,
      clientId: args.clientId?.trim() || null,
      note: args.note?.trim() || null,
      lines: {
        create: {
          targetType: line.targetType,
          slabId: line.slabId ?? null,
          pieceId: line.pieceId ?? null,
          batchId: line.batchId ?? null,
          qtyOrderedSlabs:
            line.targetType === "BATCH_VOLUME"
              ? (line.qtyOrderedSlabs ?? null)
              : 1,
          qtyOrderedAreaM2:
            line.targetType === "BATCH_VOLUME" && line.qtyOrderedAreaM2 != null
              ? line.qtyOrderedAreaM2.toFixed(3)
              : null,
          qtyShippedSlabs: 0,
          qtyShippedAreaM2: 0,
          locationSnapshot: line.locationSnapshot ?? null,
        },
      },
    },
    select: { id: true },
  });
  return { shipmentId: shipment.id };
}

/** Cancel OPEN shipment when sale is returned (minimal Slice 1). */
export async function cancelOpenShipmentForSale(
  tx: Db,
  saleRecordId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return cancelOpenShipmentByKey(tx, { saleRecordId }, now);
}

/** Cancel OPEN SAMPLE shipment when sample is returned (Slice 2). */
export async function cancelOpenShipmentForSample(
  tx: Db,
  sampleId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return cancelOpenShipmentByKey(tx, { sampleId }, now);
}

async function cancelOpenShipmentByKey(
  tx: Db,
  key: { saleRecordId: string } | { sampleId: string },
  now: Date,
): Promise<boolean> {
  const ship = await tx.shipment.findUnique({
    where: key,
    select: {
      id: true,
      cancelledAt: true,
      completedAt: true,
      lines: {
        select: {
          qtyShippedSlabs: true,
          qtyShippedAreaM2: true,
        },
      },
    },
  });
  if (!ship || ship.cancelledAt || ship.completedAt) return false;
  const anyShipped = ship.lines.some(
    (l) =>
      l.qtyShippedSlabs > 0 ||
      Number(l.qtyShippedAreaM2.toString()) > AREA_EPS,
  );
  // Partial already shipped: still cancel the task header (stock reverse is commercial path).
  void anyShipped;
  const res = await tx.shipment.updateMany({
    where: { id: ship.id, cancelledAt: null },
    data: { cancelledAt: now },
  });
  return res.count > 0;
}

export type ShipmentErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ALREADY_DONE"
  | "CANCELLED"
  | "INVALID_QTY"
  | "CONFLICT";

export class ShipmentError extends Error {
  constructor(
    public readonly code: ShipmentErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Confirm hand-over. NEVER changes UnitStatus / batch sold counters.
 * NEVER creates, re-creates, or re-activates Sample (design §4.4 single writer).
 * Unit: full only. Volume: partial allowed, never above remaining ordered.
 */
export async function confirmShipment(args: {
  shipmentId: string;
  actorId: string;
  /** Volume: optional partial; omit = ship all remaining. */
  qtySlabs?: number | null;
  qtyAreaM2?: number | null;
}): Promise<{ status: DerivedShipmentStatus }> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: args.actorId },
        select: { id: true, role: true, isActive: true },
      });
      if (!actor?.isActive) {
        throw new ShipmentError("FORBIDDEN", "Пользователь не найден");
      }
      if (actor.role !== "OWNER" && actor.role !== "WAREHOUSE") {
        throw new ShipmentError(
          "FORBIDDEN",
          "Отгрузку подтверждает складчик или владелец",
        );
      }

      const ship = await tx.shipment.findUnique({
        where: { id: args.shipmentId },
        select: {
          id: true,
          kind: true,
          cancelledAt: true,
          completedAt: true,
          lines: {
            select: {
              id: true,
              targetType: true,
              qtyOrderedSlabs: true,
              qtyOrderedAreaM2: true,
              qtyShippedSlabs: true,
              qtyShippedAreaM2: true,
            },
          },
        },
      });
      if (!ship) throw new ShipmentError("NOT_FOUND", "Отгрузка не найдена");
      if (ship.cancelledAt) {
        throw new ShipmentError(
          "CANCELLED",
          "Отгрузка отменена (возврат продажи/образца)",
        );
      }
      if (ship.completedAt) {
        throw new ShipmentError("ALREADY_DONE", "Уже отгружено полностью");
      }
      if (ship.lines.length === 0) {
        throw new ShipmentError("NOT_FOUND", "Нет строк отгрузки");
      }

      const now = new Date();
      // One line per commercial event (sale or sample).
      const line = ship.lines[0]!;
      const orderedSlabs = line.qtyOrderedSlabs ?? 0;
      const orderedArea =
        line.qtyOrderedAreaM2 == null
          ? 0
          : Number(line.qtyOrderedAreaM2.toString());
      const shippedSlabs = line.qtyShippedSlabs;
      const shippedArea = Number(line.qtyShippedAreaM2.toString());
      const remSlabs = Math.max(0, orderedSlabs - shippedSlabs);
      const remArea = Math.max(0, orderedArea - shippedArea);

      let addSlabs = 0;
      let addArea = 0;

      if (line.targetType === "SLAB" || line.targetType === "PIECE") {
        if (shippedSlabs >= 1) {
          throw new ShipmentError("ALREADY_DONE", "Единица уже отгружена");
        }
        addSlabs = 1;
      } else {
        const reqS =
          args.qtySlabs != null && Number.isFinite(args.qtySlabs)
            ? Math.floor(args.qtySlabs)
            : null;
        const reqA =
          args.qtyAreaM2 != null && Number.isFinite(args.qtyAreaM2)
            ? args.qtyAreaM2
            : null;
        if (
          (reqS == null || reqS <= 0) &&
          (reqA == null || reqA <= 0)
        ) {
          // Full remaining
          addSlabs = remSlabs;
          addArea = remArea;
        } else {
          addSlabs = reqS != null && reqS > 0 ? reqS : 0;
          addArea = reqA != null && reqA > 0 ? reqA : 0;
        }
        if (addSlabs <= 0 && addArea <= AREA_EPS) {
          throw new ShipmentError(
            "INVALID_QTY",
            "Укажите количество к отгрузке",
          );
        }
        if (addSlabs > remSlabs + 0 || addArea > remArea + AREA_EPS) {
          throw new ShipmentError(
            "INVALID_QTY",
            "Нельзя отгрузить больше остатка по заказу",
          );
        }
      }

      const newShippedSlabs = shippedSlabs + addSlabs;
      const newShippedArea = shippedArea + addArea;

      const updated = await tx.shipmentLine.updateMany({
        where: {
          id: line.id,
          qtyShippedSlabs: shippedSlabs, // optimistic
        },
        data: {
          qtyShippedSlabs: newShippedSlabs,
          qtyShippedAreaM2: newShippedArea.toFixed(3),
        },
      });
      if (updated.count === 0) {
        throw new ShipmentError(
          "CONFLICT",
          "Отгрузку изменили параллельно — обновите страницу",
        );
      }

      const afterLine = {
        targetType: line.targetType,
        qtyOrderedSlabs: line.qtyOrderedSlabs,
        qtyOrderedAreaM2:
          line.qtyOrderedAreaM2 == null
            ? null
            : Number(line.qtyOrderedAreaM2.toString()),
        qtyShippedSlabs: newShippedSlabs,
        qtyShippedAreaM2: newShippedArea,
      };
      const fully = lineIsFullyShipped(afterLine);
      if (fully) {
        await tx.shipment.update({
          where: { id: ship.id },
          data: { completedAt: now },
        });
      }

      // Intentionally NO tx.sample.* and NO slab/piece status writes (design §4).
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SHIPMENT_CONFIRM",
          entityType: "Shipment",
          entityId: ship.id,
          payload: {
            kind: ship.kind,
            lineId: line.id,
            addSlabs,
            addArea,
            fully,
            // Explicit: confirm is physical hand-over only.
            unitStatusTouched: false,
            sampleTouched: false,
          },
        },
      });

      return {
        status: deriveShipmentStatus({
          cancelledAt: null,
          completedAt: fully ? now : null,
          lines: [afterLine],
        }),
      };
    });
  } catch (e) {
    if (e instanceof ShipmentError) throw e;
    throw e;
  }
}

export const MAX_SHIPMENTS_PAGE = 100;

export type ShipmentListItem = {
  id: string;
  status: DerivedShipmentStatus;
  statusLabel: string;
  kind: string;
  /** True when kind === SAMPLE (warehouse UI «ОБРАЗЕЦ»). */
  isSample: boolean;
  createdAt: Date;
  completedAt: Date | null;
  managerId: string;
  managerName: string;
  clientName: string | null;
  siteName: string | null;
  saleId: string | null;
  sampleId: string | null;
  soldAt: Date | null;
  /** Sample return due (warehouse queue, design §3.1). */
  returnDueDate: Date | null;
  stoneLabel: string;
  locationSnapshot: string | null;
  qtyOrderedSlabs: number | null;
  qtyOrderedAreaM2: number | null;
  qtyShippedSlabs: number;
  qtyShippedAreaM2: number;
  lineId: string;
  targetType: string;
};

/** Bounded list. SALE + SAMPLE. tab=open → not cancelled & not completed; archive → completed/cancelled. */
export async function listShipments(
  database: Db,
  args: {
    /** OWNER / WAREHOUSE: all; MANAGER: own managerId only */
    canSeeAll: boolean;
    actorId: string | null;
    tab: "open" | "archive";
    take?: number;
  },
): Promise<ShipmentListItem[]> {
  const take = Math.min(MAX_SHIPMENTS_PAGE, args.take ?? MAX_SHIPMENTS_PAGE);
  const where: Prisma.ShipmentWhereInput = {
    // Slice 2: sales + samples (SHOWROOM later).
    kind: { in: ["SALE", "SAMPLE"] },
    ...(args.canSeeAll
      ? {}
      : args.actorId
        ? { managerId: args.actorId }
        : { managerId: "__none__" }),
    ...(args.tab === "open"
      ? { cancelledAt: null, completedAt: null }
      : { OR: [{ completedAt: { not: null } }, { cancelledAt: { not: null } }] }),
  };

  const rows = await database.shipment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      kind: true,
      createdAt: true,
      completedAt: true,
      cancelledAt: true,
      managerId: true,
      manager: { select: { name: true } },
      client: { select: { name: true } },
      site: { select: { name: true } },
      saleRecord: {
        select: {
          id: true,
          soldAt: true,
          customerName: true,
          targetType: true,
          qtySlabs: true,
          qtyAreaM2: true,
          slab: {
            select: {
              label: true,
              stoneType: { select: { name: true } },
            },
          },
          piece: {
            select: {
              kind: true,
              stoneType: { select: { name: true } },
            },
          },
          batch: { select: { stoneType: { select: { name: true } } } },
        },
      },
      sample: {
        select: {
          id: true,
          returnDueDate: true,
          targetType: true,
          qtySlabs: true,
          qtyAreaM2: true,
          client: { select: { name: true } },
          slab: {
            select: {
              label: true,
              stoneType: { select: { name: true } },
            },
          },
          piece: {
            select: {
              kind: true,
              stoneType: { select: { name: true } },
            },
          },
          batch: { select: { stoneType: { select: { name: true } } } },
        },
      },
      lines: {
        select: {
          id: true,
          targetType: true,
          qtyOrderedSlabs: true,
          qtyOrderedAreaM2: true,
          qtyShippedSlabs: true,
          qtyShippedAreaM2: true,
          locationSnapshot: true,
        },
        take: 5,
      },
    },
  });

  return rows.map((r) => {
    const lines = r.lines.map((l) => ({
      targetType: l.targetType,
      qtyOrderedSlabs: l.qtyOrderedSlabs,
      qtyOrderedAreaM2:
        l.qtyOrderedAreaM2 == null
          ? null
          : Number(l.qtyOrderedAreaM2.toString()),
      qtyShippedSlabs: l.qtyShippedSlabs,
      qtyShippedAreaM2: Number(l.qtyShippedAreaM2.toString()),
    }));
    const status = deriveShipmentStatus({
      cancelledAt: r.cancelledAt,
      completedAt: r.completedAt,
      lines,
    });
    const sale = r.saleRecord;
    const sample = r.sample;
    let stoneLabel = "—";
    if (sale?.slab) {
      stoneLabel = `${sale.slab.stoneType.name} — ${sale.slab.label}`;
    } else if (sale?.piece) {
      const k = sale.piece.kind === "BROKEN" ? "бой" : "остаток";
      stoneLabel = `${sale.piece.stoneType.name} — ${k}`;
    } else if (sale?.batch) {
      stoneLabel = `${sale.batch.stoneType.name} — объём`;
    } else if (sample?.slab) {
      stoneLabel = `${sample.slab.stoneType.name} — ${sample.slab.label}`;
    } else if (sample?.piece) {
      const k = sample.piece.kind === "BROKEN" ? "бой" : "остаток";
      stoneLabel = `${sample.piece.stoneType.name} — ${k}`;
    } else if (sample?.batch) {
      stoneLabel = `${sample.batch.stoneType.name} — объём (образец)`;
    }
    const line0 = r.lines[0];
    return {
      id: r.id,
      status,
      statusLabel: shipmentStatusLabelRu(status),
      kind: r.kind,
      isSample: r.kind === "SAMPLE",
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      managerId: r.managerId,
      managerName: r.manager.name,
      clientName:
        r.client?.name ??
        sample?.client?.name ??
        sale?.customerName ??
        null,
      siteName: r.site?.name ?? null,
      saleId: sale?.id ?? null,
      sampleId: sample?.id ?? null,
      soldAt: sale?.soldAt ?? null,
      returnDueDate: sample?.returnDueDate ?? null,
      stoneLabel,
      locationSnapshot: line0?.locationSnapshot ?? null,
      qtyOrderedSlabs: line0?.qtyOrderedSlabs ?? null,
      qtyOrderedAreaM2:
        line0?.qtyOrderedAreaM2 == null
          ? null
          : Number(line0.qtyOrderedAreaM2.toString()),
      qtyShippedSlabs: line0?.qtyShippedSlabs ?? 0,
      qtyShippedAreaM2: line0
        ? Number(line0.qtyShippedAreaM2.toString())
        : 0,
      lineId: line0?.id ?? "",
      targetType: line0?.targetType ?? "SLAB",
    };
  });
}
