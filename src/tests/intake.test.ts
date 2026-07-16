// Юнит-тесты чистого валидатора приёмки (src/lib/validators/intake.ts).
// Без БД — только валидация (dev-база общая, тесты её не трогают).

import { describe, expect, it } from "vitest";
import {
  MAX_DECIMAL_FIELD,
  MAX_INT_FIELD,
  parsePositiveDecimal,
  parsePositiveInt,
  validateIntake,
  type IntakeInput,
} from "@/lib/validators/intake";

function baseInput(overrides: Partial<IntakeInput> = {}): IntakeInput {
  return {
    stoneTypeId: "st_1",
    newStoneType: false,
    newName: "",
    newRockType: "",
    newColor: "",
    slabsTotal: "40",
    areaTotalM2: "220",
    supplierNote: "",
    arrivedAt: "2026-07-03",
    locations: [{ block: "А", landmark: "2", slabsHere: "", areaHereM2: "" }],
    ...overrides,
  };
}

describe("parsePositiveDecimal", () => {
  it("парсит точку и запятую («12,5» → 12.5)", () => {
    expect(parsePositiveDecimal("12.5")).toBe(12.5);
    expect(parsePositiveDecimal("12,5")).toBe(12.5);
    expect(parsePositiveDecimal(" 220 ")).toBe(220);
  });

  it("пустое поле → null (не заполнено)", () => {
    expect(parsePositiveDecimal("")).toBeNull();
    expect(parsePositiveDecimal("   ")).toBeNull();
  });

  it("отклоняет ноль, отрицательные и мусор → undefined", () => {
    expect(parsePositiveDecimal("0")).toBeUndefined();
    expect(parsePositiveDecimal("0,0")).toBeUndefined();
    expect(parsePositiveDecimal("-5")).toBeUndefined();
    expect(parsePositiveDecimal("abc")).toBeUndefined();
    expect(parsePositiveDecimal("12,5,5")).toBeUndefined();
    expect(parsePositiveDecimal("1e3")).toBeUndefined();
  });

  it("A1: значение на границе Decimal(12,3) проходит, выше — undefined (не 500)", () => {
    expect(parsePositiveDecimal(String(MAX_DECIMAL_FIELD))).toBe(MAX_DECIMAL_FIELD);
    expect(parsePositiveDecimal("999999999.999")).toBe(999999999.999);
    // Выше предела Decimal(12,3) → ошибка валидации, а не переполнение БД.
    expect(parsePositiveDecimal("1000000000")).toBeUndefined();
    expect(parsePositiveDecimal("999999999999999")).toBeUndefined();
  });
});

describe("parsePositiveInt", () => {
  it("парсит целые", () => {
    expect(parsePositiveInt("40")).toBe(40);
    expect(parsePositiveInt(" 1 ")).toBe(1);
  });

  it("пустое поле → null", () => {
    expect(parsePositiveInt("")).toBeNull();
  });

  it("отклоняет дробные, ноль, отрицательные, мусор", () => {
    expect(parsePositiveInt("12.5")).toBeUndefined();
    expect(parsePositiveInt("12,5")).toBeUndefined();
    expect(parsePositiveInt("0")).toBeUndefined();
    expect(parsePositiveInt("-3")).toBeUndefined();
    expect(parsePositiveInt("сорок")).toBeUndefined();
  });

  it("A1: значение на границе (1 000 000) проходит, выше — undefined (не 500)", () => {
    expect(parsePositiveInt(String(MAX_INT_FIELD))).toBe(MAX_INT_FIELD);
    expect(parsePositiveInt("1000000")).toBe(1000000);
    // Выше предела — обычная ошибка поля, а не переполнение Int4 → 500.
    expect(parsePositiveInt("1000001")).toBeUndefined();
    expect(parsePositiveInt("2147483648")).toBeUndefined();
    expect(parsePositiveInt("9007199254740992")).toBeUndefined();
  });
});

