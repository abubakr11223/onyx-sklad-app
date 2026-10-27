// ТЗ №19 C2 / C3 / E3 — /poisk считает УЗОР, а не партию.
// Чистые функции (без БД): sizeSearchHits/formatSizeHitLine (poisk-search.ts),
// typeFormatSummary/formatTypeFormatsLine (poisk-query.ts). Остаток узора
// подаётся так, как его отдаёт pattern-stock.loadPatternStock (availableSlabs).
import { describe, expect, it } from "vitest";
import {
  batchesPlateWhere,
  formatSizeHitLine,
  sizeSearchHits,
  slabsWord,
  type SizeSearchBatch,
  type SizeSearchFree,
} from "@/lib/poisk-search";
import {
  formatTypeFormatsLine,
  typeFormatSummary,
  type BatchAvailable,
  type FormatPatternStock,
} from "@/lib/poisk-query";

const decimal = (v: string) => ({ toString: () => v });

/** Партия 21.10 из ТЗ: узор 1 280×160×2 (3 пл., A1), узор 2 250×150×3 (3 пл., A2). */
const batch2110: SizeSearchBatch = {
  id: "b2110",
  lengthMm: 280,
  widthMm: 160,
  thicknessMm: null,
  stoneType: { id: "st-trav", name: "Травертин Классик" },
  patterns: [
    { id: "p1", description: "ТЕСТ светлый 2см", lengthMm: 280, widthMm: 160, thicknessMm: decimal("2.0") },
    { id: "p2", description: "ТЕСТ тёмный 3см", lengthMm: 250, widthMm: 150, thicknessMm: decimal("3.0") },
  ],
  locations: [
    { block: "A1", landmark: "", slabsHere: 3, batchPatternId: "p1" },
    { block: "A2", landmark: "", slabsHere: 3, batchPatternId: "p2" },
  ],
};

const patternFree = new Map<string, SizeSearchFree>([
  ["p1", { slabs: 3, areaM2: 13.44 }],
  ["p2", { slabs: 3, areaM2: 11.25 }],
]);

describe("C2 — подбор по размеру по узору", () => {
  it("270×150 (+2 см → 272×152) — только узор 280×160, строка как в ТЗ", () => {
    const hits = sizeSearchHits([batch2110], 270, 150, patternFree, null);
    expect(hits).toHaveLength(1);
    expect(hits[0].patternId).toBe("p1");
    expect(formatSizeHitLine(hits[0])).toBe(
      "Травертин Классик · ТЕСТ светлый 2см · 280×160×2 см · 3 плиты · Блок A1",
    );
  });

  it("поворот разрешён: 150×270 даёт тот же узор", () => {
    const hits = sizeSearchHits([batch2110], 150, 270, patternFree, null);
    expect(hits.map((h) => h.patternId)).toEqual(["p1"]);
  });

  it("под оба узора — две строки, у каждого свой остаток и блок", () => {
    const hits = sizeSearchHits([batch2110], 240, 140, patternFree, null);
    expect(hits.map((h) => formatSizeHitLine(h))).toEqual([
      "Травертин Классик · ТЕСТ светлый 2см · 280×160×2 см · 3 плиты · Блок A1",
      "Травертин Классик · ТЕСТ тёмный 3см · 250×150×3 см · 3 плиты · Блок A2",
    ]);
  });

  it("ни один узор не подходит — партия не показывается, даже если её габарит подошёл бы", () => {
    const big = { ...batch2110, lengthMm: 400, widthMm: 300 };
    expect(sizeSearchHits([big], 300, 200, patternFree, null)).toEqual([]);
  });

  it("однородная партия — как раньше: строка по габариту партии", () => {
    const homo: SizeSearchBatch = {
      id: "b3108",
      lengthMm: 220,
      widthMm: 160,
      thicknessMm: decimal("2.0"),
      stoneType: { id: "st-trav", name: "Травертин Классик" },
      patterns: [],
      locations: [{ block: "A1", landmark: "", slabsHere: null, batchPatternId: null }],
    };
    const free = new Map([["b3108", { slabs: 50, areaM2: 176 }]]);
    const hits = sizeSearchHits([homo], 200, 150, null, free);
    expect(hits.map((h) => formatSizeHitLine(h))).toEqual([
      "Травертин Классик · 220×160×2 см · 50 плит · Блок A1",
    ]);
    expect(sizeSearchHits([homo], 270, 150, null, free)).toEqual([]);
  });

  it("E3: партия без локации → «локация не указана»", () => {
    const homo: SizeSearchBatch = {
      id: "b-noloc",
      lengthMm: 220,
      widthMm: 160,
      thicknessMm: null,
      stoneType: { id: "st", name: "Оникс" },
      patterns: [],
      locations: [],
    };
    const [hit] = sizeSearchHits([homo], 200, 150, null, new Map([["b-noloc", { slabs: 1, areaM2: null }]]));
    expect(hit.locationMissing).toBe(true);
    expect(formatSizeHitLine(hit)).toBe("Оникс · 220×160 см · 1 плита · локация не указана");
  });

  it("PARTNER (exact=false) — без количества и локации", () => {
    const [hit] = sizeSearchHits([batch2110], 270, 150, null, null);
    expect(formatSizeHitLine(hit, { exact: false })).toBe(
      "Травертин Классик · ТЕСТ светлый 2см · 280×160×2 см",
    );
  });

  it("SQL: габарит партии решает только при отсутствии узора с L×W", () => {
    const w = batchesPlateWhere("", 272, 152);
    const homoBranch = (w.OR as Array<{ AND?: unknown[] }>)[0];
    expect(homoBranch.AND?.[0]).toEqual({
      patterns: { none: { lengthMm: { not: null }, widthMm: { not: null } } },
    });
  });

  it("склонение: 1 плита, 3 плиты, 5 плит, 11 плит, 21 плита", () => {
    expect([1, 3, 5, 11, 21, 0].map(slabsWord)).toEqual([
      "плита", "плиты", "плит", "плит", "плита", "плит",
    ]);
  });
});

