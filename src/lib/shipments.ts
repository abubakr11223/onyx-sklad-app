// TZ №15 Slice 1 — SALE shipments only.
// Stock leaves availability at SALE time (unchanged). Confirm records hand-over only.

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

/** Cancel OPEN shipment when sale is returned (minimal Slice 1). */
export async function cancelOpenShipmentForSale(
  tx: Db,
  saleRecordId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const ship = await tx.shipment.findUnique({
    where: { saleRecordId },
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
  // Partial already shipped: still cancel the task header (stock reverse is sale's job).
  // Product can refine reverse-ship later (design D9).
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
        throw new ShipmentError("CANCELLED", "Отгрузка отменена (возврат продажи)");
      }
      if (ship.completedAt) {
        throw new ShipmentError("ALREADY_DONE", "Уже отгружено полностью");
      }
      if (ship.lines.length === 0) {
        throw new ShipmentError("NOT_FOUND", "Нет строк отгрузки");
      }

      const now = new Date();
      // Slice 1: one line per sale
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
            "Нельзя отгрузить больше остатка по продаже",
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

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SHIPMENT_CONFIRM",
          entityType: "Shipment",
          entityId: ship.id,
          payload: {
            lineId: line.id,
            addSlabs,
            addArea,
            fully,
            // Explicit: no UnitStatus change on confirm (TZ15 §6 / design §3)
            unitStatusTouched: false,
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
  createdAt: Date;
  completedAt: Date | null;
  managerId: string;
  managerName: string;
  clientName: string | null;
  siteName: string | null;
  saleId: string | null;
  soldAt: Date | null;
  stoneLabel: string;
  locationSnapshot: string | null;
  qtyOrderedSlabs: number | null;
  qtyOrderedAreaM2: number | null;
  qtyShippedSlabs: number;
  qtyShippedAreaM2: number;
  lineId: string;
  targetType: string;
};

/** Bounded list. tab=open → not cancelled & not completed; archive → completed. */
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
    kind: "SALE",
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
    let stoneLabel = "—";
    if (sale?.slab) {
      stoneLabel = `${sale.slab.stoneType.name} — ${sale.slab.label}`;
    } else if (sale?.piece) {
      const k = sale.piece.kind === "BROKEN" ? "бой" : "остаток";
      stoneLabel = `${sale.piece.stoneType.name} — ${k}`;
    } else if (sale?.batch) {
      stoneLabel = `${sale.batch.stoneType.name} — объём`;
    }
    const line0 = r.lines[0];
    return {
      id: r.id,
      status,
      statusLabel: shipmentStatusLabelRu(status),
      kind: r.kind,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      managerId: r.managerId,
      managerName: r.manager.name,
      clientName: r.client?.name ?? sale?.customerName ?? null,
      siteName: r.site?.name ?? null,
      saleId: sale?.id ?? null,
      soldAt: sale?.soldAt ?? null,
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
