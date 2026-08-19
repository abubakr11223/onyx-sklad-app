// ТЗ №7 §2 (BUG-01) + ТЗ №17 §3.1 — нормализация кода блока: кир/лат дубли,
// регистр, единый алфавит = ЛАТИНИЦА (совпадает с бумажным планом склада).
import { describe, expect, it } from "vitest";
import { isLatinBlockCode, normalizeBlockLetter } from "@/lib/block-letter";

describe("normalizeBlockLetter — единый алфавит (латиница) + верхний регистр", () => {
  it("кириллические двойники → латиница (заглавные)", () => {
    expect(normalizeBlockLetter("Е")).toBe("E");
    expect(normalizeBlockLetter("А")).toBe("A");
    expect(normalizeBlockLetter("В")).toBe("B");
    expect(normalizeBlockLetter("С")).toBe("C");
    expect(normalizeBlockLetter("Н")).toBe("H");
    expect(normalizeBlockLetter("К")).toBe("K");
    expect(normalizeBlockLetter("М")).toBe("M");
    expect(normalizeBlockLetter("О")).toBe("O");
    expect(normalizeBlockLetter("Р")).toBe("P");
    expect(normalizeBlockLetter("Т")).toBe("T");
    expect(normalizeBlockLetter("Х")).toBe("X");
    expect(normalizeBlockLetter("У")).toBe("Y");
  });

  it("нижний регистр приводится к верхнему (а → A, e → E)", () => {
    expect(normalizeBlockLetter("а")).toBe("A");
    expect(normalizeBlockLetter("e")).toBe("E");
    expect(normalizeBlockLetter("т")).toBe("T");
  });

  it("латиница остаётся собой (D → D, F → F)", () => {
    expect(normalizeBlockLetter("D")).toBe("D");
    expect(normalizeBlockLetter("d")).toBe("D");
    expect(normalizeBlockLetter("f")).toBe("F");
    expect(normalizeBlockLetter("z")).toBe("Z");
  });

  it("кириллица БЕЗ латинского двойника не транслитерируется (Б, Д, Ж)", () => {
    // Критично: «Б» → «B» слилось бы с «В» → «B» — два разных блока стали бы
    // одним. Переименование делает зав. склада вручную (ТЗ №17 §4).
    expect(normalizeBlockLetter("Б")).toBe("Б");
    expect(normalizeBlockLetter("д")).toBe("Д");
    expect(normalizeBlockLetter("Ж")).toBe("Ж");
  });

  it("ТЗ №17 §3.2 — код ряда «A1» проходит целиком, посимвольно", () => {
    expect(normalizeBlockLetter("a1")).toBe("A1");
    expect(normalizeBlockLetter("В2")).toBe("B2"); // кир. «В» + цифра
    expect(normalizeBlockLetter(" d3 ")).toBe("D3");
    expect(normalizeBlockLetter("s1")).toBe("S1");
    expect(normalizeBlockLetter("К3")).toBe("K3");
  });

  it("обрезает пробелы", () => {
    expect(normalizeBlockLetter("  в  ")).toBe("B");
    expect(normalizeBlockLetter("")).toBe("");
    expect(normalizeBlockLetter("   ")).toBe("");
  });

  it("критичный кейс BUG-01: «E» (лат.) и «Е» (кир.) сходятся в одно место", () => {
    expect(normalizeBlockLetter("E")).toBe(normalizeBlockLetter("Е"));
    expect(normalizeBlockLetter("a")).toBe(normalizeBlockLetter("А"));
    expect(normalizeBlockLetter("b2")).toBe(normalizeBlockLetter("В2"));
  });
});

describe("isLatinBlockCode — ТЗ №17 §3.1", () => {
  it("латинские коды с плана — валидны", () => {
    for (const code of ["A1", "B2", "D3", "G1", "H2", "K3", "S1", "F1-2", "A 1"]) {
      expect(isLatinBlockCode(code)).toBe(true);
    }
  });

  it("остатки кириллицы без двойника — невалидны", () => {
    expect(isLatinBlockCode(normalizeBlockLetter("Б"))).toBe(false);
    expect(isLatinBlockCode(normalizeBlockLetter("Д"))).toBe(false);
    expect(isLatinBlockCode(normalizeBlockLetter("Ж1"))).toBe(false);
  });

  it("двойники после нормализации проходят (кир. «В2» → «B2»)", () => {
    expect(isLatinBlockCode(normalizeBlockLetter("В2"))).toBe(true);
    expect(isLatinBlockCode(normalizeBlockLetter("Е"))).toBe(true);
  });

  it("пустую строку не считает нелатинской (её ловит проверка пустоты)", () => {
    expect(isLatinBlockCode("")).toBe(true);
  });
});
