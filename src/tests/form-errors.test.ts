// Structural silent-form guard (round2 / sweep tz1415).
import { describe, expect, it } from "vitest";
import {
  ensureFormError,
  leftoverErrorMessages,
  orderedErrorMessages,
} from "@/lib/form-errors";

describe("leftoverErrorMessages", () => {
  it("returns messages for keys not in the rendered set", () => {
    const leftovers = leftoverErrorMessages(
      { clientId: "need client", totallyUnknown: "secret reject", form: "x" },
      ["form", "clientId"],
    );
    expect(leftovers).toEqual(["secret reject"]);
  });

  it("empty / whitespace messages ignored", () => {
    expect(
      leftoverErrorMessages({ ghost: "  ", ok: "hi" }, ["ok"]),
    ).toEqual([]);
  });

  it("dedupes identical leftover messages", () => {
    expect(
      leftoverErrorMessages(
        { a: "same", b: "same" },
        [] as string[],
      ),
    ).toEqual(["same"]);
  });
});

describe("orderedErrorMessages", () => {
  it("preferred keys first, then unknown leftover keys", () => {
    const items = orderedErrorMessages(
      {
        qtyAreaM2: "bad area",
        totallyUnknown: "x from future validator",
        form: "check form",
      },
      ["form", "qtyAreaM2", "clientId"],
    );
    expect(items).toEqual([
      "check form",
      "bad area",
      "x from future validator",
    ]);
  });

  it("unknown key alone still surfaces (contract: never silent)", () => {
    const items = orderedErrorMessages(
      { __testOnly: "must reach the user" },
      ["form", "clientId"],
    );
    expect(items).toContain("must reach the user");
    expect(items).toHaveLength(1);
  });

  it("dedupes form mirror of first field error", () => {
    const items = orderedErrorMessages(
      { form: "need client", clientId: "need client" },
      ["form", "clientId"],
    );
    expect(items).toEqual(["need client"]);
  });
});

describe("ensureFormError", () => {
  it("sets form from first field when form missing", () => {
    const errors: Record<string, string> = { clientId: "Выберите клиента" };
    ensureFormError(errors);
    expect(errors.form).toBe("Выберите клиента");
    expect(errors.clientId).toBe("Выберите клиента");
  });

  it("does not overwrite existing form", () => {
    const errors: Record<string, string> = {
      form: "Нет доступа",
      clientId: "x",
    };
    ensureFormError(errors);
    expect(errors.form).toBe("Нет доступа");
  });

  it("no-op on empty map", () => {
    const errors: Record<string, string> = {};
    ensureFormError(errors);
    expect(errors).toEqual({});
  });
});
