// ТЗ №20 F — частичный (и полный) возврат объёмной продажи + приём складом.
//
// Правила (§7):
//  • вернуть можно не больше, чем продано минус прошлые возвраты; возвратов по
//    одной продаже может быть несколько; последний, закрывший всё, = полный
//    возврат (SaleRecord.returnedAt);
//  • сумма предлагается пропорционально (цена × доля), менеджер может поправить
//    (0 ≤ сумма ≤ цена − уже возвращено); полный возврат — вся оставшаяся сумма;
//  • продажа в долг: сначала уменьшается долг, деньги клиенту — только сверх;
//  • неотгруженная часть: уменьшается задача «К отгрузке», камень возвращается
//    в остаток сразу; отгруженная — ждёт приёма складчиком в «Отгрузках» и
//    возвращается в остаток только при приёме (acceptSaleReturn).
//
// Деньги — целые тийины/центы. Одна транзакция; замки: продажа → партия → долг
// (тот же порядок, что у продажи/платежа — без взаимных блокировок).
//
// Модуль не импортирует sales.ts в рантайме (только типы) — sales.ts зовёт
// returnVolumeInTx из returnSale, обратная зависимость дала бы цикл.

import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { ActorRole, SaleError, SaleErrorCode, SaleFail } from "./sales";
import { lockBatchForUpdate } from "./batch-lock";
import { isWarehouseRole } from "./permissions";
import { returnToLocationsInTx } from "./pattern-stock";
import { cancelDebtForReturnedSale } from "./debts";
import { cancelOpenShipmentForSale, lineIsFullyShipped } from "./shipments";
import {
  centsToStr,
  debtRemainingCents,
  decToCents,
  netPaidCents,
  recordRefundInTx,
  type PayMethod,
} from "./payments";

const EPS = 1e-6;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (d: { toString(): string } | null | undefined): number =>
  d == null ? 0 : Number(d.toString());

/** Ошибка внутри транзакции → откат и SaleFail у вызывающего. */
export class ReturnLogicError extends Error {
  constructor(public readonly saleError: SaleError) {
    super(saleError.message);
  }
}

function bad(code: SaleErrorCode, message: string): never {
  throw new ReturnLogicError({ code, message });
}

export type ReturnDestination = "SAME_PATTERN" | "REMAINDER";

// ───────────────────────── Чистые решения ─────────────────────────

/** Право на возврат: OWNER — любые продажи, MANAGER — только свои (§15). */
export function decideReturnAccess(args: {
  actingRole: ActorRole;
  actingUserId: string;
  saleManagerId: string | null | undefined;
}): { ok: true } | SaleFail {
  if (args.actingRole !== "OWNER" && args.actingRole !== "MANAGER") {
    return {
      ok: false,
      error: { code: "FORBIDDEN_ROLE", message: "Возврат оформляет менеджер или владелец" },
    };
  }
  if (args.actingRole === "MANAGER" && args.saleManagerId !== args.actingUserId) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN_ROLE",
        message: "Менеджер оформляет возврат только по своим продажам",
      },
    };
  }
  return { ok: true };
}

export interface ResolvedReturnQty {
  /** Плиты возврата (null — продажа не в плитах). */
  slabs: number | null;
  /** м² возврата (null — продажа не в м²). */
  areaM2: number | null;
  /** Чем считается доля: плиты, если продано плитами, иначе м². */
  primary: "slabs" | "area";
  /** Возврат закрывает продажу целиком. */
  isFull: boolean;
}

/**
 * Сколько возвращаем. Пусто = весь остаток. Продажа в плитах: плиты главные,
 * м² (если продажа их тоже хранит) — по введённому или пропорционально.
 */
