// W1-B — «Поиск камня» vidlar sahifasi: SQL-sahifalash va JS «наличие» filtri
// BITTA joyda, kelishilgan holda.
//
// MUAMMO (page.tsx:95-129 + :256-258 HEAD holatida): SQL `take: PAGE_SIZE + 1`
// filtrdan OLDIN ishlaydi, «наличие» filtri esa (`types.filter(t => t.hasAvailability)`)
// keyin — JS'da. Natijada bo'sh so'rov + o'lchamsiz holatda sahifa 30 ta emas, 7 ta
// yoki 0 ta qator ko'rsatishi mumkin, «Показать ещё» esa baribir turadi
// («Ничего не найдено.» + «Показать ещё» — yolg'on juftlik).
//
// MUHIM (adversarial verifikatsiya xulosasi): HEAD'dagi `nextCursor` XATO EMAS.
// `StoneType.name` @unique (schema.prisma:122), kursor XOM (filtrlanmagan) kesimning
// oxirgi qatoridir — shuning uchun sahifalash monoton va yo'qotishsiz. Bu modul
// o'sha xususiyatni SAQLAYDI: kursor doim skan QILINGAN (consumed) xom qatorlarning
// oxirgisi. Sahifa to'lganda skan aynan o'sha qatorda TO'XTAYDI, shuning uchun
// «oxirgi skan qilingan xom qator» = «oxirgi ko'rinadigan qator» — orasida
// o'tkazib yuboriladigan qator BO'LMAYDI (invariant pastda).
//
// Strategiya (B) — «to'lguncha o'qish» (fetch-until-filled), qattiq chegara bilan.
// (A) — «наличие»ni SQL'ga surish — ISBOTLAB BO'LMAYDI, sabablari:
//   1. hasAvailability `slabsTotalSum > 0` ni tekshiradi, bu partiyalar bo'yicha
//      YIG'INDI; freeRemainderFromAggregate (batch-remainders.ts:90-97) nol bilan
//      CHEGARALAMAYDI → slabsFree manfiy bo'lishi mumkin. Demak `Σ > 0` ni
//      `EXISTS(batch: free > 0)` ga ajratib bo'lmaydi: {+2, −3} → Σ = −1 (false),
//      EXISTS → true. Ular AYNAN BIR XIL to'plam bermaydi.
//   2. areaFreeM2 null-maydonli plitalar uchun `areaTotalM2 / slabsTotal` o'rtacha
//      fallback'ini ishlatadi (batch-remainders.ts:102-105) — JS IEEE-754 bo'linishi
//      Postgres NUMERIC arifmetikasi bilan `> 0` chegarasida mos kelishi
//      kafolatlanmagan.
//   3. Prisma query API relatsiya bo'yicha HISOBLANGAN agregat ustidan filtrlay
//      olmaydi; `$queryRaw` kerak bo'lardi, uni esa tekshirib bo'lmaydi
//      (DATABASE_URL = prod, ulanish taqiqlangan).
// Shuning uchun (B): «наличие» predikati AYNAN bugungi JS kodi (page.tsx:231-235)
// bo'lib qoladi, faqat u endi sahifa to'lguncha takrorlanadigan skan ichida turadi.
import type { PrismaClient } from "@prisma/client";
import { materialWhere } from "./poisk-search";
import type {
  BatchRemainderAggregate,
  BatchReservationHold,
} from "./batch-remainders";
import {
  EMPTY_AGGREGATE,
  EMPTY_HOLD,
  freeRemainderFromAggregate,
  getBatchRemainders,
  getBatchReservationHolds,
} from "./batch-remainders";

/**
 * Bitta chaqiruvda DB'dan o'qiladigan vid qatorlarining QATTIQ chegarasi
 * (strategiya (B) talab qiladigan bound). Chegaraga yetilganda skan to'xtaydi va
 * natija `truncated: true` bilan qaytadi — shu paytgacha topilgani ko'rsatiladi,
 * kursor esa oxirgi o'qilgan qatorda qoladi (hech narsa o'tkazib yuborilmaydi).
 *
 * Nega 1000: /poisk arxivlanmagan vidlar bo'yicha ishlaydi. Katalogda 1000 tadan
 * kam arxivlanmagan vid bo'lsa — chegaraga UMUMAN yetib bo'lmaydi (skan avval
 * tugaydi), ya'ni bu masshtabda modul so'zsiz to'liq sahifa yoki halol
 * «oxirgi sahifa» beradi.
 */
