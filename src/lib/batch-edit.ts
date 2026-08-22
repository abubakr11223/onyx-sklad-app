// ТЗ №14 §3 — редактирование уже созданной партии.
// Остаток: ТОЛЬКО freeRemainderFromAggregate + volume holds (batch-remainders).
// Не изобретаем свою арифметику — §3 source of truth дважды чинилась.
//
// Доступ (placeholder до решения Onyx):
//  • количество (slabsTotal / areaTotalM2 / pattern counts) → только OWNER
//  • размеры, детали, локации, описание узоров → WAREHOUSE или OWNER
// (узкое безопасное чтение; см. docs в result-batchedit.md)

import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { lockBatchForUpdate } from "@/lib/batch-lock";
import { thicknessToNumber } from "@/lib/dimensions";
import {
  EMPTY_AGGREGATE,
  EMPTY_HOLD,
  freeRemainderFromAggregate,
  getBatchRemainders,
  getBatchReservationHolds,
  type BatchRemainderAggregate,
  type BatchReservationHold,
} from "@/lib/batch-remainders";
import type { BatchTotalsInput, FreeRemainder } from "@/lib/inventory";
import {
  MAX_DECIMAL_FIELD,
  MAX_INT_FIELD,
  parsePositiveInt,
  parseQuantityField,
} from "@/lib/validators/intake";
import { normalizeBlockLetter } from "@/lib/block-letter";

// ───────────────────────── errors ─────────────────────────

export type BatchEditErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN_QTY"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "BELOW_FLOOR"
  | "CONFLICT"
  | "NO_CHANGES";

export class BatchEditError extends Error {
  constructor(
    public readonly code: BatchEditErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "BatchEditError";
  }
}

// ───────────────────────── pure floors ─────────────────────────

/** Свободный остаток после вычета volume-holds (бронь + образцы BATCH_VOLUME). */
export function freeAfterVolumeHolds(
  free: FreeRemainder,
  hold: BatchReservationHold,
): FreeRemainder {
  return {
    slabsFree:
      free.slabsFree === null ? null : free.slabsFree - hold.reservedSlabs,
    areaFreeM2:
      free.areaFreeM2 === null
        ? null
        : free.areaFreeM2 - hold.reservedAreaM2,
  };
}

/**
 * Минимальный slabsTotal, при котором free−holds ≥ 0.
 * Из freeRemainderFromAggregate:
 *   slabsFree = slabsTotal + slabsAdjusted − sold − slabCount − pieceCount
 *   slabsFree − reserved ≥ 0
 *   ⇒ slabsTotal ≥ reserved + sold − adjusted + slabCount + pieceCount
 * null-tracking (slabsTotal был/остаётся null) → floor null.
 */
export function minSlabsTotalFloor(
  batch: Pick<
    BatchTotalsInput,
    "slabsTotal" | "slabsAdjusted" | "slabsSoldDirect"
  >,
  agg: BatchRemainderAggregate,
  hold: BatchReservationHold,
): number | null {
  if (batch.slabsTotal === null) return null;
  const floor =
    hold.reservedSlabs +
    batch.slabsSoldDirect -
    batch.slabsAdjusted +
    agg.slabCount +
    agg.pieceCount;
  return Math.max(0, floor);
}

/**
 * Минимальный areaTotalM2 при free−holds ≥ 0.
 * areaFree = areaTotal + adj − soldArea − slabsArea − piecesArea
 * slabsArea = slabAreaSum + nullCount * (areaTotal/slabsTotal)  — зависит от areaTotal
 * и slabsTotal. При null area tracking → null.
 *
 * Для floor при **фиксированном** slabsTotal (proposed):
 *   areaFree − reserved ≥ 0
 *   areaTotal − nullCount*(areaTotal/slabsTotal) ≥ reserved − adj + sold + slabSum + pieceSum
 *   areaTotal * (1 − nullCount/slabsTotal) ≥ RHS
 *   если coeff > 0: areaTotal ≥ RHS / coeff
 *   если nullCount == slabsTotal (все null area): avg = areaTotal/slabsTotal, slabsArea = areaTotal
 *     areaFree = adj − sold − pieceSum − reserved  (areaTotal cancels) — edge case.
 *
 * Практичный guard (и source of truth): не floor-формула для UI, а
 * `assertQuantityAboveFloor(proposed, agg, hold)` через freeRemainderFromAggregate.
 * minArea helper ниже — для подсказки UI; assert — для записи.
 */
