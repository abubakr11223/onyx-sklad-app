// Salebug — confirmation step must list qty errors (previously silent).
// MUST import production helper — a local copy would not catch SaleForm drift.
// round2: unknown keys must ALSO surface (allowlist drift no longer silent).
import { describe, expect, it } from "vitest";
import {
  fieldErrorItems,
  SALE_FORM_ERROR_KEYS,
  sampleFieldErrorItems,
  SAMPLE_FORM_ERROR_KEYS,
} from "@/app/prodazha/sale-form-errors";
import { leftoverErrorMessages } from "@/lib/form-errors";

describe("SaleForm confirmation error surface", () => {
  it("exports keys that include clientId and qty* (production contract)", () => {
    expect(SALE_FORM_ERROR_KEYS).toContain("clientId");
    expect(SALE_FORM_ERROR_KEYS).toContain("qtyAreaM2");
    expect(SALE_FORM_ERROR_KEYS).toContain("qtySlabs");
  });

  it("includes qtyAreaM2 validation error (space in area field)", () => {
    const items = fieldErrorItems({
      qtyAreaM2:
        "Площадь — одно число без пробелов (дробь через запятую: 12,5 или 55)",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/без пробелов/);
  });

  it("includes form-level error", () => {
    const items = fieldErrorItems({ form: "Нет доступа" });
    expect(items).toContain("Нет доступа");
  });

  it("includes clientId validation error (TZ №10+11 §6)", () => {
    const items = fieldErrorItems({
      clientId: "Выберите или создайте клиента — обязательное поле",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/клиент/i);
  });

  it("empty errors → no banner items", () => {
    expect(fieldErrorItems({})).toEqual([]);
  });

  it("unknown error key still surfaces (structural leftover — never silent)", () => {
    // THE round2 contract: allowlist drift must not drop messages.
    const items = fieldErrorItems({
      totallyUnknown: "x",
    } as Record<string, string>);
    expect(items).toEqual(["x"]);
  });

  it("preferred keys keep order; unknown appends after", () => {
    const items = fieldErrorItems({
      totallyUnknown: "future key",
      clientId: "need client",
      form: "form msg",
    } as Record<string, string>);
    expect(items[0]).toBe("form msg");
    expect(items).toContain("need client");
    expect(items[items.length - 1]).toBe("future key");
  });

  it("leftoverErrorMessages matches what fieldErrorItems would miss without ordered append", () => {
    const errors = { brandNewValidatorKey: "blocked" } as Record<string, string>;
    expect(leftoverErrorMessages(errors, SALE_FORM_ERROR_KEYS)).toEqual([
      "blocked",
    ]);
    expect(fieldErrorItems(errors)).toEqual(["blocked"]);
  });
});

describe("sampleFieldErrorItems — same leftover contract on sample path", () => {
  it("exports sample preferred keys", () => {
    expect(SAMPLE_FORM_ERROR_KEYS).toContain("returnDueDate");
    expect(SAMPLE_FORM_ERROR_KEYS).toContain("clientId");
  });

  it("unknown sample key still surfaces", () => {
    expect(
      sampleFieldErrorItems({ weirdSampleKey: "must show" } as Record<
        string,
        string
      >),
    ).toEqual(["must show"]);
  });

  it("known sample keys + leftover", () => {
    const items = sampleFieldErrorItems({
      returnDueDate: "need date",
      extra: "also",
    } as Record<string, string>);
    expect(items).toEqual(["need date", "also"]);
  });
});