export function resolveReturnQty(args: {
  soldSlabs: number | null;
  soldAreaM2: number | null;
  returnedSlabs: number;
  returnedAreaM2: number;
  reqSlabs: number | null;
  reqAreaM2: number | null;
}): { ok: true; qty: ResolvedReturnQty } | { ok: false; message: string } {
  const { soldSlabs, soldAreaM2 } = args;
  if (soldSlabs !== null) {
    const rem = soldSlabs - args.returnedSlabs;
    const remArea = soldAreaM2 === null ? null : round3(soldAreaM2 - args.returnedAreaM2);
    if (rem <= 0) return { ok: false, message: "По этой продаже всё уже возвращено" };
    const slabs = args.reqSlabs ?? (args.reqAreaM2 === null ? rem : null);
    if (slabs === null) return { ok: false, message: "Укажите, сколько плит возвращают" };
    if (!Number.isInteger(slabs) || slabs <= 0) {
      return { ok: false, message: "Количество плит — целое число больше нуля" };
    }
    if (slabs > rem) {
      return {
        ok: false,
        message: `Вернуть можно не больше ${rem} плит (продано ${soldSlabs}, уже возвращено ${args.returnedSlabs})`,
      };
    }
    let area: number | null = null;
    if (remArea !== null && soldAreaM2 !== null) {
      if (slabs === rem) area = Math.max(0, remArea);
      else if (args.reqAreaM2 !== null) {
        if (!(args.reqAreaM2 > 0) || args.reqAreaM2 > remArea + EPS) {
          return { ok: false, message: `Площадь возврата — от 0 до ${remArea} м²` };
        }
        area = round3(args.reqAreaM2);
      } else {
        area = Math.min(remArea, round3((soldAreaM2 * slabs) / soldSlabs));
      }
    }
    return { ok: true, qty: { slabs, areaM2: area, primary: "slabs", isFull: slabs === rem } };
  }
  if (soldAreaM2 === null) return { ok: false, message: "В продаже нет количества — возврат невозможен" };
  const remArea = round3(soldAreaM2 - args.returnedAreaM2);
  if (remArea <= EPS) return { ok: false, message: "По этой продаже всё уже возвращено" };
  const area = args.reqAreaM2 ?? remArea;
  if (!(area > 0)) return { ok: false, message: "Площадь возврата — больше нуля" };
  if (area > remArea + EPS) {
    return {
      ok: false,
      message: `Вернуть можно не больше ${remArea} м² (продано ${soldAreaM2}, уже возвращено ${round3(args.returnedAreaM2)})`,
    };
  }
  const isFull = area >= remArea - EPS;
  return {
    ok: true,
    qty: { slabs: null, areaM2: isFull ? remArea : round3(area), primary: "area", isFull },
  };
}

/**
 * Предлагаемая сумма: цена × доля (по плитам или м²), в центах. Последний
 * возврат — ровно остаток суммы (без хвоста от округления).
 */
export function suggestRefundCents(args: {
  priceCents: number;
  returnedCents: number;
  soldPrimary: number;
  qtyPrimary: number;
  isFull: boolean;
}): number {
  const left = Math.max(0, args.priceCents - args.returnedCents);
  if (args.isFull || args.soldPrimary <= 0) return left;
  return Math.min(left, Math.round((args.priceCents * args.qtyPrimary) / args.soldPrimary));
}

/** Сначала долг, сверх него — деньги клиенту. */
export function splitRefund(
  refundCents: number,
  debtLeftCents: number,
): { debtReductionCents: number; cashCents: number } {
  const d = Math.max(0, Math.min(refundCents, debtLeftCents));
  return { debtReductionCents: d, cashCents: refundCents - d };
}

/** Строка отгрузки в единицах главной меры продажи. */
export interface ReturnPlanLine {
  lineId: string;
  batchPatternId: string | null;
  batchLocationId: string | null;
  ordered: number;
  shipped: number;
}

/** Часть возврата: откуда (узор · место) и отгружена ли она уже клиенту. */
export interface ReturnPart {
  lineId: string | null;
  batchPatternId: string | null;
  batchLocationId: string | null;
  slabs: number | null;
  areaM2: number | null;
  shipped: boolean;
}

/**
 * Раскладка возврата по строкам отгрузки: сначала НЕотгруженное (задача
 * «К отгрузке» уменьшается, камень сразу в остаток), потом отгруженное (ждёт
 * приёма складом). Нет строк (старая продажа без задачи = отгружено) — всё
 * отгружено, узор продажи. Площадь при продаже в плитах — пропорционально,
 * последняя часть добирает остаток.
 */
export function planReturnParts(args: {
  lines: readonly ReturnPlanLine[];
  primary: "slabs" | "area";
  qtyPrimary: number;
  /** м² возврата при продаже в плитах (null — м² не учитываются). */
  areaForSlabs: number | null;
  fallbackPatternId: string | null;
}): ReturnPart[] {
  const raw: { line: ReturnPlanLine | null; take: number; shipped: boolean }[] = [];
  let left = args.qtyPrimary;
  const take = (avail: number) => {
    const t = args.primary === "slabs" ? Math.min(left, Math.floor(avail)) : round3(Math.min(left, avail));
    return t > EPS ? t : 0;
  };
  for (const shipped of [false, true]) {
    for (const l of args.lines) {
      if (left <= EPS) break;
      const avail = shipped ? Math.max(0, l.shipped) : Math.max(0, l.ordered - l.shipped);
      const t = take(avail);
      if (t <= 0) continue;
      raw.push({ line: l, take: t, shipped });
      left = args.primary === "slabs" ? left - t : round3(left - t);
    }
  }
  if (left > EPS) raw.push({ line: null, take: left, shipped: true });

  let areaLeft = args.areaForSlabs ?? 0;
  return raw.map((r, i) => {
    let area: number | null = null;
    if (args.primary === "area") area = r.take;
    else if (args.areaForSlabs !== null) {
      if (i === raw.length - 1) area = round3(areaLeft);
      else {
        area = round3((args.areaForSlabs * r.take) / args.qtyPrimary);
        areaLeft = round3(areaLeft - area);
      }
    }
    return {
      lineId: r.line?.lineId ?? null,
      batchPatternId: r.line ? r.line.batchPatternId : args.fallbackPatternId,
      batchLocationId: r.line?.batchLocationId ?? null,
      slabs: args.primary === "slabs" ? r.take : null,
      areaM2: area,
      shipped: r.shipped,
    };
  });
}

