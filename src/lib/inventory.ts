// Onyx — sof hisob funksiyalari (S1-E, «Поиск камня»).
// DB importlari YO'Q — bu modul faqat toza hisob: docs/data-model.md §3
// («partiya doim sxoditsya» invarianti) va TZ §5.2 gabarit-qidiruv dopuski.
// Chaqiruvchi (server component) Prisma'dan olingan qiymatlarni oddiy
// number/null ko'rinishga keltirib uzatadi (Decimal → Number).

// ТЗ №12: единица размеров — см. CUTTING_MARGIN_MM — legacy-имя; значение 2 (см).
import { CUTTING_MARGIN_CM as _CUTTING_MARGIN_CM } from "@/lib/dimensions";
export const CUTTING_MARGIN_MM = _CUTTING_MARGIN_CM;
export { CUTTING_MARGIN_CM } from "@/lib/dimensions";

/** Batch jadvalining hisob uchun kerakli ustunlari (data-model.md §1.2). */
export interface BatchTotalsInput {
  /** null = partiya faqat m² da kiritilgan (§3: dona-nazorat o'chadi). */
  slabsTotal: number | null;
  /** null = partiya faqat donada kiritilgan (§3 ko'zgu holat). */
  areaTotalM2: number | null;
  slabsAdjusted: number;
  areaAdjustedM2: number;
  slabsSoldDirect: number;
  areaSoldDirectM2: number;
}

/**
 * Ajratilgan plita (Slab) — HAR QANDAY statusda formulada minus (§3:
 * plita ajratilgach partiya massasidan chiqqan, o'z hayotini yashaydi).
 */
export interface SeparatedSlabInput {
  /** null = o'lcham hali kiritilmagan → partiya o'rtachasi ishlatiladi (§3). */
  areaM2: number | null;
}

/**
 * Partiyadan TO'G'RIDAN-TO'G'RI chiqqan boy (Piece, originSlabId IS NULL).
 * Plitadan chiqqan Piece (originSlabId to'ldirilgan) formulada QATNASHMAYDI —
 * chaqiruvchi ularni bu ro'yxatga KIRITMASLIGI shart (§3: ikki marta hisob yo'q).
 */
export interface DirectPieceInput {
  areaM2: number | null;
}

export interface FreeRemainder {
  /** null = slabsTotal null (dona hisobi mavjud emas, §3). */
  slabsFree: number | null;
  /** null = areaTotalM2 null (m² hisobi mavjud emas, §3). */
  areaFreeM2: number | null;
}

/**
 * Erkin qoldiq — data-model.md §3 formulasining birebir implementatsiyasi:
 *
 *   slabsFree  = slabsTotal + slabsAdjusted − slabsSoldDirect
 *              − count(ajratilgan Slab, har qanday statusda)
 *              − count(Piece WHERE originSlabId IS NULL)
 *
 *   areaFreeM2 = areaTotalM2 + areaAdjustedM2 − areaSoldDirectM2
 *              − Σ slab.areaM2 − Σ piece.areaM2 (originSlabId IS NULL)
 *
 * `slabsTotal = null` → slabsFree = null (dona-nazorat o'chadi);
 * `areaTotalM2 = null` → areaFreeM2 = null (m²-nazorat o'chadi).
 * Slab.areaM2 = null bo'lsa partiya o'rtachasi (areaTotalM2 / slabsTotal)
 * olinadi (§3 «o'lchov noaniqligi»); o'rtacha hisoblab bo'lmasa (slabsTotal
 * null) bunday holat §3 bo'yicha bo'lmasligi kerak — himoya sifatida 0
 * olinadi (qoldiqni sun'iy kamaytirmaymiz, haqiqiy o'lcham kiritilganda farq
 * areaFree ga singadi).
 */
export function computeFreeRemainder(
  batch: BatchTotalsInput,
  separatedSlabs: readonly SeparatedSlabInput[],
  directPieces: readonly DirectPieceInput[],
): FreeRemainder {
  const slabsFree =
    batch.slabsTotal === null
      ? null
      : batch.slabsTotal +
        batch.slabsAdjusted -
        batch.slabsSoldDirect -
        separatedSlabs.length -
        directPieces.length;

  let areaFreeM2: number | null = null;
  if (batch.areaTotalM2 !== null) {
    const avgSlabAreaM2 =
      batch.slabsTotal !== null && batch.slabsTotal > 0
        ? batch.areaTotalM2 / batch.slabsTotal
        : 0;
    const slabsAreaM2 = separatedSlabs.reduce(
      (sum, s) => sum + (s.areaM2 ?? avgSlabAreaM2),
      0,
    );
    const piecesAreaM2 = directPieces.reduce((sum, p) => sum + (p.areaM2 ?? 0), 0);
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
 * Gabarit bo'yicha moslik (TZ §5.2, §6.5): so'ralgan L×W (mm) bo'lak
 * bounding-to'rtburchagiga kesish dopuski bilan sig'adimi. Burish (90°)
 * ruxsat etiladi — to'rtburchak uchun bu «katta tomon katta tomonga,
 * kichigi kichigiga» tekshiruv bilan ekvivalent.
 * Nol/manfiy so'rov o'lchami — mos emas (false).
 */
export function pieceFitsRequest(
  boundingLengthMm: number,
  boundingWidthMm: number,
  requestLengthMm: number,
  requestWidthMm: number,
  marginMm: number = CUTTING_MARGIN_MM,
): boolean {
  if (requestLengthMm <= 0 || requestWidthMm <= 0) return false;
  const boundMax = Math.max(boundingLengthMm, boundingWidthMm);
  const boundMin = Math.min(boundingLengthMm, boundingWidthMm);
  const needMax = Math.max(requestLengthMm, requestWidthMm) + marginMm;
  const needMin = Math.min(requestLengthMm, requestWidthMm) + marginMm;
  return boundMax >= needMax && boundMin >= needMin;
}