export const POISK_MAX_SCAN_ROWS = 1000;

/** Prisma Decimal — runtime'da import qilinmaydi, struktura bo'yicha. */
type DecimalLike = { toString(): string };

/** Prisma Decimal | null → number | null (page.tsx:60-62 bilan bir xil). */
function toNum(d: DecimalLike | null): number | null {
  return d === null ? null : Number(d.toString());
}

/** /poisk kartochkasi uchun kerakli partiya maydonlari (page.tsx:110-123). */
export interface PoiskBatchRow {
  id: string;
  slabsTotal: number | null;
  areaTotalM2: DecimalLike | null;
  slabsAdjusted: number;
  areaAdjustedM2: DecimalLike;
  slabsSoldDirect: number;
  areaSoldDirectM2: DecimalLike;
  _count: { patterns: number };
}

/** /poisk kartochkasi uchun kerakli vid maydonlari (page.tsx:105-124). */
export interface PoiskStoneTypeRow {
  id: string;
  name: string;
  rockType: string;
  color: string | null;
  batches: PoiskBatchRow[];
}

/**
 * Bitta vid kartochkasining tayyor ma'lumotlari — page.tsx:237-253 qaytaradigan
 * obyekt bilan MAYDONMA-MAYDON bir xil (o'sha nomlar, o'sha semantika).
 */
export interface PoiskTypeRow {
  st: PoiskStoneTypeRow;
  slabsTotalSum: number;
  slabsFreeSum: number;
  reservedSlabsSum: number;
  slabsKnown: boolean;
  slabsUnknown: boolean;
  areaTotalSum: number;
  areaFreeSum: number;
  reservedAreaSum: number;
  areaKnown: boolean;
  areaUnknown: boolean;
  countedSlabs: number;
  countedPieces: number;
  patternsCount: number;
  hasAvailability: boolean;
  /**
   * §3 remainder went negative (before display clamp) — data inconsistency.
   * UI shows «требует проверки»; free numbers stay clamped ≥ 0.
   */
  remainderNegative: boolean;
}

export interface FetchPoiskTypesPageArgs {
  /** Material so'rovi (вид/тип/цвет). Bo'sh satr = filtr yo'q. */
  q: string;
  /** Gabarit (l va w ikkalasi ham berilgan) — page.tsx:88 `hasDims`. */
  hasDims: boolean;
  /** Keyset kursori: `name > after`. Bo'sh satr = birinchi sahifa. */
  after: string;
  /** Bitta sahifadagi KO'RINADIGAN vidlar soni (page.tsx PAGE_SIZE). */
  pageSize: number;
  /** Bron muddatini tekshirish momenti (page.tsx:137 `now`). */
  now?: Date;
  /** Strategiya (B) chegarasi — test uchun pasaytiriladi. */
  maxScanRows?: number;
}