/** parts из JSON (SaleReturn.parts) — параноидально, мусор отбрасывается. */
export function parseReturnParts(raw: unknown): ReturnPart[] {
  if (!Array.isArray(raw)) return [];
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      lineId: s(x.lineId),
      batchPatternId: s(x.batchPatternId),
      batchLocationId: s(x.batchLocationId),
      slabs: n(x.slabs),
      areaM2: n(x.areaM2),
      shipped: x.shipped === true,
    }));
}

/** «3 плит / 6,3 м²» */
export function formatReturnQty(slabs: number | null, areaM2: number | null): string {
  const m2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
  return [
    slabs !== null && slabs > 0 && `${slabs} плит`,
    areaM2 !== null && areaM2 > EPS && `${m2.format(areaM2)} м²`,
  ]
    .filter(Boolean)
    .join(" / ");
}

/** «Возврат частичный: 3 из 10 плит» (или м²) — null, если возвратов не было. */
export function partialReturnLabel(s: {
  qtySlabs: number | null;
  qtyAreaM2: { toString(): string } | null;
  returnedSlabs?: number | null;
  returnedAreaM2?: { toString(): string } | null;
}): string | null {
  const m2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
  if (s.qtySlabs !== null && (s.returnedSlabs ?? 0) > 0) {
    return `Возврат частичный: ${s.returnedSlabs} из ${s.qtySlabs} плит`;
  }
  const ra = num(s.returnedAreaM2);
  if (s.qtySlabs === null && s.qtyAreaM2 !== null && ra > EPS) {
    return `Возврат частичный: ${m2.format(ra)} из ${m2.format(num(s.qtyAreaM2))} м²`;
  }
  return null;
}

// ───────────────────────── Транзакционная часть ─────────────────────────

type Tx = Prisma.TransactionClient;

interface SaleForReturn {
  id: string;
  managerId: string;
  targetType: "SLAB" | "PIECE" | "BATCH_VOLUME";
  batchId: string | null;
  batchPatternId: string | null;
  qtySlabs: number | null;
  qtyAreaM2: { toString(): string } | null;
  price: { toString(): string } | null;
  currency: "UZS" | "USD" | null;
  returnedAt: Date | null;
  returnedSlabs: number;
  returnedAreaM2: { toString(): string };
  returnedAmount: { toString(): string };
}

interface Dims {
  stoneTypeId: string;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessMm: { toString(): string } | null;
  unitAreaM2: number;
}

/** Габарит/площадь плиты узора (или партии) — для мест и для кусков «в остаток». */
async function loadDims(tx: Tx, batchId: string, patternId: string | null): Promise<Dims> {
  const batch = await tx.batch.findUnique({
    where: { id: batchId },
    select: {
      stoneTypeId: true,
      lengthMm: true,
      widthMm: true,
      thicknessMm: true,
      slabsTotal: true,
      areaTotalM2: true,
    },
  });
  const p = patternId
    ? await tx.batchPattern.findUnique({
        where: { id: patternId },
        select: { lengthMm: true, widthMm: true, thicknessMm: true, slabsCount: true, areaM2: true },
      })
    : null;
  const L = p?.lengthMm ?? batch?.lengthMm ?? null;
  const W = p?.widthMm ?? batch?.widthMm ?? null;
  const unit =
    L && W
      ? (L * W) / 10_000
      : p && p.slabsCount > 0
        ? num(p.areaM2) / p.slabsCount
        : batch?.slabsTotal && batch.areaTotalM2
          ? num(batch.areaTotalM2) / batch.slabsTotal
          : 0;
  return {
    stoneTypeId: batch?.stoneTypeId ?? "",
    lengthCm: L,
    widthCm: W,
    thicknessMm: p?.thicknessMm ?? batch?.thicknessMm ?? null,
    unitAreaM2: unit,
  };
}

/**
 * Вернуть части в остаток (под замком партии): счётчики партии и узора —
 * назад; SAME_PATTERN — плиты в то же место; REMAINDER — куски «остаток» того
 * же узора (needsCheck: размеры — по формату плиты, складчик уточнит).
 * Кусок прямого боя сам по себе −1 плита из свободного (§3), поэтому
 * REMAINDER не добавляет целых плит в продажу — только куски.
 */