export function assertQuantityAboveFloor(
  proposed: BatchTotalsInput,
  agg: BatchRemainderAggregate,
  hold: BatchReservationHold,
): { ok: true } | { ok: false; message: string; field: "slabsTotal" | "areaTotalM2" } {
  if (proposed.slabsTotal === null && proposed.areaTotalM2 === null) {
    return {
      ok: false,
      message: "Укажите хотя бы плиты или площадь партии",
      field: "slabsTotal",
    };
  }
  if (
    proposed.slabsTotal !== null &&
    (!Number.isSafeInteger(proposed.slabsTotal) ||
      proposed.slabsTotal < 0 ||
      proposed.slabsTotal > MAX_INT_FIELD)
  ) {
    return {
      ok: false,
      message: "Количество плит — целое неотрицательное",
      field: "slabsTotal",
    };
  }
  if (
    proposed.areaTotalM2 !== null &&
    !(
      Number.isFinite(proposed.areaTotalM2) &&
      proposed.areaTotalM2 > 0 &&
      proposed.areaTotalM2 <= MAX_DECIMAL_FIELD
    )
  ) {
    return {
      ok: false,
      message: "Площадь — положительное число в допустимых пределах",
      field: "areaTotalM2",
    };
  }

  const free = freeRemainderFromAggregate(proposed, agg);
  const after = freeAfterVolumeHolds(free, hold);

  if (after.slabsFree !== null && after.slabsFree < 0) {
    const floor = minSlabsTotalFloor(proposed, agg, hold);
    return {
      ok: false,
      message:
        floor !== null
          ? `Нельзя меньше ${floor} плит: уже продано/забронировано/выделено/бой`
          : "Остаток плит ушёл бы в минус — уменьшите меньше нельзя",
      field: "slabsTotal",
    };
  }
  if (after.areaFreeM2 !== null && after.areaFreeM2 < -1e-9) {
    return {
      ok: false,
      message:
        "Площадь партии меньше уже проданного/забронированного/списанного — увеличьте м²",
      field: "areaTotalM2",
    };
  }
  return { ok: true };
}

/** Были ли «движения» (продажа, бронь, бой, выделенные плиты, образцы-hold). */
export function batchHasMovements(
  batch: Pick<BatchTotalsInput, "slabsSoldDirect" | "areaSoldDirectM2">,
  agg: BatchRemainderAggregate,
  hold: BatchReservationHold,
): boolean {
  return (
    batch.slabsSoldDirect > 0 ||
    batch.areaSoldDirectM2 > 1e-12 ||
    agg.slabCount > 0 ||
    agg.pieceCount > 0 ||
    hold.reservedSlabs > 0 ||
    hold.reservedAreaM2 > 1e-12
  );
}

// ───────────────────────── change set ─────────────────────────

export type FieldChange = {
  field: string;
  old: string | number | null;
  new: string | number | null;
};

