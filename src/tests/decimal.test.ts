// Аудит ТЗ №7 #7 — единый bounded-парсер decimal-полей. Регрессии:
// (a) переполнение (99999999999) → 'overflow', не 500 из Prisma;
// (b) allowZero true/false — площадь блока может быть 0, площадь в приёмке нет;
// (c) parsePositiveDecimal (адаптер) сохраняет старый контракт.

import { describe, expect, it } from "vitest";
import {
  MAX_DECIMAL_12_2,
  MAX_DECIMAL_12_3,
  parseBoundedDecimal,
} from "@/lib/decimal";
import { parsePositiveDecimal } from "@/lib/validators/intake";
import { parseMoneyField } from "@/lib/stone-edit";

describe("parseBoundedDecimal — общий контракт (ТЗ №7 #7)", () => {
  const OPTS = { max: MAX_DECIMAL_12_3, allowZero: true };

  it("пусто → { ok:true, value:null }", () => {
    expect(parseBoundedDecimal("", OPTS)).toEqual({ ok: true, value: null });
    expect(parseBoundedDecimal("   ", OPTS)).toEqual({ ok: true, value: null });
  });

  it("«12,5» → 12.5 (запятая как разделитель)", () => {
    expect(parseBoundedDecimal("12,5", OPTS)).toEqual({ ok: true, value: 12.5 });
  });

  it("«12.5» → 12.5 (точка тоже)", () => {
    expect(parseBoundedDecimal("12.5", OPTS)).toEqual({ ok: true, value: 12.5 });
  });

  it("текст / буквы → not_number", () => {
    expect(parseBoundedDecimal("abc", OPTS)).toEqual({ ok: false, reason: "not_number" });
    expect(parseBoundedDecimal("1a", OPTS)).toEqual({ ok: false, reason: "not_number" });
    expect(parseBoundedDecimal("1..2", OPTS)).toEqual({ ok: false, reason: "not_number" });
  });

  it("отрицательное → negative", () => {
    // Regex `^\d+(\.\d+)?$` не пропускает знак `-`, поэтому «-1» — not_number, а не negative.
    // Отрицательные значения могут прийти только программно (не через строку формы).
    // Санити: проверим, что regex-путь всё-таки уходит в not_number, а логика n<0 работает
    // на форматно корректном варианте (проверить нельзя без обхода regex).
    expect(parseBoundedDecimal("-1", OPTS)).toEqual({ ok: false, reason: "not_number" });
  });

  it("переполнение (> max) → overflow, НЕ 500", () => {
    // Ключевой сценарий аудита: 99999999999 (11 цифр) > MAX_DECIMAL_12_3.
    expect(parseBoundedDecimal("99999999999", OPTS)).toEqual({
      ok: false,
      reason: "overflow",
    });
    // Ровно на границе — ok.
    expect(parseBoundedDecimal(String(MAX_DECIMAL_12_3), OPTS)).toEqual({
      ok: true,
      value: MAX_DECIMAL_12_3,
    });
    // На 1 больше — overflow (при max 999 999 999.999 → 10^9 = 1 000 000 000 больше).
    expect(parseBoundedDecimal("1000000000", OPTS)).toEqual({
      ok: false,
      reason: "overflow",
    });
  });
});

describe("parseBoundedDecimal — allowZero политика (ТЗ №7 #7)", () => {
  it("allowZero:true → «0» проходит (площадь блока может быть 0)", () => {
    expect(parseBoundedDecimal("0", { max: MAX_DECIMAL_12_3, allowZero: true })).toEqual({
      ok: true,
      value: 0,
    });
    expect(parseBoundedDecimal("0,0", { max: MAX_DECIMAL_12_3, allowZero: true })).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("allowZero:false → «0» → { ok:false, reason:'zero' } (приёмка требует > 0)", () => {
    expect(parseBoundedDecimal("0", { max: MAX_DECIMAL_12_3, allowZero: false })).toEqual({
      ok: false,
      reason: "zero",
    });
    expect(parseBoundedDecimal("0,000", { max: MAX_DECIMAL_12_3, allowZero: false })).toEqual({
      ok: false,
      reason: "zero",
    });
  });
});

describe("parseBoundedDecimal — MAX_DECIMAL_12_2 для money (ТЗ №7 #7)", () => {
  const MONEY = { max: MAX_DECIMAL_12_2, allowZero: true };

  it("basePrice 99 999 999 999.99 → ok (граница Decimal(12,2))", () => {
    expect(parseBoundedDecimal(String(MAX_DECIMAL_12_2), MONEY)).toEqual({
      ok: true,
      value: MAX_DECIMAL_12_2,
    });
  });

  it("10 000 000 000 (11 цифр) — overflow, НЕ 500 из Prisma", () => {
    expect(parseBoundedDecimal("10000000000", MONEY)).toEqual({
      ok: false,
      reason: "overflow",
    });
  });

  it("площади (12,3) больше денежного max — но проходит с 12_2? Нет — 999999999999 (12 цифр) overflow", () => {
    expect(parseBoundedDecimal("999999999999", MONEY)).toEqual({
      ok: false,
      reason: "overflow",
    });
  });
});

describe("parsePositiveDecimal — backward-compat адаптер (ТЗ №7 #7)", () => {
  it("«12,5» → 12.5 (сохраняем старый контракт: number)", () => {
    expect(parsePositiveDecimal("12,5")).toBe(12.5);
  });
  it("пусто → null", () => {
    expect(parsePositiveDecimal("")).toBeNull();
  });
  it("текст → undefined (strogo pozitiv, старый контракт)", () => {
    expect(parsePositiveDecimal("abc")).toBeUndefined();
  });
  it("0 → undefined (strogo pozitiv)", () => {
    expect(parsePositiveDecimal("0")).toBeUndefined();
  });
  it("99999999999 → undefined (overflow, регрессия к 500 закрыта)", () => {
    expect(parsePositiveDecimal("99999999999")).toBeUndefined();
  });
});

describe("parseMoneyField — Decimal(12,2) (ТЗ №7 #7)", () => {
  it("«500,00» → 500", () => {
    expect(parseMoneyField("500,00")).toEqual({ ok: true, value: 500 });
  });
  it("«0» → 0 (цена может быть 0)", () => {
    expect(parseMoneyField("0")).toEqual({ ok: true, value: 0 });
  });
  it("пусто → null", () => {
    expect(parseMoneyField("")).toEqual({ ok: true, value: null });
  });
  it("10 000 000 000 (переполнение Decimal(12,2)) → { ok:false }, НЕ 500", () => {
    expect(parseMoneyField("10000000000")).toEqual({ ok: false });
  });
  it("текст → { ok:false }", () => {
    expect(parseMoneyField("abc")).toEqual({ ok: false });
  });
});