async function restorePartsInTx(
  tx: Tx,
  sale: Pick<SaleForReturn, "qtySlabs" | "qtyAreaM2"> & { batchId: string },
  parts: readonly ReturnPart[],
  destination: ReturnDestination,
  actorId: string,
): Promise<{ pieceIds: string[] }> {
  if (parts.length === 0) return { pieceIds: [] };
  const slabsOf = (p: ReturnPart) => (sale.qtySlabs !== null ? (p.slabs ?? 0) : 0);
  const areaOf = (p: ReturnPart) => (sale.qtyAreaM2 !== null ? (p.areaM2 ?? 0) : 0);

  const totalSlabs = parts.reduce((s, p) => s + slabsOf(p), 0);
  const totalArea = round3(parts.reduce((s, p) => s + areaOf(p), 0));
  if (totalSlabs > 0 || totalArea > EPS) {
    await tx.batch.update({
      where: { id: sale.batchId },
      data: {
        ...(totalSlabs > 0 ? { slabsSoldDirect: { decrement: totalSlabs } } : {}),
        ...(totalArea > EPS ? { areaSoldDirectM2: { decrement: totalArea.toFixed(3) } } : {}),
      },
    });
  }
  const byPattern = new Map<string, { slabs: number; area: number }>();
  for (const p of parts) {
    if (!p.batchPatternId) continue;
    const a = byPattern.get(p.batchPatternId) ?? { slabs: 0, area: 0 };
    a.slabs += slabsOf(p);
    a.area = round3(a.area + areaOf(p));
    byPattern.set(p.batchPatternId, a);
  }
  for (const [id, a] of byPattern) {
    if (a.slabs <= 0 && a.area <= EPS) continue;
    await tx.batchPattern.update({
      where: { id },
      data: {
        ...(a.slabs > 0 ? { slabsSold: { decrement: a.slabs } } : {}),
        ...(a.area > EPS ? { areaSoldM2: { decrement: a.area.toFixed(3) } } : {}),
      },
    });
  }

  const pieceIds: string[] = [];
  const dimsCache = new Map<string, Dims>();
  const dimsFor = async (patternId: string | null) => {
    const key = patternId ?? "";
    let d = dimsCache.get(key);
    if (!d) {
      d = await loadDims(tx, sale.batchId, patternId);
      dimsCache.set(key, d);
    }
    return d;
  };
  for (const p of parts) {
    const needLoc = destination === "SAME_PATTERN" ? !!p.batchLocationId : true;
    if (!needLoc) continue;
    const dims = await dimsFor(p.batchPatternId);
    const n =
      p.slabs ??
      (dims.unitAreaM2 > 0 && p.areaM2 !== null ? Math.floor(p.areaM2 / dims.unitAreaM2 + EPS) : 0);
    if (destination === "SAME_PATTERN") {
      await returnToLocationsInTx(tx, [{ locationId: p.batchLocationId, slabs: n }], dims.unitAreaM2);
      continue;
    }
    // REMAINDER: куски «остаток» в месте, откуда плиты уходили.
    if (n <= 0 || !dims.lengthCm || !dims.widthCm) continue; // проверено при оформлении
    const loc = p.batchLocationId
      ? await tx.batchLocation.findUnique({
          where: { id: p.batchLocationId },
          select: { block: true, landmark: true },
        })
      : await tx.batchLocation.findFirst({
          where: { batchId: sale.batchId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { block: true, landmark: true },
        });
    const pieceArea =
      sale.qtyAreaM2 !== null && p.areaM2 !== null && p.areaM2 > EPS
        ? round3(p.areaM2 / n)
        : round3(dims.unitAreaM2);
    for (let i = 0; i < n; i++) {
      const piece = await tx.piece.create({
        data: {
          stoneTypeId: dims.stoneTypeId,
          batchId: sale.batchId,
          batchPatternId: p.batchPatternId,
          originSlabId: null,
          kind: "OFFCUT",
          sidesMm: [dims.lengthCm, dims.widthCm, dims.lengthCm, dims.widthCm],
          boundingLengthMm: dims.lengthCm,
          boundingWidthMm: dims.widthCm,
          thicknessMm: dims.thicknessMm === null ? null : dims.thicknessMm.toString(),
          areaM2: pieceArea > 0 ? pieceArea.toFixed(3) : null,
          block: loc?.block ?? "—",
          landmark: loc?.landmark ?? "—",
          needsCheck: true,
          createdById: actorId,
        },
        select: { id: true },
      });
      pieceIds.push(piece.id);
    }
  }
  return { pieceIds };
}

export interface VolumeReturnOptions {
  /** null = всё, что осталось. */
  qtySlabs: number | null;
  qtyAreaM2: number | null;
  /** null = предложенная (пропорциональная). */
  refundCents: number | null;
  method: PayMethod;
  destination: ReturnDestination;
  reason: string | null;
  /** returnSale («вся продажа»): игнорировать количество, вернуть всё. */
  full?: boolean;
}

export interface VolumeReturnResult {
  saleId: string;
  saleReturnId: string;
  batchId: string;
  isFull: boolean;
  refundCents: number;
  debtReductionCents: number;
  cashCents: number;
  immediateSlabs: number;
  immediateAreaM2: number;
  pendingSlabs: number;
  pendingAreaM2: number;
}

/**
 * Возврат объёмной продажи внутри транзакции (частичный или полный).
 * Бросает ReturnLogicError — вызывающий превращает её в SaleFail.
 */
export async function returnVolumeInTx(
  tx: Tx,
  args: {
    saleId: string;
    actor: { id: string; role: ActorRole };
    opts: VolumeReturnOptions;
    now: Date;
  },
): Promise<VolumeReturnResult> {
  const { actor, opts, now } = args;
  // Замок продажи: два возврата по одной продаже идут строго по очереди —
  // второй видит уже увеличенные returned* (иначе можно вернуть больше проданного).
  await tx.$queryRaw`SELECT id FROM "SaleRecord" WHERE id = ${args.saleId} FOR UPDATE`;
  const sale = (await tx.saleRecord.findUnique({
    where: { id: args.saleId },
    select: {
      id: true,
      managerId: true,
      targetType: true,
      batchId: true,
      batchPatternId: true,
      qtySlabs: true,
      qtyAreaM2: true,
      price: true,
      currency: true,
      returnedAt: true,
      returnedSlabs: true,
      returnedAreaM2: true,
      returnedAmount: true,
    },
  })) as SaleForReturn | null;
  if (!sale) bad("NOT_FOUND", "Продажа не найдена");
  const access = decideReturnAccess({
    actingRole: actor.role,
    actingUserId: actor.id,
    saleManagerId: sale.managerId,
  });
  if (!access.ok) bad(access.error.code, access.error.message);
  if (sale.targetType !== "BATCH_VOLUME") {
    bad("INVALID_INPUT", "Частичный возврат — только для продаж объёмом (плиты / м²)");
  }
  if (sale.returnedAt) bad("ALREADY_RETURNED", "По этой продаже возврат уже оформлен");
  if (!sale.batchId) bad("NOT_FOUND", "Партия продажи не найдена");
  const batchId = sale.batchId;

  const q = resolveReturnQty({
    soldSlabs: sale.qtySlabs,
    soldAreaM2: sale.qtyAreaM2 === null ? null : num(sale.qtyAreaM2),
    returnedSlabs: sale.returnedSlabs ?? 0,
    returnedAreaM2: num(sale.returnedAreaM2),
    reqSlabs: opts.full ? null : opts.qtySlabs,
    reqAreaM2: opts.full ? null : opts.qtyAreaM2,
  });
  if (!q.ok) bad("INVALID_INPUT", q.message);
  const qty = q.qty;
  if (opts.destination === "REMAINDER" && sale.qtySlabs === null) {
    bad("INVALID_INPUT", "«В бой/остаток» — только для продаж в плитах; выберите «в тот же узор»");
  }

  // ── деньги: проверка до любых записей ──
  const hasMoney = sale.price != null && sale.currency != null;
  const priceCents = hasMoney ? decToCents(sale.price) : 0;
  const returnedCents = decToCents(sale.returnedAmount);
  const leftCents = Math.max(0, priceCents - returnedCents);
  const soldPrimary = qty.primary === "slabs" ? (sale.qtySlabs ?? 0) : num(sale.qtyAreaM2);
  const qtyPrimary = qty.primary === "slabs" ? (qty.slabs ?? 0) : (qty.areaM2 ?? 0);
  let refundCents = 0;
  if (hasMoney) {
    const suggested = suggestRefundCents({
      priceCents,
      returnedCents,
      soldPrimary,
      qtyPrimary,
      isFull: qty.isFull,
    });
    if (opts.refundCents === null) refundCents = suggested;
    else if (!Number.isInteger(opts.refundCents) || opts.refundCents < 0 || opts.refundCents > leftCents) {
      bad("INVALID_INPUT", `Сумма возврата — от 0 до ${centsToStr(leftCents)}`);
    } else if (qty.isFull && opts.refundCents !== leftCents) {
      bad(
        "INVALID_INPUT",
        `Возвращается весь остаток — сумма возврата равна оставшейся сумме продажи (${centsToStr(leftCents)})`,
      );
    } else refundCents = opts.refundCents;
  }

  await lockBatchForUpdate(tx, batchId);

  // ── раскладка: неотгруженное → сразу, отгруженное → ждёт склад ──
  const ship = await tx.shipment.findUnique({
    where: { saleRecordId: sale.id },
    select: {
      id: true,
      cancelledAt: true,
      completedAt: true,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          targetType: true,
          batchPatternId: true,
          batchLocationId: true,
          qtyOrderedSlabs: true,
          qtyOrderedAreaM2: true,
          qtyShippedSlabs: true,
          qtyShippedAreaM2: true,
        },
      },
    },
  });
  const shipLines = ship?.lines ?? [];
  const planLines: ReturnPlanLine[] = shipLines.map((l) => ({
    lineId: l.id,
    batchPatternId: l.batchPatternId ?? null,
    batchLocationId: l.batchLocationId ?? null,
    ordered: qty.primary === "slabs" ? (l.qtyOrderedSlabs ?? 0) : num(l.qtyOrderedAreaM2),
    shipped: qty.primary === "slabs" ? l.qtyShippedSlabs : num(l.qtyShippedAreaM2),
  }));
  const parts = planReturnParts({
    lines: planLines,
    primary: qty.primary,
    qtyPrimary,
    areaForSlabs: qty.primary === "slabs" ? qty.areaM2 : null,
    fallbackPatternId: sale.batchPatternId,
  });
  const immediate = parts.filter((p) => !p.shipped);
  const pending = parts.filter((p) => p.shipped);
  const sumSlabs = (ps: ReturnPart[]) => ps.reduce((s, p) => s + (p.slabs ?? 0), 0);
  const sumArea = (ps: ReturnPart[]) => round3(ps.reduce((s, p) => s + (p.areaM2 ?? 0), 0));

  // «В бой/остаток» без габарита плиты не собрать — отказ сразу, а не при приёме.
  if (opts.destination === "REMAINDER") {
    for (const pid of new Set(parts.map((p) => p.batchPatternId))) {
      const d = await loadDims(tx, batchId, pid);
      if (!d.lengthCm || !d.widthCm) {
        bad("INVALID_INPUT", "У плиты нет габарита — «в бой/остаток» невозможен, выберите «в тот же узор»");
      }
    }
  }

  // ── деньги: долг → деньги клиенту ──
  let debtReductionCents = 0;
  let cashCents = 0;
  if (hasMoney && qty.isFull) {
    // Полный возврат — как раньше: ACTIVE-долг отменяется, клиенту — всё,
    // что он фактически заплатил.
    const debt = await tx.debt.findUnique({
      where: { saleRecordId: sale.id },
      select: { id: true, status: true, amount: true, repaidAmount: true },
    });
    debtReductionCents = debt?.status === "ACTIVE" ? debtRemainingCents(debt) : 0;
    await cancelDebtForReturnedSale(tx, { saleRecordId: sale.id, actorId: actor.id, now });
    cashCents = Math.max(0, await netPaidCents(tx, sale.id));
    refundCents = debtReductionCents + cashCents;
  } else if (hasMoney && refundCents > 0) {
    await tx.$queryRaw`SELECT id FROM "Debt" WHERE "saleRecordId" = ${sale.id} FOR UPDATE`;
    const debt = await tx.debt.findUnique({
      where: { saleRecordId: sale.id },
      select: { id: true, status: true, amount: true, repaidAmount: true },
    });
    const debtLeft = debt?.status === "ACTIVE" ? debtRemainingCents(debt) : 0;
    const split = splitRefund(refundCents, debtLeft);
    debtReductionCents = split.debtReductionCents;
    cashCents = split.cashCents;
    if (debt && debtReductionCents > 0) {
      const newAmount = decToCents(debt.amount) - debtReductionCents;
      const repaid = decToCents(debt.repaidAmount);
      const closed = newAmount - repaid <= 0;
      await tx.debt.update({
        where: { id: debt.id },
        data: {
          amount: centsToStr(newAmount),
          // Остаток погашен возвратом: если клиент что-то платил — «погашен»,
          // если нет — долг просто снят.
          ...(closed
            ? repaid > 0
              ? { status: "REPAID" as const, repaidAt: now }
              : { status: "CANCELLED" as const }
            : {}),
        },
      });
    }
  }
  if (hasMoney && cashCents > 0) {
    await recordRefundInTx(tx, {
      saleId: sale.id,
      amountCents: cashCents,
      currency: sale.currency!,
      method: opts.method,
      paidAt: now,
      actorId: actor.id,
      comment: qty.isFull ? "возврат продажи" : "частичный возврат",
    });
  }

  // ── камень: неотгруженное — в остаток сейчас ──
  const restored = await restorePartsInTx(
    tx,
    { batchId, qtySlabs: sale.qtySlabs, qtyAreaM2: sale.qtyAreaM2 },
    immediate,
    opts.destination,
    actor.id,
  );

  // ── задача «К отгрузке» ──
  if (qty.isFull) {
    await cancelOpenShipmentForSale(tx, sale.id, now);
  } else if (ship && !ship.cancelledAt) {
    const after = new Map(
      shipLines.map((l) => [
        l.id,
        {
          targetType: l.targetType as string,
          qtyOrderedSlabs: l.qtyOrderedSlabs,
          qtyOrderedAreaM2: l.qtyOrderedAreaM2 === null ? null : num(l.qtyOrderedAreaM2),
          qtyShippedSlabs: l.qtyShippedSlabs,
          qtyShippedAreaM2: num(l.qtyShippedAreaM2),
        },
      ]),
    );
    for (const p of parts) {
      if (!p.lineId) continue;
      const cur = after.get(p.lineId);
      if (!cur) continue;
      const before = cur.qtyShippedSlabs;
      const next = {
        ...cur,
        qtyOrderedSlabs:
          cur.qtyOrderedSlabs === null ? null : Math.max(0, cur.qtyOrderedSlabs - (p.slabs ?? 0)),
        qtyOrderedAreaM2:
          cur.qtyOrderedAreaM2 === null ? null : Math.max(0, round3(cur.qtyOrderedAreaM2 - (p.areaM2 ?? 0))),
        qtyShippedSlabs: p.shipped ? Math.max(0, cur.qtyShippedSlabs - (p.slabs ?? 0)) : cur.qtyShippedSlabs,
        qtyShippedAreaM2: p.shipped
          ? Math.max(0, round3(cur.qtyShippedAreaM2 - (p.areaM2 ?? 0)))
          : cur.qtyShippedAreaM2,
      };
      // Оптимистично по отгруженному: параллельное «Отгрузить» → CONFLICT.
      const upd = await tx.shipmentLine.updateMany({
        where: { id: p.lineId, qtyShippedSlabs: before },
        data: {
          qtyOrderedSlabs: next.qtyOrderedSlabs,
          qtyOrderedAreaM2: next.qtyOrderedAreaM2 === null ? null : next.qtyOrderedAreaM2.toFixed(3),
          qtyShippedSlabs: next.qtyShippedSlabs,
          qtyShippedAreaM2: next.qtyShippedAreaM2.toFixed(3),
        },
      });
      if (upd.count === 0) bad("CONFLICT", "Отгрузку изменили параллельно — обновите страницу");
      after.set(p.lineId, next);
    }
    // Остаток задачи полностью выдан → задача закрыта.
    if (!ship.completedAt && [...after.values()].every(lineIsFullyShipped)) {
      await tx.shipment.update({ where: { id: ship.id }, data: { completedAt: now } });
    }
  }

  // ── продажа: накопительные возвраты (+ returnedAt у последнего) ──
  const marked = await tx.saleRecord.updateMany({
    where: { id: sale.id, returnedAt: null },
    data: {
      ...(sale.qtySlabs !== null && qty.slabs ? { returnedSlabs: { increment: qty.slabs } } : {}),
      ...(sale.qtyAreaM2 !== null && qty.areaM2
        ? { returnedAreaM2: { increment: qty.areaM2.toFixed(3) } }
        : {}),
      returnedAmount: { increment: centsToStr(qty.isFull ? leftCents : refundCents) },
      ...(qty.isFull ? { returnedAt: now } : {}),
    },
  });
  if (marked.count === 0) bad("ALREADY_RETURNED", "Возврат уже оформлен параллельно — обновите страницу");

  const pendingSlabs = sumSlabs(pending);
  const pendingAreaM2 = sumArea(pending);
  const reason = opts.reason?.trim().slice(0, 500) || null;
  const created = await tx.saleReturn.create({
    data: {
      saleRecordId: sale.id,
      qtySlabs: qty.slabs,
      qtyAreaM2: qty.areaM2 === null ? null : qty.areaM2.toFixed(3),
      refundAmount: centsToStr(refundCents),
      debtReduction: centsToStr(debtReductionCents),
      cashRefund: centsToStr(cashCents),
      method: cashCents > 0 ? opts.method : null,
      destination: opts.destination,
      reason,
      isFull: qty.isFull,
      immediateSlabs: sumSlabs(immediate),
      immediateAreaM2: sumArea(immediate).toFixed(3),
      pendingSlabs,
      pendingAreaM2: pendingAreaM2.toFixed(3),
      parts: parts as unknown as Prisma.InputJsonValue,
      createdById: actor.id,
    },
    select: { id: true },
  });

  await tx.auditLog.create({
    data: {
      userId: actor.id,
      action: "RETURN",
      entityType: "Batch",
      entityId: batchId,
      payload: {
        kind: qty.isFull ? "sale.return" : "sale.partial_return",
        saleId: sale.id,
        saleReturnId: created.id,
        batchPatternId: sale.batchPatternId,
        qtySlabs: qty.slabs,
        qtyAreaM2: qty.areaM2,
        soldSlabs: sale.qtySlabs,
        soldAreaM2: sale.qtyAreaM2 === null ? null : num(sale.qtyAreaM2),
        currency: sale.currency,
        refund: centsToStr(refundCents),
        debtReduction: centsToStr(debtReductionCents),
        cashRefund: centsToStr(cashCents),
        method: cashCents > 0 ? opts.method : null,
        destination: opts.destination,
        immediateSlabs: sumSlabs(immediate),
        immediateAreaM2: sumArea(immediate),
        pendingSlabs,
        pendingAreaM2,
        pieceIds: restored.pieceIds,
        reason,
      },
    },
  });

  return {
    saleId: sale.id,
    saleReturnId: created.id,
    batchId,
    isFull: qty.isFull,
    refundCents,
    debtReductionCents,
    cashCents,
    immediateSlabs: sumSlabs(immediate),
    immediateAreaM2: sumArea(immediate),
    pendingSlabs,
    pendingAreaM2,
  };
}

