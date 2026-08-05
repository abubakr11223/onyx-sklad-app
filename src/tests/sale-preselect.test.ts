// W7-B — /prodazha deep-link preselect sof validatsiya (DB YO'Q).
// TZ §6.1 шаг 8: plita №N → sotuv formasi; query ishonchsiz.
import { describe, expect, it } from "vitest";
import {
  parseSalePreselectQuery,
  resolveSalePreselect,
  salePreselectAlert,
  type SalePreselectUnitRow,
} from "@/app/prodazha/sale-preselect";

const baseUnit = (
  over: Partial<SalePreselectUnitRow> = {},
): SalePreselectUnitRow => ({
  id: "slab1",
  status: "AVAILABLE",
  needsCheck: false,
  stoneTypeId: "st1",
  stoneName: "Травертин",
  unitLabel: "Плита №2",
  activeReservationManagerId: null,
  ...over,
});

describe("parseSalePreselectQuery", () => {
  it("parametr yo'q → null id lar", () => {
    expect(parseSalePreselectQuery({})).toEqual({
      slabId: null,
      pieceId: null,
    });
  });

  it("slab/piece trim; bo'sh → null", () => {
    expect(parseSalePreselectQuery({ slab: "  s1  ", piece: "" })).toEqual({
      slabId: "s1",
      pieceId: null,
    });
  });

  it("array searchParam → birinchi qiymat", () => {
    expect(parseSalePreselectQuery({ slab: ["a", "b"] }).slabId).toBe("a");
  });
});

describe("resolveSalePreselect — canSell / missing", () => {
  it("canSell=false → forbidden (wrong role)", () => {
    const r = resolveSalePreselect({
      canSell: false,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("forbidden");
  });

  it("unit null → not_found", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_found");
      expect(r.message).toMatch(/не найдена/i);
    }
  });

  it("id nomuvofiq → not_found", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "other",
      unit: baseUnit({ id: "slab1" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });
});

describe("resolveSalePreselect — status branches", () => {
  it("AVAILABLE → ok, stoneTypeId + title", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit(),
    });
    expect(r).toMatchObject({
      ok: true,
      kind: "SLAB",
      unitId: "slab1",
      stoneTypeId: "st1",
      title: "Травертин — Плита №2",
    });
  });

  it("SOLD → sold", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit({ status: "SOLD" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("sold");
      expect(r.message).toMatch(/продана/i);
    }
  });

  it("RESERVED boshqa menejer → reserved_other", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit({
        status: "RESERVED",
        activeReservationManagerId: "mgrOTHER",
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("reserved_other");
      expect(r.message).toMatch(/другого менеджера/i);
    }
  });

  it("RESERVED o'z bronim → ok", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit({
        status: "RESERVED",
        activeReservationManagerId: "mgr1",
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("needsCheck → needs_check", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit({ needsCheck: true }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("needs_check");
  });

  it("BROKEN_OFFCUT → unavailable", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit({ status: "BROKEN_OFFCUT" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unavailable");
  });

  it("SAMPLE → sample (TZ №10: clear message, not generic unavailable)", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "SLAB",
      requestedId: "slab1",
      unit: baseUnit({ status: "SAMPLE" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("sample");
      expect(r.message ?? "").toMatch(/образец/i);
    }
  });

  it("PIECE AVAILABLE → ok", () => {
    const r = resolveSalePreselect({
      canSell: true,
      actorId: "mgr1",
      kind: "PIECE",
      requestedId: "p1",
      unit: baseUnit({
        id: "p1",
        unitLabel: "бой",
        status: "AVAILABLE",
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("PIECE");
  });
});

describe("salePreselectAlert", () => {
  it("ok / none / forbidden → banner yo'q", () => {
    expect(
      salePreselectAlert({
        ok: true,
        kind: "SLAB",
        unitId: "x",
        stoneTypeId: "s",
        title: "t",
        subtitle: "s",
      }),
    ).toBeNull();
    expect(
      salePreselectAlert({ ok: false, reason: "none", message: null }),
    ).toBeNull();
    expect(
      salePreselectAlert({
        ok: false,
        reason: "forbidden",
        message: "x",
      }),
    ).toBeNull();
  });

  it("sold → danger banner", () => {
    const a = salePreselectAlert({
      ok: false,
      reason: "sold",
      message: "Эта плита уже продана — выбрать другую.",
    });
    expect(a?.variant).toBe("danger");
    expect(a?.body).toMatch(/продана/);
  });
});