export interface PoiskTypesPage {
  /**
   * Ko'rsatiladigan vidlar. Invariant: `hasMore === true && truncated === false`
   * bo'lsa — uzunligi AYNAN `pageSize` (qisqa sahifa + «Показать ещё» mumkin emas).
   */
  types: PoiskTypeRow[];
  /**
   * `nextCursor`dan KEYIN yana kamida bitta XOM (filtrlanmagan) vid qatori bormi.
   * Semantika HEAD bilan bir xil — xom qatorlar bo'yicha, ko'rinadiganlar bo'yicha emas.
   */
  hasMore: boolean;
  /**
   * Keyingi sahifa boshlanadigan nuqta — skan QILINGAN (consumed) xom qatorlarning
   * OXIRGISINING `name`i. Ko'rinadigan qatordan olinmaydi (u xom kesimning oxiridan
   * oldin bo'lsa, oradagi qatorlar qayta-qayta o'qilaverardi).
   *
   * INVARIANT: `nextCursor !== null` ⟺ `hasMore === true` (HEAD, page.tsx:129 kabi).
   * Bu MAJBURIY: «Показать ещё» bloki (page.tsx:526) `hasMore`ga emas, aynan
   * `nextCursor`ga qaraydi — null bo'lmagan kursor + hasMore=false «o'lik» havola
   * bo'lardi.
   */
  nextCursor: string | null;
  /** Shu chaqiruvda DB'dan o'qilgan XOM vid qatorlari soni (≤ maxScanRows). */
  scannedRows: number;
  /**
   * `true` → sahifa to'lmasidan skan chegarasi (maxScanRows) tugadi. Bu YAGONA
   * holatda `types.length < pageSize` va `hasMore === true` birga bo'lishi mumkin.
   */
  truncated: boolean;
}

/**
 * Vidlar so'rovining `where`i — page.tsx:96-102 bilan AYNAN bir xil manba.
 * Alohida eksport: /poisk sahifasi va bu modul bir xil filtrni ishlatishini test
 * qatorma-qator tekshira oladi (drift yo'q).
 */
export function poiskTypesWhere(q: string, after: string) {
  return {
    isArchived: false,
    ...(materialWhere(q) ?? {}),
    ...(after ? { name: { gt: after } } : {}),
  };
}

/** Xom vid qatorlarini kursor bo'yicha o'qiydi (page.tsx:95-125 so'rovi). */
async function fetchTypeRows(
  db: PrismaClient,
  q: string,
  after: string,
  take: number,
): Promise<PoiskStoneTypeRow[]> {
  return db.stoneType.findMany({
    where: poiskTypesWhere(q, after),
    orderBy: { name: "asc" },
    take,
    select: {
      id: true,
      name: true,
      rockType: true,
      color: true,
      batches: {
        orderBy: { arrivedAt: "asc" },
        select: {
          id: true,
          slabsTotal: true,
          areaTotalM2: true,
          slabsAdjusted: true,
          areaAdjustedM2: true,
          slabsSoldDirect: true,
          areaSoldDirectM2: true,
          // ТЗ №3 / §4 — сколько узор-подгрупп в партии (индикатор «раскрыть»).
          _count: { select: { patterns: true } },
        },
      },
    },
  });
}

/** `cursor`dan keyin yana xom qator bormi (bitta yengil so'rov). */
async function hasTypeAfter(
  db: PrismaClient,
  q: string,
  cursor: string,
): Promise<boolean> {
  const row = await db.stoneType.findFirst({
    where: poiskTypesWhere(q, cursor),
    orderBy: { name: "asc" },
    select: { id: true },
  });
  return row !== null;
}

/**
 * SOF funksiya: xom vid qatorlari + agregatlar → kartochka qatorlari.
 * Mantiq page.tsx:172-254 dan QATORMA-QATOR ko'chirilgan — jumladan
 * `hasAvailability` ta'rifi (page.tsx:231-235). Uni QAYTA TA'RIFLAMANG:
 * bron (holds) `hasAvailability`ga TA'SIR QILMAYDI — u bronlardan OLDINGI
 * jamiga qaraydi; holds faqat ko'rsatiladigan «свободно / в брони» raqamlarига.
 */
