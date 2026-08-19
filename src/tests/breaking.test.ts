// S2-C — «Разбить камень»: юнит-тесты чистых функций (БЕЗ БД).
// Нормативные источники: TZ §5.5/§5.6/§6.4; data-model.md §1.5, §2, §3.
import { describe, expect, it } from "vitest";
import {
  BreakError,
  BREAK_CAUSES,
  BREAK_CAUSE_NOTE_MAX,
  MIN_SIDES,
  assertValidPieceInput,
  canBreak,
  estimatePieceAreaM2,
  parseBreakCause,
  parsePieceRow,
  parseSidesMm,
  validateSidesMm,
  type PieceInput,
  type RawPieceRow,
} from "@/lib/breaking";

describe("parseBreakCause — TZ §5.6 taxonomy", () => {
  it("empty → fail (required)", () => {
    expect(parseBreakCause("").ok).toBe(false);
    expect(parseBreakCause(null).ok).toBe(false);
  });

  it("spec example codes map to Russian labels", () => {
    for (const c of BREAK_CAUSES) {
      const r = parseBreakCause(c.code);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.cause.code).toBe(c.code);
        expect(r.cause.labelRu).toBe(c.labelRu);
      }
    }
  });

  it("OTHER may carry optional note; note too long fails", () => {
    const ok = parseBreakCause("OTHER", "  стеклопакет  ");
    expect(ok).toEqual({
      ok: true,
      cause: {
        code: "OTHER",
        labelRu: "Другое",
        otherNote: "стеклопакет",
      },
    });
    const long = "x".repeat(BREAK_CAUSE_NOTE_MAX + 1);
    expect(parseBreakCause("OTHER", long).ok).toBe(false);
  });

  it("unknown code → fail", () => {
    expect(parseBreakCause("EXPLOSION").ok).toBe(false);
  });
});

describe("parseSidesMm — «118, 64, 95, 610» → [числа]", () => {
  it("парсит запятые с пробелами", () => {
    expect(parseSidesMm("118, 64, 95, 610")).toEqual([118, 64, 95, 610]);
  });

  it("парсит точки с запятой и просто пробелы", () => {
    expect(parseSidesMm("118;64;95")).toEqual([118, 64, 95]);
    expect(parseSidesMm("118 64 95")).toEqual([118, 64, 95]);
  });

  it(`меньше ${MIN_SIDES} сторон → null (форма минимум треугольник)`, () => {
    expect(parseSidesMm("118, 64")).toBeNull();
    expect(parseSidesMm("")).toBeNull();
  });

  it("мусор, дробные, ноль и отрицательные → null", () => {
    expect(parseSidesMm("118, abc, 95")).toBeNull();
    expect(parseSidesMm("118, 64.5, 95")).toBeNull();
    expect(parseSidesMm("118, 0, 95")).toBeNull();
    expect(parseSidesMm("118, -64, 95")).toBeNull();
  });
});

describe("validateSidesMm — защита на границе БД", () => {
  it("валидный массив", () => {
    expect(validateSidesMm([118, 64, 95])).toBe(true);
  });
  it("не массив / коротко / не целые положительные", () => {
    expect(validateSidesMm("118,64,95")).toBe(false);
    expect(validateSidesMm([118, 64])).toBe(false);
    expect(validateSidesMm([118, 64, 0])).toBe(false);
    expect(validateSidesMm([118, 64, 1.5])).toBe(false);
  });
});

