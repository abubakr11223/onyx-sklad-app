// S1-E — «Поиск камня» where-quruvchilarining sof testlari (DB'siz).
// BUG-FIX §5.2/§6.5: «предложить первыми» boy bloki material (вид/тип/цвет)
// filtrini ham qo'llashi kerak — boshqa vid qoldiqlari chiqmasligi shart.
import { describe, expect, it } from "vitest";
import { materialWhere, piecesWhere } from "@/lib/poisk-search";

describe("materialWhere — вид/тип/цвет OR-filtri", () => {
  it("bo'sh so'rov → null (filtr yo'q)", () => {
    expect(materialWhere("")).toBeNull();
  });

  it("so'rov bor → name/rockType/color bo'yicha registrga befarq OR", () => {
    expect(materialWhere("мрамор")).toEqual({
      OR: [
        { name: { contains: "мрамор", mode: "insensitive" } },
        { rockType: { contains: "мрамор", mode: "insensitive" } },
        { color: { contains: "мрамор", mode: "insensitive" } },
      ],
    });
  });
});

describe("piecesWhere — габарит + материал (§5.2/§6.5)", () => {
  const needMax = 1220;
  const needMin = 720;

  it("status AVAILABLE va gabarit OR (dopusk + 90° burish) doim bor", () => {
    const w = piecesWhere("", needMax, needMin);
    expect(w.status).toBe("AVAILABLE");
    expect(w.OR).toEqual([
      { boundingLengthMm: { gte: needMax }, boundingWidthMm: { gte: needMin } },
      { boundingLengthMm: { gte: needMin }, boundingWidthMm: { gte: needMax } },
    ]);
  });

  it("faqat o'lcham (q bo'sh) → material filtri yo'q, faqat isArchived:false", () => {
    const w = piecesWhere("", needMax, needMin);
    expect(w.stoneType).toEqual({ isArchived: false });
    // OR faqat gabarit uchun — material OR stoneType ichida umuman yo'q.
    expect(w.stoneType).not.toHaveProperty("OR");
  });

  it("material + o'lcham → stoneType relatsiyasida material OR qo'llanadi", () => {
    const w = piecesWhere("мрамор", needMax, needMin);
    expect(w.stoneType).toEqual({
      isArchived: false,
      OR: [
        { name: { contains: "мрамор", mode: "insensitive" } },
        { rockType: { contains: "мрамор", mode: "insensitive" } },
        { color: { contains: "мрамор", mode: "insensitive" } },
      ],
    });
  });

  it("piece.stoneType filtri butun plita filtri bilan AYNAN mos (drift yo'q)", () => {
    // Boy so'rovining material qismi va butun-plita so'rovining material qismi
    // bitta manbadan (materialWhere) — bu ularning sinxronligini kafolatlaydi.
    const q = "оникс";
    const w = piecesWhere(q, needMax, needMin);
    const { isArchived, ...material } = w.stoneType as {
      isArchived: boolean;
      OR: unknown;
    };
    expect(isArchived).toBe(false);
    expect(material).toEqual(materialWhere(q));
  });
});

// Xatti-harakat darajasidagi tekshiruv: berilgan gabaritli boy to'plamiga
// piecesWhere'ni "qo'lda" qo'llab, filtr kutilgan qoldiqlarnigina qoldirishini
// tasdiqlaymiz (SQL o'rniga — sof mantiq).
describe("piecesWhere — filtr xatti-harakati (material bo'yicha ajratish)", () => {
  type FakePiece = {
    id: string;
    stoneName: string;
    rockType: string;
    color: string;
    isArchived: boolean;
    status: string;
    bL: number;
    bW: number;
  };

  const pieces: FakePiece[] = [
    // Mos o'lcham + мрамор → chiqishi kerak.
    { id: "marble-fit", stoneName: "Мрамор белый", rockType: "мрамор", color: "белый", isArchived: false, status: "AVAILABLE", bL: 1300, bW: 800 },
    // Mos o'lcham, lekin BOSHQA vid (оникс) → material so'ralganda CHIQMASLIGI kerak.
    { id: "onyx-fit", stoneName: "Оникс медовый", rockType: "оникс", color: "медовый", isArchived: false, status: "AVAILABLE", bL: 1300, bW: 800 },
    // мрамор, lekin o'lcham yetmaydi → chiqmaydi.
    { id: "marble-small", stoneName: "Мрамор серый", rockType: "мрамор", color: "серый", isArchived: false, status: "AVAILABLE", bL: 1000, bW: 600 },
    // мрамор + mos o'lcham, lekin arxivlangan vid → chiqmaydi.
    { id: "marble-archived", stoneName: "Мрамор старый", rockType: "мрамор", color: "бежевый", isArchived: true, status: "AVAILABLE", bL: 1300, bW: 800 },
    // мрамор + mos o'lcham, lekin band (RESERVED) → chiqmaydi.
    { id: "marble-reserved", stoneName: "Мрамор бронь", rockType: "мрамор", color: "белый", isArchived: false, status: "RESERVED", bL: 1300, bW: 800 },
  ];

  // piecesWhere natijasini FakePiece to'plamiga qo'llovchi mini-baholovchi.
  function apply(where: ReturnType<typeof piecesWhere>, list: FakePiece[]) {
    const st = where.stoneType as {
      isArchived?: boolean;
      OR?: Array<Record<string, { contains: string; mode: string }>>;
    };
    const dimOr = where.OR as Array<{
      boundingLengthMm: { gte: number };
      boundingWidthMm: { gte: number };
    }>;
    const q = st.OR?.[0]?.name?.contains ?? "";
    return list.filter((p) => {
      if (p.status !== where.status) return false;
      if (st.isArchived !== undefined && p.isArchived !== st.isArchived) {
        return false;
      }
      if (st.OR) {
        const hay = [p.stoneName, p.rockType, p.color].map((s) =>
          s.toLowerCase(),
        );
        const needle = q.toLowerCase();
        if (!hay.some((h) => h.includes(needle))) return false;
      }
      return dimOr.some(
        (c) => p.bL >= c.boundingLengthMm.gte && p.bW >= c.boundingWidthMm.gte,
      );
    });
  }

  const needMax = 1220; // 1200 + margin
  const needMin = 720; // 700 + margin

  it("material so'ralganda BOSHQA vid qoldig'i chiqmaydi, o'sha vidniki chiqadi", () => {
    const ids = apply(piecesWhere("мрамор", needMax, needMin), pieces).map(
      (p) => p.id,
    );
    expect(ids).toContain("marble-fit");
    expect(ids).not.toContain("onyx-fit");
    // O'lcham yetmagan / arxiv / band — hech biri chiqmaydi.
    expect(ids).not.toContain("marble-small");
    expect(ids).not.toContain("marble-archived");
    expect(ids).not.toContain("marble-reserved");
  });

  it("faqat o'lcham (q bo'sh) → mos o'lchamli BARCHA vid qoldig'i chiqadi", () => {
    const ids = apply(piecesWhere("", needMax, needMin), pieces).map(
      (p) => p.id,
    );
    // Material filtri yo'q — мрамор ham, оникс ham (ikkalasi mos o'lcham).
    expect(ids).toContain("marble-fit");
    expect(ids).toContain("onyx-fit");
    // Arxiv/band/kichik — baribir chiqmaydi.
    expect(ids).not.toContain("marble-archived");
    expect(ids).not.toContain("marble-reserved");
    expect(ids).not.toContain("marble-small");
  });
});