export function buildTypeRows(
  rows: readonly PoiskStoneTypeRow[],
  remainders: ReadonlyMap<string, BatchRemainderAggregate>,
  holds: ReadonlyMap<string, BatchReservationHold>,
  slabCountMap: ReadonlyMap<string, number>,
  pieceCountMap: ReadonlyMap<string, number>,
): PoiskTypeRow[] {
  return rows.map((st) => {
    let slabsTotalSum = 0;
    let reservedSlabsSum = 0;
    let slabsKnown = false;
    let slabsUnknown = false;
    let areaTotalSum = 0;
    let reservedAreaSum = 0;
    let areaKnown = false;
    let areaUnknown = false;
    let remainderNegative = false;
    for (const b of st.batches) {
      const agg = remainders.get(b.id) ?? EMPTY_AGGREGATE;
      const hold = holds.get(b.id) ?? EMPTY_HOLD;
      const free = freeRemainderFromAggregate(
        {
          slabsTotal: b.slabsTotal,
          areaTotalM2: toNum(b.areaTotalM2),
          slabsAdjusted: b.slabsAdjusted,
          areaAdjustedM2: Number(b.areaAdjustedM2),
          slabsSoldDirect: b.slabsSoldDirect,
          areaSoldDirectM2: Number(b.areaSoldDirectM2),
        },
        agg,
      );
      if (free.slabsFree === null) slabsUnknown = true;
      else {
        slabsKnown = true;
        if (free.slabsFree < 0) remainderNegative = true;
        slabsTotalSum += free.slabsFree;
        reservedSlabsSum += hold.reservedSlabs;
      }
      if (free.areaFreeM2 === null) areaUnknown = true;
      else {
        areaKnown = true;
        if (free.areaFreeM2 < 0) remainderNegative = true;
        areaTotalSum += free.areaFreeM2;
        reservedAreaSum += hold.reservedAreaM2;
      }
    }

    // Erkin = max(0, jami − band) — invariant buzilsa ham manfiy ko'rsatilmaydi.
    const unclampedSlabs = slabsTotalSum - reservedSlabsSum;
    const unclampedArea = areaTotalSum - reservedAreaSum;
    if (slabsKnown && unclampedSlabs < 0) remainderNegative = true;
    if (areaKnown && unclampedArea < 0) remainderNegative = true;
    const slabsFreeSum = Math.max(0, unclampedSlabs);
    const areaFreeSum = Math.max(0, unclampedArea);

    // needsCheck birliklari sonlarga KIRMAYDI (TZ §7.4), lekin naliche summasida.
    const countedSlabs = slabCountMap.get(st.id) ?? 0;
    const countedPieces = pieceCountMap.get(st.id) ?? 0;

    // ТЗ №3 / §4 — узор-подгрупп по всем партиям вида (B2C: «раскрыть узоры»).
    const patternsCount = st.batches.reduce(
      (sum, b) => sum + b._count.patterns,
      0,
    );

    const hasAvailability =
      slabsTotalSum > 0 ||
      areaTotalSum > 0 ||
      countedSlabs > 0 ||
      countedPieces > 0;

    return {
      st,
      slabsTotalSum,
      slabsFreeSum,
      reservedSlabsSum,
      slabsKnown,
      slabsUnknown,
      areaTotalSum,
      areaFreeSum,
      reservedAreaSum,
      areaKnown,
      areaUnknown,
      countedSlabs,
      countedPieces,
      patternsCount,
      hasAvailability,
      remainderNegative,
    };
  });
}