describe("canBreak — data-model.md §2, переходы 3/6/9 и запреты", () => {
  it("AVAILABLE → можно, бронь не трогается (переход 3)", () => {
    expect(canBreak("AVAILABLE")).toEqual({ allowed: true, cancelsReservation: false });
  });

  it("RESERVED → можно, бронь авто-отменяется (переход 6)", () => {
    expect(canBreak("RESERVED")).toEqual({ allowed: true, cancelsReservation: true });
  });

  it("RETURNED → можно (переход 9 — вернулся битым)", () => {
    expect(canBreak("RETURNED")).toEqual({ allowed: true, cancelsReservation: false });
  });

  it("SOLD → явный запрет", () => {
    const r = canBreak("SOLD");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("SLAB_SOLD");
  });

  it("BROKEN_OFFCUT → явный запрет (терминал для Slab)", () => {
    const r = canBreak("BROKEN_OFFCUT");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe("SLAB_ALREADY_BROKEN");
  });

  it("SAMPLE → запрет (TZ №10: плита у клиента как образец)", () => {
    const r = canBreak("SAMPLE");
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe("SLAB_IN_SAMPLE");
      expect(r.message).toMatch(/образец/i);
    }
  });
});

describe("estimatePieceAreaM2 — средняя плита партии (§3)", () => {
  it("220 м² / 40 плит = 5.5", () => {
    expect(estimatePieceAreaM2(220, 40)).toBeCloseTo(5.5, 9);
  });
  it("нет площади или нет штук → null (контроль отключён)", () => {
    expect(estimatePieceAreaM2(null, 40)).toBeNull();
    expect(estimatePieceAreaM2(220, null)).toBeNull();
    expect(estimatePieceAreaM2(220, 0)).toBeNull();
  });
});

const validRow: RawPieceRow = {
  kind: "BROKEN",
  sidesMm: "118, 64, 95, 61",
  boundingLengthMm: "118",
  boundingWidthMm: "64",
  thicknessMm: "2",
  areaM2: "0,6",
  block: "А",
  landmark: "2",
};

