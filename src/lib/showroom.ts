// TZ №15 Slice 3 — showroom (unit-only).
// State change AVAILABLE→SHOWROOM on send (conditional updateMany), same TX as
// placement + OPEN SHOWROOM shipment. Warehouse confirm is physical only.
// Mutual exclusion with sell / reserve / sample via UnitStatus.

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { createShowroomShipment } from "@/lib/shipments";

type Db = PrismaClient | Prisma.TransactionClient;

export type ShowroomErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN_ROLE"
  | "INVALID_INPUT"
  | "UNIT_UNAVAILABLE"
  | "ALREADY_IN_SHOWROOM"
  | "NOT_IN_SHOWROOM"
  | "CONFLICT";

export class ShowroomError extends Error {
  constructor(
    public readonly code: ShowroomErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ShowroomFail = { ok: false; error: { code: ShowroomErrorCode; message: string } };

function fail(code: ShowroomErrorCode, message: string): ShowroomFail {
  return { ok: false, error: { code, message } };
}

/** Manager + warehouse + owner may send (design D5 placeholder). */
export function roleCanSendToShowroom(role: string): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "WAREHOUSE";
}

/** Return to stock: warehouse or seller (design D6 placeholder). */
export function roleCanReturnFromShowroom(role: string): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "WAREHOUSE";
}

export async function sendToShowroom(args: {
  targetType: "SLAB" | "PIECE";
  unitId: string;
  actorId: string;
  /** Display stand / comment (required for warehouse UX). */
  standNote?: string | null;
}): Promise<{ ok: true; placementId: string; shipmentId: string } | ShowroomFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: args.actorId },
        select: { id: true, role: true, isActive: true },
      });
      if (!actor?.isActive) {
        throw new ShowroomError("FORBIDDEN_ROLE", "Пользователь не найден");
      }
      if (!roleCanSendToShowroom(actor.role)) {
        throw new ShowroomError(
          "FORBIDDEN_ROLE",
          "В шоу-рум отправляет менеджер, складчик или владелец",
        );
      }

      const unitId = args.unitId.trim();
      if (!unitId) {
        throw new ShowroomError("INVALID_INPUT", "Не указан камень");
      }

      // Conditional: AVAILABLE only — competes with sell/reserve/sample.
      const where = {
        id: unitId,
        status: "AVAILABLE" as const,
        needsCheck: false,
      };
      const updated =
        args.targetType === "SLAB"
          ? await tx.slab.updateMany({
              where,
              data: { status: "SHOWROOM" },
            })
          : await tx.piece.updateMany({
              where,
              data: { status: "SHOWROOM" },
            });

      if (updated.count === 0) {
        const unit =
          args.targetType === "SLAB"
            ? await tx.slab.findUnique({
                where: { id: unitId },
                select: { status: true },
              })
            : await tx.piece.findUnique({
                where: { id: unitId },
                select: { status: true },
              });
        if (!unit) {
          throw new ShowroomError("NOT_FOUND", "Камень не найден");
        }
        if (unit.status === "SHOWROOM") {
          throw new ShowroomError(
            "ALREADY_IN_SHOWROOM",
            "Камень уже в шоу-руме",
          );
        }
        throw new ShowroomError(
          "UNIT_UNAVAILABLE",
          "Камень недоступен (продан, в брони, образец или на проверке)",
        );
      }

      const locRow =
        args.targetType === "SLAB"
          ? await tx.slab.findUnique({
              where: { id: unitId },
              select: { block: true, landmark: true },
            })
          : await tx.piece.findUnique({
              where: { id: unitId },
              select: { block: true, landmark: true },
            });
      const locationSnapshot = locRow
        ? `Блок ${locRow.block}, ор. ${locRow.landmark}`
        : null;

      const standNote = args.standNote?.trim() || null;
      const { shipmentId } = await createShowroomShipment(tx, {
        managerId: actor.id,
        note: standNote,
        line: {
          targetType: args.targetType,
          slabId: args.targetType === "SLAB" ? unitId : null,
          pieceId: args.targetType === "PIECE" ? unitId : null,
          locationSnapshot,
        },
      });

      const placement = await tx.showroomPlacement.create({
        data: {
          targetType: args.targetType,
          slabId: args.targetType === "SLAB" ? unitId : null,
          pieceId: args.targetType === "PIECE" ? unitId : null,
          standNote,
          sentById: actor.id,
          shipmentId,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SHOWROOM_SEND",
          entityType: args.targetType === "SLAB" ? "Slab" : "Piece",
          entityId: unitId,
          payload: {
            placementId: placement.id,
            shipmentId,
            standNote,
            from: "AVAILABLE",
            to: "SHOWROOM",
          },
        },
      });

      return {
        ok: true as const,
        placementId: placement.id,
        shipmentId,
      };
    });
  } catch (e) {
    if (e instanceof ShowroomError) {
      return fail(e.code, e.message);
    }
    throw e;
  }
}