export type BatchEditInput = {
  batchId: string;
  /** Optimistic concurrency pins (from form load). */
  expected: {
    slabsTotal: number | null;
    areaTotalM2: number | null;
    slabsSoldDirect: number;
    areaSoldDirectM2: number;
    lengthMm: number | null;
    widthMm: number | null;
    thicknessMm: number | null;
    supplierNote: string | null;
    arrivedAtIso: string; // YYYY-MM-DD
  };
  /** Proposed totals (cm fields for dims). */
  slabsTotal: number | null;
  areaTotalM2: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  supplierNote: string | null;
  arrivedAt: Date;
  locations: {
    block: string;
    landmark: string;
    slabsHere: number | null;
    areaHereM2: number | null;
  }[];
  patterns: {
    id: string;
    description: string;
    thicknessMm: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    slabsCount: number;
    areaM2: number;
  }[];
  /**
   * ТЗ №14 §3 pattern photo (reuses Photo SAMPLE + batchPatternId).
   * Blob put happens BEFORE applyBatchEdit; DB create/unlink is inside this TX
   * so field edit + photo never diverge (same class of bug as slab-without-photo).
   * Photo rows are eternal (§1.9) — clear unlinks only (batchPatternId → null,
   * stoneTypeId kept as owner for CHECK).
   */
  patternPhotoOps?: {
    patternId: string;
    op: "set" | "clear";
    /** Required for set — result of putPhotoBlob. */
    storageKey?: string;
    takenAt?: Date;
  }[];
  actorId: string;
  /** OWNER → can edit quantity; warehouse → dims/details only. */
  canEditQuantity: boolean;
};

function decStr(n: number | null): string | null {
  if (n === null) return null;
  return n.toFixed(3);
}

function sameNum(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-9;
}

// ───────────────────────── apply ─────────────────────────

/**
 * Редактирование партии одной транзакцией:
 * 1) lockBatchForUpdate
 * 2) re-read counters + remainders + holds
 * 3) assert floor via freeRemainderFromAggregate
 * 4) conditional updateMany (sold counters + expected totals pin)
 * 5) replace locations; update patterns (with sold floors)
 * 6) AuditLog ADJUSTMENT old→new
 */
