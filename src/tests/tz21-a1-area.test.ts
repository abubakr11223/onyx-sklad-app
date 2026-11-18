// ТЗ №21 А1 — продажа плитами списывает и площадь; итог вида в Поиске =
// сумма узоров (совпадает с разбивкой по размерам).
import { describe, expect, it } from "vitest";
import { areaForHomogeneousSlabs } from "@/lib/sales";
import { reconcileTypeWithPatterns } from "@/lib/poisk-query";
import { areaForSlabs, computePatternFree, EMPTY_PATTERN_AGGREGATE } from "@/lib/pattern-stock";

describe("А1 — площадь уходит вместе с плитами", () => {
  it("однородная партия: 2 плиты 280×160 → 8,96 м²", () => {
    expect(areaForHomogeneousSlabs(2, 4.48, 40)).toBe(8.96);
  });
  it("не больше свободной площади", () => {
    expect(areaForHomogeneousSlabs(3, 4.48, 10)).toBe(10);
  });
  it("без учёта м² или площади плиты — null", () => {
    expect(areaForHomogeneousSlabs(2, 4.48, null)).toBeNull();
    expect(areaForHomogeneousSlabs(2, 0, 10)).toBeNull();
  });
  it("узор 3 плиты 280×160 (13,44 м²), продали 1 плиту → свободно 2 плиты ≈ 8,96 м²", () => {
    const p = { slabsCount: 3, areaM2: 13.44, slabsSold: 0, areaSoldM2: 0, lengthMm: 280, widthMm: 160 };
    const sold = areaForSlabs(p, 1, 13.44);
    expect(sold).toBe(4.48);
    const after = computePatternFree(
      { ...p, slabsSold: 1, areaSoldM2: sold ?? 0 },
      EMPTY_PATTERN_AGGREGATE,
    );
    expect(after.slabsFree).toBe(2);
    expect(after.areaFreeM2).toBeCloseTo(8.96, 3);
  });
});

describe("А1 — Поиск: итог вида = сумма узоров", () => {
  const base = {
    batchStock: [
      { batchId: "pat", slabs: 19, areaM2: 39.7 },
      { batchId: "plain", slabs: 5, areaM2: 10 },
    ],
    slabsFreeSum: 24,
    areaFreeSum: 49.7,
    slabsTotalSum: 24,
    areaTotalSum: 49.7,
    reservedSlabsSum: 0,
    reservedAreaSum: 0,
  };
  it("партия с узорами берёт свободный остаток узоров", () => {
    const stock = new Map([
      ["u1", { batchId: "pat", availableSlabs: 12, availableAreaM2: 25.2 }],
      ["u2", { batchId: "pat", availableSlabs: 8, availableAreaM2: 16.8 }],
    ]);
    const t = reconcileTypeWithPatterns(base, stock);
    expect(t.slabsFreeSum).toBe(25);
    expect(t.areaFreeSum).toBeCloseTo(52, 3);
    expect(t.batchStock[0]).toEqual({ batchId: "pat", slabs: 20, areaM2: 42 });
  });
  it("без узоров — без изменений", () => {
    expect(reconcileTypeWithPatterns(base, new Map())).toBe(base);
  });
});

import { planSlabAreaRepair } from "@/lib/slab-area-repair";

describe("А1 — пересчёт старых продаж плитами", () => {
  const row = {
    id: "s1",
    soldAt: new Date("2026-10-21"),
    qtySlabs: 1,
    returnedSlabs: 0,
    batchId: "b1",
    batchPatternId: "u1",
    unitAreaM2: 4.48,
    label: "Травертин Классик · узор «ТЕСТ светлый 2см» · 1 пл.",
  };
  it("продажа 1 плиты узора 280×160 → списать 4,48 м² (остаток 13,44 → 8,96)", () => {
    const [p] = planSlabAreaRepair([row]);
    expect(p.saleAreaM2).toBe(4.48);
    expect(p.addSoldAreaM2).toBe(4.48);
    expect(p.returnedAreaM2).toBe(0);
  });
  it("возвращённые плиты не списываются повторно", () => {
    const [p] = planSlabAreaRepair([{ ...row, qtySlabs: 3, returnedSlabs: 1 }]);
    expect(p.saleAreaM2).toBe(13.44);
    expect(p.returnedAreaM2).toBe(4.48);
    expect(p.addSoldAreaM2).toBe(8.96);
  });
  it("полностью возвращённая продажа — площадь в учёт не добавляется", () => {
    const [p] = planSlabAreaRepair([{ ...row, returnedSlabs: 1 }]);
    expect(p.addSoldAreaM2).toBe(0);
  });
});
