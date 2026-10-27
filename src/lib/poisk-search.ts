// S1-E — «Поиск камня» so'rovlari uchun sof (DB'siz) where-quruvchilar.
// BUG-FIX (§5.2 / §6.5): «Бой и остатки — предложить первыми» bloki gabarit bilan
// birga MATERIAL (вид/тип/цвет) filtrini ham hisobga olishi kerak. Ilgari boy so'rovi
// faqat status + gabarit bo'yicha filtrlanardi — natijada menejer «мрамор» + o'lcham
// so'raganda BOSHQA vid (оникс, гранит…) qoldiqlari ham chiqib qolardi, holbuki
// pastdagi butun plita ro'yxati material bo'yicha filtrlangan (mos kelmaslik).
//
// Bu yerdagi funksiyalar sof — faqat `type Prisma` import qilinadi (runtime'da
// o'chib ketadi), shuning uchun Prisma klientini yuklamaydi va unit-test qilinadi
// (par.: src/tests/poisk-search.test.ts).
import type { Prisma } from "@prisma/client";
// ТЗ №19: чистые модули (без Prisma-клиента) — тестируется без БД.
import { formatGabarit, thicknessToNumber } from "./dimensions";
import { pieceFitsRequest } from "./inventory";
import { formatLocationsShort, locationsForPattern } from "./pattern-stock";

/**
 * Material (вид/тип/цвет) OR-filtri — `q` bo'yicha name/rockType/color
 * (registrga befarq). `q` bo'sh bo'lsa `null` (filtr yo'q). Butun plita
 * (stoneType) va boy (piece.stoneType relatsiyasi) so'rovlarida BIR XIL manba
 * sifatida ishlatiladi — ikkisi doim sinxron qoladi.
 */
export function materialWhere(q: string): Prisma.StoneTypeWhereInput | null {
  if (!q) return null;
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { rockType: { contains: q, mode: "insensitive" } },
      { color: { contains: q, mode: "insensitive" } },
    ],
  };
}

/**
 * «Предложить первыми» boy/qoldiq so'rovining where'i.
 *  - status = AVAILABLE;
 *  - stoneType arxivlanmagan + (agar `q` bo'lsa) material OR-filtri
 *    relatsiya orqali qo'llanadi — boshqa vid qoldiqlari chiqmaydi;
 *  - gabarit: dopusk + 90° burish ekvivalenti (needMax/needMin chaqiruvchi
 *    tomonda CUTTING_MARGIN_MM bilan hisoblangan):
 *      (L≥needMax ∧ W≥needMin) ∨ (L≥needMin ∧ W≥needMax).
 * `q` bo'sh bo'lsa (faqat o'lcham qidiruvi) — material filtri qo'llanmaydi,
 * barcha mos qoldiqlar ko'rsatiladi (eski xatti-harakat saqlanadi).
 */
export function piecesWhere(
  q: string,
  needMax: number,
  needMin: number,
): Prisma.PieceWhereInput {
  const mat = materialWhere(q);
  return {
    // Ordinary free stock only — SHOWROOM not offered as ordinary remainder.
    status: "AVAILABLE",
    stoneType: { isArchived: false, ...(mat ?? {}) },
    OR: [
      { boundingLengthMm: { gte: needMax }, boundingWidthMm: { gte: needMin } },
      { boundingLengthMm: { gte: needMin }, boundingWidthMm: { gte: needMax } },
    ],
  };
}

/** TZ №15 — showroom pieces (badge «в шоу-руме»), not free stock. */
export function showroomPiecesWhere(
  q: string,
  needMax: number,
  needMin: number,
): Prisma.PieceWhereInput {
  const mat = materialWhere(q);
  return {
    status: "SHOWROOM",
    stoneType: { isArchived: false, ...(mat ?? {}) },
    OR: [
      { boundingLengthMm: { gte: needMax }, boundingWidthMm: { gte: needMin } },
      { boundingLengthMm: { gte: needMin }, boundingWidthMm: { gte: needMax } },
    ],
  };
}

/**
 * ТЗ №12 §3: целые плиты (Slab) — тот же gabarit OR + material, что у boy.
 * lengthMm/widthMm хранят см (legacy *Mm).
 */
export function slabsWhere(
  q: string,
  needMax: number,
  needMin: number,
): Prisma.SlabWhereInput {
  const mat = materialWhere(q);
  return {
    // Ordinary free stock only — SHOWROOM excluded (not sellable as ordinary).
    status: "AVAILABLE",
    needsCheck: false,
    lengthMm: { not: null },
    widthMm: { not: null },
    stoneType: { isArchived: false, ...(mat ?? {}) },
    OR: [
      { lengthMm: { gte: needMax }, widthMm: { gte: needMin } },
      { lengthMm: { gte: needMin }, widthMm: { gte: needMax } },
    ],
  };
}

