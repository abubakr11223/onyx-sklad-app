// BreakForm leftover — soldPart edge + unknown keys.
import { describe, expect, it } from "vitest";
import {
  breakErrorItems,
  breakLeftoverItems,
  breakRenderedKeys,
  BREAK_FORM_STATIC_KEYS,
} from "@/app/razbit/break-form-errors";
import { ensureFormError } from "@/lib/form-errors";

describe("breakRenderedKeys / leftovers", () => {
  it("soldPart fields unmounted when soldPart=false → leftover", () => {
    const rendered = breakRenderedKeys({
      mode: "slab",
      soldPart: false,
      pieceRowCount: 1,
    });
    expect(rendered).not.toContain("soldCustomerName");
    expect(rendered).not.toContain("soldPrice");
    const leftovers = breakLeftoverItems(
      { soldCustomerName: "Укажите, кому ушла часть" },
      rendered,
    );
    expect(leftovers).toEqual(["Укажите, кому ушла часть"]);
  });

  it("soldPart mounted → soldCustomerName not leftover", () => {
    const rendered = breakRenderedKeys({
      mode: "slab",
      soldPart: true,
      pieceRowCount: 1,
    });
    expect(rendered).toContain("soldCustomerName");
    expect(
      breakLeftoverItems(
        { soldCustomerName: "x" },
        rendered,
      ),
    ).toEqual([]);
  });

  it("unknown key always leftover when not preferred static", () => {
    expect(
      breakErrorItems({ weirdFuture: "blocked" } as Record<string, string>),
    ).toEqual(["blocked"]);
  });

  it("static keys include soldPart fields", () => {
    expect(BREAK_FORM_STATIC_KEYS).toContain("soldCustomerName");
    expect(BREAK_FORM_STATIC_KEYS).toContain("soldPrice");
  });
});

describe("ensureFormError on break field map", () => {
  it("slabId-only → form set", () => {
    const e = ensureFormError({ slabId: "Выберите плиту" });
    expect(e.form).toBe("Выберите плиту");
  });
});
