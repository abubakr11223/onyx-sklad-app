// TZ №10 — образцы: domain (issue / return / sell / list).
// Double-issue: UnitStatus SAMPLE + partial unique on Sample (DB).
// Free stock: SAMPLE units not AVAILABLE → excluded from search like RESERVED.

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { lockBatchForUpdate } from "@/lib/batch-lock";
import { computeFreeRemainder } from "@/lib/inventory";
import { checkVolumeSaleGuard } from "@/lib/sales";
import {
  createDebtForSale,
  DebtLogicError,
} from "@/lib/debts";
import { MAX_DECIMAL_14_2 } from "@/lib/decimal";
import type { MoneyCurrency } from "@/lib/clients";
import {
  cancelOpenShipmentForSample,
  createSampleShipment,
  shipmentAwaitsWarehouse,
} from "@/lib/shipments";
import {
  cancelOpenShowroomShipmentForUnit,
  closeOpenShowroomPlacement,
} from "@/lib/showroom";
import { formatLocation } from "@/lib/locations";

type Db = PrismaClient | Prisma.TransactionClient;

export type SampleStatus = "ACTIVE" | "RETURNED" | "SOLD";
export type SampleTarget = "SLAB" | "PIECE" | "BATCH_VOLUME";

export type SampleErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN_ROLE"
  | "INVALID_INPUT"
  | "UNIT_UNAVAILABLE"
  | "ALREADY_ISSUED"
  | "NOT_ACTIVE"
  | "CONFLICT"
  | "INSUFFICIENT_REMAINDER";

export interface SampleError {
  code: SampleErrorCode;
  message: string;
}

export type SampleFail = { ok: false; error: SampleError };
class SampleLogicError extends Error {
  constructor(public readonly sampleError: SampleError) {
    super(sampleError.message);
  }
}
function fail(code: SampleErrorCode, message: string): SampleFail {
  return { ok: false, error: { code, message } };
}

/** Overdue = ACTIVE && returnDueDate < now. Not a stored status. */
export function isSampleOverdue(
  sample: { status: SampleStatus; returnDueDate: Date },
  now: Date,
): boolean {
  return (
    sample.status === "ACTIVE" &&
    sample.returnDueDate.getTime() < now.getTime()
  );
}


/**
 * Pure: free volume left after other holds (reservations + other active samples).
 * Used by issueSample BATCH_VOLUME guard (unit-tested without DB).
 */
export function checkSampleVolumeAgainstFree(args: {
  freeSlabs: number | null;
  freeAreaM2: number | null;
  holdSlabs: number;
  holdAreaM2: number;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
}): { ok: true } | { ok: false; message: string } {
  const qs = args.qtySlabs;
  const qa = args.qtyAreaM2;
  if ((qs == null || qs <= 0) && (qa == null || qa <= 0)) {
    return { ok: false, message: "Укажите объём образца (плиты или м²)" };
  }
  if (qs != null && qs > 0 && args.freeSlabs != null) {
    const avail = args.freeSlabs - args.holdSlabs;
    if (qs > avail) {
      return {
        ok: false,
        message:
          `В партии столько нет для образца: свободно ${Math.max(0, avail)} плит` +
          (args.holdSlabs > 0
            ? ` (ещё ${args.holdSlabs} в брони/других образцах)`
            : ""),
      };
    }
  }
  if (qa != null && qa > 0 && args.freeAreaM2 != null) {
    const avail = args.freeAreaM2 - args.holdAreaM2;
    if (qa > avail + 1e-6) {
      const freeTxt = Math.max(0, avail).toFixed(3).replace(/\.?0+$/, "");
      return {
        ok: false,
        message:
          `В партии столько нет для образца: свободно ≈${freeTxt} м²` +
          (args.holdAreaM2 > 0
            ? ` (часть в брони/других образцах)`
            : ""),
      };
    }
  }
  return { ok: true };
}


/** Owner all / manager own — same as clients. */
export function sampleListScope(args: {
  canSeeAll: boolean;
  actorId: string | null;
}): { managerId?: string } {
  if (args.canSeeAll) return {};
  if (args.actorId) return { managerId: args.actorId };
  return { managerId: "__no_actor__" };
}

export function canAccessSample(args: {
  canSeeAll: boolean;
  actorId: string | null;
  sampleManagerId: string;
}): boolean {
  if (args.canSeeAll) return true;
  if (!args.actorId) return false;
  return args.actorId === args.sampleManagerId;
}

