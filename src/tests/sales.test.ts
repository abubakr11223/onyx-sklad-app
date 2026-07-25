// S2-B — чистые решения продажи (без БД). Нормативная база:
// docs/data-model.md §2 (переходы 2 и 4, запреты), §3 (охрана объёмной
// продажи, оптовый выкуп TZ §7.6), TZ §7.1/§7.4/§7.5.
import { describe, expect, it, vi } from "vitest";
import {
  checkPatternSaleGuard,
  checkVolumeSaleGuard,
  computeWholeBatchSale,
  decideUnitSale,
  executeVolumeSale,
  isHoldEffective,
  roleCanSell,
  selectCoveredOwnHolds,
  selectOwnHoldsToComplete,
  sumEffectiveOthersHolds,
  type UnitSaleDecisionInput,
  type VolumeHoldRow,
} from "@/lib/sales";

const MANAGER_A = "mgr-a";
const MANAGER_B = "mgr-b";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-07-16T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 24 * HOUR);
const PAST = new Date(NOW.getTime() - HOUR);

function hold(over: Partial<VolumeHoldRow> = {}): VolumeHoldRow {
  return {
    id: "res-1",
    managerId: MANAGER_A,
    qtySlabs: null,
    qtyAreaM2: null,
    expiresAt: FUTURE,
    createdAt: NOW,
    ...over,
  };
}

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

  it("A1-b: объём сверх предела → INVALID_INPUT ДО инкремента (m²-only партия)", () => {
    // slabsFree = null (контроль плит отключён) — иначе огромный qtySlabs
    // проскочил бы охрану и переполнил Int4 slabsSoldDirect.
    const mFree = { slabsFree: null, areaFreeM2: null };
    const overSlabs = checkVolumeSaleGuard({
      ...noHolds,
      free: mFree,
      qtySlabs: 1_000_001,
      qtyAreaM2: null,
    });
    expect(overSlabs.ok).toBe(false);
    if (!overSlabs.ok) expect(overSlabs.error.code).toBe("INVALID_INPUT");

    const overArea = checkVolumeSaleGuard({
      ...noHolds,
      free: mFree,
      qtySlabs: null,
      qtyAreaM2: 1_000_000_000,
    });
    expect(overArea.ok).toBe(false);
    if (!overArea.ok) expect(overArea.error.code).toBe("INVALID_INPUT");
  });

  it("A1-b: ровно на пределе (без учёта остатка) охрана по величине пропускает", () => {
    // slabsFree/areaFreeM2 = null → проверка достаточности не работает,
    // но и переполнения нет: значение на границе типа — валидно.
    expect(
      checkVolumeSaleGuard({
        ...noHolds,
        free: { slabsFree: null, areaFreeM2: null },
        qtySlabs: 1_000_000,
        qtyAreaM2: 999_999_999.999,
      }),
    ).toEqual({ ok: true });
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

  it("площадь усекается до 3 знаков (Decimal(12,3)) — Math.floor, НЕ round-up (ТЗ №7 #21)", () => {
    // Раньше Math.round давал 12.346 (round-up). Теперь Math.floor → 12.345,
    // чтобы никогда не переконсумить остаток (регрессия к areaFree=-0.00029).
    const r = computeWholeBatchSale({ slabsFree: null, areaFreeM2: 12.3456789 });
    expect(r).toEqual({ ok: true, qtySlabs: null, qtyAreaM2: 12.345 });
  });

  it("ТЗ №7 #21: бесконечная дробь после average-slab-fallback → truncate, не round-up", () => {
    // Классический сценарий из аудита: areaFreeM2 = 100 / 7 ≈ 14.2857142857...
    // Math.round → 14.286 (превышение на ~0.0004 → areaFree после инкремента
    // становится ~-0.0004 → блокирует последующий area-only registerDirectPiece).
    // Math.floor → 14.285 (остаток становится +0.0007 — безопасно).
    const r = computeWholeBatchSale({ slabsFree: null, areaFreeM2: 100 / 7 });
    if (!r.ok) throw new Error("unexpected");
    expect(r.qtyAreaM2).toBe(14.285);
    // Ключевое: остаток после списания НЕ отрицательный.
    expect(100 / 7 - (r.qtyAreaM2 ?? 0)).toBeGreaterThanOrEqual(0);
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

// ───────────────────────────── A2: истечение броней ─────────────────────────────

describe("isHoldEffective — истёкшая бронь фактически свободна (A2)", () => {
  it("будущая expiresAt → эффективна; прошлая/ровно now → нет", () => {
    expect(isHoldEffective(FUTURE, NOW)).toBe(true);
    expect(isHoldEffective(PAST, NOW)).toBe(false);
    expect(isHoldEffective(NOW, NOW)).toBe(false); // ровно now — уже не блокирует
  });
});

describe("decideUnitSale — истёкшая бронь не блокирует продажу единицы (A2)", () => {
  it("RESERVED, чужая бронь ИСТЕКЛА → продажа проходит (не RESERVED_BY_OTHER)", () => {
    const d = decideUnitSale(
      baseInput({
        unitStatus: "RESERVED",
        activeReservationManagerId: null, // эффективной нет (истекла)
        expiredReservationPresent: true,
      }),
    );
    expect(d).toEqual({ ok: true, expectedStatus: "RESERVED", viaReservation: false });
  });

  it("RESERVED, чужая бронь ЕЩЁ активна → по-прежнему RESERVED_BY_OTHER", () => {
    const d = decideUnitSale(
      baseInput({
        unitStatus: "RESERVED",
        activeReservationManagerId: MANAGER_B,
        expiredReservationPresent: false,
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("RESERVED_BY_OTHER");
  });

  it("RESERVED без брони и без истёкшей → CONFLICT (рассинхрон, без регресса)", () => {
    const d = decideUnitSale(
      baseInput({ unitStatus: "RESERVED", expiredReservationPresent: false }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe("CONFLICT");
  });
});

describe("sumEffectiveOthersHolds — истёкшие чужие брони не режут остаток (A2)", () => {
  it("будущая чужая бронь учитывается", () => {
    const holds = [hold({ id: "r1", managerId: MANAGER_B, qtySlabs: 5, qtyAreaM2: 30 })];
    expect(sumEffectiveOthersHolds(holds, MANAGER_A, NOW)).toEqual({
      slabs: 5,
      areaM2: 30,
    });
  });

  it("ИСТЁКШАЯ чужая бронь НЕ уменьшает доступный остаток", () => {
    const holds = [
      hold({ id: "r1", managerId: MANAGER_B, qtySlabs: 5, qtyAreaM2: 30, expiresAt: PAST }),
    ];
    expect(sumEffectiveOthersHolds(holds, MANAGER_A, NOW)).toEqual({
      slabs: 0,
      areaM2: 0,
    });
  });

  it("свои брони в чужую сумму не входят; истёкшие отбрасываются", () => {
    const holds = [
      hold({ id: "own", managerId: MANAGER_A, qtySlabs: 9, qtyAreaM2: 99 }),
      hold({ id: "b-live", managerId: MANAGER_B, qtySlabs: 2, qtyAreaM2: 10 }),
      hold({ id: "b-dead", managerId: MANAGER_B, qtySlabs: 7, qtyAreaM2: 70, expiresAt: PAST }),
    ];
    expect(sumEffectiveOthersHolds(holds, MANAGER_A, NOW)).toEqual({
      slabs: 2,
      areaM2: 10,
    });
  });
});

// ─────────────── A3: погашение только покрытых своих volume-броней ───────────────

describe("selectCoveredOwnHolds — не гасит бронь, которую продажа не покрыла (A3)", () => {
  it("(a) продажа 2 при бронях 5 и 3 → НИ одна не гасится", () => {
    const holds = [
      { id: "h5", qtySlabs: 5, qtyAreaM2: null },
      { id: "h3", qtySlabs: 3, qtyAreaM2: null },
    ];
    expect(selectCoveredOwnHolds(holds, 2, null)).toEqual([]);
  });

  it("(b) продажа 3 при бронях 3 (старше) и 5 → гасится только 3", () => {
    const holds = [
      { id: "h3", qtySlabs: 3, qtyAreaM2: null },
      { id: "h5", qtySlabs: 5, qtyAreaM2: null },
    ];
    expect(selectCoveredOwnHolds(holds, 3, null)).toEqual(["h3"]);
  });

  it("(c) продажа 8 при бронях 5 и 3 → гасятся обе", () => {
    const holds = [
      { id: "h5", qtySlabs: 5, qtyAreaM2: null },
      { id: "h3", qtySlabs: 3, qtyAreaM2: null },
    ];
    expect(selectCoveredOwnHolds(holds, 8, null)).toEqual(["h5", "h3"]);
  });

  it("стоп на первой непокрытой: продажа 6 при 5 (старше) и 3 → только 5", () => {
    const holds = [
      { id: "h5", qtySlabs: 5, qtyAreaM2: null },
      { id: "h3", qtySlabs: 3, qtyAreaM2: null },
    ];
    // после 5 бюджет = 1, следующую (3) не покрывает → стоп.
    expect(selectCoveredOwnHolds(holds, 6, null)).toEqual(["h5"]);
  });

  it("бронь в м², продажа в плитах → не гасится (единица не предоставлена)", () => {
    const holds = [{ id: "area", qtySlabs: null, qtyAreaM2: 10 }];
    expect(selectCoveredOwnHolds(holds, 100, null)).toEqual([]);
  });

  it("бронь по обеим единицам гасится, только если покрыты ОБЕ", () => {
    const holds = [{ id: "both", qtySlabs: 3, qtyAreaM2: 20 }];
    expect(selectCoveredOwnHolds(holds, 3, 20)).toEqual(["both"]);
    expect(selectCoveredOwnHolds(holds, 3, 19)).toEqual([]); // площади не хватает
    expect(selectCoveredOwnHolds(holds, 3, null)).toEqual([]); // продажа без м²
  });
});

describe("selectOwnHoldsToComplete — свои + не истёкшие + старейшие вперёд (A2+A3)", () => {
  const t = (min: number) => new Date(NOW.getTime() + min * 60 * 1000);

  it("(d) чужие брони не трогаются — гасятся только свои", () => {
    const holds = [
      hold({ id: "b", managerId: MANAGER_B, qtySlabs: 1, createdAt: t(-10) }),
      hold({ id: "a", managerId: MANAGER_A, qtySlabs: 3, createdAt: t(-5) }),
    ];
    expect(selectOwnHoldsToComplete(holds, MANAGER_A, 100, null, NOW)).toEqual(["a"]);
  });

  it("сортирует свои по createdAt (старейшая вперёд) для правила бюджета", () => {
    // Порядок в массиве обратный времени — функция должна отсортировать.
    const holds = [
      hold({ id: "new5", managerId: MANAGER_A, qtySlabs: 5, createdAt: t(5) }),
      hold({ id: "old3", managerId: MANAGER_A, qtySlabs: 3, createdAt: t(-5) }),
    ];
    // Продажа 3: старейшая (old3, 3) покрыта → гасится; new5 (5) — нет.
    expect(selectOwnHoldsToComplete(holds, MANAGER_A, 3, null, NOW)).toEqual(["old3"]);
  });

  it("истёкшая своя бронь не гасится (A2), даже если бюджет её покрыл бы", () => {
    const holds = [
      hold({ id: "dead", managerId: MANAGER_A, qtySlabs: 2, expiresAt: PAST, createdAt: t(-10) }),
      hold({ id: "live", managerId: MANAGER_A, qtySlabs: 2, expiresAt: FUTURE, createdAt: t(-5) }),
    ];
    expect(selectOwnHoldsToComplete(holds, MANAGER_A, 4, null, NOW)).toEqual(["live"]);
  });
});

describe("checkPatternSaleGuard — продажа из узора не превышает остаток (ТЗ №3)", () => {
  const base = { remainingSlabs: 50, remainingArea: 30 };

  it("в пределах остатка → ok", () => {
    expect(checkPatternSaleGuard({ ...base, qtySlabs: 20, qtyAreaM2: 12 }).ok).toBe(true);
    expect(checkPatternSaleGuard({ ...base, qtySlabs: 50, qtyAreaM2: 30 }).ok).toBe(true);
  });

  it("плит больше остатка узора → INSUFFICIENT_REMAINDER", () => {
    const r = checkPatternSaleGuard({ ...base, qtySlabs: 51, qtyAreaM2: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
  });

  it("м² больше остатка узора → INSUFFICIENT_REMAINDER", () => {
    const r = checkPatternSaleGuard({ ...base, qtySlabs: null, qtyAreaM2: 30.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
  });

  it("двоичная погрешность м² не даёт ложный отказ (эпсилон)", () => {
    // 0.1 + 0.2 > 0.3 в float — эпсилон гасит только шум, не реальный перебор.
    expect(
      checkPatternSaleGuard({
        remainingSlabs: 10,
        remainingArea: 0.3,
        qtySlabs: null,
        qtyAreaM2: 0.1 + 0.2,
      }).ok,
    ).toBe(true);
  });

  it("узор продан наполовину: остаток 25 плит, продажа 26 → отказ", () => {
    const r = checkPatternSaleGuard({ remainingSlabs: 25, remainingArea: 15, qtySlabs: 26, qtyAreaM2: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INSUFFICIENT_REMAINDER");
  });
})

// ─────────── executeVolumeSale — узор-ветвь (интеграция с мок-tx, ТЗ №3 §7.5) ───────────
// Ядро продажи вызывается ВНУТРИ транзакции с уже загруженными actor/batch/free/pattern.
// Здесь мокаем только сам tx (5 методов), чтобы проверить НОВУЮ узор-логику:
// синхронный условный инкремент счётчиков узора + batch, SaleRecord.batchPatternId,
// охрана остатка узора ДО записи и CONFLICT при параллельном изменении узора.
describe("executeVolumeSale — продажа из узора (интеграция, ТЗ №3 §7.5)", () => {
  // Возвращаем СЫРОЙ объект с vi.fn (для assert .mock.calls); в executeVolumeSale
  // передаём его через cast — на узор-пути другие методы tx не вызываются.
  // arg-param у vi.fn нужен, чтобы .mock.calls[0][0] был доступен (иначе TS
  // выводит кортеж без аргументов). Значения не типизируем строго — это mock.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeTx = (opts?: { batchCount?: number; patternCount?: number }) => ({
    batch: { updateMany: vi.fn(async (_a?: any) => ({ count: opts?.batchCount ?? 1 })) },
    batchPattern: {
      updateMany: vi.fn(async (_a?: any) => ({ count: opts?.patternCount ?? 1 })),
    },
    reservation: { updateMany: vi.fn(async (_a?: any) => ({ count: 0 })) },
    saleRecord: { create: vi.fn(async (_a?: any) => ({ id: "sale-1" })) },
    auditLog: { create: vi.fn(async (_a?: any) => ({})) },
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  type TxArg = Parameters<typeof executeVolumeSale>[0];

  const actor = { id: "mgr-1", role: "MANAGER" as const };
  const batch = {
    id: "batch-1",
    needsCheck: false,
    slabsTotal: 100,
    areaTotalM2: 60,
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 0,
    areaSoldDirectM2: 0,
    slabs: [],
    pieces: [],
    reservations: [],
  };
  const free = { slabsFree: 100, areaFreeM2: 60 };
  const pattern = { id: "pat-1", slabsCount: 50, slabsSold: 0, areaM2: 30, areaSoldM2: 0 };
  const common = {
    actor,
    batch,
    free,
    customerName: "Клиент",
    customerContact: null,
    price: null,
    wholeBatch: false,
    now: new Date("2026-07-24T00:00:00Z"),
  };

  it("в пределах остатка узора → инкремент И узора, И партии + SaleRecord.batchPatternId", async () => {
    const tx = makeTx();
    const res = await executeVolumeSale(tx as unknown as TxArg, {
      ...common,
      qtySlabs: 10,
      qtyAreaM2: 6,
      pattern,
    });
    expect(res.ok).toBe(true);
    // партия уменьшена (условный UPDATE со счётчиками из чтения).
    expect(tx.batch.updateMany).toHaveBeenCalledTimes(1);
    // узор уменьшен синхронно.
    expect(tx.batchPattern.updateMany).toHaveBeenCalledTimes(1);
    const patArg = tx.batchPattern.updateMany.mock.calls[0][0];
    expect(patArg.where).toMatchObject({ id: "pat-1", slabsSold: 0 });
    expect(patArg.data.slabsSold).toEqual({ increment: 10 });
    // SaleRecord несёт batchPatternId.
    const saleArg = tx.saleRecord.create.mock.calls[0][0];
    expect(saleArg.data.batchPatternId).toBe("pat-1");
  });

  it("продажа сверх остатка узора → INSUFFICIENT_REMAINDER ДО записи (партия не тронута)", async () => {
    const tx = makeTx();
    const almostSold = { ...pattern, slabsSold: 45 }; // осталось 5 плит
    await expect(
      executeVolumeSale(tx as unknown as TxArg, { ...common, qtySlabs: 6, qtyAreaM2: 3, pattern: almostSold }),
    ).rejects.toThrow(/В узоре столько нет|остаток/i);
    // охрана узора сработала ДО UPDATE — ни партия, ни узор не изменены.
    expect(tx.batch.updateMany).not.toHaveBeenCalled();
    expect(tx.batchPattern.updateMany).not.toHaveBeenCalled();
  });

  it("узор изменили параллельно (0 строк) → CONFLICT", async () => {
    const tx = makeTx({ patternCount: 0 });
    await expect(
      executeVolumeSale(tx as unknown as TxArg, { ...common, qtySlabs: 10, qtyAreaM2: 6, pattern }),
    ).rejects.toThrow(/параллельно/);
    // партия уже уменьшена, но узор дал 0 строк → вся транзакция откатится.
    expect(tx.batchPattern.updateMany).toHaveBeenCalledTimes(1);
  });

  it("без узора (обычный batch-volume) → batchPattern не трогаем, batchPatternId = null", async () => {
    const tx = makeTx();
    const res = await executeVolumeSale(tx as unknown as TxArg, {
      ...common,
      qtySlabs: 10,
      qtyAreaM2: 6,
      pattern: null,
    });
    expect(res.ok).toBe(true);
    expect(tx.batchPattern.updateMany).not.toHaveBeenCalled();
    const saleArg = tx.saleRecord.create.mock.calls[0][0];
    expect(saleArg.data.batchPatternId).toBeNull();
  });
})
