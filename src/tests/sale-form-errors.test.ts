// Salebug — confirmation step must list qty errors (previously silent).
// Pure contract of which keys the UI must treat as submit failures.
import { describe, expect, it } from "vitest";

/**
 * Mirrors SaleForm step-4 fieldErrorItems construction.
 * Regression: qty / qtySlabs / qtyAreaM2 were omitted → owner saw nothing.
 */
function fieldErrorItems(errors: Record<string, string>): string[] {
  return [
    errors.form,
    errors.qty,
    errors.qtySlabs,
    errors.qtyAreaM2,
    errors.clientId,
    errors.customerName,
    errors.customerContact,
    errors.siteId,
    errors.paymentMethod,
    errors.price,
    errors.currency,
    errors.debtDueDate,
    errors.debtComment,
  ].filter((msg): msg is string => Boolean(msg));
}

describe("SaleForm confirmation error surface", () => {
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
});