/** Частичный возврат (кнопка «Оформить возврат» → форма). */
export async function returnSalePartial(input: {
  saleRecordId: string;
  managerId: string;
  opts: VolumeReturnOptions;
}): Promise<({ ok: true } & VolumeReturnResult) | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: input.managerId },
        select: { id: true, role: true, isActive: true },
      });
      if (!actor?.isActive) bad("NOT_FOUND", "Пользователь не найден или отключён");
      const r = await returnVolumeInTx(tx, {
        saleId: input.saleRecordId,
        actor: { id: actor.id, role: actor.role },
        opts: input.opts,
        now: new Date(),
      });
      return { ok: true as const, ...r };
    });
  } catch (e) {
    if (e instanceof ReturnLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

/**
 * «Принять возврат» в «Отгрузках» (§7, §15: владелец, зав. склада, складчик):
 * отгруженная часть возврата физически пришла — счётчики и места назад.
 * Идемпотентно: условная пометка acceptedAt; повтор → ALREADY_RETURNED, остаток
 * второй раз не растёт.
 */
export async function acceptSaleReturn(input: {
  saleReturnId: string;
  actorId: string;
}): Promise<{ ok: true; saleId: string; batchId: string } | SaleFail> {
  try {
    return await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: input.actorId },
        select: { id: true, role: true, isActive: true },
      });
      if (!actor?.isActive) bad("NOT_FOUND", "Пользователь не найден или отключён");
      if (actor.role !== "OWNER" && !isWarehouseRole(actor.role)) {
        bad("FORBIDDEN_ROLE", "Приём возврата подтверждает склад или владелец");
      }
      await tx.$queryRaw`SELECT id FROM "SaleReturn" WHERE id = ${input.saleReturnId} FOR UPDATE`;
      const r = await tx.saleReturn.findUnique({
        where: { id: input.saleReturnId },
        select: {
          id: true,
          saleRecordId: true,
          acceptedAt: true,
          pendingSlabs: true,
          pendingAreaM2: true,
          destination: true,
          parts: true,
        },
      });
      if (!r) bad("NOT_FOUND", "Возврат не найден");
      if (r.acceptedAt) bad("ALREADY_RETURNED", "Этот возврат уже принят складом");
      if (r.pendingSlabs <= 0 && num(r.pendingAreaM2) <= EPS) {
        bad("NOT_RETURNED", "По этому возврату нечего принимать — камень не отгружался");
      }
      const sale = await tx.saleRecord.findUnique({
        where: { id: r.saleRecordId },
        select: { id: true, batchId: true, qtySlabs: true, qtyAreaM2: true },
      });
      if (!sale?.batchId) bad("NOT_FOUND", "Партия продажи не найдена");
      await lockBatchForUpdate(tx, sale.batchId);
      const now = new Date();
      const marked = await tx.saleReturn.updateMany({
        where: { id: r.id, acceptedAt: null },
        data: { acceptedAt: now, acceptedById: actor.id },
      });
      if (marked.count === 0) bad("ALREADY_RETURNED", "Возврат уже принят параллельно — обновите страницу");

      const parts = parseReturnParts(r.parts).filter((p) => p.shipped);
      const restored = await restorePartsInTx(
        tx,
        { batchId: sale.batchId, qtySlabs: sale.qtySlabs, qtyAreaM2: sale.qtyAreaM2 },
        parts,
        r.destination,
        actor.id,
      );
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "RETURN_ACCEPT",
          entityType: "Batch",
          entityId: sale.batchId,
          payload: {
            saleId: sale.id,
            saleReturnId: r.id,
            qtySlabs: r.pendingSlabs > 0 ? r.pendingSlabs : null,
            qtyAreaM2: num(r.pendingAreaM2) > EPS ? num(r.pendingAreaM2) : null,
            destination: r.destination,
            pieceIds: restored.pieceIds,
          },
        },
      });
      return { ok: true as const, saleId: sale.id, batchId: sale.batchId };
    });
  } catch (e) {
    if (e instanceof ReturnLogicError) return { ok: false, error: e.saleError };
    throw e;
  }
}

