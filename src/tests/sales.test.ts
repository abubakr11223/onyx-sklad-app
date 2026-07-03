// S2-B — чистые решения продажи (без БД). Нормативная база:
// docs/data-model.md §2 (переходы 2 и 4, запреты), §3 (охрана объёмной
// продажи, оптовый выкуп TZ §7.6), TZ §7.1/§7.4/§7.5.
import { describe, expect, it } from "vitest";
import {
  checkVolumeSaleGuard,
  computeWholeBatchSale,
  decideUnitSale,
  roleCanSell,
  type UnitSaleDecisionInput,
} from "@/lib/sales";

const MANAGER_A = "mgr-a";
const MANAGER_B = "mgr-b";

function baseInput(over: Partial<UnitSaleDecisionInput> = {}): UnitSaleDecisionInput {
  return {
    unitStatus: "AVAILABLE",
    needsCheck: false,
    activeReservationManagerId: null,
    actingManagerId: MANAGER_A,
    actingRole: "MANAGER",
    ...over,
  };
}

describe("roleCanSell — матрица ролей (data-model §1.7)", () => {
  it("продают только OWNER и MANAGER", () => {
    expect(roleCanSell("OWNER")).toBe(true);
    expect(roleCanSell("MANAGER")).toBe(true);
    expect(roleCanSell("WAREHOUSE")).toBe(false);
    expect(roleCanSell("PARTNER")).toBe(false);
  });
});