/** Close open placement rows for a unit (return / sell / sample exit). */
export async function closeOpenShowroomPlacement(
  tx: Db,
  args: { slabId?: string | null; pieceId?: string | null; now?: Date },
): Promise<number> {
  const now = args.now ?? new Date();
  if (args.slabId) {
    const r = await tx.showroomPlacement.updateMany({
      where: { slabId: args.slabId, closedAt: null },
      data: { closedAt: now },
    });
    return r.count;
  }
  if (args.pieceId) {
    const r = await tx.showroomPlacement.updateMany({
      where: { pieceId: args.pieceId, closedAt: null },
      data: { closedAt: now },
    });
    return r.count;
  }
  return 0;
}

/**
 * Cancel OPEN SHOWROOM shipment for unit (on return before confirm, or cleanup).
 * Looks up open placement's shipmentId.
 */
export async function cancelOpenShowroomShipmentForUnit(
  tx: Db,
  args: { slabId?: string | null; pieceId?: string | null; now?: Date },
): Promise<boolean> {
  const now = args.now ?? new Date();
  const open = args.slabId
    ? await tx.showroomPlacement.findFirst({
        where: { slabId: args.slabId, closedAt: null },
        select: { shipmentId: true },
        orderBy: { sentAt: "desc" },
      })
    : args.pieceId
      ? await tx.showroomPlacement.findFirst({
          where: { pieceId: args.pieceId, closedAt: null },
          select: { shipmentId: true },
          orderBy: { sentAt: "desc" },
        })
      : null;
  if (!open?.shipmentId) return false;
  const res = await tx.shipment.updateMany({
    where: {
      id: open.shipmentId,
      cancelledAt: null,
      completedAt: null,
    },
    data: { cancelledAt: now },
  });
  return res.count > 0;
}

