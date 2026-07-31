// SK-2 — sof «проверить» (пересорт) helperlari testlari (DB YO'Q).
// Normativ manba: TZ, обработка ошибок «Камень нашли, но по факту его нет →
// помечается «проверить»».
import { describe, expect, it } from "vitest";
import {
  buildCheckPayload,
  isValidCheckEntity,
  parseCheckValue,
  sortNeedsCheckLast,
} from "@/lib/checks";

describe("isValidCheckEntity — allowlist guard", () => {
  it("Batch/Slab/Piece → true", () => {
    expect(isValidCheckEntity("Batch")).toBe(true);
    expect(isValidCheckEntity("Slab")).toBe(true);
    expect(isValidCheckEntity("Piece")).toBe(true);
  });

  it("пустая строка → false", () => {
    expect(isValidCheckEntity("")).toBe(false);
  });

  it("неправильный регистр «batch» → false", () => {
    expect(isValidCheckEntity("batch")).toBe(false);
    expect(isValidCheckEntity("SLAB")).toBe(false);
  });

  it("посторонняя модель «User» и произвольная строка → false", () => {
    expect(isValidCheckEntity("User")).toBe(false);
    expect(isValidCheckEntity("BatchLocation")).toBe(false);
    expect(isValidCheckEntity("foo")).toBe(false);
  });
});

describe("parseCheckValue — разбор булевого из формы", () => {
  it("«1»/«true» (с триммингом/регистром) → true", () => {
    expect(parseCheckValue("1")).toBe(true);
    expect(parseCheckValue("true")).toBe(true);
    expect(parseCheckValue("  TRUE  ")).toBe(true);
    expect(parseCheckValue(" 1 ")).toBe(true);
  });

  it("«0»/«false»/пусто/мусор/null → false", () => {
    expect(parseCheckValue("0")).toBe(false);
    expect(parseCheckValue("false")).toBe(false);
    expect(parseCheckValue("")).toBe(false);
    expect(parseCheckValue("yes")).toBe(false);
    expect(parseCheckValue(null)).toBe(false);
    expect(parseCheckValue(undefined)).toBe(false);
  });
});

describe("sortNeedsCheckLast — needsCheck items sink", () => {
  it("false first, true last; relative order among equals preserved", () => {
    const items = [
      { id: "a", needsCheck: true },
      { id: "b", needsCheck: false },
      { id: "c", needsCheck: true },
      { id: "d", needsCheck: false },
    ];
    expect(sortNeedsCheckLast(items).map((x) => x.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("empty / all clear → identity order", () => {
    expect(sortNeedsCheckLast([])).toEqual([]);
    expect(
      sortNeedsCheckLast([
        { id: "1", needsCheck: false },
        { id: "2", needsCheck: false },
      ]).map((x) => x.id),
    ).toEqual(["1", "2"]);
  });
});

describe("buildCheckPayload — аудит STATUS_CHANGE", () => {
  it("установка отметки (false → true)", () => {
    expect(buildCheckPayload("Batch", false, true)).toEqual({
      entity: "Batch",
      needsCheck: { from: false, to: true },
    });
  });

  it("снятие отметки (true → false)", () => {
    expect(buildCheckPayload("Slab", true, false)).toEqual({
      entity: "Slab",
      needsCheck: { from: true, to: false },
    });
  });

  it("сущность попадает в payload как есть (Piece)", () => {
    expect(buildCheckPayload("Piece", false, true)).toEqual({
      entity: "Piece",
      needsCheck: { from: false, to: true },
    });
  });
});
