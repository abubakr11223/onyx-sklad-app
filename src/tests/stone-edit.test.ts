// OWN-02 — валидация правок карточки камня (чистая логика).
import { describe, expect, it } from "vitest";
import {
  parseMoneyField,
  parseProperties,
  validateStoneEdit,
  type StoneEditInput,
} from "@/lib/stone-edit";

const base: StoneEditInput = {
  name: "Травертин Classic",
  rockType: "травертин",
  color: "бежевый",
  description: "тёплый тон",
  basePrice: "95",
  purchasePrice: "60",
  properties: "finish: полированный\norigin: Турция",
};

describe("parseMoneyField", () => {
  it("пусто → null (цена не задана)", () => {
    expect(parseMoneyField("")).toEqual({ ok: true, value: null });
    expect(parseMoneyField("   ")).toEqual({ ok: true, value: null });
  });
  it("число (точка и запятая) → значение", () => {
    expect(parseMoneyField("95")).toEqual({ ok: true, value: 95 });
    expect(parseMoneyField("95,5")).toEqual({ ok: true, value: 95.5 });
  });
  it("отрицательное / текст → ошибка", () => {
    expect(parseMoneyField("-1").ok).toBe(false);
    expect(parseMoneyField("abc").ok).toBe(false);
  });
  it("ноль допустим (бесплатно/сброс)", () => {
    expect(parseMoneyField("0")).toEqual({ ok: true, value: 0 });
  });
});

describe("parseProperties", () => {
  it("строки «ключ: значение» → объект", () => {
    expect(parseProperties("finish: полированный\norigin: Турция")).toEqual({
      finish: "полированный",
      origin: "Турция",
    });
  });
  it("пустые и битые строки пропускаются; ничего валидного → null", () => {
    expect(parseProperties("\n  \nбез двоеточия\n: пустой ключ")).toBeNull();
  });
  it("значение с двоеточием внутри сохраняется целиком", () => {
    expect(parseProperties("time: 10:30")).toEqual({ time: "10:30" });
  });
});

describe("validateStoneEdit", () => {
  it("корректный ввод → нормализованные значения", () => {
    const r = validateStoneEdit(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Травертин Classic");
      expect(r.value.basePrice).toBe(95);
      expect(r.value.purchasePrice).toBe(60);
      expect(r.value.properties).toEqual({
        finish: "полированный",
        origin: "Турция",
      });
    }
  });
  it("пустое имя → error name", () => {
    const r = validateStoneEdit({ ...base, name: "   " });
    expect(r).toEqual({ ok: false, error: "name" });
  });
  it("пустая порода → error rockType", () => {
    const r = validateStoneEdit({ ...base, rockType: "" });
    expect(r).toEqual({ ok: false, error: "rockType" });
  });
  it("плохая цена → error basePrice", () => {
    const r = validateStoneEdit({ ...base, basePrice: "-5" });
    expect(r).toEqual({ ok: false, error: "basePrice" });
  });
  it("пустые необязательные поля → null (не пустые строки)", () => {
    const r = validateStoneEdit({
      ...base,
      color: "",
      description: "",
      purchasePrice: "",
      properties: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.color).toBeNull();
      expect(r.value.description).toBeNull();
      expect(r.value.purchasePrice).toBeNull();
      expect(r.value.properties).toBeNull();
    }
  });
});
