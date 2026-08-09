// TZ №15 §8.1 / §3.3 — «фото факта отгрузки».
//
// Self-contained module (o4). Does NOT edit shipments.ts / otgruzki UI.
//
// Reuses the existing Photo path — no second attachment system:
//   • Photo.storageKey hybrid: Telegram file_id OR https Blob URL
//     (same convention as /api/photo/[id] proxy)
//   • Photo.kind ∈ { SLAB, PIECE, SAMPLE } so the public proxy allowlist serves it
//   • Links to slabId / pieceId / stoneTypeId (Photo CHECK: ≥1 of these NOT NULL)
//
// Atomicity lesson (slab-without-photo bug): when confirm + photo must stay
// consistent, call `createShipmentFactPhotoInTx` INSIDE the same Prisma
// transaction as confirmShipment's line/audit updates. External Blob `put`
// (if any) stays OUTSIDE the TX — only the Photo row is transactional, same
// as separateSlabWithPhoto (file_id already known before TX).
//
// No schema change: Photo has no shipmentId. The durable link for «this
// confirmation's photo» is:
//   1) Photo → unit (slab/piece/stoneType)
//   2) SHIPMENT_CONFIRM AuditLog.payload.photoId (o1 adds one field)
//
// ─── WIRING (exactly one call site for o1) ───────────────────────────────
// Inside confirmShipment's $transaction, after line update / before return:
//
//   import { createShipmentFactPhotoInTx } from "@/lib/shipment-photo";
//   // if (args.photoStorageKey) {
//   //   const { photoId } = await createShipmentFactPhotoInTx(tx, {
//   //     storageKey: args.photoStorageKey,
//   //     takenById: actor.id,
//   //     shipmentKind: ship.kind,
//   //     targetType: line.targetType,
//   //     slabId: line.slabId,
//   //     pieceId: line.pieceId,
//   //     stoneTypeId: /* from line.slab/piece/batch include */,
//   //   });
//   //   // put photoId into the existing auditLog.create payload:
//   //   payload: { …existing, photoId }
//   // }
//
// Or use attachShipmentFactPhoto(shipmentId, …) when photo is uploaded after
// confirm (standalone, own query + create). Prefer InTx when possible.

import type { PhotoKind, Prisma } from "@prisma/client";

// ───────────────────────── Errors ─────────────────────────

export type ShipmentPhotoErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "NO_ANCHOR"
  | "CANCELLED";

export class ShipmentPhotoError extends Error {
  constructor(
    public readonly code: ShipmentPhotoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShipmentPhotoError";
  }
}

// ───────────────────────── Pure helpers ─────────────────────────

/**
 * Pick Photo.kind for a shipment fact photo.
 * SAMPLE shipments → SAMPLE (distinct in UI / proxy allowlist).
 * Unit lines → SLAB / PIECE. Volume → SLAB + stoneTypeId only.
 */
export function shipmentFactPhotoKind(args: {
  shipmentKind: string;
  targetType: string;
}): PhotoKind {
  if (args.shipmentKind === "SAMPLE") return "SAMPLE";
  if (args.targetType === "PIECE") return "PIECE";
  // SLAB unit, BATCH_VOLUME, SHOWROOM slab, default
  return "SLAB";
}

/**
 * Validate storageKey hybrid contract used by /api/photo/[id]:
 *   • https?://… → Vercel Blob URL (redirect)
 *   • otherwise → Telegram file_id (getFile path)
 */
