// ТЗ №18 — привязка узора к строке локации («Что здесь») + сверка раскладки.
// Чистый валидатор, без БД.

import { describe, expect, it } from "vitest";
import { validateIntake, type IntakeInput } from "@/lib/validators/intake";

/** Партия 16 плит / 2 м², два узора (10/1.25 + 6/0.75) — пример из ТЗ §1. */
function tzInput(overrides: Partial<IntakeInput> = {}): IntakeInput {
  return {
    stoneTypeId: "st_1",
    newStoneType: false,
    newName: "",
    newRockType: "",
    newColor: "",
    newDescription: "",
    newBasePrice: "",
    slabsTotal: "16",
    areaTotalM2: "2",
    lengthMm: "",
    widthMm: "",
    thicknessMm: "",
    supplierNote: "",
    arrivedAt: "2026-08-21",
    patternsEnabled: true,
    patterns: [
      { description: "светлый с прожилками", lengthMm: "125", widthMm: "100", thicknessMm: "2", slabs: "10", areaM2: "1.25" },
      { description: "тёмный", lengthMm: "125", widthMm: "100", thicknessMm: "2", slabs: "6", areaM2: "0.75" },
    ],
    locations: [
      { block: "A", landmark: "3", slabsHere: "10", areaHereM2: "", pattern: "0" },
      { block: "B", landmark: "7", slabsHere: "6", areaHereM2: "", pattern: "1" },
    ],
    ...overrides,
  };
}

describe("ТЗ №18 — «Что здесь» (узор в строке локации)", () => {
  it("сценарий B: разные узоры в разных местах → ok, patternIdx проставлен", () => {
    const r = validateIntake(tzInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations.map((l) => l.patternIdx)).toEqual([0, 1]);
    }
  });

  it("сценарий A: один узор в двух местах → ok", () => {
    const r = validateIntake(
      tzInput({
        locations: [
          { block: "A", landmark: "3", slabsHere: "6", areaHereM2: "", pattern: "0" },
          { block: "A", landmark: "4", slabsHere: "4", areaHereM2: "", pattern: "0" },
          { block: "B", landmark: "7", slabsHere: "6", areaHereM2: "", pattern: "1" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations.map((l) => l.patternIdx)).toEqual([0, 0, 1]);
    }
  });

  it("§5 — м² здесь СЧИТАЕТСЯ из узора (плит × м²/плиту), ввод игнорируется", () => {
    const r = validateIntake(tzInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations[0].areaHereM2).toBeCloseTo(1.25, 3);
      expect(r.data.locations[1].areaHereM2).toBeCloseTo(0.75, 3);
    }
  });

  it("«весь приход» по умолчанию: одна строка, м² вручную → ok, patternIdx=null", () => {
    const r = validateIntake(
      tzInput({
        locations: [
          { block: "A", landmark: "3", slabsHere: "16", areaHereM2: "2", pattern: "" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.locations[0].patternIdx).toBeNull();
  });

  it("«весь приход» в партии с узорами БЕЗ м² → ошибка поля (итог не сверить)", () => {
    const r = validateIntake(
      tzInput({
        locations: [
          { block: "A", landmark: "3", slabsHere: "16", areaHereM2: "", pattern: "" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["loc-0-areaHereM2"]).toMatch(/весь приход/);
  });

  it("§4.2 — по узору нельзя разложить больше, чем пришло", () => {
    const r = validateIntake(
      tzInput({
        locations: [
          { block: "A", landmark: "3", slabsHere: "8", areaHereM2: "", pattern: "1" }, // узор 6 плит
          { block: "B", landmark: "7", slabsHere: "8", areaHereM2: "", pattern: "0" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locationsSum).toMatch(/тёмный/);
  });

  it("§4.3 — разложено не всё → locationsSum с недобором", () => {
    const r = validateIntake(
      tzInput({
        locations: [
          { block: "A", landmark: "3", slabsHere: "10", areaHereM2: "", pattern: "0" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locationsSum).toMatch(/10 из 16/);
  });

  it("некорректный индекс узора → loc-N-pattern", () => {
    const r = validateIntake(
      tzInput({
        locations: [
          { block: "A", landmark: "3", slabsHere: "10", areaHereM2: "", pattern: "7" },
          { block: "B", landmark: "7", slabsHere: "6", areaHereM2: "", pattern: "1" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["loc-0-pattern"]).toBeTruthy();
  });

  it("§6 — совместимость: поле pattern отсутствует (старый вызов) == весь приход", () => {
    const r = validateIntake(
      tzInput({
        patternsEnabled: false,
        patterns: [],
        lengthMm: "125",
        widthMm: "100",
        locations: [
          { block: "A", landmark: "3", slabsHere: "16", areaHereM2: "2" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.locations[0].patternIdx).toBeNull();
  });
});