/**
 * TZ №15 Slice 3 — showroom slabs matching same size/material, marked separately.
 * Not mixed into ordinary AVAILABLE results (not ordinarily sellable).
 */
export function showroomSlabsWhere(
  q: string,
  needMax: number,
  needMin: number,
): Prisma.SlabWhereInput {
  const mat = materialWhere(q);
  return {
    status: "SHOWROOM",
    needsCheck: false,
    lengthMm: { not: null },
    widthMm: { not: null },
    stoneType: { isArchived: false, ...(mat ?? {}) },
    OR: [
      { lengthMm: { gte: needMax }, widthMm: { gte: needMin } },
      { lengthMm: { gte: needMin }, widthMm: { gte: needMax } },
    ],
  };
}

/** Name-only showroom list (no size filter) — bounded pickers / discovery. */
export function showroomUnitsByMaterialWhere(
  q: string,
): Prisma.SlabWhereInput {
  const mat = materialWhere(q);
  return {
    status: "SHOWROOM",
    needsCheck: false,
    stoneType: { isArchived: false, ...(mat ?? {}) },
  };
}

/**
 * ТЗ №12 §3: партии с известным форматом плиты (Batch или BatchPattern L×W).
 * Запас needMax/needMin уже с CUTTING_MARGIN.
 */
export function batchesPlateWhere(
  q: string,
  needMax: number,
  needMin: number,
): Prisma.BatchWhereInput {
  const mat = materialWhere(q);
  const dimOR: Prisma.BatchWhereInput[] = [
    { lengthMm: { gte: needMax }, widthMm: { gte: needMin } },
    { lengthMm: { gte: needMin }, widthMm: { gte: needMax } },
  ];
  const patDimOR: Prisma.BatchPatternWhereInput[] = [
    { lengthMm: { gte: needMax }, widthMm: { gte: needMin } },
    { lengthMm: { gte: needMin }, widthMm: { gte: needMax } },
  ];
  return {
    stoneType: { isArchived: false, ...(mat ?? {}) },
    OR: [
      {
        AND: [
          // ТЗ №19 C2: формат партии решает только у однородной партии (нет
          // узора с известным L×W). У партии с узорами подбор — по узорам ниже,
          // иначе партия «подходит» по своему габариту, а узора под размер нет.
          {
            patterns: {
              none: { lengthMm: { not: null }, widthMm: { not: null } },
            },
          },
          { lengthMm: { not: null } },
          { widthMm: { not: null } },
          { OR: dimOR },
        ],
      },
      {
        patterns: {
          some: {
            AND: [
              { lengthMm: { not: null } },
              { widthMm: { not: null } },
              { OR: patDimOR },
            ],
          },
        },
      },
    ],
  };
}

// ───────────── ТЗ №19 C2 / E3 — подбор по размеру: узор, а не партия ─────────────

/** Узор партии в выдаче по размеру (поля из select'а /poisk, Decimal толщина). */
export interface SizeSearchPattern {
  id: string;
  description: string;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: { toString(): string } | number | null;
}

/** Локация партии (BatchLocation) — для «Блок A1» / «локация не указана». */
export interface SizeSearchLocation {
  block: string;
  landmark: string;
  slabsHere: number | null;
  batchPatternId: string | null;
}

/** Партия, прошедшая SQL-фильтр batchesPlateWhere. */
export interface SizeSearchBatch {
  id: string;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: { toString(): string } | number | null;
  stoneType: { id: string; name: string };
  /** В порядке приёмки (createdAt asc). */
  patterns: readonly SizeSearchPattern[];
  locations: readonly SizeSearchLocation[];
}

/** Свободно (после броней/образцов). null — величина не ведётся / не загружена. */
export interface SizeSearchFree {
  slabs: number | null;
  areaM2: number | null;
}

/** Одна строка выдачи: узор смешанной партии или однородная партия целиком. */
export interface SizeSearchHit {
  /** patternId для узора, batchId для однородной партии (React key). */
  key: string;
  batchId: string;
  patternId: string | null;
  stoneTypeId: string;
  stoneName: string;
  /** Описание узора; null — однородная партия. */
  description: string | null;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number | null;
  free: SizeSearchFree;
  /** «Блок A1» / «Блок A1, A2» / «локация не указана» (E3). */
  locationText: string;
  locationMissing: boolean;
}

/** Текст formatLocationsShort для пустого списка (E3). */
export const LOCATION_MISSING = "локация не указана";

