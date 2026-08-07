
import { describe, expect, it } from "vitest";
import {
  CUTTING_MARGIN_CM,
  areaM2FromCm,
  formatGabarit,
  areaDiscrepancyPct,
} from "@/lib/dimensions";
import { CUTTING_MARGIN_MM } from "@/lib/inventory";

describe("dimensions TZ №12", () => {
  it("margin is 2 cm", () => {
    expect(CUTTING_MARGIN_CM).toBe(2);
    expect(CUTTING_MARGIN_MM).toBe(2);
  });
  it("formatGabarit uses см", () => {
    expect(formatGabarit(118, 64)).toBe("118×64 см");
    expect(formatGabarit(118, 64, 2)).toBe("118×64×2 см");
  });
  it("area from cm", () => {
    expect(areaM2FromCm(100, 100)).toBeCloseTo(1, 6);
    expect(areaM2FromCm(118, 64)).toBeCloseTo(0.7552, 4);
  });
  it("discrepancy pct", () => {
    const pct = areaDiscrepancyPct(100, 100, 2, 2.0);
    expect(pct).toBeCloseTo(0, 5);
  });
});