export async function returnFromShowroom(args: {
  targetType: "SLAB" | "PIECE";
  unitId: string;
  actorId: string;
}): Promise<{ ok: true } | ShowroomFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: args.actorId },
        select: { id: true, role: true, isActive: true },
      });
      if (!actor?.isActive) {
        throw new ShowroomError("FORBIDDEN_ROLE", "Пользователь не найден");
      }
      if (!roleCanReturnFromShowroom(actor.role)) {
        throw new ShowroomError(
          "FORBIDDEN_ROLE",
          "Вернуть из шоу-рума может менеджер, складчик или владелец",
        );
      }

      const unitId = args.unitId.trim();
      const where = { id: unitId, status: "SHOWROOM" as const };
      const updated =
        args.targetType === "SLAB"
          ? await tx.slab.updateMany({
              where,
              data: { status: "AVAILABLE" },
            })
          : await tx.piece.updateMany({
              where,
              data: { status: "AVAILABLE" },
            });
      if (updated.count === 0) {
        const unit =
          args.targetType === "SLAB"
            ? await tx.slab.findUnique({
                where: { id: unitId },
                select: { status: true },
              })
            : await tx.piece.findUnique({
                where: { id: unitId },
                select: { status: true },
              });
        if (!unit) {
          throw new ShowroomError("NOT_FOUND", "Камень не найден");
        }
        throw new ShowroomError(
          "NOT_IN_SHOWROOM",
          "Камень не в шоу-руме (уже вернули, продали или выдали)",
        );
      }

      const now = new Date();
      await cancelOpenShowroomShipmentForUnit(tx, {
        slabId: args.targetType === "SLAB" ? unitId : null,
        pieceId: args.targetType === "PIECE" ? unitId : null,
        now,
      });
      await closeOpenShowroomPlacement(tx, {
        slabId: args.targetType === "SLAB" ? unitId : null,
        pieceId: args.targetType === "PIECE" ? unitId : null,
        now,
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SHOWROOM_RETURN",
          entityType: args.targetType === "SLAB" ? "Slab" : "Piece",
          entityId: unitId,
          payload: { from: "SHOWROOM", to: "AVAILABLE" },
        },
      });

      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof ShowroomError) {
      return fail(e.code, e.message);
    }
    throw e;
  }
}

export const MAX_SHOWROOM_PAGE = 100;

export type ShowroomListItem = {
  placementId: string;
  targetType: "SLAB" | "PIECE";
  unitId: string;
  stoneLabel: string;
  standNote: string | null;
  sentAt: Date;
  sentByName: string;
  location: string;
  block: string;
  landmark: string;
};

/** Bounded list of units currently in showroom (status SHOWROOM + open placement). */
export async function listShowroom(
  database: Db,
  args?: { take?: number },
): Promise<ShowroomListItem[]> {
  const take = Math.min(MAX_SHOWROOM_PAGE, args?.take ?? MAX_SHOWROOM_PAGE);
  const rows = await database.showroomPlacement.findMany({
    where: { closedAt: null },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      targetType: true,
      slabId: true,
      pieceId: true,
      standNote: true,
      sentAt: true,
      sentBy: { select: { name: true } },
      slab: {
        select: {
          id: true,
          label: true,
          status: true,
          block: true,
          landmark: true,
          stoneType: { select: { name: true } },
        },
      },
      piece: {
        select: {
          id: true,
          kind: true,
          status: true,
          block: true,
          landmark: true,
          stoneType: { select: { name: true } },
        },
      },
    },
  });

  const out: ShowroomListItem[] = [];
  for (const r of rows) {
    // Prefer live status SHOWROOM; skip stale open placement if unit left.
    if (r.slab) {
      if (r.slab.status !== "SHOWROOM") continue;
      out.push({
        placementId: r.id,
        targetType: "SLAB",
        unitId: r.slab.id,
        stoneLabel: `${r.slab.stoneType.name} — ${r.slab.label}`,
        standNote: r.standNote,
        sentAt: r.sentAt,
        sentByName: r.sentBy.name,
        location: `Блок ${r.slab.block}, ор. ${r.slab.landmark}`,
        block: r.slab.block,
        landmark: r.slab.landmark,
      });
    } else if (r.piece) {
      if (r.piece.status !== "SHOWROOM") continue;
      const k = r.piece.kind === "BROKEN" ? "бой" : "остаток";
      out.push({
        placementId: r.id,
        targetType: "PIECE",
        unitId: r.piece.id,
        stoneLabel: `${r.piece.stoneType.name} — ${k}`,
        standNote: r.standNote,
        sentAt: r.sentAt,
        sentByName: r.sentBy.name,
        location: `Блок ${r.piece.block}, ор. ${r.piece.landmark}`,
        block: r.piece.block,
        landmark: r.piece.landmark,
      });
    }
  }
  return out;
}

/** Pure: showroom units are not ordinarily sellable free stock. */
export function isOrdinarilySellableStatus(status: string): boolean {
  return status === "AVAILABLE" || status === "RESERVED";
}