const UNKNOWN_FREE: SizeSearchFree = { slabs: null, areaM2: null };

/** Узор с известным форматом — только такие участвуют в подборе по размеру. */
function hasFormat(p: SizeSearchPattern): boolean {
  return p.lengthMm !== null && p.widthMm !== null;
}

/**
 * ТЗ №19 C2: строки выдачи «по размеру».
 *  - партия с узорами (хотя бы один узор с L×W) → строка на КАЖДЫЙ узор, чей
 *    формат проходит pieceFitsRequest (запас на рез + поворот); узоры не под
 *    размер в выдачу не попадают;
 *  - однородная партия → одна строка по габариту партии (как раньше).
 * Свободный остаток — из pattern-stock (узор) и batch-remainders (партия);
 * map'ы могут быть null (PARTNER не видит чисел — не грузим).
 * E3: нет локации → «локация не указана».
 */
export function sizeSearchHits(
  batches: readonly SizeSearchBatch[],
  reqLengthCm: number,
  reqWidthCm: number,
  patternFree: ReadonlyMap<string, SizeSearchFree> | null,
  batchFree: ReadonlyMap<string, SizeSearchFree> | null,
): SizeSearchHit[] {
  const out: SizeSearchHit[] = [];
  for (const b of batches) {
    const formatted = b.patterns.filter(hasFormat);
    if (formatted.length > 0) {
      for (const p of formatted) {
        const L = p.lengthMm as number;
        const W = p.widthMm as number;
        if (!pieceFitsRequest(L, W, reqLengthCm, reqWidthCm)) continue;
        const locationText = formatLocationsShort(
          locationsForPattern(b.locations, p.id),
        );
        out.push({
          key: p.id,
          batchId: b.id,
          patternId: p.id,
          stoneTypeId: b.stoneType.id,
          stoneName: b.stoneType.name,
          description: p.description.trim() || null,
          lengthMm: L,
          widthMm: W,
          thicknessMm:
            thicknessToNumber(p.thicknessMm) ?? thicknessToNumber(b.thicknessMm),
          free: patternFree?.get(p.id) ?? UNKNOWN_FREE,
          locationText,
          locationMissing: locationText === LOCATION_MISSING,
        });
      }
      continue;
    }
    if (b.lengthMm === null || b.widthMm === null) continue;
    if (!pieceFitsRequest(b.lengthMm, b.widthMm, reqLengthCm, reqWidthCm)) continue;
    const locationText = formatLocationsShort(b.locations);
    out.push({
      key: b.id,
      batchId: b.id,
      patternId: null,
      stoneTypeId: b.stoneType.id,
      stoneName: b.stoneType.name,
      description: null,
      lengthMm: b.lengthMm,
      widthMm: b.widthMm,
      thicknessMm: thicknessToNumber(b.thicknessMm),
      free: batchFree?.get(b.id) ?? UNKNOWN_FREE,
      locationText,
      locationMissing: locationText === LOCATION_MISSING,
    });
  }
  return out;
}

/** 1 плита · 2 плиты · 5 плит · 11 плит · 21 плита. */
export function slabsWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return "плит";
  if (b === 1) return "плита";
  if (b >= 2 && b <= 4) return "плиты";
  return "плит";
}

const hitM2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** «3 плиты» / «≈13,4 м²» / «нет свободных»; null — количество не загружено. */
export function formatHitQty(free: SizeSearchFree): string | null {
  if (free.slabs !== null) {
    return free.slabs > 0 ? `${free.slabs} ${slabsWord(free.slabs)}` : "нет свободных";
  }
  if (free.areaM2 !== null) {
    return free.areaM2 > 0 ? `≈${hitM2Fmt.format(free.areaM2)} м²` : "нет свободных";
  }
  return null;
}

/**
 * Строка выдачи C2:
 *   «Травертин Классик · ТЕСТ светлый 2см · 280×160×2 см · 3 плиты · Блок A1»
 * exact = false (PARTNER) — без количества и локации (§3 / §4.6).
 */
export function formatSizeHitLine(
  hit: SizeSearchHit,
  opts: { includeStone?: boolean; exact?: boolean } = {},
): string {
  const { includeStone = true, exact = true } = opts;
  const parts: string[] = [];
  if (includeStone) parts.push(hit.stoneName);
  if (hit.description) parts.push(hit.description);
  parts.push(formatGabarit(hit.lengthMm, hit.widthMm, hit.thicknessMm));
  if (exact) {
    const qty = formatHitQty(hit.free);
    if (qty) parts.push(qty);
    parts.push(hit.locationText);
  }
  return parts.join(" · ");
}
