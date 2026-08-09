// ReserveForm leftover contract — unmounted target/qty + unknown keys.
import { describe, expect, it } from "vitest";
import {
  RESERVE_FORM_ERROR_KEYS,
  reserveErrorItems,
  reserveRenderedKeys,
} from "@/app/bron/reserve-form-errors";
import {
  ensureFormError,
  leftoverErrorMessages,
} from "@/lib/form-errors";

describe("reserveErrorItems", () => {
  it("includes preferred keys in stable order", () => {
    expect(RESERVE_FORM_ERROR_KEYS).toContain("target");
    expect(RESERVE_FORM_ERROR_KEYS).toContain("qtySlabs");
  });

  it("unknown key still surfaces", () => {
    expect(
      reserveErrorItems({ totallyUnknown: "must show" } as Record<
        string,
        string
      >),
    ).toEqual(["must show"]);
  });

  it("target without stone selected is a leftover of mount set", () => {
    const errors = { target: "Выберите камень" };
    const rendered = reserveRenderedKeys({
      stoneSelected: false,
      isBatch: false,
    });
    expect(rendered).not.toContain("target");
    expect(leftoverErrorMessages(errors, rendered)).toEqual([
      "Выберите камень",
    ]);
    // Preferred banner still lists it even when field unmounted
    expect(reserveErrorItems(errors)).toContain("Выберите камень");
  });

  it("qty keys leftover when not batch", () => {
    const errors = { qtySlabs: "Укажите количество" };
    const rendered = reserveRenderedKeys({
      stoneSelected: true,
      isBatch: false,
    });
    expect(leftoverErrorMessages(errors, rendered)).toEqual([
      "Укажите количество",
    ]);
  });
});

describe("createReservation ensureFormError shape", () => {
  it("field-only errors get form after ensureFormError", () => {
    const errors = ensureFormError({ target: "Выберите камень" });
    expect(errors.form).toBe("Выберите камень");
  });
});