describe("decideUnitSale — переходы §2", () => {
  it("AVAILABLE → SOLD (переход №2): ok, без брони", () => {
    const d = decideUnitSale(baseInput());
    expect(d).toEqual({ ok: true, expectedStatus: "AVAILABLE", viaReservation: false });
  });

  it("RESERVED своей бронью → SOLD (переход №4): ok, бронь гасится", () => {
    const d = decideUnitSale(
      baseInput({ unitStatus: "RESERVED", activeReservationManagerId: MANAGER_A }),
    );
    expect(d).toEqual({ ok: true, expectedStatus: "RESERVED", viaReservation: true });
  });

  it("RESERVED чужой бронью → запрет «забронирован другим менеджером» (TZ §7.5)", () => {
    const d = decideUnitSale(
      baseInput({ unitStatus: "RESERVED", activeReservationManagerId: MANAGER_B }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.error.code).toBe("RESERVED_BY_OTHER");
      expect(d.error.message).toContain("забронирован другим менеджером");
    }
  });

  it("RESERVED чужой бронью, но действует OWNER → ok (переход №4: «или Owner»)", () => {
    const d = decideUnitSale(
      baseInput({
        unitStatus: "RESERVED",
        activeReservationManagerId: MANAGER_B,
        actingManagerId: "owner-1",
        actingRole: "OWNER",
      }),
    );
    expect(d).toEqual({ ok: true, expectedStatus: "RESERVED", viaReservation: true });
  });

  it("RESERVED без активной брони (рассинхрон) → CONFLICT", () => {
    const d = decideUnitSale(baseInput({ unitStatus: "RESERVED" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("CONFLICT");
  });

  it("SOLD → «уже продан»", () => {
    const d = decideUnitSale(baseInput({ unitStatus: "SOLD" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("ALREADY_SOLD");
  });

  it("BROKEN_OFFCUT терминален — продажа запрещена", () => {
    const d = decideUnitSale(baseInput({ unitStatus: "BROKEN_OFFCUT" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("INVALID_STATUS");
  });

  it("RETURNED — только через проверку, продажа запрещена", () => {
    const d = decideUnitSale(baseInput({ unitStatus: "RETURNED" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("INVALID_STATUS");
  });

  it("needsCheck=true блокирует продажу даже у AVAILABLE (TZ §7.4)", () => {
    const d = decideUnitSale(baseInput({ needsCheck: true }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("NEEDS_CHECK");
  });

  it("needsCheck=true блокирует и продажу из-под своей брони", () => {
    const d = decideUnitSale(
      baseInput({
        unitStatus: "RESERVED",
        needsCheck: true,
        activeReservationManagerId: MANAGER_A,
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("NEEDS_CHECK");
  });

  it("WAREHOUSE / PARTNER не продают", () => {
    for (const actingRole of ["WAREHOUSE", "PARTNER"] as const) {
      const d = decideUnitSale(baseInput({ actingRole }));
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.error.code).toBe("FORBIDDEN_ROLE");
    }
  });
});

describe("checkVolumeSaleGuard — охрана объёмной продажи (§3)", () => {
  const free = { slabsFree: 10, areaFreeM2: 55 };
  const noHolds = { othersReservedSlabs: 0, othersReservedAreaM2: 0 };

  it("в пределах остатка → ok", () => {
    expect(
      checkVolumeSaleGuard({ free, ...noHolds, qtySlabs: 10, qtyAreaM2: 55 }),
    ).toEqual({ ok: true });
  });

  it("ровно на границе с чужой бронью → ok", () => {
    expect(
      checkVolumeSaleGuard({
        free,
        othersReservedSlabs: 4,
        othersReservedAreaM2: 20,
        qtySlabs: 6,
        qtyAreaM2: 35,
      }),
    ).toEqual({ ok: true });
  });

  it("плит больше остатка → INSUFFICIENT_REMAINDER", () => {
    const r = checkVolumeSaleGuard({ free, ...noHolds, qtySlabs: 11, qtyAreaM2: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
  });

  it("м² больше остатка → INSUFFICIENT_REMAINDER", () => {
    const r = checkVolumeSaleGuard({ free, ...noHolds, qtySlabs: null, qtyAreaM2: 55.001 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
  });

  it("чужая volume-бронь уменьшает доступное (data-model §3)", () => {
    const r = checkVolumeSaleGuard({
      free,
      othersReservedSlabs: 5,
      othersReservedAreaM2: 30,
      qtySlabs: 6,
      qtyAreaM2: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
      expect(r.error.message).toContain("чужой бронью");
    }
  });

  it("контроль по измерению отключён (free = null) → по нему проверки нет", () => {
    expect(
      checkVolumeSaleGuard({
        free: { slabsFree: null, areaFreeM2: 12 },
        ...noHolds,
        qtySlabs: 999,
        qtyAreaM2: 12,
      }),
    ).toEqual({ ok: true });
  });

  it("двоичная погрешность м² не даёт ложный отказ (эпсилон)", () => {
    // 0.1 + 0.2 > 0.3 в float — эпсилон должен это гасить.
    expect(
      checkVolumeSaleGuard({
        free: { slabsFree: null, areaFreeM2: 0.3 },
        ...noHolds,
        qtySlabs: null,
        qtyAreaM2: 0.1 + 0.2,
      }),
    ).toEqual({ ok: true });
  });

  it("пустой объём / ноль / дробные плиты → INVALID_INPUT", () => {
    for (const [qtySlabs, qtyAreaM2] of [
      [null, null],
      [0, null],
      [-1, null],
      [1.5, null],
      [null, 0],
      [null, -3],
    ] as const) {
      const r = checkVolumeSaleGuard({ free, ...noHolds, qtySlabs, qtyAreaM2 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("INVALID_INPUT");
    }
  });
});

describe("computeWholeBatchSale — оптовый выкуп партии (TZ §7.6)", () => {
  it("весь свободный остаток уходит в продажу", () => {
    expect(computeWholeBatchSale({ slabsFree: 7, areaFreeM2: 38.5 })).toEqual({
      ok: true,
      qtySlabs: 7,
      qtyAreaM2: 38.5,
    });
  });

  it("площадь округляется до 3 знаков (Decimal(12,3))", () => {
    const r = computeWholeBatchSale({ slabsFree: null, areaFreeM2: 12.3456789 });
    expect(r).toEqual({ ok: true, qtySlabs: null, qtyAreaM2: 12.346 });
  });

  it("нулевой/отрицательный остаток по измерению → null по нему", () => {
    expect(computeWholeBatchSale({ slabsFree: 0, areaFreeM2: 5 })).toEqual({
      ok: true,
      qtySlabs: null,
      qtyAreaM2: 5,
    });
    expect(computeWholeBatchSale({ slabsFree: 3, areaFreeM2: -0.2 })).toEqual({
      ok: true,
      qtySlabs: 3,
      qtyAreaM2: null,
    });
  });

  it("продавать нечего (остаток пуст) → INSUFFICIENT_REMAINDER", () => {
    for (const free of [
      { slabsFree: 0, areaFreeM2: 0 },
      { slabsFree: null, areaFreeM2: null },
      { slabsFree: 0, areaFreeM2: null },
    ]) {
      const r = computeWholeBatchSale(free);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
    }
  });
});
