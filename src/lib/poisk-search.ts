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
    status: "AVAILABLE",
    stoneType: { isArchived: false, ...(mat ?? {}) },
    OR: [
      { boundingLengthMm: { gte: needMax }, boundingWidthMm: { gte: needMin } },
      { boundingLengthMm: { gte: needMin }, boundingWidthMm: { gte: needMax } },
    ],
  };
}
