// ТЗ №19 — учёт по узорам: единый остаток узора, площадь вместе с плитами,
// раскладка по местам и строки отгрузки. Сквозной пример — тест 21.10:
// Травертин Классик, узор 1 = 280×160×2, 3 пл. → A1; узор 2 = 250×150×3, 3 пл. → A2.
import { describe, expect, it, vi } from "vitest";
import {
  allocateFromLocations,
  areaForSlabs,
  checkPatternAvailable,
  computePatternFree,
  EMPTY_PATTERN_AGGREGATE,
  formatSourceLine,
  locationsForPattern,
  patternHoldsFromRows,
  patternUnitAreaM2,
} from "@/lib/pattern-stock";
import { executeVolumeSale, planVolumeLines } from "@/lib/sales";

const P1 = {
  slabsCount: 3,
  areaM2: 13.44,
  slabsSold: 0,
  areaSoldM2: 0,
  lengthMm: 280,
  widthMm: 160,
};
const A1 = { id: "loc-a1", block: "A1", landmark: "", slabsHere: 3, areaHereM2: 13.44 };
const A2 = { id: "loc-a2", block: "A2", landmark: "", slabsHere: 3, areaHereM2: 11.25 };

describe("остаток узора (§D)", () => {
  it("S по габариту: 280×160 → 4,48 м²; без габарита — средняя по приёмке", () => {
    expect(patternUnitAreaM2(P1)).toBeCloseTo(4.48, 6);
    expect(patternUnitAreaM2({ ...P1, lengthMm: null, widthMm: null })).toBeCloseTo(4.48, 6);
  });

  it("продажа 2 плит узора: остаток 1 плита, площадь −8,96", () => {
    const free = computePatternFree(
      { ...P1, slabsSold: 2, areaSoldM2: 8.96 },
      EMPTY_PATTERN_AGGREGATE,
    );
    expect(free.slabsFree).toBe(1);
    expect(free.areaFreeM2).toBeCloseTo(4.48, 6);
  });

  it("выделенная плита и бой из узора уменьшают его остаток (не только продажи)", () => {
    const free = computePatternFree(P1, {
      ...EMPTY_PATTERN_AGGREGATE,
      slabCount: 1,
      slabNullAreaCount: 1,
      pieceCount: 1,
      pieceAreaSum: 2,
    });
    expect(free.slabsFree).toBe(1);
    expect(free.areaFreeM2).toBeCloseTo(13.44 - 4.48 - 2, 6);
  });

  it("продали м² без плит → плиты по формату с округлением вниз (§2 п.4)", () => {
    const free = computePatternFree({ ...P1, areaSoldM2: 5 }, EMPTY_PATTERN_AGGREGATE);
    // 8,44 м² / 4,48 = 1,88 → 1 плита
    expect(free.slabsFree).toBe(1);
  });

  it("площадь к плитам: N × S, не больше свободной", () => {
    expect(areaForSlabs(P1, 2, 13.44)).toBeCloseTo(8.96, 6);
    expect(areaForSlabs(P1, 3, 10)).toBe(10);
  });

  it("брони узора режут доступное, истёкшие — нет; образцы держат без срока", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    const holds = patternHoldsFromRows(
      [
        { batchPatternId: "p1", qtySlabs: 1, qtyAreaM2: null, expiresAt: new Date("2026-10-22") },
        { batchPatternId: "p1", qtySlabs: 5, qtyAreaM2: null, expiresAt: new Date("2026-10-20") },
        { batchPatternId: "p1", qtySlabs: 1, qtyAreaM2: null, expiresAt: null },
        { batchPatternId: null, qtySlabs: 9, qtyAreaM2: null, expiresAt: null },
      ],
      now,
    );
    expect(holds.get("p1")).toEqual({ slabs: 2, areaM2: 0 });
    const err = checkPatternAvailable(
      { slabsFree: 3, areaFreeM2: 13.44, hold: { slabs: 2, areaM2: 0 } },
      2,
      null,
    );
    expect(err).toMatch(/свободно 1 плит/);
    // своя погашаемая бронь возвращает её объём
    expect(
      checkPatternAvailable(
        { slabsFree: 3, areaFreeM2: 13.44, hold: { slabs: 2, areaM2: 0 } },
        2,
        null,
        { slabs: 1, areaM2: 0 },
      ),
    ).toBeNull();
  });
});

