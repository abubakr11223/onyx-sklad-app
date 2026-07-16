// S2-C — «Разбить камень»: юнит-тесты чистых функций (БЕЗ БД).
// Нормативные источники: TZ §5.5/§5.6/§6.4; data-model.md §1.5, §2, §3.
import { describe, expect, it } from "vitest";
import {
  BreakError,
  MIN_SIDES,
  assertValidPieceInput,
  canBreak,
  estimatePieceAreaM2,
  parsePieceRow,
  parseSidesMm,
  validateSidesMm,
  type PieceInput,
  type RawPieceRow,
} from "@/lib/breaking";

describe("parseSidesMm — «1180, 640, 950, 610» → [числа]", () => {
  it("парсит запятые с пробелами", () => {
    expect(parseSidesMm("1180, 640, 950, 610")).toEqual([1180, 640, 950, 610]);
  });

  it("парсит точки с запятой и просто пробелы", () => {
    expect(parseSidesMm("1180;640;950")).toEqual([1180, 640, 950]);
    expect(parseSidesMm("1180 640 950")).toEqual([1180, 640, 950]);
  });

  it(`меньше ${MIN_SIDES} сторон → null (форма минимум треугольник)`, () => {
    expect(parseSidesMm("1180, 640")).toBeNull();
    expect(parseSidesMm("")).toBeNull();
  });

  it("мусор, дробные, ноль и отрицательные → null", () => {
    expect(parseSidesMm("1180, abc, 950")).toBeNull();
    expect(parseSidesMm("1180, 640.5, 950")).toBeNull();
    expect(parseSidesMm("1180, 0, 950")).toBeNull();
    expect(parseSidesMm("1180, -640, 950")).toBeNull();
  });
});

describe("validateSidesMm — защита на границе БД", () => {
  it("валидный массив", () => {
    expect(validateSidesMm([1180, 640, 950])).toBe(true);
  });
  it("не массив / коротко / не целые положительные", () => {
    expect(validateSidesMm("1180,640,950")).toBe(false);
    expect(validateSidesMm([1180, 640])).toBe(false);
    expect(validateSidesMm([1180, 640, 0])).toBe(false);
    expect(validateSidesMm([1180, 640, 1.5])).toBe(false);
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
  sidesMm: "1180, 640, 950, 610",
  boundingLengthMm: "1180",
  boundingWidthMm: "640",
  thicknessMm: "20",
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
        sidesMm: [1180, 640, 950, 610],
        boundingLengthMm: 1180,
        boundingWidthMm: 640,
        thicknessMm: 20,
        areaM2: 0.6,
        block: "А",
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

  it("ошибки адресованы полям: kind, стороны, габариты, локация", () => {
    const r = parsePieceRow({
      kind: "WHOLE",
      sidesMm: "1180, 640",
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
  sidesMm: [1450, 800, 1450, 800],
  boundingLengthMm: 1450,
  boundingWidthMm: 800,
  thicknessMm: 20,
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
      { ...validPiece, sidesMm: [1450, 800] },
      { ...validPiece, boundingLengthMm: 0 },
      { ...validPiece, boundingWidthMm: -5 },
      { ...validPiece, thicknessMm: 1.5 },
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

  it("A1: мм-габариты сверх 1 000 000 → INVALID_PIECE (не Int4-переполнение → 500)", () => {
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
        thicknessMm: 1_000_000,
        areaM2: 999_999_999.999,
      }),
    ).not.toThrow();
  });
});
