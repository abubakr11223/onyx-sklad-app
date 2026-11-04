// ТЗ №20 C — минимальные остатки: пересечение порога, анти-спам, re-arm,
// пустой порог, счёт по единице. Без БД: фейковый клиент + подмена остатка.
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  checkMinStock,
  decideMinStock,
  formatLowStockMessage,
  isBelowThreshold,
  stockLevelsFromBatches,
  thresholdOf,
  type StockLevel,
} from "@/lib/min-stock";
import { EMPTY_AGGREGATE } from "@/lib/batch-remainders";

interface FakeType {
  id: string;
  name: string;
  minStockQty: number | null;
  minStockUnit: "SLABS" | "AREA_M2" | null;
  lowStockAlertedAt: Date | null;
}

function makeFake(types: FakeType[], owners = [{ id: "o1", telegramId: "111" }]) {
  const byId = new Map(types.map((t) => [t.id, t]));
  const db = {
    stoneType: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => byId.get(id)).filter(Boolean).map((t) => ({ ...t })),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; lowStockAlertedAt: null | { not: null } };
          data: { lowStockAlertedAt: Date | null };
        }) => {
          const t = byId.get(where.id);
          if (!t) return { count: 0 };
          const wantNull = where.lowStockAlertedAt === null;
          const isNull = t.lowStockAlertedAt === null;
          if (wantNull !== isNull) return { count: 0 };
          t.lowStockAlertedAt = data.lowStockAlertedAt;
          return { count: 1 };
        },
      ),
    },
    user: { findMany: vi.fn(async () => owners) },
  } as unknown as PrismaClient;
  return { db, byId };
}

function run(
  db: PrismaClient,
  ids: string[],
  level: StockLevel,
  send = vi.fn(async () => ({ ok: true as const, messageId: 1 })),
) {
  return {
    send,
    result: checkMinStock(db, ids, {
      sendMessage: send,
      loadLevels: async (xs) => new Map(xs.map((id) => [id, level])),
      now: new Date("2026-11-03T10:00:00Z"),
    }),
  };
}

const travertin = (): FakeType => ({
  id: "st1",
  name: "Травертин Классик",
  minStockQty: 10,
  minStockUnit: "SLABS",
  lowStockAlertedAt: null,
});