export async function applyBatchEdit(
  input: BatchEditInput,
  deps: { db?: PrismaClient } = {},
): Promise<{ batchId: string; changes: FieldChange[] }> {
  const client = deps.db ?? db;

  return client.$transaction(async (tx) => {
    await lockBatchForUpdate(tx, input.batchId);

    const batch = await tx.batch.findUnique({
      where: { id: input.batchId },
      select: {
        id: true,
        stoneTypeId: true,
        slabsTotal: true,
        areaTotalM2: true,
        slabsAdjusted: true,
        areaAdjustedM2: true,
        slabsSoldDirect: true,
        areaSoldDirectM2: true,
        lengthMm: true,
        widthMm: true,
        thicknessMm: true,
        supplierNote: true,
        arrivedAt: true,
        stoneType: { select: { name: true } },
        patterns: {
          select: {
            id: true,
            description: true,
            thicknessMm: true,
            lengthMm: true,
            widthMm: true,
            slabsCount: true,
            areaM2: true,
            slabsSold: true,
            areaSoldM2: true,
            photos: {
              where: { kind: "SAMPLE" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true },
            },
          },
        },
        locations: {
          select: {
            id: true,
            block: true,
            landmark: true,
            slabsHere: true,
            areaHereM2: true,
          },
        },
      },
    });
    if (!batch) {
      throw new BatchEditError("NOT_FOUND", "Партия не найдена");
    }

    // Concurrency pin: counters or totals already moved → conflict.
    const curArea = batch.areaTotalM2 === null ? null : Number(batch.areaTotalM2);
    const curSoldArea = Number(batch.areaSoldDirectM2);
    if (
      batch.slabsSoldDirect !== input.expected.slabsSoldDirect ||
      Math.abs(curSoldArea - input.expected.areaSoldDirectM2) > 1e-9 ||
      batch.slabsTotal !== input.expected.slabsTotal ||
      !sameNum(curArea, input.expected.areaTotalM2)
    ) {
      throw new BatchEditError(
        "CONFLICT",
        "Партию только что изменили (продажа/правка) — обновите страницу и повторите",
      );
    }

    const remMap = await getBatchRemainders(tx as unknown as PrismaClient, [
      batch.id,
    ]);
    const holdMap = await getBatchReservationHolds(
      tx as unknown as PrismaClient,
      [batch.id],
    );
    const agg = remMap.get(batch.id) ?? EMPTY_AGGREGATE;
    const hold = holdMap.get(batch.id) ?? EMPTY_HOLD;

    const qtyChanging =
      batch.slabsTotal !== input.slabsTotal ||
      !sameNum(curArea, input.areaTotalM2);

    if (qtyChanging && !input.canEditQuantity) {
      throw new BatchEditError(
        "FORBIDDEN_QTY",
        "Менять количество партии может только владелец",
        "slabsTotal",
      );
    }

    // Pattern quantity changes also require owner.
    const existingPat = new Map(batch.patterns.map((p) => [p.id, p]));
    for (const p of input.patterns) {
      const old = existingPat.get(p.id);
      if (!old) {
        throw new BatchEditError(
          "INVALID_INPUT",
          "Узор не принадлежит этой партии",
          "patterns",
        );
      }
      const oldArea = Number(old.areaM2);
      if (
        (old.slabsCount !== p.slabsCount || Math.abs(oldArea - p.areaM2) > 1e-9) &&
        !input.canEditQuantity
      ) {
        throw new BatchEditError(
          "FORBIDDEN_QTY",
          "Менять количество в узоре может только владелец",
          "patterns",
        );
      }
      // Pattern sold floor
      if (p.slabsCount < old.slabsSold) {
        throw new BatchEditError(
          "BELOW_FLOOR",
          `Узор «${old.description}»: нельзя меньше ${old.slabsSold} плит (уже продано)`,
          "patterns",
        );
      }
      const soldArea = Number(old.areaSoldM2);
      if (p.areaM2 + 1e-9 < soldArea) {
        throw new BatchEditError(
          "BELOW_FLOOR",
          `Узор «${old.description}»: нельзя меньше ${soldArea} м² (уже продано)`,
          "patterns",
        );
      }
    }

    const proposed: BatchTotalsInput = {
      slabsTotal: input.slabsTotal,
      areaTotalM2: input.areaTotalM2,
      slabsAdjusted: batch.slabsAdjusted,
      areaAdjustedM2: Number(batch.areaAdjustedM2),
      slabsSoldDirect: batch.slabsSoldDirect,
      areaSoldDirectM2: curSoldArea,
    };

    if (qtyChanging || input.canEditQuantity) {
      const floor = assertQuantityAboveFloor(proposed, agg, hold);
      if (!floor.ok) {
        throw new BatchEditError("BELOW_FLOOR", floor.message, floor.field);
      }
    }

    // Dimensions always editable: length/width if set must be positive pair.
    if (
      (input.lengthMm === null) !== (input.widthMm === null) ||
      (input.lengthMm !== null && input.lengthMm <= 0) ||
      (input.widthMm !== null && input.widthMm <= 0)
    ) {
      throw new BatchEditError(
        "INVALID_INPUT",
        "Длина и ширина — оба пусто или оба целые см > 0",
        "lengthMm",
      );
    }

    const changes: FieldChange[] = [];
    const push = (
      field: string,
      oldV: string | number | null,
      newV: string | number | null,
    ) => {
      if (oldV === newV) return;
      if (
        typeof oldV === "number" &&
        typeof newV === "number" &&
        Math.abs(oldV - newV) < 1e-9
      ) {
        return;
      }
      changes.push({ field, old: oldV, new: newV });
    };

    push("slabsTotal", batch.slabsTotal, input.slabsTotal);
    push("areaTotalM2", curArea, input.areaTotalM2);
    push("lengthMm", batch.lengthMm, input.lengthMm);
    push("widthMm", batch.widthMm, input.widthMm);
    push("thicknessMm", thicknessToNumber(batch.thicknessMm), input.thicknessMm);
    push(
      "supplierNote",
      batch.supplierNote?.trim() || null,
      input.supplierNote?.trim() || null,
    );
    const oldDay = batch.arrivedAt.toISOString().slice(0, 10);
    const newDay = input.arrivedAt.toISOString().slice(0, 10);
    push("arrivedAt", oldDay, newDay);

    for (const p of input.patterns) {
      const old = existingPat.get(p.id)!;
      push(`pattern.${p.id}.description`, old.description, p.description);
      push(
        `pattern.${p.id}.thicknessMm`,
        thicknessToNumber(old.thicknessMm),
        p.thicknessMm,
      );
      push(`pattern.${p.id}.lengthMm`, old.lengthMm, p.lengthMm);
      push(`pattern.${p.id}.widthMm`, old.widthMm, p.widthMm);
      push(`pattern.${p.id}.slabsCount`, old.slabsCount, p.slabsCount);
      push(`pattern.${p.id}.areaM2`, Number(old.areaM2), p.areaM2);
    }

    // Pattern photos — audit old photo id → new id | null (unlink).
    const photoOps = input.patternPhotoOps ?? [];
    for (const op of photoOps) {
      if (!existingPat.has(op.patternId)) {
        throw new BatchEditError(
          "INVALID_INPUT",
          "Узор не принадлежит этой партии (фото)",
          "patterns",
        );
      }
      if (op.op === "set" && !op.storageKey) {
        throw new BatchEditError(
          "INVALID_INPUT",
          "Нет файла фото узора",
          "patterns",
        );
      }
      const oldPhotoId =
        existingPat.get(op.patternId)!.photos[0]?.id ?? null;
      if (op.op === "set") {
        push(`pattern.${op.patternId}.photo`, oldPhotoId, "new");
      } else {
        // clear: only meaningful if something was linked
        if (oldPhotoId) {
          push(`pattern.${op.patternId}.photo`, oldPhotoId, null);
        }
      }
    }

    // Locations: compare serialised
    const oldLoc = batch.locations
      .map(
        (l) =>
          `${l.block}|${l.landmark}|${l.slabsHere ?? ""}|${l.areaHereM2 ?? ""}`,
      )
      .sort()
      .join(";");
    const newLoc = input.locations
      .map(
        (l) =>
          `${l.block}|${l.landmark}|${l.slabsHere ?? ""}|${l.areaHereM2 ?? ""}`,
      )
      .sort()
      .join(";");
    if (oldLoc !== newLoc) {
      push("locations", oldLoc || null, newLoc || null);
    }

    if (changes.length === 0) {
      throw new BatchEditError("NO_CHANGES", "Нет изменений для сохранения");
    }

    // Conditional UPDATE — sold counters + previous totals (sale-path discipline).
    const updated = await tx.batch.updateMany({
      where: {
        id: batch.id,
        slabsSoldDirect: input.expected.slabsSoldDirect,
        areaSoldDirectM2: input.expected.areaSoldDirectM2.toFixed(3),
        ...(input.expected.slabsTotal === null
          ? { slabsTotal: null }
          : { slabsTotal: input.expected.slabsTotal }),
        ...(input.expected.areaTotalM2 === null
          ? { areaTotalM2: null }
          : { areaTotalM2: input.expected.areaTotalM2.toFixed(3) }),
      },
      data: {
        slabsTotal: input.slabsTotal,
        areaTotalM2:
          input.areaTotalM2 === null ? null : input.areaTotalM2.toFixed(3),
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        thicknessMm: input.thicknessMm,
        supplierNote: input.supplierNote?.trim() || null,
        arrivedAt: input.arrivedAt,
      },
    });
    if (updated.count === 0) {
      throw new BatchEditError(
        "CONFLICT",
        "Партию только что изменили параллельно — обновите страницу и повторите",
      );
    }

    // Patterns — conditional on sold counters for qty fields.
    for (const p of input.patterns) {
      const old = existingPat.get(p.id)!;
      const patUp = await tx.batchPattern.updateMany({
        where: {
          id: p.id,
          batchId: batch.id,
          slabsSold: old.slabsSold,
          areaSoldM2: Number(old.areaSoldM2).toFixed(3),
        },
        data: {
          description: p.description,
          thicknessMm: p.thicknessMm,
          lengthMm: p.lengthMm,
          widthMm: p.widthMm,
          slabsCount: p.slabsCount,
          areaM2: p.areaM2.toFixed(3),
        },
      });
      if (patUp.count === 0) {
        throw new BatchEditError(
          "CONFLICT",
          "Узор изменили параллельно (продажа) — обновите страницу",
        );
      }
    }

    // Locations: replace all (order not significant).
    if (oldLoc !== newLoc) {
      await tx.batchLocation.deleteMany({ where: { batchId: batch.id } });
      if (input.locations.length > 0) {
        await tx.batchLocation.createMany({
          data: input.locations.map((l) => ({
            batchId: batch.id,
            block: l.block,
            landmark: l.landmark,
            slabsHere: l.slabsHere,
            areaHereM2:
              l.areaHereM2 === null ? null : l.areaHereM2.toFixed(3),
          })),
        });
      }
    }

    // Pattern photos inside the same TX as field edits (atomic DB).
    // §1.9: Photo rows are never hard-deleted.
    for (const op of photoOps) {
      if (op.op === "clear") {
        // Unlink from pattern; keep stoneTypeId so Photo_owner_check holds.
        await tx.photo.updateMany({
          where: { batchPatternId: op.patternId, kind: "SAMPLE" },
          data: {
            batchPatternId: null,
            stoneTypeId: batch.stoneTypeId,
          },
        });
      } else if (op.op === "set" && op.storageKey) {
        // New SAMPLE photo on the pattern (old rows stay linked — eternal archive).
        await tx.photo.create({
          data: {
            storageKey: op.storageKey,
            kind: "SAMPLE",
            takenAt: op.takenAt ?? new Date(),
            takenById: input.actorId,
            stoneTypeId: batch.stoneTypeId,
            batchPatternId: op.patternId,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "ADJUSTMENT",
        entityType: "Batch",
        entityId: batch.id,
        payload: {
          kind: "BATCH_EDIT",
          stoneName: batch.stoneType.name,
          batchId: batch.id,
          changes,
          canEditQuantity: input.canEditQuantity,
          hasMovements: batchHasMovements(
            {
              slabsSoldDirect: batch.slabsSoldDirect,
              areaSoldDirectM2: curSoldArea,
            },
            agg,
            hold,
          ),
        },
      },
    });

    return { batchId: batch.id, changes };
  });
}

// ───────────────────────── form parse helpers ─────────────────────────

export function parseOptionalCm(raw: string): number | null | undefined {
  // null = empty, undefined = invalid
  const t = raw.trim();
  if (t === "") return null;
  return parsePositiveInt(t) ?? undefined;
}

export function parseOptionalQtySlabs(raw: string): number | null | undefined {
  // intake: 0 treated as empty for quantity fields
  return parseQuantityField(raw, "int");
}

export function parseOptionalQtyArea(raw: string): number | null | undefined {
  return parseQuantityField(raw, "decimal");
}

export function parseDateOnly(raw: string): Date | null {
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseLocationRow(raw: {
  block: string;
  landmark: string;
  slabsHere: string;
  areaHereM2: string;
}):
  | { ok: true; data: BatchEditInput["locations"][number] }
  | { ok: false; message: string } {
  const block = normalizeBlockLetter(raw.block);
  // ТЗ №18 §2 — ориентир необязателен (пусто = адрес до уровня блока).
  const landmark = raw.landmark.trim();
  if (!block) {
    return { ok: false, message: "Локация: укажите блок" };
  }
  const slabsHere = parseQuantityField(raw.slabsHere, "int");
  if (slabsHere === undefined) {
    return { ok: false, message: "Локация: плиты — целое ≥ 0 или пусто" };
  }
  const areaHere = parseQuantityField(raw.areaHereM2, "decimal");
  if (areaHere === undefined) {
    return { ok: false, message: "Локация: м² — число или пусто" };
  }
  return {
    ok: true,
    data: {
      block,
      landmark,
      slabsHere,
      areaHereM2: areaHere,
    },
  };
}

export { parsePositiveInt, parseQuantityField };
