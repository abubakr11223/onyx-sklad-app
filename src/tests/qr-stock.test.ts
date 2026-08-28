// W1-T4 — /q/[slug] публичный бейдж «в наличии» по официальной формуле §3.
// Регрессия: страница считала slabsTotal − slabsSoldDirect и игнорировала
// отделённые плиты / прямые бои / корректировки — распроданный вид был «в наличии».
import { describe, expect, it } from "vitest";
import { computeQrHasStock, type QrBatchRow } from "@/app/q/stock";
import {
  EMPTY_AGGREGATE,
  aggregateFromRows,
  type BatchRemainderAggregate,
} from "@/lib/batch-remainders";
import { buildQrPublicView } from "@/lib/qr-showroom";

function batch(over: Partial<QrBatchRow> & { id: string }): QrBatchRow {
  return {
    slabsTotal: null,
    areaTotalM2: null,
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 0,
    areaSoldDirectM2: 0,
    ...over,
  };
}

const NO_AGG = new Map<string, BatchRemainderAggregate>();

describe("computeQrHasStock — формула §3 через freeRemainderFromAggregate", () => {
  it("полностью проданная напрямую партия (sold = total) → нет наличия", () => {
    const b = batch({
      id: "b1",
      slabsTotal: 10,
      areaTotalM2: 100,
      slabsSoldDirect: 10,
      areaSoldDirectM2: 100,
    });
    expect(computeQrHasStock([b], NO_AGG, 0, 0)).toBe(false);
  });

  it("РЕГРЕССИЯ: все плиты отделены и проданы поштучно → нет наличия (старая формула давала true)", () => {
    // slabsTotal − slabsSoldDirect = 10 > 0, но 10 плит отделены (Slab, любой
    // статус минусуется по §3) — свободного остатка нет.
    const b = batch({ id: "b1", slabsTotal: 10, areaTotalM2: 100 });
    const remainders = new Map([
      ["b1", aggregateFromRows(Array.from({ length: 10 }, () => ({ areaM2: 10 })), [])],
    ]);
    expect(computeQrHasStock([b], remainders, 0, 0)).toBe(false);
  });

  it("партия распродана, но остался AVAILABLE-бой → в наличии (как countedPieces в /poisk)", () => {
    const b = batch({
      id: "b1",
      slabsTotal: 5,
      areaTotalM2: 50,
      slabsSoldDirect: 5,
      areaSoldDirectM2: 50,
    });
    expect(computeQrHasStock([b], NO_AGG, 0, 1)).toBe(true);
    expect(computeQrHasStock([b], NO_AGG, 1, 0)).toBe(true);
  });

  it("частично свободная партия → в наличии", () => {
    const b = batch({
      id: "b1",
      slabsTotal: 10,
      areaTotalM2: 100,
      slabsSoldDirect: 4,
      areaSoldDirectM2: 40,
    });
    const remainders = new Map([
      ["b1", aggregateFromRows([{ areaM2: 10 }], [{ areaM2: 5 }])],
    ]);
    expect(computeQrHasStock([b], remainders, 0, 0)).toBe(true);
  });

  it("{+2, −3}: суммы без клампа, как hasAvailability в /poisk — Σ = −1 → нет наличия, без падения", () => {
    const plus2 = batch({ id: "plus", slabsTotal: 2 });
    const minus3 = batch({ id: "minus", slabsTotal: 0, slabsAdjusted: -3 });
    expect(computeQrHasStock([plus2, minus3], NO_AGG, 0, 0)).toBe(false);
    // Зеркальный случай {+3, −2}: Σ = 1 → в наличии.
    const plus3 = batch({ id: "plus", slabsTotal: 3 });
    const minus2 = batch({ id: "minus", slabsTotal: 0, slabsAdjusted: -2 });
    expect(computeQrHasStock([plus3, minus2], NO_AGG, 0, 0)).toBe(true);
  });

  it("null-остатки (партия только в м² / только в штуках) не ломают сумму", () => {
    const onlyArea = batch({ id: "a", areaTotalM2: 50, areaSoldDirectM2: 50 });
    const onlySlabs = batch({ id: "s", slabsTotal: 3, slabsSoldDirect: 3 });
    expect(computeQrHasStock([onlyArea, onlySlabs], NO_AGG, 0, 0)).toBe(false);
    expect(
      computeQrHasStock(
        [batch({ id: "a2", areaTotalM2: 50, areaSoldDirectM2: 20 })],
        NO_AGG,
        0,
        0,
      ),
    ).toBe(true);
  });

  it("Decimal-подобные поля (Prisma) конвертируются через toString", () => {
    const dec = (n: number) => ({ toString: () => String(n) });
    const b = batch({
      id: "b1",
      slabsTotal: 2,
      areaTotalM2: dec(20),
      areaAdjustedM2: dec(0),
      areaSoldDirectM2: dec(20),
      slabsSoldDirect: 2,
    });
    expect(computeQrHasStock([b], NO_AGG, 0, 0)).toBe(false);
  });

  it("вид без партий и без юнитов → нет наличия", () => {
    expect(computeQrHasStock([], NO_AGG, 0, 0)).toBe(false);
  });

  it("EMPTY_AGGREGATE — партия без отделений считается по totals", () => {
    const b = batch({ id: "b1", slabsTotal: 1 });
    const remainders = new Map([["b1", { ...EMPTY_AGGREGATE }]]);
    expect(computeQrHasStock([b], remainders, 0, 0)).toBe(true);
  });
});

describe("публичный контракт: наружу только бейдж, без чисел остатка", () => {
  it("распроданный вид → «под заказ», view не содержит чисел остатка/цен", () => {
    const sold = batch({
      id: "b1",
      slabsTotal: 10,
      areaTotalM2: 137.5,
      slabsSoldDirect: 10,
      areaSoldDirectM2: 137.5,
    });
    const hasStock = computeQrHasStock([sold], NO_AGG, 0, 0);
    const view = buildQrPublicView({
      name: "Оникс Мед",
      rockType: "оникс",
      color: null,
      description: null,
      properties: [],
      hasStock,
      textureFileUrl: null,
      photos: [],
    });
    expect(view.stockLabel).toBe("под заказ");
    // Только клиент-безопасные поля — никаких slabsFree/area/цен/локаций.
    expect(Object.keys(view).sort()).toEqual(
      [
        "color",
        "description",
        "mediaMode",
        "name",
        "photoIds",
        "photoKinds",
        "properties",
        "rockType",
        "stockLabel",
        "textureFileUrl",
      ].sort(),
    );
    // Числа партии (10, 137.5) не просачиваются в сериализованный view.
    const json = JSON.stringify(view);
    expect(json).not.toContain("10");
    expect(json).not.toContain("137.5");
  });

  it("вид с наличием → ровно «в наличии», без чисел", () => {
    const free = batch({ id: "b1", slabsTotal: 7 });
    const view = buildQrPublicView({
      name: "Оникс Мед",
      rockType: "оникс",
      color: null,
      description: null,
      properties: [],
      hasStock: computeQrHasStock([free], NO_AGG, 0, 0),
      photos: [],
      textureFileUrl: null,
    });
    expect(view.stockLabel).toBe("в наличии");
    expect(JSON.stringify(view)).not.toContain("7");
  });
});