describe("места узора и раскладка", () => {
  it("свои места узора, иначе «весь приход»", () => {
    const locs = [
      { id: "x", batchPatternId: "p1" },
      { id: "y", batchPatternId: "p2" },
      { id: "z", batchPatternId: null },
    ];
    expect(locationsForPattern(locs, "p1").map((l) => l.id)).toEqual(["x"]);
    expect(locationsForPattern(locs, "p3").map((l) => l.id)).toEqual(["z"]);
  });

  it("сначала выбранное место, остаток — из следующих", () => {
    const a = allocateFromLocations([A1, { ...A2, slabsHere: 2 }], 4, "loc-a2");
    expect(a.map((x) => [x.locationId, x.slabs])).toEqual([
      ["loc-a2", 2],
      ["loc-a1", 2],
    ]);
  });

  it("старая партия без счётчика по месту: строка с этим местом", () => {
    const a = allocateFromLocations([{ ...A1, slabsHere: null }], 2);
    expect(a).toEqual([{ locationId: "loc-a1", block: "A1", landmark: "", slabs: 2 }]);
  });

  it("строки отгрузки: площадь по формату, сумма = объём продажи", () => {
    const plan = planVolumeLines({
      batchPatternId: "p1",
      patternLabel: "ТЕСТ светлый 2см",
      locations: [{ ...A1, slabsHere: 1 }, A2],
      qtySlabs: 2,
      qtyAreaM2: 8.96,
      unitAreaM2: 4.48,
    });
    expect(plan.lines.map((l) => [l.batchLocationId, l.qtyOrderedSlabs, l.qtyOrderedAreaM2])).toEqual([
      ["loc-a1", 1, 4.48],
      ["loc-a2", 1, 4.48],
    ]);
    expect(plan.lines[0].locationSnapshot).toBe("Блок A1");
  });

  it("строка источника §B", () => {
    expect(
      formatSourceLine({
        stoneName: "Травертин Классик",
        description: "ТЕСТ светлый 2см",
        lengthMm: 280,
        widthMm: 160,
        thicknessMm: 2,
        slabsFree: 3,
        areaFreeM2: 13.44,
        locationText: "Блок A1",
      }),
    ).toBe("Травертин Классик · ТЕСТ светлый 2см · 280×160×2 см · свободно 3 пл. / 13,4 м² · Блок A1");
  });
});

describe("executeVolumeSale — продажа узора списывает место и пишет строки (ТЗ №19)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeTx = () => ({
    batch: { updateMany: vi.fn(async (_a?: any) => ({ count: 1 })) },
    batchPattern: { updateMany: vi.fn(async (_a?: any) => ({ count: 1 })) },
    batchLocation: {
      findUnique: vi.fn(async (_a?: any) => ({ slabsHere: 3, areaHereM2: "13.440" })),
      update: vi.fn(async (_a?: any) => ({})),
    },
    reservation: { updateMany: vi.fn(async (_a?: any) => ({ count: 0 })) },
    saleRecord: { create: vi.fn(async (_a?: any) => ({ id: "sale-1" })) },
    shipment: { create: vi.fn(async (_a?: any) => ({ id: "ship-1" })) },
    auditLog: { create: vi.fn(async (_a?: any) => ({})) },
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("2 плиты узора 1: узор +2/+8,96, A1: 3 → 1, строка с узором и местом", async () => {
    const tx = makeTx();
    const plan = planVolumeLines({
      batchPatternId: "p1",
      patternLabel: "ТЕСТ светлый 2см",
      locations: [A1],
      qtySlabs: 2,
      qtyAreaM2: 8.96,
      unitAreaM2: 4.48,
    });
    await executeVolumeSale(tx as unknown as Parameters<typeof executeVolumeSale>[0], {
      actor: { id: "mgr", role: "MANAGER" },
      batch: {
        id: "b1",
        needsCheck: false,
        slabsTotal: 6,
        areaTotalM2: 24.69,
        slabsAdjusted: 0,
        areaAdjustedM2: 0,
        slabsSoldDirect: 0,
        areaSoldDirectM2: 0,
        slabs: [],
        pieces: [],
        reservations: [],
        samples: [],
      },
      free: { slabsFree: 6, areaFreeM2: 24.69 },
      qtySlabs: 2,
      qtyAreaM2: 8.96,
      customerName: "Тимур",
      customerContact: null,
      price: 100000,
      wholeBatch: false,
      now: new Date(),
      pattern: { id: "p1", slabsCount: 3, slabsSold: 0, areaM2: 13.44, areaSoldM2: 0 },
      shipmentLines: plan.lines,
      locationTakes: [{ allocations: plan.allocations, unitAreaM2: 4.48 }],
    });
    // партия: −2 плиты и −8,96 м² (площадь больше не «≈24,7 без изменений»)
    expect(tx.batch.updateMany.mock.calls[0][0].data).toEqual({
      slabsSoldDirect: { increment: 2 },
      areaSoldDirectM2: { increment: "8.960" },
    });
    expect(tx.batchPattern.updateMany.mock.calls[0][0].data).toEqual({
      slabsSold: { increment: 2 },
      areaSoldM2: { increment: "8.960" },
    });
    // карта: A1 3 → 1
    expect(tx.batchLocation.update.mock.calls[0][0]).toEqual({
      where: { id: "loc-a1" },
      data: { slabsHere: 1, areaHereM2: "4.480" },
    });
    const line = tx.shipment.create.mock.calls[0][0].data.lines.create;
    expect(line).toMatchObject({
      batchPatternId: "p1",
      batchLocationId: "loc-a1",
      qtyOrderedSlabs: 2,
      qtyOrderedAreaM2: "8.960",
      locationSnapshot: "Блок A1",
    });
  });
});
