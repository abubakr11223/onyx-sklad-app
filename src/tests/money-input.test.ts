// Money price input: group for display, bare digits for sale-payment validator.
import { describe, expect, it } from "vitest";
import {
  applyMoneyInputChange,
  formatMoneyGrouped,
  normalizeMoneyForSubmit,
} from "@/app/prodazha/money-input";
import { validateSalePayment } from "@/lib/validators/sale-payment";

describe("normalizeMoneyForSubmit — what the server receives", () => {
  it("strips grouping spaces (ASCII + NBSP)", () => {
    expect(normalizeMoneyForSubmit("200 007 666")).toBe("200007666");
    expect(normalizeMoneyForSubmit("200\u00A0007\u00A0666")).toBe("200007666");
    expect(normalizeMoneyForSubmit("13 400,50")).toBe("13400.50");
  });

  it("accepts paste with mixed separators", () => {
    expect(normalizeMoneyForSubmit("1 234 567.89")).toBe("1234567.89");
    expect(normalizeMoneyForSubmit("$13,400.50".replace("$", ""))).toBe(
      "13400.50",
    );
  });

  it("preserves decimals (max 2 for submit)", () => {
    expect(normalizeMoneyForSubmit("13400.50")).toBe("13400.50");
    expect(normalizeMoneyForSubmit("13400,5")).toBe("13400.5");
    expect(normalizeMoneyForSubmit("13400,567")).toBe("13400.56");
  });

  it("empty → empty", () => {
    expect(normalizeMoneyForSubmit("")).toBe("");
    expect(normalizeMoneyForSubmit("   ")).toBe("");
  });
});

describe("formatMoneyGrouped — display matches app style (space groups)", () => {
  it("groups thousands with spaces like debts-ui / ru-RU", () => {
    expect(formatMoneyGrouped("200007666")).toBe("200 007 666");
    expect(formatMoneyGrouped("200 007 666")).toBe("200 007 666");
    expect(formatMoneyGrouped("13400")).toBe("13 400");
  });

  it("keeps decimal part (comma in display)", () => {
    expect(formatMoneyGrouped("13400.50")).toBe("13 400,50");
    expect(formatMoneyGrouped("13400,50")).toBe("13 400,50");
  });

  it("allows trailing separator while typing", () => {
    expect(formatMoneyGrouped("13400,")).toBe("13 400,");
    expect(formatMoneyGrouped("13400.")).toBe("13 400,");
  });
});

describe("applyMoneyInputChange — caret does not jump to end blindly", () => {
  it("keeps caret after same significant count when grouping grows", () => {
    // Typing "2000" → "2 000"; caret after last digit stays after last digit.
    const r = applyMoneyInputChange("2000", 4);
    expect(r.display).toBe("2 000");
    expect(r.submit).toBe("2000");
    expect(r.caret).toBe(5); // after "2 000"
  });

  it("paste of grouped value normalizes submit", () => {
    const r = applyMoneyInputChange("200 007 666", 11);
    expect(r.display).toBe("200 007 666");
    expect(r.submit).toBe("200007666");
  });
});

describe("value that reaches validateSalePayment is accepted", () => {
  it("grouped display → normalize → validator OK", () => {
    const submit = normalizeMoneyForSubmit("200 007 666");
    const r = validateSalePayment({
      paymentMethod: "CREDIT",
      currency: "UZS",
      price: submit,
      customerContact: "+998901112233",
      debtDueDate: "",
      debtComment: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.price).toBe(200007666);
  });

  it("decimal USD path", () => {
    const submit = normalizeMoneyForSubmit("13 400,50");
    expect(submit).toBe("13400.50");
    const r = validateSalePayment({
      paymentMethod: "CASH",
      currency: "USD",
      price: submit,
      customerContact: "",
      debtDueDate: "",
      debtComment: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.price).toBe(13400.5);
  });

  it("raw grouped string WITHOUT normalize would fail (regression guard)", () => {
    const r = validateSalePayment({
      paymentMethod: "CASH",
      currency: "UZS",
      price: "200 007 666",
      customerContact: "",
      debtDueDate: "",
      debtComment: "",
    });
    expect(r.ok).toBe(false);
  });
});
