// BATCH-B (perf) — partiya erkin qoldig'ini AGGREGAT bo'yicha hisoblash.
// Old kod har bir partiya uchun BARCHA plita/boy qatorlarini xotiraga tortib,
// keyin JS'da yig'ardi (real masshtabda muzlash). Bu yerda o'sha qatorlar
// SQL agregatlariga (COUNT + SUM areaM2) almashtiriladi.
//
// MUHIM: natija src/lib/inventory.ts §3 formulasi bilan BIR XIL bo'lishi shart.
// `computeFreeRemainder` separatedSlabs/directPieces massivlaridan FAQAT quyidagini
// oladi: (1) count, (2) Σ areaM2 (null bo'lmaganlar), (3) null-areaM2 qatorlar soni
// (o'rtacha-fallback uchun). freeRemainderFromAggregate aynan shu uch qiymatdan
// computeFreeRemainder bilan bir xil formulani qayta hisoblaydi — pastdagi test
// har ikki yo'l teng ekanini isbotlaydi.
import type { PrismaClient } from "@prisma/client";
import type { BatchTotalsInput, FreeRemainder } from "./inventory";

/**
 * Bitta partiya uchun SQL agregatlari (row-fetch o'rniga).
 * - slab*: partiyaning AJRATILGAN plitalari (HAR QANDAY statusda — §3 formulasi
 *   ularni statusdan qat'i nazar minus qiladi; old kod `slabs: true` bilan hammasini
 *   olardi).
 * - piece*: partiyadan TO'G'RIDAN-TO'G'RI chiqqan boy (originSlabId IS NULL) — plitadan
 *   chiqqanlar (§3) formulaga KIRMAYDI, shuning uchun filtr shu.
 */
export interface BatchRemainderAggregate {
  slabCount: number;
  slabAreaSum: number;
  slabNullAreaCount: number;
  pieceCount: number;
  pieceAreaSum: number;
  pieceNullAreaCount: number;
}

/** Hech nima ajratilmagan partiya (map'da yo'q partiya uchun default). */
export const EMPTY_AGGREGATE: BatchRemainderAggregate = {
  slabCount: 0,
  slabAreaSum: 0,
  slabNullAreaCount: 0,
  pieceCount: 0,
  pieceAreaSum: 0,
  pieceNullAreaCount: 0,
};

/** Prisma Decimal | null → number (null → 0). */
function decToNum(d: { toString(): string } | null | undefined): number {
  return d === null || d === undefined ? 0 : Number(d.toString());
}

/**
 * Row massivlaridan agregat quradi. Sof funksiya — test uchun (row-yo'l bilan
 * aggregat-yo'lni bir xil kirishdan qurish) va agregatni tushunish uchun hujjat.
 */
export function aggregateFromRows(
  separatedSlabs: readonly { areaM2: number | null }[],
  directPieces: readonly { areaM2: number | null }[],
): BatchRemainderAggregate {
  let slabAreaSum = 0;
  let slabNullAreaCount = 0;
  for (const s of separatedSlabs) {
    if (s.areaM2 === null) slabNullAreaCount++;
    else slabAreaSum += s.areaM2;
  }
  let pieceAreaSum = 0;
  let pieceNullAreaCount = 0;
  for (const p of directPieces) {
    if (p.areaM2 === null) pieceNullAreaCount++;
    else pieceAreaSum += p.areaM2;
  }
  return {
    slabCount: separatedSlabs.length,
    slabAreaSum,
    slabNullAreaCount,
    pieceCount: directPieces.length,
    pieceAreaSum,
    pieceNullAreaCount,
  };
}

/**
 * §3 formulasining agregatdan hisoblanadigan varianti. computeFreeRemainder
 * bilan BIR XIL natija beradi:
 *   - separatedSlabs.length     → agg.slabCount
 *   - directPieces.length       → agg.pieceCount
 *   - Σ(slab.areaM2 ?? avg)     → agg.slabAreaSum + agg.slabNullAreaCount * avg
 *   - Σ(piece.areaM2 ?? 0)      → agg.pieceAreaSum   (null → 0)
 * (mantiq inventory.ts computeFreeRemainder bilan qatorma-qator ko'zgu.)
 */