describe("min-stock — пересечение порога", () => {
  it("падение ниже порога → одно сообщение владельцу в формате ТЗ", async () => {
    const { db, byId } = makeFake([travertin()]);
    const { send, result } = run(db, ["st1"], { slabs: 4, areaM2: 20 });
    const r = await result;
    expect(r.alerted).toEqual(["st1"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("111", "Травертин Классик: осталось 4 плиты (порог 10)");
    expect(byId.get("st1")!.lowStockAlertedAt).not.toBeNull();
  });

  it("следующая продажа ниже порога — без нового сообщения", async () => {
    const { db } = makeFake([travertin()]);
    await run(db, ["st1"], { slabs: 4, areaM2: 0 }).result;
    const second = run(db, ["st1"], { slabs: 2, areaM2: 0 });
    const r = await second.result;
    expect(r.alerted).toEqual([]);
    expect(second.send).not.toHaveBeenCalled();
  });

  it("приёмка выше порога снимает пометку, следующее падение — снова сообщение", async () => {
    const { db, byId } = makeFake([travertin()]);
    await run(db, ["st1"], { slabs: 4, areaM2: 0 }).result;
    const up = await run(db, ["st1"], { slabs: 15, areaM2: 0 }).result;
    expect(up.rearmed).toEqual(["st1"]);
    expect(byId.get("st1")!.lowStockAlertedAt).toBeNull();
    const again = run(db, ["st1"], { slabs: 9, areaM2: 0 });
    expect((await again.result).alerted).toEqual(["st1"]);
    expect(again.send).toHaveBeenCalledWith("111", "Травертин Классик: осталось 9 плит (порог 10)");
  });

  it("ровно на пороге — не «ниже» (re-arm при остатке ≥ порога)", () => {
    const t = thresholdOf(10, "SLABS");
    expect(isBelowThreshold(t, { slabs: 10, areaM2: 0 })).toBe(false);
    expect(decideMinStock({ threshold: t, level: { slabs: 10, areaM2: 0 }, alerted: true })).toBe(
      "rearm",
    );
  });

  it("пустой порог — не отслеживается: ни сообщения, ни пометки", async () => {
    const { db, byId } = makeFake([{ ...travertin(), minStockQty: null, minStockUnit: null }]);
    const { send, result } = run(db, ["st1"], { slabs: 0, areaM2: 0 });
    const r = await result;
    expect(r.alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(byId.get("st1")!.lowStockAlertedAt).toBeNull();
    expect(thresholdOf(null, "SLABS")).toBeNull();
    expect(thresholdOf(0, "SLABS")).toBeNull();
    expect(thresholdOf(5, null)).toBeNull();
  });

  it("единица порога решает: плиты считаются плитами, м² — площадью", async () => {
    const level = { slabs: 3, areaM2: 50 };
    // 3 плиты < 10 плит → ниже; 50 м² ≥ 20 м² → нет.
    expect(isBelowThreshold(thresholdOf(10, "SLABS"), level)).toBe(true);
    expect(isBelowThreshold(thresholdOf(20, "AREA_M2"), level)).toBe(false);
    expect(isBelowThreshold(thresholdOf(60, "AREA_M2"), level)).toBe(true);

    const { db } = makeFake([
      { ...travertin(), id: "m2", name: "Оникс Мед", minStockQty: 60, minStockUnit: "AREA_M2" },
    ]);
    const { send, result } = run(db, ["m2"], { slabs: 3, areaM2: 12.5 });
    await result;
    expect(send).toHaveBeenCalledWith("111", "Оникс Мед: осталось 12,5 м² (порог 60 м²)");
  });

  it("сбой Telegram не роняет проверку, пометка остаётся (без повторов)", async () => {
    const { db, byId } = makeFake([travertin()]);
    const send = vi.fn(async () => {
      throw new Error("network");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await run(db, ["st1"], { slabs: 1, areaM2: 0 }, send as never).result;
    warn.mockRestore();
    expect(r.alerted).toEqual(["st1"]);
    expect(r.sent).toBe(0);
    expect(byId.get("st1")!.lowStockAlertedAt).not.toBeNull();
  });

  it("сообщение — каждому владельцу с Telegram", async () => {
    const { db } = makeFake([travertin()], [
      { id: "o1", telegramId: "111" },
      { id: "o2", telegramId: "222" },
    ]);
    const { send, result } = run(db, ["st1"], { slabs: 1, areaM2: 0 });
    expect((await result).sent).toBe(2);
    expect(send.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["111", "222"]);
  });
});

describe("min-stock — свободный остаток вида", () => {
  const batch = (over: Partial<Parameters<typeof stockLevelsFromBatches>[0][number]> = {}) => ({
    id: "b1",
    stoneTypeId: "st1",
    slabsTotal: 20,
    areaTotalM2: 100,
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 5,
    areaSoldDirectM2: 25,
    ...over,
  });

  it("объём партий − брони/образцы + выделенные плиты AVAILABLE, по виду в целом", () => {
    const levels = stockLevelsFromBatches(
      [batch(), batch({ id: "b2", slabsTotal: 10, areaTotalM2: 50, slabsSoldDirect: 0, areaSoldDirectM2: 0 })],
      // b1: 2 выделенные плиты (любой статус) — вычитаются из объёма партии.
      new Map([["b1", { ...EMPTY_AGGREGATE, slabCount: 2, slabAreaSum: 10 }]]),
      // b2: бронь 3 плиты / 15 м².
      new Map([["b2", { reservedSlabs: 3, reservedAreaM2: 15 }]]),
      // из 2 выделенных плит b1 одна AVAILABLE (вторая — в шоу-руме/брони).
      new Map([["b1", { count: 1, areaSum: 5, nullAreaCount: 0 }]]),
    );
    // объём: b1 20−5−2=13, b2 10 → 23 − бронь 3 = 20, + 1 выделенная = 21.
    // м²: b1 100−25−10=65, b2 50 → 115 − 15 = 100, + 5 = 105.
    expect(levels.get("st1")).toEqual({ slabs: 21, areaM2: 105 });
  });

  it("брони не уводят объём ниже нуля; выделенная плита без площади — средняя партии", () => {
    const levels = stockLevelsFromBatches(
      [batch({ slabsSoldDirect: 20, areaSoldDirectM2: 100 })],
      new Map(),
      new Map([["b1", { reservedSlabs: 2, reservedAreaM2: 10 }]]),
      new Map([["b1", { count: 1, areaSum: 0, nullAreaCount: 1 }]]),
    );
    expect(levels.get("st1")).toEqual({ slabs: 1, areaM2: 5 });
  });

  it("текст сообщения: 1 плита / 21 плита", () => {
    const t = thresholdOf(30, "SLABS")!;
    expect(formatLowStockMessage("Мрамор", { slabs: 1, areaM2: 0 }, t)).toBe(
      "Мрамор: осталось 1 плита (порог 30)",
    );
    expect(formatLowStockMessage("Мрамор", { slabs: 21, areaM2: 0 }, t)).toBe(
      "Мрамор: осталось 21 плита (порог 30)",
    );
  });
});