describe("parsePieceRow — строка формы → PieceInput", () => {
  it("валидная строка: все поля распарсены, «0,6» → 0.6", () => {
    const r = parsePieceRow(validRow);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        kind: "BROKEN",
        sidesMm: [118, 64, 95, 61],
        boundingLengthMm: 118,
        boundingWidthMm: 64,
        thicknessMm: 2,
        areaM2: 0.6,
        block: "A", // ТЗ №17 §3.1 — кир. «А» на входе → лат. «A»
        landmark: "2",
      });
    }
  });

  it("толщина и площадь необязательны (пусто → null)", () => {
    const r = parsePieceRow({ ...validRow, thicknessMm: "", areaM2: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.thicknessMm).toBeNull();
      expect(r.data.areaM2).toBeNull();
    }
  });

  it("BUG-01 (ТЗ №4): «Стороны» пусто → ok, стороны = прямоугольник [Д,Ш,Д,Ш]", () => {
    const r = parsePieceRow({ ...validRow, sidesMm: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Длина 118, ширина 64 → прямоугольник.
      expect(r.data.sidesMm).toEqual([118, 64, 118, 64]);
      expect(r.data.boundingLengthMm).toBe(118);
      expect(r.data.boundingWidthMm).toBe(64);
    }
  });

  it("BUG-01: «Стороны» пусто, но габариты обязательны — без длины/ширины ошибка", () => {
    const r = parsePieceRow({
      ...validRow,
      sidesMm: "",
      boundingLengthMm: "",
      boundingWidthMm: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.boundingLengthMm).toBeTruthy();
      expect(r.errors.boundingWidthMm).toBeTruthy();
      expect(r.errors.sidesMm).toBeUndefined(); // стороны пусты — это ок
    }
  });

  it("«Стороны» заданы, но их меньше 3 → ошибка (это не многоугольник)", () => {
    const r = parsePieceRow({ ...validRow, sidesMm: "118, 64" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sidesMm).toBeTruthy();
  });

  it("ошибки адресованы полям: kind, стороны, габариты, локация", () => {
    const r = parsePieceRow({
      kind: "WHOLE",
      sidesMm: "118, 64",
      boundingLengthMm: "0",
      boundingWidthMm: "",
      thicknessMm: "тонкая",
      areaM2: "-1",
      block: " ",
      landmark: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual([
        "areaM2",
        "block",
        "boundingLengthMm",
        "boundingWidthMm",
        "kind",
        "landmark",
        "sidesMm",
        "thicknessMm",
      ]);
    }
  });

  it("bounding-габариты проверяются только на положительность (форма произвольная)", () => {
    // bounding больше максимальной стороны — НЕ ошибка: доказать соответствие
    // в общем случае нельзя, а мешать складчику — против TZ §9.
    const r = parsePieceRow({ ...validRow, boundingLengthMm: "99999" });
    expect(r.ok).toBe(true);
  });
});

const validPiece: PieceInput = {
  kind: "OFFCUT",
  sidesMm: [145, 80, 145, 80],
  boundingLengthMm: 145,
  boundingWidthMm: 800,
  thicknessMm: 2,
  areaM2: 1.16,
  block: "В",
  landmark: "3",
};

describe("assertValidPieceInput — вход не из формы (Telegram-бот)", () => {
  it("валидный кусок проходит", () => {
    expect(() => assertValidPieceInput(validPiece)).not.toThrow();
  });

  it("битые стороны / габариты / локация → BreakError(INVALID_PIECE)", () => {
    const cases: PieceInput[] = [
      { ...validPiece, sidesMm: [145, 80] },
      { ...validPiece, boundingLengthMm: 0 },
      { ...validPiece, boundingWidthMm: -5 },
      // ТЗ №12 + решение владельца 2026-08-10: ДРОБНАЯ толщина теперь валидна
      // (18 мм = 1,8 см), поэтому 1.5 переехало в список допустимых ниже.
      // Здесь остаётся то, что и должно падать: ноль, минус, за пределом NUMERIC(5,1).
      { ...validPiece, thicknessMm: 0 },
      { ...validPiece, thicknessMm: -2 },
      { ...validPiece, thicknessMm: 10_000 },
      { ...validPiece, areaM2: 0 },
      { ...validPiece, block: "  " },
      { ...validPiece, landmark: "" },
    ];
    for (const bad of cases) {
      try {
        assertValidPieceInput(bad);
        expect.unreachable("ожидалась BreakError");
      } catch (err) {
        expect(err).toBeInstanceOf(BreakError);
        expect((err as BreakError).code).toBe("INVALID_PIECE");
      }
    }
  });

  it("A1: см-габариты сверх 1 000 000 → INVALID_PIECE (не Int4-переполнение → 500)", () => {
    const overCap: PieceInput[] = [
      { ...validPiece, boundingLengthMm: 1_000_001 },
      { ...validPiece, boundingWidthMm: 2_147_483_648 },
      { ...validPiece, thicknessMm: 5_000_000 },
      { ...validPiece, areaM2: 1_000_000_000 }, // > Decimal(12,3)
    ];
    for (const bad of overCap) {
      try {
        assertValidPieceInput(bad);
        expect.unreachable("ожидалась BreakError");
      } catch (err) {
        expect(err).toBeInstanceOf(BreakError);
        expect((err as BreakError).code).toBe("INVALID_PIECE");
      }
    }
  });

  it("A1: значения ровно на границе допустимы", () => {
    expect(() =>
      assertValidPieceInput({
        ...validPiece,
        boundingLengthMm: 1_000_000,
        boundingWidthMm: 1_000_000,
        // Толщина — своя граница: NUMERIC(5,1), не Int4 (ТЗ №12, дробные см).
        thicknessMm: 9999.9,
        areaM2: 999_999_999.999,
      }),
    ).not.toThrow();
  });

  it("ТЗ №12: дробная толщина принимается — 18 мм это 1,8 см", () => {
    // Ровно тот случай, ради которого менялся тип: раньше 1,8 не сохранить,
    // складчик был вынужден писать 2 и терять реальный размер камня.
    expect(() =>
      assertValidPieceInput({ ...validPiece, thicknessMm: 1.8 }),
    ).not.toThrow();
    expect(() =>
      assertValidPieceInput({ ...validPiece, thicknessMm: 1.5 }),
    ).not.toThrow();
  });
});