export function freeRemainderFromAggregate(
  batch: BatchTotalsInput,
  agg: BatchRemainderAggregate,
): FreeRemainder {
  const slabsFree =
    batch.slabsTotal === null
      ? null
      : batch.slabsTotal +
        batch.slabsAdjusted -
        batch.slabsSoldDirect -
        agg.slabCount -
        agg.pieceCount;

  let areaFreeM2: number | null = null;
  if (batch.areaTotalM2 !== null) {
    const avgSlabAreaM2 =
      batch.slabsTotal !== null && batch.slabsTotal > 0
        ? batch.areaTotalM2 / batch.slabsTotal
        : 0;
    const slabsAreaM2 = agg.slabAreaSum + agg.slabNullAreaCount * avgSlabAreaM2;
    const piecesAreaM2 = agg.pieceAreaSum;
    areaFreeM2 =
      batch.areaTotalM2 +
      batch.areaAdjustedM2 -
      batch.areaSoldDirectM2 -
      slabsAreaM2 -
      piecesAreaM2;
  }

  return { slabsFree, areaFreeM2 };
}

/**
 * DB agregati: partiyalar bo'yicha COUNT + SUM(areaM2) ni ikkita groupBy so'rovda
 * oladi (BARCHA plita/boy qatorlarini tortmasdan). Natija — batchId → agregat map.
 * Map'da bo'lmagan partiya = hech nima ajratilmagan (EMPTY_AGGREGATE ishlating).
 */
export async function getBatchRemainders(
  db: PrismaClient,
  batchIds: string[],
): Promise<Map<string, BatchRemainderAggregate>> {
  const result = new Map<string, BatchRemainderAggregate>();
  if (batchIds.length === 0) return result;

  // Ajratilgan plitalar (har qanday status) va to'g'ridan-to'g'ri boy (originSlabId IS
  // NULL) — old kodning massiv qurish filtrlariga aynan mos.
  const [slabGroups, pieceGroups] = await Promise.all([
    db.slab.groupBy({
      by: ["batchId"],
      where: { batchId: { in: batchIds } },
      _count: { _all: true, areaM2: true },
      _sum: { areaM2: true },
    }),
    db.piece.groupBy({
      by: ["batchId"],
      where: { batchId: { in: batchIds }, originSlabId: null },
      _count: { _all: true, areaM2: true },
      _sum: { areaM2: true },
    }),
  ]);

  for (const id of batchIds) result.set(id, { ...EMPTY_AGGREGATE });

  for (const g of slabGroups) {
    const agg = result.get(g.batchId);
    if (!agg) continue;
    agg.slabCount = g._count._all;
    agg.slabAreaSum = decToNum(g._sum.areaM2);
    // _count.areaM2 = null bo'lmagan areaM2 qatorlar → null'lar = _all − shu.
    agg.slabNullAreaCount = g._count._all - g._count.areaM2;
  }

  for (const g of pieceGroups) {
    // Piece.batchId nullable — filtr null'larni chiqargan, lekin tip string | null.
    if (g.batchId === null) continue;
    const agg = result.get(g.batchId);
    if (!agg) continue;
    agg.pieceCount = g._count._all;
    agg.pieceAreaSum = decToNum(g._sum.areaM2);
    agg.pieceNullAreaCount = g._count._all - g._count.areaM2;
  }

  return result;
}

// ─────────────── BUG-03: BATCH_VOLUME bronlarning band qoldig'i ───────────────
// §3 formula (freeRemainderFromAggregate) faqat AJRATILGAN plita/boyni minus qiladi —
// hajm broni (BATCH_VOLUME) hech qanday birlik statusiga tegmaydi, shuning uchun
// qoldiqdan ALOHIDA ayirilishi kerak. /bron buni qiladi, /poisk esa qilmasdi
// («jami 10, bronda 2» bo'lsa ham «bo'sh 10» ko'rsatardi). Bu yerdagi helper o'sha
// bo'shliqni to'ldiradi. (Par.: reservations.sumActiveVolumeHolds — bitta partiya
// varianti; bu yerda partiyalar bo'yicha map.)

/** Bitta partiya bo'yicha faol volume-bronlarning band yig'indisi. */
export interface BatchReservationHold {
  reservedSlabs: number;
  reservedAreaM2: number;
}

/** Faol volume-broni yo'q partiya (map'da yo'q partiya uchun default). */
export const EMPTY_HOLD: BatchReservationHold = {
  reservedSlabs: 0,
  reservedAreaM2: 0,
};