/** Sum deposits per currency — never mix UZS+USD. */
export function sumDepositsByCurrency(
  rows: ReadonlyArray<{
    depositAmount: string | null;
    depositCurrency: MoneyCurrency | null;
  }>,
): Array<{ currency: MoneyCurrency; amount: string; count: number }> {
  const acc = new Map<MoneyCurrency, { cents: bigint; count: number }>();
  for (const r of rows) {
    if (r.depositAmount == null || r.depositCurrency == null) continue;
    const cur = r.depositCurrency;
    if (cur !== "UZS" && cur !== "USD") continue;
    const s = r.depositAmount.trim().replace(",", ".");
    const m = /^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s);
    if (!m) continue;
    const whole = BigInt(m[2] || "0");
    const frac = BigInt(((m[3] ?? "") + "00").slice(0, 2));
    let cents = whole * 100n + frac;
    if (m[1] === "-") cents = -cents;
    const prev = acc.get(cur) ?? { cents: 0n, count: 0 };
    prev.cents += cents;
    prev.count += 1;
    acc.set(cur, prev);
  }
  const out: Array<{ currency: MoneyCurrency; amount: string; count: number }> =
    [];
  for (const cur of ["UZS", "USD"] as const) {
    const row = acc.get(cur);
    if (!row || row.count === 0) continue;
    const neg = row.cents < 0n;
    const a = neg ? -row.cents : row.cents;
    const amount = `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
    out.push({ currency: cur, amount, count: row.count });
  }
  return out;
}

async function loadActor(tx: Db, managerId: string) {
  const u = await tx.user.findUnique({
    where: { id: managerId },
    select: { id: true, role: true, isActive: true },
  });
  if (!u || !u.isActive) {
    throw new SampleLogicError({
      code: "NOT_FOUND",
      message: "Менеджер не найден",
    });
  }
  if (u.role !== "OWNER" && u.role !== "MANAGER") {
    throw new SampleLogicError({
      code: "FORBIDDEN_ROLE",
      message: "Образцы оформляет менеджер или владелец",
    });
  }
  return u;
}

export interface IssueSampleInput {
  targetType: SampleTarget;
  unitId?: string; // SLAB / PIECE
  batchId?: string;
  qtySlabs?: number | null;
  qtyAreaM2?: number | null;
  clientId: string;
  managerId: string;
  returnDueDate: Date;
  depositAmount?: number | null;
  depositCurrency?: MoneyCurrency | null;
  comment?: string | null;
  photoUrl?: string | null;
  locationNote?: string | null;
  linkedRequestId?: string | null;
}

export async function issueSample(
  input: IssueSampleInput,
): Promise<{ ok: true; sampleId: string; shipmentId: string } | SampleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);
      const clientId = input.clientId?.trim();
      if (!clientId) {
        throw new SampleLogicError({
          code: "INVALID_INPUT",
          message: "Выберите клиента",
        });
      }
      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: { id: true },
      });
      if (!client) {
        throw new SampleLogicError({
          code: "NOT_FOUND",
          message: "Клиент не найден",
        });
      }
      if (
        !(input.returnDueDate instanceof Date) ||
        Number.isNaN(input.returnDueDate.getTime())
      ) {
        throw new SampleLogicError({
          code: "INVALID_INPUT",
          message: "Укажите срок возврата образца",
        });
      }

      let depositAmount: string | null = null;
      let depositCurrency: MoneyCurrency | null = null;
      if (input.depositAmount != null && input.depositAmount !== 0) {
        if (
          !Number.isFinite(input.depositAmount) ||
          input.depositAmount <= 0 ||
          input.depositAmount > MAX_DECIMAL_14_2
        ) {
          throw new SampleLogicError({
            code: "INVALID_INPUT",
            message: "Залог — положительная сумма",
          });
        }
        if (
          input.depositCurrency !== "UZS" &&
          input.depositCurrency !== "USD"
        ) {
          throw new SampleLogicError({
            code: "INVALID_INPUT",
            message: "Валюта залога: UZS или USD",
          });
        }
        depositAmount = input.depositAmount.toFixed(2);
        depositCurrency = input.depositCurrency;
      }

      let slabId: string | null = null;
      let pieceId: string | null = null;
      let batchId: string | null = null;
      let qtySlabs: number | null = null;
      let qtyAreaM2: string | null = null;

      if (input.targetType === "SLAB" || input.targetType === "PIECE") {
        const unitId = input.unitId?.trim();
        if (!unitId) {
          throw new SampleLogicError({
            code: "INVALID_INPUT",
            message: "Не выбран камень",
          });
        }
        // Conditional AVAILABLE→SAMPLE; or SHOWROOM→SAMPLE (issue from showroom).
        let fromShowroom = false;
        const tryStatuses = ["AVAILABLE", "SHOWROOM"] as const;
        let updated = { count: 0 };
        for (const st of tryStatuses) {
          const where = {
            id: unitId,
            status: st,
            needsCheck: false,
          };
          updated =
            input.targetType === "SLAB"
              ? await tx.slab.updateMany({
                  where,
                  data: { status: "SAMPLE" },
                })
              : await tx.piece.updateMany({
                  where,
                  data: { status: "SAMPLE" },
                });
          if (updated.count > 0) {
            fromShowroom = st === "SHOWROOM";
            break;
          }
        }
        if (updated.count === 0) {
          // Distinguish already SAMPLE vs missing
          const unit =
            input.targetType === "SLAB"
              ? await tx.slab.findUnique({
                  where: { id: unitId },
                  select: { status: true },
                })
              : await tx.piece.findUnique({
                  where: { id: unitId },
                  select: { status: true },
                });
          if (!unit) {
            throw new SampleLogicError({
              code: "NOT_FOUND",
              message: "Камень не найден",
            });
          }
          if (unit.status === "SAMPLE") {
            throw new SampleLogicError({
              code: "ALREADY_ISSUED",
              message: "Камень уже выдан как образец",
            });
          }
          throw new SampleLogicError({
            code: "UNIT_UNAVAILABLE",
            message:
              "Камень недоступен для образца (продан, в брони или на проверке)",
          });
        }
        if (fromShowroom) {
          const now = new Date();
          await cancelOpenShowroomShipmentForUnit(tx, {
            slabId: input.targetType === "SLAB" ? unitId : null,
            pieceId: input.targetType === "PIECE" ? unitId : null,
            now,
          });
          await closeOpenShowroomPlacement(tx, {
            slabId: input.targetType === "SLAB" ? unitId : null,
            pieceId: input.targetType === "PIECE" ? unitId : null,
            now,
          });
        }
        if (input.targetType === "SLAB") slabId = unitId;
        else pieceId = unitId;
      } else {
        // BATCH_VOLUME — lock batch, check free − holds, then Sample row holds qty
        const bid = input.batchId?.trim();
        if (!bid) {
          throw new SampleLogicError({
            code: "INVALID_INPUT",
            message: "Не выбрана партия",
          });
        }
        const qs = input.qtySlabs ?? null;
        const qa = input.qtyAreaM2 ?? null;
        if ((qs == null || qs <= 0) && (qa == null || qa <= 0)) {
          throw new SampleLogicError({
            code: "INVALID_INPUT",
            message: "Укажите объём образца (плиты или м²)",
          });
        }

        await lockBatchForUpdate(tx, bid);
        const batch = await tx.batch.findUnique({
          where: { id: bid },
          select: {
            id: true,
            needsCheck: true,
            slabsTotal: true,
            areaTotalM2: true,
            slabsAdjusted: true,
            areaAdjustedM2: true,
            slabsSoldDirect: true,
            areaSoldDirectM2: true,
            slabs: { select: { areaM2: true } },
            pieces: {
              where: { originSlabId: null },
              select: { areaM2: true },
            },
          },
        });
        if (!batch) {
          throw new SampleLogicError({
            code: "NOT_FOUND",
            message: "Партия не найдена",
          });
        }
        if (batch.needsCheck) {
          throw new SampleLogicError({
            code: "UNIT_UNAVAILABLE",
            message: "Партия помечена «проверить» — образец заблокирован",
          });
        }

        const free = computeFreeRemainder(
          {
            slabsTotal: batch.slabsTotal,
            areaTotalM2:
              batch.areaTotalM2 == null
                ? null
                : Number(batch.areaTotalM2.toString()),
            slabsAdjusted: batch.slabsAdjusted,
            areaAdjustedM2: Number(batch.areaAdjustedM2.toString()),
            slabsSoldDirect: batch.slabsSoldDirect,
            areaSoldDirectM2: Number(batch.areaSoldDirectM2.toString()),
          },
          batch.slabs.map((s) => ({
            areaM2: s.areaM2 == null ? null : Number(s.areaM2.toString()),
          })),
          batch.pieces.map((p) => ({
            areaM2: p.areaM2 == null ? null : Number(p.areaM2.toString()),
          })),
        );

        const now = new Date();
        const resHolds = await tx.reservation.findMany({
          where: {
            status: "ACTIVE",
            targetType: "BATCH_VOLUME",
            batchId: bid,
            expiresAt: { gt: now },
          },
          select: { qtySlabs: true, qtyAreaM2: true },
        });
        const sampleHolds = await tx.sample.findMany({
          where: {
            status: "ACTIVE",
            targetType: "BATCH_VOLUME",
            batchId: bid,
          },
          select: { qtySlabs: true, qtyAreaM2: true },
        });
        let holdSlabs = 0;
        let holdArea = 0;
        for (const h of resHolds) {
          holdSlabs += h.qtySlabs ?? 0;
          holdArea += h.qtyAreaM2 == null ? 0 : Number(h.qtyAreaM2.toString());
        }
        for (const h of sampleHolds) {
          holdSlabs += h.qtySlabs ?? 0;
          holdArea += h.qtyAreaM2 == null ? 0 : Number(h.qtyAreaM2.toString());
        }

        const guard = checkSampleVolumeAgainstFree({
          freeSlabs: free.slabsFree,
          freeAreaM2: free.areaFreeM2,
          holdSlabs,
          holdAreaM2: holdArea,
          qtySlabs: qs != null && qs > 0 ? qs : null,
          qtyAreaM2: qa != null && qa > 0 ? qa : null,
        });
        if (!guard.ok) {
          throw new SampleLogicError({
            code: "INSUFFICIENT_REMAINDER",
            message: guard.message,
          });
        }

        // Also run sales guard shape (same numbers) for consistent messages
        const saleGuard = checkVolumeSaleGuard({
          free,
          othersReservedSlabs: holdSlabs,
          othersReservedAreaM2: holdArea,
          qtySlabs: qs != null && qs > 0 ? qs : null,
          qtyAreaM2: qa != null && qa > 0 ? qa : null,
        });
        if (!saleGuard.ok) {
          throw new SampleLogicError({
            code: "INSUFFICIENT_REMAINDER",
            message: saleGuard.error.message,
          });
        }

        batchId = bid;
        qtySlabs = qs != null && qs > 0 ? qs : null;
        qtyAreaM2 = qa != null && qa > 0 ? qa.toFixed(3) : null;
      }

      try {
        // TZ14: Sample ACTIVE written here (single writer). TZ15 §4 does NOT
        // create Sample at warehouse confirm — shipment is a sibling only.
        const sample = await tx.sample.create({
          data: {
            targetType: input.targetType,
            slabId,
            pieceId,
            batchId,
            qtySlabs,
            qtyAreaM2,
            clientId,
            returnDueDate: input.returnDueDate,
            depositAmount,
            depositCurrency,
            comment: input.comment?.trim() || null,
            photoUrl: input.photoUrl?.trim() || null,
            locationNote: input.locationNote?.trim() || null,
            managerId: actor.id,
            status: "ACTIVE",
            linkedRequestId: input.linkedRequestId?.trim() || null,
          },
          select: { id: true },
        });

        // Location snapshot for warehouse queue (unit samples).
        let locationSnapshot: string | null =
          input.locationNote?.trim() || null;
        if (
          (input.targetType === "SLAB" || input.targetType === "PIECE") &&
          !locationSnapshot
        ) {
          const unitId = slabId ?? pieceId;
          if (unitId) {
            const loc =
              input.targetType === "SLAB"
                ? await tx.slab.findUnique({
                    where: { id: unitId },
                    select: { block: true, landmark: true },
                  })
                : await tx.piece.findUnique({
                    where: { id: unitId },
                    select: { block: true, landmark: true },
                  });
            if (loc) {
              locationSnapshot = formatLocation(loc.block, loc.landmark);
            }
          }
        }

        // TZ №15 Slice 2 — OPEN SAMPLE shipment same TX (stock already held above).
        const { shipmentId } = await createSampleShipment(tx, {
          sampleId: sample.id,
          managerId: actor.id,
          clientId,
          note: input.comment?.trim() || null,
          line: {
            targetType: input.targetType,
            slabId,
            pieceId,
            batchId,
            qtyOrderedSlabs: qtySlabs,
            qtyOrderedAreaM2:
              qtyAreaM2 != null ? Number(qtyAreaM2) : null,
            locationSnapshot,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: "SAMPLE_ISSUE",
            entityType: "Sample",
            entityId: sample.id,
            payload: {
              targetType: input.targetType,
              slabId,
              pieceId,
              batchId,
              clientId,
              returnDueDate: input.returnDueDate.toISOString(),
              depositAmount,
              depositCurrency,
            },
          },
        });

        // shipmentId — ТЗ №15 §8.2: уведомление складчику шлём ПОСЛЕ коммита.
        return { ok: true as const, sampleId: sample.id, shipmentId };
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "P2002") {
          throw new SampleLogicError({
            code: "ALREADY_ISSUED",
            message:
              "Этот камень уже выдан как образец (параллельная выдача)",
          });
        }
        throw e;
      }
    });
  } catch (e) {
    if (e instanceof SampleLogicError) return { ok: false, error: e.sampleError };
    throw e;
  }
}

export async function returnSample(args: {
  sampleId: string;
  managerId: string;
}): Promise<{ ok: true } | SampleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, args.managerId);
      const sample = await tx.sample.findUnique({
        where: { id: args.sampleId },
        select: {
          id: true,
          status: true,
          targetType: true,
          slabId: true,
          pieceId: true,
          depositAmount: true,
        },
      });
      if (!sample) {
        throw new SampleLogicError({
          code: "NOT_FOUND",
          message: "Образец не найден",
        });
      }
      if (sample.status !== "ACTIVE") {
        throw new SampleLogicError({
          code: "NOT_ACTIVE",
          message: "Образец уже закрыт",
        });
      }

      const upd = await tx.sample.updateMany({
        where: { id: sample.id, status: "ACTIVE" },
        data: {
          status: "RETURNED",
          depositReturnedAt:
            sample.depositAmount != null ? new Date() : null,
        },
      });
      if (upd.count === 0) {
        throw new SampleLogicError({
          code: "CONFLICT",
          message: "Образец изменился — обновите страницу",
        });
      }

      // TZ №15 Slice 2 — cancel OPEN sample shipment (stock reverse below is independent).
      await cancelOpenShipmentForSample(tx, sample.id, new Date());

      if (sample.targetType === "SLAB" && sample.slabId) {
        await tx.slab.updateMany({
          where: { id: sample.slabId, status: "SAMPLE" },
          data: { status: "AVAILABLE" },
        });
      }
      if (sample.targetType === "PIECE" && sample.pieceId) {
        await tx.piece.updateMany({
          where: { id: sample.pieceId, status: "SAMPLE" },
          data: { status: "AVAILABLE" },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SAMPLE_RETURN",
          entityType: "Sample",
          entityId: sample.id,
          payload: { slabId: sample.slabId, pieceId: sample.pieceId },
        },
      });
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof SampleLogicError) return { ok: false, error: e.sampleError };
    throw e;
  }
}

export async function extendSampleDueDate(args: {
  sampleId: string;
  managerId: string;
  returnDueDate: Date;
}): Promise<{ ok: true } | SampleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, args.managerId);
      if (
        !(args.returnDueDate instanceof Date) ||
        Number.isNaN(args.returnDueDate.getTime())
      ) {
        throw new SampleLogicError({
          code: "INVALID_INPUT",
          message: "Неверная дата возврата",
        });
      }
      const upd = await tx.sample.updateMany({
        where: { id: args.sampleId, status: "ACTIVE" },
        data: { returnDueDate: args.returnDueDate },
      });
      if (upd.count === 0) {
        throw new SampleLogicError({
          code: "NOT_ACTIVE",
          message: "Продлить можно только активный образец",
        });
      }
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SAMPLE_EXTEND",
          entityType: "Sample",
          entityId: args.sampleId,
          payload: { returnDueDate: args.returnDueDate.toISOString() },
        },
      });
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof SampleLogicError) return { ok: false, error: e.sampleError };
    throw e;
  }
}

export interface SellSampleInput {
  sampleId: string;
  managerId: string;
  price: number;
  paymentMethod: "CASH" | "CARD" | "CREDIT";
  currency: MoneyCurrency;
  debtDueDate?: Date | null;
  debtComment?: string | null;
}

/**
 * Образец → продажа: SAMPLE unit → SOLD, Sample → SOLD + SaleRecord.
 * CREDIT creates Debt. Deposit is recorded in audit (credited in UI note).
 */
export async function sellSample(
  input: SellSampleInput,
): Promise<{ ok: true; saleId: string } | SampleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, input.managerId);
      if (
        !Number.isFinite(input.price) ||
        input.price <= 0 ||
        input.price > MAX_DECIMAL_14_2
      ) {
        throw new SampleLogicError({
          code: "INVALID_INPUT",
          message: "Укажите цену продажи",
        });
      }
      const sample = await tx.sample.findUnique({
        where: { id: input.sampleId },
        select: {
          id: true,
          status: true,
          targetType: true,
          slabId: true,
          pieceId: true,
          batchId: true,
          qtySlabs: true,
          qtyAreaM2: true,
          clientId: true,
          depositAmount: true,
          depositCurrency: true,
          client: { select: { name: true, phone: true } },
        },
      });
      if (!sample) {
        throw new SampleLogicError({
          code: "NOT_FOUND",
          message: "Образец не найден",
        });
      }
      if (sample.status !== "ACTIVE") {
        throw new SampleLogicError({
          code: "NOT_ACTIVE",
          message: "Образец уже закрыт",
        });
      }
      if (input.paymentMethod === "CREDIT" && !sample.client.phone?.trim()) {
        throw new SampleLogicError({
          code: "INVALID_INPUT",
          message: "Для продажи в долг у клиента должен быть телефон",
        });
      }

      const now = new Date();
      const priceStr = input.price.toFixed(2);

      // Unit SAMPLE → SOLD
      if (sample.targetType === "SLAB" && sample.slabId) {
        const u = await tx.slab.updateMany({
          where: { id: sample.slabId, status: "SAMPLE" },
          data: { status: "SOLD" },
        });
        if (u.count === 0) {
          throw new SampleLogicError({
            code: "CONFLICT",
            message: "Статус камня изменился",
          });
        }
      }
      if (sample.targetType === "PIECE" && sample.pieceId) {
        const u = await tx.piece.updateMany({
          where: { id: sample.pieceId, status: "SAMPLE" },
          data: { status: "SOLD" },
        });
        if (u.count === 0) {
          throw new SampleLogicError({
            code: "CONFLICT",
            message: "Статус камня изменился",
          });
        }
      }
      if (sample.targetType === "BATCH_VOLUME" && sample.batchId) {
        // Lock + optimistic WHERE on sold counters (same pattern as sellBatchVolume)
        await lockBatchForUpdate(tx, sample.batchId);
        const batch = await tx.batch.findUnique({
          where: { id: sample.batchId },
          select: {
            id: true,
            slabsSoldDirect: true,
            areaSoldDirectM2: true,
            needsCheck: true,
          },
        });
        if (!batch || batch.needsCheck) {
          throw new SampleLogicError({
            code: "UNIT_UNAVAILABLE",
            message: "Партия недоступна",
          });
        }
        const data: Prisma.BatchUpdateManyMutationInput = {};
        if (sample.qtySlabs != null && sample.qtySlabs > 0) {
          data.slabsSoldDirect = { increment: sample.qtySlabs };
        }
        if (sample.qtyAreaM2 != null) {
          data.areaSoldDirectM2 = {
            increment: sample.qtyAreaM2.toString(),
          };
        }
        const upd = await tx.batch.updateMany({
          where: {
            id: batch.id,
            slabsSoldDirect: batch.slabsSoldDirect,
            areaSoldDirectM2: batch.areaSoldDirectM2.toString(),
          },
          data,
        });
        if (upd.count === 0) {
          throw new SampleLogicError({
            code: "CONFLICT",
            message:
              "Остаток партии изменился параллельно — обновите и повторите",
          });
        }
      }

      const sale = await tx.saleRecord.create({
        data: {
          managerId: actor.id,
          customerName: sample.client.name,
          customerContact: sample.client.phone,
          targetType: sample.targetType,
          slabId: sample.slabId,
          pieceId: sample.pieceId,
          batchId: sample.batchId,
          qtySlabs: sample.qtySlabs,
          qtyAreaM2: sample.qtyAreaM2,
          price: priceStr,
          paymentMethod: input.paymentMethod,
          currency: input.currency,
          clientId: sample.clientId,
          soldAt: now,
        },
        select: { id: true },
      });

      if (input.paymentMethod === "CREDIT") {
        try {
          await createDebtForSale(tx, {
            saleRecordId: sale.id,
            amount: priceStr,
            currency: input.currency,
            dueDate: input.debtDueDate ?? null,
            comment: input.debtComment ?? null,
            clientId: sample.clientId,
          });
        } catch (e) {
          if (e instanceof DebtLogicError) {
            throw new SampleLogicError({
              code: "INVALID_INPUT",
              message: e.debtError.message,
            });
          }
          throw e;
        }
      }

      const sUpd = await tx.sample.updateMany({
        where: { id: sample.id, status: "ACTIVE" },
        data: {
          status: "SOLD",
          saleRecordId: sale.id,
        },
      });
      if (sUpd.count === 0) {
        throw new SampleLogicError({
          code: "CONFLICT",
          message: "Образец уже закрыт",
        });
      }

      // TZ №15 §4 — cancel OPEN SAMPLE shipment if warehouse has not finished
      // hand-over. Without this, /otgruzki keeps a «К отгрузке» task after the
      // commercial sample is already SOLD (badge on /obraztsy would not show
      // awaitsWarehouse for SOLD, but the ship queue would lie).
      await cancelOpenShipmentForSample(tx, sample.id, now);

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "SAMPLE_SELL",
          entityType: "Sample",
          entityId: sample.id,
          payload: {
            saleId: sale.id,
            paymentMethod: input.paymentMethod,
            currency: input.currency,
            price: priceStr,
            depositAmount: sample.depositAmount?.toString() ?? null,
            depositCurrency: sample.depositCurrency,
          },
        },
      });

      return { ok: true as const, saleId: sale.id };
    });
  } catch (e) {
    if (e instanceof SampleLogicError) return { ok: false, error: e.sampleError };
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// УДАЛЕНО (аудит 2026-08-10): `sellAllClientSamples` — «продать все образцы
// клиента одним действием».
//
// Функция не имела НИ ОДНОГО вызова и НИ ОДНОГО теста, и при этом содержала
// частичный коммит: она продавала образцы по одному, каждый своей транзакцией,
// и при ошибке на N-м возвращала ошибку — при том, что первые N−1 уже проданы.
// Пользователь увидел бы «не получилось», а склад — списанные камни, долги и
// SaleRecord'ы. То есть худший вариант из возможных: «неуспех» на пути, который
// частично удался.
//
// Если такое действие понадобится, его нельзя писать циклом поверх `sellSample`:
// нужен один $transaction на все образцы (как `sellUnit`) — либо явное
// частичное поведение, которое честно показано в UI («продано 3 из 5, потому
// что …»). Восстанавливать старую форму — значит вернуть тихую порчу данных.
// ─────────────────────────────────────────────────────────────────────────────

export type SampleListItem = {
  id: string;
  status: SampleStatus;
  targetType: SampleTarget;
  issuedAt: Date;
  returnDueDate: Date;
  overdue: boolean;
  depositAmount: string | null;
  depositCurrency: MoneyCurrency | null;
  comment: string | null;
  locationNote: string | null;
  clientId: string;
  clientName: string;
  clientPhone: string;
  managerId: string;
  managerName: string;
  stoneLabel: string;
  /**
   * TZ №15 Slice 2 — true while sibling SAMPLE shipment is OPEN/PARTIAL.
   * Derived only; never stored on Sample. Legacy samples (no shipment) → false.
   */
  awaitsWarehouse: boolean;
};

export async function listSamples(
  database: Db,
  args: {
    canSeeAll: boolean;
    actorId: string | null;
    status?: SampleStatus | "ALL";
    overdueOnly?: boolean;
    clientId?: string;
    now?: Date;
    take?: number;
  },
): Promise<SampleListItem[]> {
  const now = args.now ?? new Date();
  const scope = sampleListScope({
    canSeeAll: args.canSeeAll,
    actorId: args.actorId,
  });
  const where: Prisma.SampleWhereInput = { ...scope };
  if (args.status && args.status !== "ALL") {
    where.status = args.status;
  }
  if (args.clientId) where.clientId = args.clientId;
  if (args.overdueOnly) {
    where.status = "ACTIVE";
    where.returnDueDate = { lt: now };
  }

  const rows = await database.sample.findMany({
    where,
    orderBy: [{ returnDueDate: "asc" }, { issuedAt: "desc" }],
    take: Math.min(200, args.take ?? 100),
    select: {
      id: true,
      status: true,
      targetType: true,
      issuedAt: true,
      returnDueDate: true,
      depositAmount: true,
      depositCurrency: true,
      comment: true,
      locationNote: true,
      clientId: true,
      managerId: true,
      client: { select: { name: true, phone: true } },
      manager: { select: { name: true } },
      slab: { select: { label: true, stoneType: { select: { name: true } } } },
      piece: {
        select: { kind: true, stoneType: { select: { name: true } } },
      },
      batch: { select: { stoneType: { select: { name: true } } } },
      qtySlabs: true,
      qtyAreaM2: true,
      // TZ №15 — sibling shipment for «ожидает выдачи» badge (bounded lines).
      shipment: {
        select: {
          cancelledAt: true,
          completedAt: true,
          lines: {
            select: {
              targetType: true,
              qtyOrderedSlabs: true,
              qtyOrderedAreaM2: true,
              qtyShippedSlabs: true,
              qtyShippedAreaM2: true,
            },
            take: 5,
          },
        },
      },
    },
  });

  return rows.map((r) => {
    let stoneLabel = "—";
    if (r.slab) stoneLabel = `${r.slab.stoneType.name} — ${r.slab.label}`;
    else if (r.piece) {
      const k = r.piece.kind === "BROKEN" ? "бой" : "остаток";
      stoneLabel = `${r.piece.stoneType.name} — ${k}`;
    } else if (r.batch) {
      const q = [
        r.qtySlabs != null ? `${r.qtySlabs} плит` : null,
        r.qtyAreaM2 != null ? `${r.qtyAreaM2} м²` : null,
      ]
        .filter(Boolean)
        .join(" / ");
      stoneLabel = `${r.batch.stoneType.name} — объём${q ? ` (${q})` : ""}`;
    }
    const ship = r.shipment
      ? {
          cancelledAt: r.shipment.cancelledAt,
          completedAt: r.shipment.completedAt,
          lines: r.shipment.lines.map((l) => ({
            targetType: l.targetType,
            qtyOrderedSlabs: l.qtyOrderedSlabs,
            qtyOrderedAreaM2:
              l.qtyOrderedAreaM2 == null
                ? null
                : Number(l.qtyOrderedAreaM2.toString()),
            qtyShippedSlabs: l.qtyShippedSlabs,
            qtyShippedAreaM2: Number(l.qtyShippedAreaM2.toString()),
          })),
        }
      : null;
    return {
      id: r.id,
      status: r.status as SampleStatus,
      targetType: r.targetType as SampleTarget,
      issuedAt: r.issuedAt,
      returnDueDate: r.returnDueDate,
      overdue: isSampleOverdue(
        { status: r.status as SampleStatus, returnDueDate: r.returnDueDate },
        now,
      ),
      depositAmount: r.depositAmount?.toString() ?? null,
      depositCurrency: (r.depositCurrency as MoneyCurrency | null) ?? null,
      comment: r.comment,
      locationNote: r.locationNote,
      clientId: r.clientId,
      clientName: r.client.name,
      clientPhone: r.client.phone,
      managerId: r.managerId,
      managerName: r.manager.name,
      stoneLabel,
      awaitsWarehouse: shipmentAwaitsWarehouse(ship),
    };
  });
}

/** Active sample holds on batches (like reservation volume holds). */
export function sampleHoldsFromRows(
  rows: readonly {
    batchId: string | null;
    qtySlabs: number | null;
    qtyAreaM2: number | null;
    status: string;
  }[],
): Map<string, { reservedSlabs: number; reservedAreaM2: number }> {
  const result = new Map<string, { reservedSlabs: number; reservedAreaM2: number }>();
  for (const r of rows) {
    if (r.batchId == null || r.status !== "ACTIVE") continue;
    const cur = result.get(r.batchId) ?? { reservedSlabs: 0, reservedAreaM2: 0 };
    cur.reservedSlabs += r.qtySlabs ?? 0;
    cur.reservedAreaM2 += r.qtyAreaM2 ?? 0;
    result.set(r.batchId, cur);
  }
  return result;
}

export async function getBatchSampleHolds(
  database: PrismaClient,
  batchIds: string[],
): Promise<Map<string, { reservedSlabs: number; reservedAreaM2: number }>> {
  if (batchIds.length === 0) return new Map();
  const rows = await database.sample.findMany({
    where: {
      status: "ACTIVE",
      targetType: "BATCH_VOLUME",
      batchId: { in: batchIds },
    },
    select: {
      batchId: true,
      qtySlabs: true,
      qtyAreaM2: true,
      status: true,
    },
  });
  return sampleHoldsFromRows(
    rows.map((r) => ({
      batchId: r.batchId,
      qtySlabs: r.qtySlabs,
      qtyAreaM2: r.qtyAreaM2 == null ? null : Number(r.qtyAreaM2.toString()),
      status: r.status,
    })),
  );
}