/** Bitta bo'lak xom qator uchun agregatlarni oladi (page.tsx:131-170). */
async function enrichTypeRows(
  db: PrismaClient,
  rows: readonly PoiskStoneTypeRow[],
  now: Date,
): Promise<PoiskTypeRow[]> {
  const typeIds = rows.map((t) => t.id);
  const batchIds = rows.flatMap((t) => t.batches.map((b) => b.id));

  const [remainders, holds, slabCounts, pieceCounts] = await Promise.all([
    getBatchRemainders(db, batchIds),
    getBatchReservationHolds(db, batchIds, now),
    typeIds.length > 0
      ? db.slab.groupBy({
          by: ["stoneTypeId"],
          where: {
            stoneTypeId: { in: typeIds },
            status: "AVAILABLE",
            needsCheck: false,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    typeIds.length > 0
      ? db.piece.groupBy({
          by: ["stoneTypeId"],
          where: {
            stoneTypeId: { in: typeIds },
            status: "AVAILABLE",
            needsCheck: false,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const slabCountMap = new Map(
    slabCounts.map((g) => [g.stoneTypeId, g._count._all]),
  );
  const pieceCountMap = new Map(
    pieceCounts.map((g) => [g.stoneTypeId, g._count._all]),
  );

  return buildTypeRows(rows, remainders, holds, slabCountMap, pieceCountMap);
}

/**
 * Bitta sahifa KO'RINADIGAN vidlarni oladi.
 *
 * Algoritm (strategiya (B)): kursordan boshlab xom qatorlar bo'laklab o'qiladi
 * (birinchi bo'lak — `pageSize + 1`, ya'ni HEAD'dagi so'rovning AYNAN o'zi, keyin
 * ikki barobar o'sadi → chegaragacha ≤ 6 iteratsiya), har bir bo'lak page.tsx
 * agregatlari bilan boyitiladi va o'sha JS predikati qo'llanadi. Skan `pageSize`
 * ko'rinadigan qator to'plangan qatorda TO'XTAYDI.
 *
 * INVARIANT (nega o'tkazib yuborish yo'q): skan har doim kursordan keyingi xom
 * qatorlarning UZLUKSIZ prefiksini iste'mol qiladi, `nextCursor` esa o'sha
 * prefiksning oxirgi qatoridir. Demak `nextCursor`dan keyin hech qachon
 * o'qilmagan-yu tashlab yuborilgan qator qolmaydi.
 *   • sahifa to'lgan holat: prefiks aynan `pageSize`-chi ko'rinadigan qatorda
 *     tugaydi → oxirgi iste'mol qilingan qator = oxirgi ko'rinadigan qator;
 *   • chegara (truncated) holati: prefiks oxirida ko'rinmaydigan qatorlar bo'lishi
 *     mumkin, lekin ular ta'rifi bo'yicha KO'RSATILMAYDIGANLAR — oxirgi ko'rinadigan
 *     qatordan keyin ko'rinadigan qator bo'lganida u to'plamga tushgan bo'lardi.
 *
 * HAMMASI HEAD bilan bir xil qoladigan joylar: `where` (poiskTypesWhere),
 * tartib (`name asc`), `hasAvailability` ta'rifi, `hasMore` semantikasi (xom
 * qatorlar bo'yicha) va `q`/gabarit bo'lganda filtr QO'LLANMASLIGI.
 */
export async function fetchPoiskTypesPage(
  db: PrismaClient,
  args: FetchPoiskTypesPageArgs,
): Promise<PoiskTypesPage> {
  const {
    q,
    hasDims,
    after,
    pageSize,
    now = new Date(),
    maxScanRows = POISK_MAX_SCAN_ROWS,
  } = args;

  if (pageSize < 1) {
    return {
      types: [],
      hasMore: false,
      nextCursor: null,
      scannedRows: 0,
      truncated: false,
    };
  }

  // Talab №2 (page.tsx:256-258): «наличие» filtri FAQAT bo'sh so'rov + o'lchamsiz
  // holatda. Boshqa hollarda xatti-harakat bugungidek — filtrsiz.
  const filterByAvailability = !q && !hasDims;

  const collected: PoiskTypeRow[] = [];
  let cursor = after;
  let scannedRows = 0;
  let consumedRows = 0;
  let exhausted = false;
  /** Sahifa to'lgan xom qatorning nomi (to'lmagan bo'lsa — null). */
  let filledAt: string | null = null;
  /** Kesim nuqtasidan keyin AYNI bo'lakda yana qator ko'ringanmi. */
  let moreSeenInChunk = false;
  let chunkSize = pageSize + 1;

  while (
    collected.length < pageSize &&
    scannedRows < maxScanRows &&
    !exhausted
  ) {
    const take = Math.min(chunkSize, maxScanRows - scannedRows);
    const rows = await fetchTypeRows(db, q, cursor, take);
    scannedRows += rows.length;
    // So'ralgandan kam qaytdi → kursordan keyingi qatorlar tugadi.
    if (rows.length < take) exhausted = true;
    if (rows.length === 0) break;

    const enriched = await enrichTypeRows(db, rows, now);
    for (let i = 0; i < enriched.length; i++) {
      const t = enriched[i];
      consumedRows++;
      cursor = t.st.name; // iste'mol qilingan OXIRGI xom qator
      if (!filterByAvailability || t.hasAvailability) collected.push(t);
      if (collected.length === pageSize) {
        filledAt = t.st.name;
        moreSeenInChunk = i + 1 < enriched.length;
        break;
      }
    }

    chunkSize *= 2;
  }

  if (filledAt !== null) {
    const hasMore =
      moreSeenInChunk || (!exhausted && (await hasTypeAfter(db, q, filledAt)));
    return {
      types: collected,
      hasMore,
      // Kursor faqat davom etadigan bo'lsa beriladi (invariant: ⟺ hasMore).
      nextCursor: hasMore ? filledAt : null,
      scannedRows,
      truncated: false,
    };
  }

  if (exhausted) {
    // Qatorlar tugadi — bu OXIRGI sahifa. «Показать ещё» ko'rsatilmaydi, shuning
    // uchun «Ничего не найдено.» + «Показать ещё» juftligi endi imkonsiz.
    return {
      types: collected,
      hasMore: false,
      nextCursor: null,
      scannedRows,
      truncated: false,
    };
  }

  // Skan chegarasi sahifa to'lmasdan tugadi. Bor narsani ko'rsatamiz va kursorni
  // o'qilgan oxirgi qatorda qoldiramiz — qolgani keyingi sahifada ochiladi
  // (yashirib qo'yishdan ko'ra ko'rsatib qo'yish afzal).
  const lastConsumed = consumedRows > 0 ? cursor : null;
  const hasMore =
    lastConsumed !== null && (await hasTypeAfter(db, q, lastConsumed));
  return {
    types: collected,
    hasMore,
    nextCursor: hasMore ? lastConsumed : null,
    scannedRows,
    truncated: true,
  };
}

// ──────────────────── W6-A — boy/qoldiq ranking (§6.5) ────────────────────

/**
 * Display/ranking key for «продать остатки первыми»: bounding rectangle area
 * (mm²). Always defined — `boundingLengthMm` / `boundingWidthMm` are NOT NULL
 * on Piece (schema.prisma). Independent of nullable `areaM2`.
 */
export function pieceBoundingAreaMm2(
  boundingLengthMm: number,
  boundingWidthMm: number,
): number {
  return boundingLengthMm * boundingWidthMm;
}

export interface RankablePiece {
  id: string;
  boundingLengthMm: number;
  boundingWidthMm: number;
}

export interface RankAndCapResult<T> {
  /** Top `max` by bounding area ASC (id tie-break) — display order. */
  ranked: T[];
  /** True iff input had more than `max` rows (some did not make the list). */
  capped: boolean;
  /** Full matching set size before cap. */
  total: number;
}

/**
 * W6-A / W6-A2 — rank pieces by the **display** key (L×W), then cap.
 *
 * Page query (W6-A2): SQL `ORDER BY boundingAreaMm2 ASC, id ASC`
 * `take: max + 1` on the generated column (= L×W). This function re-applies
 * the same key + id tie-break on that bounded prefix and sets `capped` from
 * the +1 probe — so UI order matches SQL and behaviour stays stable if the
 * caller ever passes an unsorted bag (unit tests).
 *
 * Do **not** pre-cap by `areaM2` (old bug): different key, NULLS LAST.
 * `areaM2` is ignored here (nullable; real polygon area ≠ bounding box).
 */
export function rankAndCapFittingPieces<T extends RankablePiece>(
  rows: readonly T[],
  max: number,
): RankAndCapResult<T> {
  if (max < 0) {
    throw new Error("rankAndCapFittingPieces: max must be ≥ 0");
  }
  const sorted = [...rows].sort((a, b) => {
    const da = pieceBoundingAreaMm2(a.boundingLengthMm, a.boundingWidthMm);
    const db = pieceBoundingAreaMm2(b.boundingLengthMm, b.boundingWidthMm);
    return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const capped = sorted.length > max;
  return {
    ranked: capped ? sorted.slice(0, max) : sorted,
    capped,
    total: sorted.length,
  };
}
