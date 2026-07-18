// BATCH-B — agregat→qoldiq yo'li §3 formulasi (computeFreeRemainder) bilan BIR XIL
// natija berishini isbotlaydi. DB YO'Q: getBatchRemainders (DB groupBy) shu yerda
// ishtirok etmaydi — uning chiqishi aggregateFromRows bilan ekvivalent (ikkalasi ham
// count + Σ areaM2 + null-count beradi), test esa aynan shu agregatni tekshiradi.
import { describe, expect, it } from "vitest";
import { computeFreeRemainder } from "@/lib/inventory";
import {
  EMPTY_AGGREGATE,
  aggregateFromRows,
  freeRemainderFromAggregate,
} from "@/lib/batch-remainders";

// slabsTotal/areaTotalM2 nullable — ba'zi testlar ularni null bilan override qiladi
// (m²-only yoki dona-only partiya). Tip aniq berilmasa `number` chiqariladi va
// { ...baseBatch, slabsTotal: null } TS2322 beradi.
const baseBatch: {
  slabsTotal: number | null;
  areaTotalM2: number | null;
  slabsAdjusted: number;
  areaAdjustedM2: number;
  slabsSoldDirect: number;
  areaSoldDirectM2: number;
} = {
  slabsTotal: 40,
  areaTotalM2: 220,
  slabsAdjusted: 0,
  areaAdjustedM2: 0,
  slabsSoldDirect: 0,
  areaSoldDirectM2: 0,
};

/** Bir xil kirishni ikki yo'l bilan hisoblab, teng ekanini tasdiqlaydi. */
function assertParity(
  batch: typeof baseBatch,
  slabs: { areaM2: number | null }[],
  pieces: { areaM2: number | null }[],
) {
  const rowBased = computeFreeRemainder(batch, slabs, pieces);
  const agg = aggregateFromRows(slabs, pieces);
  const aggregateBased = freeRemainderFromAggregate(batch, agg);
  expect(aggregateBased).toEqual(rowBased);
  return { rowBased, aggregateBased };
}

describe("freeRemainderFromAggregate — §3 formulasi bilan pariteti", () => {
  it("toza partiya: hech narsa ajratilmagan (nol qatorlar)", () => {
    const { aggregateBased } = assertParity(baseBatch, [], []);
    expect(aggregateBased).toEqual({ slabsFree: 40, areaFreeM2: 220 });
  });

  it("EMPTY_AGGREGATE = nol qatorlar bilan bir xil", () => {
    expect(freeRemainderFromAggregate(baseBatch, EMPTY_AGGREGATE)).toEqual(
      computeFreeRemainder(baseBatch, [], []),
    );
  });

  it("seed holati: 1 ajratilgan plita + 1 to'g'ridan-to'g'ri boy", () => {
    const { aggregateBased } = assertParity(
      baseBatch,
      [{ areaM2: 5.32 }],
      [{ areaM2: 0.6 }],
    );
    expect(aggregateBased.slabsFree).toBe(38);
    expect(aggregateBased.areaFreeM2).toBeCloseTo(214.08, 6);
  });

  it("ajratilgan plita statusidan qat'i nazar minus (ko'p qator)", () => {
    assertParity(baseBatch, [{ areaM2: 5 }, { areaM2: 5 }, { areaM2: 5 }], []);
  });

  it("soldDirect + adjusted hisobga olinadi", () => {
    assertParity(
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
  });

  it("slabsTotal = null → slabsFree null, m² hisobi ishlaydi", () => {
    const { aggregateBased } = assertParity(
      { ...baseBatch, slabsTotal: null },
      [{ areaM2: 5 }],
      [{ areaM2: 1 }],
    );
    expect(aggregateBased.slabsFree).toBeNull();
    expect(aggregateBased.areaFreeM2).toBeCloseTo(214, 6);
  });

  it("areaTotalM2 = null → areaFreeM2 null, dona hisobi ishlaydi", () => {
    const { aggregateBased } = assertParity(
      { ...baseBatch, areaTotalM2: null },
      [{ areaM2: null }],
      [{ areaM2: null }],
    );
    expect(aggregateBased.slabsFree).toBe(38);
    expect(aggregateBased.areaFreeM2).toBeNull();
  });

  it("slab.areaM2 = null → partiya o'rtachasi (null-fallback)", () => {
    // O'rtacha = 220/40 = 5.5
    const { aggregateBased } = assertParity(baseBatch, [{ areaM2: null }], []);
    expect(aggregateBased.slabsFree).toBe(39);
    expect(aggregateBased.areaFreeM2).toBeCloseTo(220 - 5.5, 6);
  });

  it("null va ma'lum area aralash — fallback faqat null qatorlarga", () => {
    // Rows: [5, null, 5] avg=5.5 → Σ = 5 + 5.5 + 5 = 15.5
    const { aggregateBased } = assertParity(
      baseBatch,
      [{ areaM2: 5 }, { areaM2: null }, { areaM2: 5 }],
      [],
    );
    expect(aggregateBased.areaFreeM2).toBeCloseTo(220 - 15.5, 6);
  });

  it("slab.areaM2 = null va slabsTotal = null → himoya: 0", () => {
    assertParity(
      { ...baseBatch, slabsTotal: null },
      [{ areaM2: null }],
      [],
    );
  });

  it("piece.areaM2 = null → 0 (m² hisobida qatnashmaydi)", () => {
    const { aggregateBased } = assertParity(baseBatch, [], [{ areaM2: null }]);
    expect(aggregateBased.slabsFree).toBe(39);
    expect(aggregateBased.areaFreeM2).toBeCloseTo(220, 6);
  });

  it("hammasi sotilgan partiya: qoldiq 0", () => {
    const { aggregateBased } = assertParity(
      { ...baseBatch, slabsSoldDirect: 40, areaSoldDirectM2: 220 },
      [],
      [],
    );
    expect(aggregateBased).toEqual({ slabsFree: 0, areaFreeM2: 0 });
  });

  it("aralash yirik holat: plita + boy + null'lar + tuzatish", () => {
    assertParity(
      {
        slabsTotal: 100,
        areaTotalM2: 550,
        slabsAdjusted: 3,
        areaAdjustedM2: 16.5,
        slabsSoldDirect: 7,
        areaSoldDirectM2: 38.5,
      },
      [{ areaM2: 5.5 }, { areaM2: null }, { areaM2: 6 }, { areaM2: null }],
      [{ areaM2: 0.75 }, { areaM2: null }, { areaM2: 1.25 }],
    );
  });
});

describe("aggregateFromRows — count/sum/null-count", () => {
  it("null-area qatorlarni alohida sanaydi, Σ null bo'lmaganlardan", () => {
    const agg = aggregateFromRows(
      [{ areaM2: 5 }, { areaM2: null }, { areaM2: 6 }],
      [{ areaM2: 0.5 }, { areaM2: null }],
    );
    expect(agg).toEqual({
      slabCount: 3,
      slabAreaSum: 11,
      slabNullAreaCount: 1,
      pieceCount: 2,
      pieceAreaSum: 0.5,
      pieceNullAreaCount: 1,
    });
  });

  it("bo'sh massivlar → nol agregat (EMPTY_AGGREGATE)", () => {
    expect(aggregateFromRows([], [])).toEqual(EMPTY_AGGREGATE);
  });
});
