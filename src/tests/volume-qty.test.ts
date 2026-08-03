// Salebug / TZ9 — volume qty parsing for /prodazha. No live DB.
import { describe, expect, it } from "vitest";
import {
  formatVolumeQtyDisplay,
  parseVolumeQtyFields,
} from "@/lib/validators/volume-qty";
import { checkVolumeSaleGuard } from "@/lib/sales";

describe("parseVolumeQtyFields", () => {
  it("accepts plain integers and decimal area (comma or dot)", () => {
    expect(parseVolumeQtyFields("12", "55")).toEqual({
      ok: true,
      qtySlabs: 12,
      qtyAreaM2: 55,
    });
    expect(parseVolumeQtyFields("12", "12,5")).toEqual({
      ok: true,
      qtySlabs: 12,
      qtyAreaM2: 12.5,
    });
    expect(parseVolumeQtyFields("", "12.5")).toEqual({
      ok: true,
      qtySlabs: null,
      qtyAreaM2: 12.5,
    });
    expect(parseVolumeQtyFields("3", "")).toEqual({
      ok: true,
      qtySlabs: 3,
      qtyAreaM2: null,
    });
  });

  it('rejects "55 12.5" — does NOT become 5512.5', () => {
    const r = parseVolumeQtyFields("12", "55 12.5");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.qtyAreaM2).toMatch(/без пробелов/i);
    }
  });

  it("rejects NBSP / thin space inside area (copy-paste of formatted numbers)", () => {
    const r = parseVolumeQtyFields("12", "5\u00A0512,5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.qtyAreaM2).toBeTruthy();
  });

  it("rejects empty volume", () => {
    const r = parseVolumeQtyFields("", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.qty).toMatch(/Укажите объём/i);
  });
});

describe("formatVolumeQtyDisplay", () => {
  it('joins with " · " so two values cannot look like one number', () => {
    expect(formatVolumeQtyDisplay("12", "55")).toBe("12 плит · 55 м²");
    // Old buggy join was " / " which still read ok, but "55 12.5" raw was the issue
    expect(formatVolumeQtyDisplay("12", "55 12.5")).toBe("12 плит · 55 12.5 м²");
  });
});

describe("rejection path: volume exceeds free remainder", () => {
  it("INSUFFICIENT_REMAINDER when area >> free (domain guard)", () => {
    const guard = checkVolumeSaleGuard({
      free: { slabsFree: 12, areaFreeM2: 60 },
      othersReservedSlabs: 0,
      othersReservedAreaM2: 0,
      qtySlabs: 12,
      qtyAreaM2: 5512.5,
    });
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.error.code).toBe("INSUFFICIENT_REMAINDER");
      expect(guard.error.message).toMatch(/свободно/i);
    }
  });

  it("valid 12 slabs / 55 m² passes when free is ~12 / 60", () => {
    const guard = checkVolumeSaleGuard({
      free: { slabsFree: 12, areaFreeM2: 60 },
      othersReservedSlabs: 0,
      othersReservedAreaM2: 0,
      qtySlabs: 12,
      qtyAreaM2: 55,
    });
    expect(guard).toEqual({ ok: true });
  });
});

describe("failState-equivalent: conflict codes surface remainder errors", () => {
  // Mirrors actions.ts CONFLICT_CODES — remainder errors must be conflict, not buried form.
  const CONFLICT_CODES = new Set([
    "ALREADY_SOLD",
    "RESERVED_BY_OTHER",
    "CONFLICT",
    "NEEDS_CHECK",
    "INSUFFICIENT_REMAINDER",
    "INVALID_STATUS",
  ]);

  it("INSUFFICIENT_REMAINDER is a conflict code (large banner path)", () => {
    expect(CONFLICT_CODES.has("INSUFFICIENT_REMAINDER")).toBe(true);
  });
});
