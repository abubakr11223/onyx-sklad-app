// S1-E — sof hisob funksiyalari testlari (DB ishlatilmaydi).
// Formulaning normativ manbasi: docs/data-model.md §3.
import { describe, expect, it } from "vitest";
import {
  CUTTING_MARGIN_MM,
  computeFreeRemainder,
  pieceFitsRequest,
} from "@/lib/inventory";

const baseBatch = {
  slabsTotal: 40,
  areaTotalM2: 220,
  slabsAdjusted: 0,
  areaAdjustedM2: 0,
  slabsSoldDirect: 0,
  areaSoldDirectM2: 0,
};

describe("computeFreeRemainder — data-model.md §3", () => {
  it("toza partiya: hech narsa ajratilmagan", () => {
    const r = computeFreeRemainder(baseBatch, [], []);
    expect(r).toEqual({ slabsFree: 40, areaFreeM2: 220 });
  });

  it("seed'dagi holat: 1 ajratilgan plita + 1 to'g'ridan-to'g'ri boy", () => {
    // batch1 (Травертин): 40 плит / 220 м², slab 5.32 м², piece 0.6 м².
    const r = computeFreeRemainder(baseBatch, [{ areaM2: 5.32 }], [{ areaM2: 0.6 }]);
    expect(r.slabsFree).toBe(38);
    expect(r.areaFreeM2).toBeCloseTo(214.08, 6);
  });

  it("ajratilgan plita statusidan QAT'I NAZAR minus (RESERVED/SOLD ham)", () => {
    // Funksiya ro'yxat uzunligini oladi — chaqiruvchi statusga qaramay uzatadi.
    const r = computeFreeRemainder(
      baseBatch,
      [{ areaM2: 5 }, { areaM2: 5 }, { areaM2: 5 }],
      [],
    );
    expect(r.slabsFree).toBe(37);
    expect(r.areaFreeM2).toBeCloseTo(205, 6);
  });

  it("soldDirect va adjusted hisobga olinadi (B2B + inventarizatsiya ±)", () => {
    const r = computeFreeRemainder(
      {
        ...baseBatch,
        slabsSoldDirect: 10,
        areaSoldDirectM2: 55,
        slabsAdjusted: -2,
        areaAdjustedM2: -11,
      },
      [],
      [],
    );
    expect(r.slabsFree).toBe(28);
    expect(r.areaFreeM2).toBeCloseTo(154, 6);
  });

  it("slabsTotal = null → slabsFree = null, m²-hisob ishlayveradi", () => {
    const r = computeFreeRemainder(
      { ...baseBatch, slabsTotal: null },
      [{ areaM2: 5 }],
      [{ areaM2: 1 }],
    );
    expect(r.slabsFree).toBeNull();
    expect(r.areaFreeM2).toBeCloseTo(214, 6);
  });

  it("areaTotalM2 = null → areaFreeM2 = null, dona-hisob ishlayveradi", () => {
    const r = computeFreeRemainder(
      { ...baseBatch, areaTotalM2: null },
      [{ areaM2: null }],
      [{ areaM2: null }],
    );
    expect(r.slabsFree).toBe(38);
    expect(r.areaFreeM2).toBeNull();
  });

  it("slab.areaM2 = null → partiya o'rtachasi (areaTotalM2 / slabsTotal)", () => {
    // O'rtacha = 220/40 = 5.5
    const r = computeFreeRemainder(baseBatch, [{ areaM2: null }], []);
    expect(r.slabsFree).toBe(39);
    expect(r.areaFreeM2).toBeCloseTo(220 - 5.5, 6);
  });

  it("slab.areaM2 = null va slabsTotal = null → himoya: 0 (qoldiq kamaymaydi)", () => {
    const r = computeFreeRemainder(
      { ...baseBatch, slabsTotal: null },
      [{ areaM2: null }],
      [],
    );
    expect(r.areaFreeM2).toBeCloseTo(220, 6);
  });

  it("piece.areaM2 = null → 0 sifatida (m² hisobida qatnashmaydi)", () => {
    const r = computeFreeRemainder(baseBatch, [], [{ areaM2: null }]);
    expect(r.slabsFree).toBe(39);
    expect(r.areaFreeM2).toBeCloseTo(220, 6);
  });

  it("hammasi sotilgan partiya: erkin qoldiq 0 gacha tushadi", () => {
    const r = computeFreeRemainder(
      { ...baseBatch, slabsSoldDirect: 40, areaSoldDirectM2: 220 },
      [],
      [],
    );
    expect(r).toEqual({ slabsFree: 0, areaFreeM2: 0 });
  });
});

describe("pieceFitsRequest — TZ §5.2 dopusk bilan gabarit-qidiruv", () => {
  it("dopusk konstantasi 20 mm", () => {
    expect(CUTTING_MARGIN_MM).toBe(20);
  });

  it("so'rov + dopusk sig'sa — mos (1450×800 ga 1200×700)", () => {
    expect(pieceFitsRequest(1450, 800, 1200, 700)).toBe(true);
  });

  it("aniq teng o'lcham dopusksiz sig'maydi (1200×700 ga 1200×700)", () => {
    expect(pieceFitsRequest(1200, 700, 1200, 700)).toBe(false);
  });

  it("dopusk chegarasi: bounding = so'rov + margin — mos", () => {
    expect(pieceFitsRequest(1220, 720, 1200, 700)).toBe(true);
    expect(pieceFitsRequest(1219, 720, 1200, 700)).toBe(false);
    expect(pieceFitsRequest(1220, 719, 1200, 700)).toBe(false);
  });

  it("burish (90°) ruxsat: 800×1450 bounding ham 1200×700 ni yopadi", () => {
    expect(pieceFitsRequest(800, 1450, 1200, 700)).toBe(true);
    expect(pieceFitsRequest(800, 1450, 700, 1200)).toBe(true);
  });

  it("bitta tomon yetmasa — mos emas (1180×640 ga 1200×700)", () => {
    expect(pieceFitsRequest(1180, 640, 1200, 700)).toBe(false);
  });

  it("maxsus margin bilan chaqirish mumkin", () => {
    expect(pieceFitsRequest(1200, 700, 1200, 700, 0)).toBe(true);
    expect(pieceFitsRequest(1250, 750, 1200, 700, 50)).toBe(true);
    expect(pieceFitsRequest(1250, 750, 1200, 700, 51)).toBe(false);
  });

  it("nol yoki manfiy so'rov o'lchami — mos emas", () => {
    expect(pieceFitsRequest(1450, 800, 0, 700)).toBe(false);
    expect(pieceFitsRequest(1450, 800, 1200, -5)).toBe(false);
  });
});
