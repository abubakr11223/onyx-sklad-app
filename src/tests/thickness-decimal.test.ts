// ТЗ №12 + решение владельца 2026-08-10 — толщина в ДРОБНЫХ сантиметрах.
//
// Миграция 20260807120000 перевела все размеры в сантиметры целыми числами.
// Для длины и ширины это верно (275×185 см), для толщины — нет: на складе
// есть плиты 18 мм, то есть 1,8 см. В целых сантиметрах их пришлось бы
// записывать как 2 и терять реальный размер камня — а размер это то, ради
// чего ТЗ №12 вообще писалось.
//
// Длина и ширина ОСТАЮТСЯ целыми: лишнее изменение типа — лишний риск.
import { describe, expect, it } from "vitest";
import {
  MAX_THICKNESS_CM,
  formatDim,
  formatGabarit,
  formatThickness,
  parseThicknessCm,
  thicknessToNumber,
} from "@/lib/dimensions";

describe("parseThicknessCm — ввод из формы", () => {
  it("принимает целое: «2» → 2", () => {
    expect(parseThicknessCm("2")).toBe(2);
  });

  it("принимает запятую (как печатают на складе): «1,8» → 1.8", () => {
    expect(parseThicknessCm("1,8")).toBe(1.8);
  });

  it("принимает точку: «1.8» → 1.8", () => {
    expect(parseThicknessCm("1.8")).toBe(1.8);
  });

  it("18 мм записывается — ровно тот случай, ради которого менялся тип", () => {
    expect(parseThicknessCm("1,8")).toBe(1.8);
    expect(parseThicknessCm("1,8")).not.toBe(2);
  });

  it("пусто → null (толщина необязательна)", () => {
    expect(parseThicknessCm("")).toBeNull();
    expect(parseThicknessCm("   ")).toBeNull();
  });

  it("ноль, минус и мусор → undefined (ошибка ввода)", () => {
    expect(parseThicknessCm("0")).toBeUndefined();
    expect(parseThicknessCm("-2")).toBeUndefined();
    expect(parseThicknessCm("два")).toBeUndefined();
    expect(parseThicknessCm("2 см")).toBeUndefined();
    expect(parseThicknessCm("1,8,5")).toBeUndefined();
  });

  it("за пределом NUMERIC(5,1) → undefined, а не молчаливая порча в БД", () => {
    expect(parseThicknessCm(String(MAX_THICKNESS_CM))).toBe(MAX_THICKNESS_CM);
    expect(parseThicknessCm("10000")).toBeUndefined();
  });

  it("округляет до 0,1 СРАЗУ — пользователь видит то, что сохранится", () => {
    // Иначе «1,84» превратилось бы в 1,8 уже после записи, без объяснения.
    expect(parseThicknessCm("1,84")).toBe(1.8);
    expect(parseThicknessCm("1,86")).toBe(1.9);
  });
});

describe("formatThickness — вывод", () => {
  it("целое показывается без хвоста: 2 → «2»", () => {
    expect(formatThickness(2)).toBe("2");
    expect(formatThickness(2.0)).toBe("2");
  });

  it("дробное — с запятой (ru): 1.8 → «1,8»", () => {
    expect(formatThickness(1.8)).toBe("1,8");
  });

  it("пусто → «—»", () => {
    expect(formatThickness(null)).toBe("—");
    expect(formatThickness(undefined)).toBe("—");
    expect(formatThickness(Number.NaN)).toBe("—");
  });
});

describe("длина и ширина остаются целыми", () => {
  it("formatDim по-прежнему округляет — 275,4 → «275»", () => {
    expect(formatDim(275.4)).toBe("275");
    expect(formatDim(275)).toBe("275");
  });

  it("габарит: целые Д×Ш, дробная толщина", () => {
    expect(formatGabarit(275, 185, 1.8)).toBe("275×185×1,8 см");
    expect(formatGabarit(275, 185, 2)).toBe("275×185×2 см");
    expect(formatGabarit(275, 185)).toBe("275×185 см");
  });
});

describe("thicknessToNumber — граница с Prisma Decimal", () => {
  it("Decimal-подобный объект → number", () => {
    // Prisma отдаёт Decimal; в JSX его рендерить нельзя, поэтому конвертируем
    // на границе чтения, а не «где-нибудь потом».
    expect(thicknessToNumber({ toString: () => "1.8" })).toBe(1.8);
    expect(thicknessToNumber({ toString: () => "2" })).toBe(2);
  });

  it("number проходит как есть", () => {
    expect(thicknessToNumber(1.8)).toBe(1.8);
  });

  it("null / мусор → null", () => {
    expect(thicknessToNumber(null)).toBeNull();
    expect(thicknessToNumber(undefined)).toBeNull();
    expect(thicknessToNumber({ toString: () => "не число" })).toBeNull();
  });
});

describe("схема БД соответствует решению", () => {
  it("все четыре колонки толщины — Decimal(5,1), а не Int", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const schema = readFileSync(
      join(process.cwd(), "prisma", "schema.prisma"),
      "utf8",
    );
    const lines = schema
      .split("\n")
      .filter((l) => /^\s*thicknessMm\s/.test(l));
    expect(lines).toHaveLength(4); // Batch, BatchPattern, Slab, Piece
    for (const l of lines) {
      expect(l).toContain("Decimal?");
      expect(l).toContain("@db.Decimal(5, 1)");
    }
  });
});
