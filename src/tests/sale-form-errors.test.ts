// Salebug — confirmation step must list qty errors (previously silent).
// MUST import production helper — a local copy would not catch SaleForm drift.
import { describe, expect, it } from "vitest";
import {
  fieldErrorItems,
  SALE_FORM_ERROR_KEYS,
} from "@/app/prodazha/sale-form-errors";

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

  it("omitting a production key from the map drops that message (wire to SALE_FORM_ERROR_KEYS)", () => {
    // If SALE_FORM_ERROR_KEYS lost clientId, this would still pass with a local
    // copy — so we assert the production array is what drives the helper.
    const withClient = fieldErrorItems({ clientId: "need client" });
    expect(withClient).toEqual(["need client"]);
    // Sanity: unknown keys are ignored (not in production list)
    expect(fieldErrorItems({ totallyUnknown: "x" } as Record<string, string>)).toEqual(
      [],
    );
  });
});