describe("validateIntake — вид камня", () => {
  it("принимает существующий вид", () => {
    const r = validateIntake(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.stoneType).toEqual({ kind: "existing", id: "st_1" });
  });

  it("требует выбрать вид, если не новый и id пуст", () => {
    const r = validateIntake(baseInput({ stoneTypeId: "  " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.stoneTypeId).toMatch(/Выберите вид/);
  });

  it("новый вид: название и порода обязательны", () => {
    const r = validateIntake(
      baseInput({ newStoneType: true, newName: "", newRockType: " " }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.newName).toBeTruthy();
      expect(r.errors.newRockType).toBeTruthy();
    }
  });

  it("новый вид: валидный проходит, цвет опционален (пусто → null)", () => {
    const r = validateIntake(
      baseInput({
        newStoneType: true,
        newName: "  Травертин Noce ",
        newRockType: "травертин",
        newColor: "",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.stoneType).toEqual({
        kind: "new",
        name: "Травертин Noce",
        rockType: "травертин",
        color: null,
      });
    }
  });

  it("при newStoneType игнорирует пустой stoneTypeId", () => {
    const r = validateIntake(
      baseInput({
        stoneTypeId: "",
        newStoneType: true,
        newName: "Оникс Зелёный",
        newRockType: "оникс",
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateIntake — количество (минимум одно из двух)", () => {
  it("отклоняет, когда не указано ни плит, ни площади", () => {
    const r = validateIntake(baseInput({ slabsTotal: "", areaTotalM2: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.quantity).toMatch(/минимум одно/);
  });

  it("достаточно только плит", () => {
    const r = validateIntake(baseInput({ slabsTotal: "12", areaTotalM2: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slabsTotal).toBe(12);
      expect(r.data.areaTotalM2).toBeNull();
    }
  });

  it("достаточно только площади, запятая как разделитель", () => {
    const r = validateIntake(baseInput({ slabsTotal: "", areaTotalM2: "60,5" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slabsTotal).toBeNull();
      expect(r.data.areaTotalM2).toBe(60.5);
    }
  });

  it("отклоняет ноль и отрицательные количества", () => {
    const r = validateIntake(baseInput({ slabsTotal: "0", areaTotalM2: "-5" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.slabsTotal).toBeTruthy();
      expect(r.errors.areaTotalM2).toBeTruthy();
    }
  });

  it("отклоняет дробное число плит", () => {
    const r = validateIntake(baseInput({ slabsTotal: "12,5" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.slabsTotal).toBeTruthy();
  });
});

describe("validateIntake — дата прихода", () => {
  it("пустая дата → сегодня", () => {
    const r = validateIntake(baseInput({ arrivedAt: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const diffMs = Math.abs(Date.now() - r.data.arrivedAt.getTime());
      expect(diffMs).toBeLessThan(60_000);
    }
  });

  it("отклоняет неверный формат", () => {
    const r = validateIntake(baseInput({ arrivedAt: "03.07.2026" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.arrivedAt).toBeTruthy();
  });

  it("парсит корректную дату", () => {
    const r = validateIntake(baseInput({ arrivedAt: "2026-06-10" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.arrivedAt.getFullYear()).toBe(2026);
      expect(r.data.arrivedAt.getMonth()).toBe(5);
      expect(r.data.arrivedAt.getDate()).toBe(10);
    }
  });
});

describe("validateIntake — локации", () => {
  it("требует минимум одну локацию", () => {
    const r = validateIntake(baseInput({ locations: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locations).toMatch(/хотя бы одну/);
  });

  it("блок и ориентир обязательны, ошибки адресуются по индексу", () => {
    const r = validateIntake(
      baseInput({
        locations: [
          { block: "А", landmark: "2", slabsHere: "", areaHereM2: "" },
          { block: " ", landmark: "", slabsHere: "", areaHereM2: "" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors["loc-0-block"]).toBeUndefined();
      expect(r.errors["loc-1-block"]).toBeTruthy();
      expect(r.errors["loc-1-landmark"]).toBeTruthy();
    }
  });

  it("плит/м² здесь опциональны, но валидируются при заполнении", () => {
    const r = validateIntake(
      baseInput({
        locations: [{ block: "А", landmark: "2", slabsHere: "-1", areaHereM2: "x" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors["loc-0-slabsHere"]).toBeTruthy();
      expect(r.errors["loc-0-areaHereM2"]).toBeTruthy();
    }
  });

  it("несколько валидных локаций проходят, «12,5» парсится", () => {
    const r = validateIntake(
      baseInput({
        locations: [
          { block: "А", landmark: "1", slabsHere: "25", areaHereM2: "137,5" },
          { block: "Г", landmark: "3", slabsHere: "", areaHereM2: "" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations).toEqual([
        { block: "А", landmark: "1", slabsHere: 25, areaHereM2: 137.5 },
        { block: "Г", landmark: "3", slabsHere: null, areaHereM2: null },
      ]);
    }
  });

  it("ориентир-диапазон «1–2» допустим (свободный формат)", () => {
    const r = validateIntake(
      baseInput({
        locations: [{ block: "Б", landmark: "1–2", slabsHere: "", areaHereM2: "" }],
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateIntake — прочее", () => {
  it("пустой supplierNote → null, непустой сохраняется с trim", () => {
    const r1 = validateIntake(baseInput({ supplierNote: "  " }));
    const r2 = validateIntake(baseInput({ supplierNote: " Инвойс TR-118 " }));
    expect(r1.ok && r1.data.supplierNote).toBeNull();
    expect(r2.ok && r2.data.supplierNote).toBe("Инвойс TR-118");
  });

  it("собирает ошибки сразу по нескольким полям", () => {
    const r = validateIntake(
      baseInput({
        stoneTypeId: "",
        slabsTotal: "",
        areaTotalM2: "",
        locations: [],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ["locations", "quantity", "stoneTypeId"].sort(),
      );
    }
  });
});