export function assertPhotoStorageKey(storageKey: string): string {
  const k = storageKey?.trim() ?? "";
  if (!k) {
    throw new ShipmentPhotoError("VALIDATION", "Не указан ключ фото (storageKey)");
  }
  if (k.length > 2048) {
    throw new ShipmentPhotoError("VALIDATION", "storageKey слишком длинный");
  }
  // Blob URL
  if (/^https?:\/\//i.test(k)) return k;
  // Telegram file_id alphabet (same idea as singan.ts) — keep permissive:
  // Bot API file_id is [A-Za-z0-9_-] plus sometimes longer tokens.
  if (!/^[A-Za-z0-9_\-]+$/.test(k)) {
    throw new ShipmentPhotoError(
      "VALIDATION",
      "storageKey: ожидается file_id Telegram или URL Blob",
    );
  }
  return k;
}

export type ShipmentPhotoAnchors = {
  kind: PhotoKind;
  slabId: string | null;
  pieceId: string | null;
  stoneTypeId: string | null;
};

/**
 * Resolve Photo anchors from a shipment line. Pure — unit-tested.
 * Requires ≥1 of slabId / pieceId / stoneTypeId (Photo CHECK).
 */
export function resolveShipmentPhotoAnchors(args: {
  shipmentKind: string;
  targetType: string;
  slabId?: string | null;
  pieceId?: string | null;
  /** stoneTypeId from slab / piece / batch — required for BATCH_VOLUME. */
  stoneTypeId?: string | null;
}): ShipmentPhotoAnchors {
  const kind = shipmentFactPhotoKind({
    shipmentKind: args.shipmentKind,
    targetType: args.targetType,
  });
  const slabId = args.slabId?.trim() || null;
  const pieceId = args.pieceId?.trim() || null;
  const stoneTypeId = args.stoneTypeId?.trim() || null;

  if (args.targetType === "SLAB" && !slabId) {
    throw new ShipmentPhotoError(
      "NO_ANCHOR",
      "Строка отгрузки (плита) без slabId — фото привязать некуда",
    );
  }
  if (args.targetType === "PIECE" && !pieceId) {
    throw new ShipmentPhotoError(
      "NO_ANCHOR",
      "Строка отгрузки (бой) без pieceId — фото привязать некуда",
    );
  }
  if (args.targetType === "BATCH_VOLUME" && !stoneTypeId) {
    throw new ShipmentPhotoError(
      "NO_ANCHOR",
      "Объёмная отгрузка без stoneTypeId — фото привязать некуда",
    );
  }
  if (!slabId && !pieceId && !stoneTypeId) {
    throw new ShipmentPhotoError(
      "NO_ANCHOR",
      "Нет якоря Photo (slabId / pieceId / stoneTypeId)",
    );
  }

  return { kind, slabId, pieceId, stoneTypeId };
}

// ───────────────────────── TX-level create ─────────────────────────

export interface ShipmentPhotoTx {
  photo: {
    create(args: {
      data: {
        storageKey: string;
        kind: PhotoKind;
        takenAt: Date;
        takenById: string | null;
        stoneTypeId: string | null;
        slabId: string | null;
        pieceId: string | null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export interface CreateShipmentFactPhotoInput {
  storageKey: string;
  takenById: string;
  takenAt?: Date;
  shipmentKind: string;
  targetType: string;
  slabId?: string | null;
  pieceId?: string | null;
  stoneTypeId?: string | null;
}

export interface CreateShipmentFactPhotoResult {
  photoId: string;
  kind: PhotoKind;
  slabId: string | null;
  pieceId: string | null;
  stoneTypeId: string | null;
  storageKey: string;
}

/**
 * Create Photo row for shipment fact. Call INSIDE confirmShipment's transaction
 * so a failed photo.create rolls back the hand-over write (atomic lesson).
 */
export async function createShipmentFactPhotoInTx(
  tx: ShipmentPhotoTx,
  input: CreateShipmentFactPhotoInput,
): Promise<CreateShipmentFactPhotoResult> {
  const storageKey = assertPhotoStorageKey(input.storageKey);
  const takenById = input.takenById?.trim();
  if (!takenById) {
    throw new ShipmentPhotoError("VALIDATION", "Не указан автор фото");
  }

  const anchors = resolveShipmentPhotoAnchors({
    shipmentKind: input.shipmentKind,
    targetType: input.targetType,
    slabId: input.slabId,
    pieceId: input.pieceId,
    stoneTypeId: input.stoneTypeId,
  });

  const takenAt = input.takenAt ?? new Date();
  const photo = await tx.photo.create({
    data: {
      storageKey,
      kind: anchors.kind,
      takenAt,
      takenById,
      stoneTypeId: anchors.stoneTypeId,
      slabId: anchors.slabId,
      pieceId: anchors.pieceId,
    },
    select: { id: true },
  });

  return {
    photoId: photo.id,
    kind: anchors.kind,
    slabId: anchors.slabId,
    pieceId: anchors.pieceId,
    stoneTypeId: anchors.stoneTypeId,
    storageKey,
  };
}

// ───────────────────────── Standalone (loads shipment) ─────────────────────────

export interface ShipmentPhotoLoadLine {
  targetType: string;
  slabId: string | null;
  pieceId: string | null;
  batchId: string | null;
  slab: { stoneTypeId: string } | null;
  piece: { stoneTypeId: string } | null;
  batch: { stoneTypeId: string } | null;
}

export interface ShipmentPhotoLoadRecord {
  id: string;
  kind: string;
  cancelledAt: Date | null;
  lines: ShipmentPhotoLoadLine[];
}

export interface ShipmentPhotoDeps {
  db: {
    shipment: {
      findUnique(args: {
        where: { id: string };
        select: {
          id: true;
          kind: true;
          cancelledAt: true;
          lines: {
            take: number;
            select: {
              targetType: true;
              slabId: true;
              pieceId: true;
              batchId: true;
              slab: { select: { stoneTypeId: true } };
              piece: { select: { stoneTypeId: true } };
              batch: { select: { stoneTypeId: true } };
            };
          };
        };
      }): Promise<ShipmentPhotoLoadRecord | null>;
    };
    photo: ShipmentPhotoTx["photo"];
    auditLog: {
      create(args: {
        data: {
          userId: string | null;
          action: "SHIPMENT_CONFIRM";
          entityType: string;
          entityId: string;
          payload: Prisma.InputJsonValue;
        };
      }): Promise<unknown>;
    };
  };
}

/**
 * Standalone attach: load shipment (bounded), create Photo, optional audit
 * breadcrumb with photoId. Prefer createShipmentFactPhotoInTx inside confirm
 * when wiring to the hand-over TX.
 */
export async function attachShipmentFactPhoto(
  input: {
    shipmentId: string;
    storageKey: string;
    takenById: string;
    takenAt?: Date;
    /** When true (default), write AuditLog breadcrumb { event, photoId }. */
    writeAudit?: boolean;
  },
  deps: ShipmentPhotoDeps,
): Promise<CreateShipmentFactPhotoResult> {
  const shipmentId = input.shipmentId?.trim();
  if (!shipmentId) {
    throw new ShipmentPhotoError("VALIDATION", "Не указана отгрузка");
  }

  const ship = await deps.db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      kind: true,
      cancelledAt: true,
      lines: {
        take: 5,
        select: {
          targetType: true,
          slabId: true,
          pieceId: true,
          batchId: true,
          slab: { select: { stoneTypeId: true } },
          piece: { select: { stoneTypeId: true } },
          batch: { select: { stoneTypeId: true } },
        },
      },
    },
  });

  if (!ship) {
    throw new ShipmentPhotoError("NOT_FOUND", "Отгрузка не найдена");
  }
  if (ship.cancelledAt) {
    throw new ShipmentPhotoError(
      "CANCELLED",
      "Отгрузка отменена — фото факта не записывается",
    );
  }

  const line = ship.lines[0];
  if (!line) {
    throw new ShipmentPhotoError("NOT_FOUND", "Нет строк отгрузки");
  }

  const stoneTypeId =
    line.slab?.stoneTypeId ??
    line.piece?.stoneTypeId ??
    line.batch?.stoneTypeId ??
    null;

  const result = await createShipmentFactPhotoInTx(deps.db, {
    storageKey: input.storageKey,
    takenById: input.takenById,
    takenAt: input.takenAt,
    shipmentKind: ship.kind,
    targetType: line.targetType,
    slabId: line.slabId,
    pieceId: line.pieceId,
    stoneTypeId,
  });

  if (input.writeAudit !== false) {
    await deps.db.auditLog.create({
      data: {
        userId: input.takenById,
        action: "SHIPMENT_CONFIRM",
        entityType: "Shipment",
        entityId: ship.id,
        payload: {
          event: "shipment_fact_photo",
          photoId: result.photoId,
          kind: result.kind,
          slabId: result.slabId,
          pieceId: result.pieceId,
          stoneTypeId: result.stoneTypeId,
        },
      },
    });
  }

  return result;
}
