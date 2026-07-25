// ТЗ №7 §2 (BUG-01) — нормализация буквы блока: кир/лат дубли и регистр.
import { describe, expect, it } from "vitest";
import { normalizeBlockLetter } from "@/lib/block-letter";

describe("normalizeBlockLetter — единый алфавит (кириллица) + верхний регистр", () => {
  it("латинские двойники → кириллица (заглавные)", () => {
    expect(normalizeBlockLetter("E")).toBe("Е");
    expect(normalizeBlockLetter("A")).toBe("А");
    expect(normalizeBlockLetter("B")).toBe("В");
    expect(normalizeBlockLetter("C")).toBe("С");
    expect(normalizeBlockLetter("H")).toBe("Н");
    expect(normalizeBlockLetter("K")).toBe("К");
    expect(normalizeBlockLetter("M")).toBe("М");
    expect(normalizeBlockLetter("O")).toBe("О");
    expect(normalizeBlockLetter("P")).toBe("Р");
    expect(normalizeBlockLetter("T")).toBe("Т");
    expect(normalizeBlockLetter("X")).toBe("Х");
    expect(normalizeBlockLetter("Y")).toBe("У");
  });

  it("нижний регистр приводится к верхнему (a → А, e → Е)", () => {
    expect(normalizeBlockLetter("a")).toBe("А");
    expect(normalizeBlockLetter("e")).toBe("Е");
    expect(normalizeBlockLetter("т")).toBe("Т");
  });

  it("кириллица остаётся собой (Е → Е, Ж → Ж)", () => {
    expect(normalizeBlockLetter("Е")).toBe("Е");
    expect(normalizeBlockLetter("е")).toBe("Е");
    expect(normalizeBlockLetter("Ж")).toBe("Ж");
    expect(normalizeBlockLetter("Д")).toBe("Д");
  });

  it("латиница без кириллического двойника — только верхний регистр (d → D)", () => {
    expect(normalizeBlockLetter("d")).toBe("D");
    expect(normalizeBlockLetter("F")).toBe("F");
    expect(normalizeBlockLetter("z")).toBe("Z");
  });

  it("обрезает пробелы", () => {
    expect(normalizeBlockLetter("  b  ")).toBe("В");
    expect(normalizeBlockLetter("")).toBe("");
    expect(normalizeBlockLetter("   ")).toBe("");
  });

  it("критичный кейс BUG-01: «E» (лат.) и «Е» (кир.) сходятся в одно место", () => {
    expect(normalizeBlockLetter("E")).toBe(normalizeBlockLetter("Е"));
    // и регистр: «a» и «A» — тоже одно
    expect(normalizeBlockLetter("a")).toBe(normalizeBlockLetter("A"));
  });
});