/**
 * Sof funksiya: faol BATCH_VOLUME bron qatorlari → partiya bo'yicha band qoldiq map.
 * Muddati o'tganlar (expiresAt <= now) CHIQARILADI — sweep hali yopmagan bo'lsa ham
 * ular aslida bo'sh va yangi/ko'rsatiladigan qoldiqni kesmasligi kerak (aks holda
 * hold «osilib» qoladi, kimdir /bron ochib sweep ishga tushirmaguncha).
 * qtySlabs/qtyAreaM2 null → 0 (o'sha o'lchov bron qilinmagan). Test uchun DB-siz.
 */
export function reservationHoldsFromRows(
  rows: readonly {
    batchId: string | null;
    qtySlabs: number | null;
    qtyAreaM2: number | null;
    expiresAt: Date;
  }[],
  now: Date,
): Map<string, BatchReservationHold> {
  const result = new Map<string, BatchReservationHold>();
  for (const r of rows) {
    if (r.batchId === null) continue;
    if (r.expiresAt.getTime() <= now.getTime()) continue; // muddati o'tgan — bo'sh
    const cur = result.get(r.batchId) ?? { reservedSlabs: 0, reservedAreaM2: 0 };
    cur.reservedSlabs += r.qtySlabs ?? 0;
    cur.reservedAreaM2 += r.qtyAreaM2 ?? 0;
    result.set(r.batchId, cur);
  }
  return result;
}

/**
 * DB: partiyalar bo'yicha faol BATCH_VOLUME bronlarning band qoldig'i
 * (batchId → {reservedSlabs, reservedAreaM2}). Filtr SQL'da: status ACTIVE,
 * targetType BATCH_VOLUME, expiresAt > now (getBatchRemainders uslubida). Qolgan
 * qatorlar sof reducerdan o'tadi (expiry filtri u yerda ham qayta qo'llanadi —
 * arzon himoya). Map'da bo'lmagan partiya = faol volume-bron yo'q (EMPTY_HOLD).
 */
export async function getBatchReservationHolds(
  db: PrismaClient,
  batchIds: string[],
  now: Date = new Date(),
): Promise<Map<string, BatchReservationHold>> {
  if (batchIds.length === 0) return new Map();

  const rows = await db.reservation.findMany({
    where: {
      status: "ACTIVE",
      targetType: "BATCH_VOLUME",
      batchId: { in: batchIds },
      expiresAt: { gt: now },
    },
    select: { batchId: true, qtySlabs: true, qtyAreaM2: true, expiresAt: true },
  });

  const resHolds = reservationHoldsFromRows(
    rows.map((r) => ({
      batchId: r.batchId,
      qtySlabs: r.qtySlabs,
      qtyAreaM2: decToNum(r.qtyAreaM2), // Decimal | null → number (null → 0)
      expiresAt: r.expiresAt,
    })),
    now,
  );

  // TZ №10: active BATCH_VOLUME samples hold free stock like reservations.
  // Sample model may be absent on old clients — optional chaining via try.
  let sampleHolds = new Map<string, BatchReservationHold>();
  try {
    const samples = await db.sample.findMany({
      where: {
        status: "ACTIVE",
        targetType: "BATCH_VOLUME",
        batchId: { in: batchIds },
      },
      select: { batchId: true, qtySlabs: true, qtyAreaM2: true },
    });
    sampleHolds = reservationHoldsFromRows(
      samples.map((s) => ({
        batchId: s.batchId,
        qtySlabs: s.qtySlabs,
        qtyAreaM2: decToNum(s.qtyAreaM2),
        expiresAt: new Date(now.getTime() + 86400000), // never expire as hold
      })),
      now,
    );
  } catch {
    // prisma client without Sample (pre-generate) — ignore
  }

  return mergeVolumeHolds(resHolds, sampleHolds);
}


/** Merge reservation holds + sample holds (same shape). */
export function mergeVolumeHolds(
  a: ReadonlyMap<string, BatchReservationHold>,
  b: ReadonlyMap<string, { reservedSlabs: number; reservedAreaM2: number }>,
): Map<string, BatchReservationHold> {
  const out = new Map<string, BatchReservationHold>();
  const keys = new Set<string>([...a.keys(), ...b.keys()]);
  for (const id of keys) {
    const x = a.get(id) ?? EMPTY_HOLD;
    const y = b.get(id) ?? EMPTY_HOLD;
    out.set(id, {
      reservedSlabs: x.reservedSlabs + y.reservedSlabs,
      reservedAreaM2: x.reservedAreaM2 + y.reservedAreaM2,
    });
  }
  return out;
}
