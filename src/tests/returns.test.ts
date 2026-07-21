// ВОЗВРАТ от клиента (TZ §4.3) + распил → SaleRecord (TZ §5.6/§8) — чистые
// решения без БД. Транзакционные returnSale/confirmReturnedUnit/splitSlab
// (реверс статуса, декремент счётчиков, идемпотентность) проверяются вручную
// на живой БД; здесь — доменные правила-предикаты и инвариант «нет двойного
// списания» (SaleRecord не входит в формулу свободного остатка §3).
import { describe, expect, it } from "vitest";
import { decideConfirmReturn, decideReturn } from "@/lib/sales";
import { computeFreeRemainder } from "@/lib/inventory";

describe("decideReturn — право и идемпотентность возврата (TZ §4.3)", () => {
  it("OWNER/MANAGER могут оформить возврат непогашенной продажи", () => {
    expect(decideReturn({ actingRole: "OWNER", alreadyReturned: false })).toEqual({
      ok: true,
    });
    expect(decideReturn({ actingRole: "MANAGER", alreadyReturned: false })).toEqual({
      ok: true,
    });
  });

  it("WAREHOUSE/PARTNER возврат оформить не могут (FORBIDDEN_ROLE)", () => {
    for (const actingRole of ["WAREHOUSE", "PARTNER"] as const) {
      const d = decideReturn({ actingRole, alreadyReturned: false });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.error.code).toBe("FORBIDDEN_ROLE");
    }
  });

  it("повторный возврат уже возвращённой продажи запрещён (ALREADY_RETURNED)", () => {
    const d = decideReturn({ actingRole: "MANAGER", alreadyReturned: true });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("ALREADY_RETURNED");
  });

  it("роль проверяется РАНЬШЕ идемпотентности (нет утечки состояния роли)", () => {
    // Даже по уже возвращённой продаже склад получает отказ по роли, а не «уже
    // возвращено» — право первично.
    const d = decideReturn({ actingRole: "WAREHOUSE", alreadyReturned: true });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("decideConfirmReturn — «проверено → в наличии» только из RETURNED", () => {
  it("RETURNED + OWNER/MANAGER → ok", () => {
    expect(
      decideConfirmReturn({ actingRole: "OWNER", unitStatus: "RETURNED" }),
    ).toEqual({ ok: true });
    expect(
      decideConfirmReturn({ actingRole: "MANAGER", unitStatus: "RETURNED" }),
    ).toEqual({ ok: true });
  });

  it("любой НЕ-RETURNED статус нельзя подтвердить в наличие (NOT_RETURNED)", () => {
    for (const unitStatus of [
      "AVAILABLE",
      "RESERVED",
      "SOLD",
      "BROKEN_OFFCUT",
    ] as const) {
      const d = decideConfirmReturn({ actingRole: "MANAGER", unitStatus });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.error.code).toBe("NOT_RETURNED");
    }
  });

  it("подтверждать может только OWNER/MANAGER (FORBIDDEN_ROLE)", () => {
    for (const actingRole of ["WAREHOUSE", "PARTNER"] as const) {
      const d = decideConfirmReturn({ actingRole, unitStatus: "RETURNED" });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.error.code).toBe("FORBIDDEN_ROLE");
    }
  });

  it("RETURNED → AVAILABLE достижимо ТОЛЬКО через проверку (нет прямого пути)", () => {
    // Единственная ветвь ok — из RETURNED; из AVAILABLE подтверждение отклонено,
    // значит «тихого» возврата в наличие в обход проверки нет.
    const fromAvailable = decideConfirmReturn({
      actingRole: "OWNER",
      unitStatus: "AVAILABLE",
    });
    expect(fromAvailable.ok).toBe(false);
  });
});

describe("распил → SaleRecord: нет двойного списания остатка (TZ §5.6/§8, §3)", () => {
  // Инвариант: SaleRecord НЕ является входом computeFreeRemainder. Плита
  // списывается из остатка САМИМ распилом (переход в BROKEN_OFFCUT — она в числе
  // separatedSlabs; куски-остатки originSlabId в формулу §3 НЕ входят).
  // Добавление SaleRecord для проданной части остаток не двигает.
  const batch = {
    slabsTotal: 10,
    areaTotalM2: 50, // средняя плита 5 м²
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 0,
    areaSoldDirectM2: 0,
  };

  it("распиленная плита списана один раз (счётчик количества)", () => {
    // 1 выделенная плита (любого статуса, в т.ч. BROKEN_OFFCUT) → −1 к остатку.
    const before = computeFreeRemainder(batch, [], []);
    expect(before.slabsFree).toBe(10);

    const afterSplit = computeFreeRemainder(batch, [{ areaM2: 5 }], []);
    expect(afterSplit.slabsFree).toBe(9); // −1, а не −2
    expect(afterSplit.areaFreeM2).toBe(45); // −5 м², однократно
  });

  it("куски-остатки из распила (originSlabId) в остаток НЕ входят — не переданы", () => {
    // Вызывающий (§3-контракт) кладёт в directPieces ТОЛЬКО прямой бой
    // (originSlabId IS NULL). Куски распила исключены → повторного минуса нет.
    const afterSplitWithRemainderPieces = computeFreeRemainder(
      batch,
      [{ areaM2: 5 }],
      [], // куски распила НЕ передаются (у них originSlabId заполнен)
    );
    expect(afterSplitWithRemainderPieces.slabsFree).toBe(9);
    expect(afterSplitWithRemainderPieces.areaFreeM2).toBe(45);
  });
});