/** Возвраты, ждущие приёма складом (для «Отгрузок»). Менеджер — только свои продажи. */
export async function listPendingSaleReturns(
  reader: Pick<typeof db, "saleReturn">,
  args: { managerId: string | null; take?: number },
) {
  const rows = await reader.saleReturn.findMany({
    where: {
      acceptedAt: null,
      OR: [{ pendingSlabs: { gt: 0 } }, { pendingAreaM2: { gt: 0 } }],
      ...(args.managerId ? { saleRecord: { managerId: args.managerId } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: args.take ?? 50,
    select: {
      id: true,
      createdAt: true,
      pendingSlabs: true,
      pendingAreaM2: true,
      destination: true,
      reason: true,
      isFull: true,
      parts: true,
      createdBy: { select: { name: true } },
      saleRecord: {
        select: {
          id: true,
          customerName: true,
          soldAt: true,
          qtySlabs: true,
          qtyAreaM2: true,
          batch: { select: { stoneType: { select: { name: true } } } },
          batchPattern: { select: { description: true } },
          site: { select: { name: true } },
        },
      },
    },
  });
  const locIds = [
    ...new Set(
      rows.flatMap((r) =>
        parseReturnParts(r.parts)
          .filter((p) => p.shipped && p.batchLocationId)
          .map((p) => p.batchLocationId!),
      ),
    ),
  ];
  return { rows, locationIds: locIds };
}
