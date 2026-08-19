// Юнит-тесты чистого валидатора приёмки (src/lib/validators/intake.ts).
// Без БД — только валидация (dev-база общая, тесты её не трогают).

import { describe, expect, it } from "vitest";
import {
  MAX_DECIMAL_FIELD,
  MAX_INT_FIELD,
  parsePositiveDecimal,
  parsePositiveInt,
  parseQuantityField,
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
    newDescription: "",
    newBasePrice: "",
    slabsTotal: "40",
    areaTotalM2: "220",
    lengthMm: "280",
    widthMm: "160",
    thicknessMm: "2",
    supplierNote: "",
    arrivedAt: "2026-07-03",
    locations: [{ block: "А", landmark: "2", slabsHere: "", areaHereM2: "" }],
    patternsEnabled: false,
    patterns: [],
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

describe("parseQuantityField (BUG-02 — 0 == пусто только для приёмки)", () => {
  it("пусто/пробелы → null", () => {
    expect(parseQuantityField("", "int")).toBeNull();
    expect(parseQuantityField("   ", "decimal")).toBeNull();
  });

  it("ноль в любой записи → null (не заполнено)", () => {
    expect(parseQuantityField("0", "int")).toBeNull();
    expect(parseQuantityField("00", "int")).toBeNull();
    expect(parseQuantityField("0", "decimal")).toBeNull();
    expect(parseQuantityField("0,0", "decimal")).toBeNull();
    expect(parseQuantityField("0.0", "decimal")).toBeNull();
    expect(parseQuantityField(" 0 ", "int")).toBeNull();
  });

  it("положительное число проходит (int/decimal)", () => {
    expect(parseQuantityField("40", "int")).toBe(40);
    expect(parseQuantityField("220", "decimal")).toBe(220);
    expect(parseQuantityField("12,5", "decimal")).toBe(12.5);
  });

  // Крайний случай (обнаружен ревью): дробь < 1 НЕ должна проглатываться как ноль.
  it("дробь меньше 1 не превращается в null (0,5 / 0.5 / .5)", () => {
    expect(parseQuantityField("0,5", "decimal")).toBe(0.5);
    expect(parseQuantityField("0.5", "decimal")).toBe(0.5);
    expect(parseQuantityField("0,05", "decimal")).toBe(0.05);
  });

  it("отрицательное, текст, дробь в целом, переполнение → undefined", () => {
    expect(parseQuantityField("-5", "decimal")).toBeUndefined();
    expect(parseQuantityField("-3", "int")).toBeUndefined();
    expect(parseQuantityField("abc", "decimal")).toBeUndefined();
    expect(parseQuantityField("12,5", "int")).toBeUndefined();
    expect(parseQuantityField("1000001", "int")).toBeUndefined();
    // Переполнение и по десятичному полю тоже → undefined (не null, не число).
    expect(parseQuantityField(String(MAX_DECIMAL_FIELD + 1), "decimal")).toBeUndefined();
  });
});

describe("validateIntake — толщина дробная (ТЗ №12, решение владельца 2026-08-10)", () => {
  it("принимает «1,8» — плита 18 мм заводится без потери размера", () => {
    const r = validateIntake(baseInput({ thicknessMm: "1,8" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.thicknessMm).toBe(1.8);
  });

  it("принимает точку «1.8» — раскладка не должна мешать складчику", () => {
    const r = validateIntake(baseInput({ thicknessMm: "1.8" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.thicknessMm).toBe(1.8);
  });

  it("целое по-прежнему работает: «2» → 2", () => {
    const r = validateIntake(baseInput({ thicknessMm: "2" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.thicknessMm).toBe(2);
  });

  it("пусто разрешено (толщина необязательна на уровне партии)", () => {
    const r = validateIntake(baseInput({ thicknessMm: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.thicknessMm).toBeNull();
  });

  it("ноль и мусор — ошибка поля, а не тихий null", () => {
    for (const bad of ["0", "-2", "два"]) {
      const r = validateIntake(baseInput({ thicknessMm: bad }));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors.thicknessMm).toBeTruthy();
    }
  });

  it("толщина узор-подгруппы тоже дробная", () => {
    const r = validateIntake(
      baseInput({
        patternsEnabled: true,
        slabsTotal: "50",
        areaTotalM2: "30",
        patterns: [
          {
            description: "светлый",
            lengthMm: "280",
            widthMm: "160",
            thicknessMm: "1,8",
            slabs: "50",
            areaM2: "30",
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.patterns[0].thicknessMm).toBe(1.8);
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
        description: null,
        basePrice: null,
      });
    }
  });

  // W6-C — опциональные «базовые свойства» (§5.1): description + basePrice.
  it("новый вид: description и basePrice опциональны и нормализуются", () => {
    const r = validateIntake(
      baseInput({
        newStoneType: true,
        newName: "Оникс Медовый",
        newRockType: "оникс",
        newColor: "жёлтый",
        newDescription: "  Тёплый рисунок  ",
        newBasePrice: "95,50",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data.stoneType.kind === "new") {
      expect(r.data.stoneType.description).toBe("Тёплый рисунок");
      expect(r.data.stoneType.basePrice).toBe(95.5);
    }
  });

  it("новый вид: пустые description/basePrice не блокируют приёмку", () => {
    const r = validateIntake(
      baseInput({
        newStoneType: true,
        newName: "Гранит Серый",
        newRockType: "гранит",
        newDescription: "   ",
        newBasePrice: "",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data.stoneType.kind === "new") {
      expect(r.data.stoneType.description).toBeNull();
      expect(r.data.stoneType.basePrice).toBeNull();
    }
  });

  it("новый вид: мусорная basePrice → ошибка newBasePrice, приёмка не проходит", () => {
    const r = validateIntake(
      baseInput({
        newStoneType: true,
        newName: "Мрамор",
        newRockType: "мрамор",
        newBasePrice: "abc",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.newBasePrice).toMatch(/Цена/);
  });

  it("новый вид: basePrice выше Decimal(12,2) → ошибка (не 500)", () => {
    const r = validateIntake(
      baseInput({
        newStoneType: true,
        newName: "Мрамор",
        newRockType: "мрамор",
        newBasePrice: "10000000000", // > MAX_DECIMAL_12_2
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.newBasePrice).toBeTruthy();
  });

  it("новый вид: basePrice = 0 допустима (бесплатный прайс/заглушка)", () => {
    const r = validateIntake(
      baseInput({
        newStoneType: true,
        newName: "Демо",
        newRockType: "мрамор",
        newBasePrice: "0",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.data.stoneType.kind === "new") {
      expect(r.data.stoneType.basePrice).toBe(0);
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

  // BUG-02: 0 трактуется КАК ПУСТО для полей приёмки — не ошибка поля.
  it("плиты = 0, площадь = 220 → OK (ноль == не заполнено)", () => {
    const r = validateIntake(baseInput({ slabsTotal: "0", areaTotalM2: "220" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slabsTotal).toBeNull();
      expect(r.data.areaTotalM2).toBe(220);
    }
  });

  it("плиты = 40, площадь = 0 → OK (ноль == не заполнено)", () => {
    const r = validateIntake(baseInput({ slabsTotal: "40", areaTotalM2: "0" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slabsTotal).toBe(40);
      expect(r.data.areaTotalM2).toBeNull();
    }
  });

  it("оба поля = 0 → отклонён с errors.quantity (как и оба пустых)", () => {
    const r = validateIntake(baseInput({ slabsTotal: "0", areaTotalM2: "0,0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.quantity).toMatch(/минимум одно/);
      expect(r.errors.slabsTotal).toBeUndefined();
      expect(r.errors.areaTotalM2).toBeUndefined();
    }
  });

  it("отрицательное/текст по-прежнему ошибка поля (без падения)", () => {
    const r = validateIntake(baseInput({ slabsTotal: "-5", areaTotalM2: "abc" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.slabsTotal).toBeTruthy();
      expect(r.errors.areaTotalM2).toBeTruthy();
      // Оба невалидны (undefined), поэтому правило «минимум одно» не срабатывает.
      expect(r.errors.quantity).toBeUndefined();
    }
  });

  it("десятичная площадь «12,5» принимается", () => {
    const r = validateIntake(baseInput({ slabsTotal: "", areaTotalM2: "12,5" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.areaTotalM2).toBe(12.5);
  });

  // Мусор в одном поле — ошибка поля (не проглатывается), даже если второе валидно.
  it("плиты = «abc», площадь = 220 → ошибка поля плит (мусор не тонет)", () => {
    const r = validateIntake(baseInput({ slabsTotal: "abc", areaTotalM2: "220" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.slabsTotal).toBeTruthy();
      expect(r.errors.quantity).toBeUndefined();
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
        // ТЗ №17 §3.1 — кир. «А» на входе → лат. «A» после нормализации.
        { block: "A", landmark: "1", slabsHere: 25, areaHereM2: 137.5 },
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

describe("validateIntake — узоры в партии (ТЗ №3)", () => {
  const withPatterns = (patterns: {
    description: string;
    lengthMm: "280", widthMm: "160", thicknessMm: string;
    slabs: string;
    areaM2: string;
  }[]) =>
    baseInput({ slabsTotal: "100", areaTotalM2: "60", patternsEnabled: true, patterns });

  it("галочка снята → узоры игнорируются, patterns=[]", () => {
    const r = validateIntake(
      baseInput({
        patternsEnabled: false,
        patterns: [{ description: "x", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "30" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.patterns).toEqual([]);
  });

  it("суммы сходятся (плиты И м²) → ok, узоры разобраны", () => {
    const r = validateIntake(
      withPatterns([
        { description: "светлый", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "30" },
        { description: "тёмный", lengthMm: "280", widthMm: "160", thicknessMm: "3", slabs: "30", areaM2: "18" },
        { description: "серый", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "20", areaM2: "12" },
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.patterns).toHaveLength(3);
      expect(r.data.patterns[0]).toEqual({
        description: "светлый",
        lengthMm: 280,
        widthMm: 160,
        thicknessMm: 2,
        slabs: 50,
        areaM2: 30,
      });
    }
  });

  it("сумма плит НЕ сходится → patternsSum", () => {
    const r = validateIntake(
      withPatterns([
        { description: "a", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "30" },
        { description: "b", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "40", areaM2: "30" }, // 90 ≠ 100
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.patternsSum).toBeDefined();
  });

  it("сумма м² НЕ сходится → patternsSum", () => {
    const r = validateIntake(
      withPatterns([
        { description: "a", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "30" },
        { description: "b", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "25" }, // 55 ≠ 60
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.patternsSum).toBeDefined();
  });

  it("пустое описание узора → pattern-0-description", () => {
    const r = validateIntake(
      withPatterns([
        { description: "  ", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "30" },
        { description: "b", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "50", areaM2: "30" },
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["pattern-0-description"]).toBeDefined();
  });

  it("узоры без тотала м² партии → patternsTotals", () => {
    const r = validateIntake(
      baseInput({
        slabsTotal: "100",
        areaTotalM2: "",
        patternsEnabled: true,
        patterns: [{ description: "a", lengthMm: "280", widthMm: "160", thicknessMm: "2", slabs: "100", areaM2: "60" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.patternsTotals).toBeDefined();
  });

  it("галочка стоит, но узоров нет → patterns", () => {
    const r = validateIntake(
      baseInput({ slabsTotal: "100", areaTotalM2: "60", patternsEnabled: true, patterns: [] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.patterns).toBeDefined();
  });
});