describe("C3 — строки по форматам в карточке вида", () => {
  const batches = [
    { id: "b3108", lengthMm: 220, widthMm: 160, thicknessMm: decimal("2.0") },
    { id: "b2110", lengthMm: 280, widthMm: 160, thicknessMm: null },
  ];
  const batchStock: BatchAvailable[] = [
    { batchId: "b3108", slabs: 50, areaM2: 176 },
    { batchId: "b2110", slabs: 6, areaM2: 24.69 },
  ];
  const patternStock = new Map<string, FormatPatternStock>([
    ["p1", { batchId: "b2110", lengthMm: 280, widthMm: 160, thicknessMm: 2, availableSlabs: 3 }],
    ["p2", { batchId: "b2110", lengthMm: 250, widthMm: 150, thicknessMm: 3, availableSlabs: 3 }],
  ]);

  it("«220×160×2 — 50 пл. · 280×160×2 — 3 пл. · 250×150×3 — 3 пл.»", () => {
    expect(
      formatTypeFormatsLine(typeFormatSummary(batches, batchStock, patternStock)),
    ).toBe("220×160×2 — 50 пл. · 280×160×2 — 3 пл. · 250×150×3 — 3 пл.");
  });

  it("одинаковый формат из разных партий суммируется; нули не показываются", () => {
    const more = [...batches, { id: "b-x", lengthMm: 220, widthMm: 160, thicknessMm: 2 }];
    const stock: BatchAvailable[] = [...batchStock, { batchId: "b-x", slabs: 4, areaM2: null }];
    const ps = new Map(patternStock);
    ps.set("p2", { ...patternStock.get("p2")!, availableSlabs: 0 });
    expect(formatTypeFormatsLine(typeFormatSummary(more, stock, ps))).toBe(
      "220×160×2 — 54 пл. · 280×160×2 — 3 пл.",
    );
  });

  it("партия без габарита → «формат не указан»; нечего показать → null", () => {
    const legacy = [{ id: "old", lengthMm: null, widthMm: null, thicknessMm: null }];
    expect(
      formatTypeFormatsLine(
        typeFormatSummary(legacy, [{ batchId: "old", slabs: 19, areaM2: null }], new Map()),
      ),
    ).toBe("формат не указан — 19 пл.");
    expect(
      formatTypeFormatsLine(
        typeFormatSummary(legacy, [{ batchId: "old", slabs: null, areaM2: 10 }], new Map()),
      ),
    ).toBeNull();
  });
});
