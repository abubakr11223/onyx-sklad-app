// W2-T3 — правка локаций партии (ТЗ №18 §3 + FK-safety):
//  • привязка «Что здесь» (batchPatternId) переживает правку/переименование
//    строк локаций — строки с id правятся НА МЕСТЕ, а не пересоздаются;
//  • удаление локации, на которую смотрит фотозапрос, не падает с P2003:
//    либо фотозапрос перевешивается на равнозначную выжившую строку
//    (тот же блок+ориентир), либо правка отклоняется понятной ошибкой;
//  • сверка раскладки (ТЗ №18 §4) действует и на правке.
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    queryRaw: fn(),
    batchFindUnique: fn(),
    batchUpdateMany: fn(),
    patternUpdateMany: fn(),
    locationDeleteMany: fn(),
    locationUpdate: fn(),
    locationCreate: fn(),
    photoCreate: fn(),
    photoUpdateMany: fn(),
    photoRequestFindMany: fn(),
    photoRequestUpdateMany: fn(),
    auditCreate: fn(),
    getRemainders: fn(),
    getHolds: fn(),
  };
});

const tx = {
  $queryRaw: M.queryRaw,
  batch: {
    findUnique: M.batchFindUnique,
    updateMany: M.batchUpdateMany,
  },
  batchPattern: { updateMany: M.patternUpdateMany },
  batchLocation: {
    deleteMany: M.locationDeleteMany,
    update: M.locationUpdate,
    create: M.locationCreate,
  },
  photo: {
    create: M.photoCreate,
    updateMany: M.photoUpdateMany,
  },
  photoRequest: {
    findMany: M.photoRequestFindMany,
    updateMany: M.photoRequestUpdateMany,
  },
  auditLog: { create: M.auditCreate },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (cb: (t: unknown) => Promise<unknown>) => cb(tx),
  },
}));

vi.mock("@/lib/batch-remainders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/batch-remainders")>();
  return {
    ...actual,
    getBatchRemainders: M.getRemainders,
    getBatchReservationHolds: M.getHolds,
  };
});

import {
  applyBatchEdit,
  type BatchEditInput,
} from "@/lib/batch-edit";
import { EMPTY_AGGREGATE, EMPTY_HOLD } from "@/lib/batch-remainders";

beforeEach(() => {
  Object.values(M).forEach((f) => f.mockReset());
  M.queryRaw.mockResolvedValue([]);
  M.batchUpdateMany.mockResolvedValue({ count: 1 });
  M.patternUpdateMany.mockResolvedValue({ count: 1 });
  M.locationDeleteMany.mockResolvedValue({ count: 0 });
  M.locationUpdate.mockResolvedValue({});
  M.locationCreate.mockResolvedValue({ id: "loc-new-1" });
  M.photoCreate.mockResolvedValue({ id: "ph-new" });
  M.photoUpdateMany.mockResolvedValue({ count: 1 });
  M.photoRequestFindMany.mockResolvedValue([]);
  M.photoRequestUpdateMany.mockResolvedValue({ count: 1 });
  M.auditCreate.mockResolvedValue({});
  M.getRemainders.mockResolvedValue(new Map([["b1", { ...EMPTY_AGGREGATE }]]));
  M.getHolds.mockResolvedValue(new Map([["b1", { ...EMPTY_HOLD }]]));
});

const patternRow = {
  id: "pat1",
  description: "светлый",
  thicknessMm: 2,
  lengthMm: 100,
  widthMm: 50,
  slabsCount: 5,
  areaM2: { toString: () => "20.000" },
  slabsSold: 0,
  areaSoldM2: { toString: () => "0" },
  photos: [] as { id: string }[],
};

function batchRow(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    stoneTypeId: "st1",
    slabsTotal: 10,
    areaTotalM2: { toString: () => "50.000" },
    slabsAdjusted: 0,
    areaAdjustedM2: { toString: () => "0" },
    slabsSoldDirect: 0,
    areaSoldDirectM2: { toString: () => "0" },
    lengthMm: 118,
    widthMm: 64,
    thicknessMm: 2,
    supplierNote: "doc-1",
    arrivedAt: new Date("2026-08-01T12:00:00Z"),
    stoneType: { name: "Травертин" },
    patterns: [{ ...patternRow }],
    locations: [
      {
        id: "loc1",
        block: "A",
        landmark: "1",
        slabsHere: 5,
        areaHereM2: null,
        batchPatternId: "pat1",
      },
      {
        id: "loc2",
        block: "B",
        landmark: "2",
        slabsHere: 5,
        areaHereM2: null,
        batchPatternId: null,
      },
    ],
    ...over,
  };
}

const inputPattern = {
  id: "pat1",
  description: "светлый",
  thicknessMm: 2,
  lengthMm: 100,
  widthMm: 50,
  slabsCount: 5,
  areaM2: 20,
};

function baseInput(over: Partial<BatchEditInput> = {}): BatchEditInput {
  return {
    batchId: "b1",
    expected: {
      slabsTotal: 10,
      areaTotalM2: 50,
      slabsSoldDirect: 0,
      areaSoldDirectM2: 0,
      lengthMm: 118,
      widthMm: 64,
      thicknessMm: 2,
      supplierNote: "doc-1",
      arrivedAtIso: "2026-08-01",
    },
    slabsTotal: 10,
    areaTotalM2: 50,
    lengthMm: 118,
    widthMm: 64,
    thicknessMm: 2,
    supplierNote: "doc-1",
    arrivedAt: new Date("2026-08-01T12:00:00Z"),
    locations: [
      {
        id: "loc1",
        block: "A",
        landmark: "1",
        slabsHere: 5,
        areaHereM2: null,
        batchPatternId: "pat1",
      },
      {
        id: "loc2",
        block: "B",
        landmark: "2",
        slabsHere: 5,
        areaHereM2: null,
        batchPatternId: null,
      },
    ],
    patterns: [{ ...inputPattern }],
    actorId: "u-owner",
    canEditQuantity: true,
    ...over,
  };
}

describe("applyBatchEdit — «Что здесь» переживает правку локаций (ТЗ №18 §3)", () => {
  it("переименование + перестановка строк: строки правятся на месте, binding сохранён", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    const res = await applyBatchEdit(
      baseInput({
        locations: [
          // порядок перевёрнут, у loc1 сменился ориентир — binding остаётся
          {
            id: "loc2",
            block: "B",
            landmark: "2",
            slabsHere: 5,
            areaHereM2: null,
            batchPatternId: null,
          },
          {
            id: "loc1",
            block: "A",
            landmark: "3",
            slabsHere: 5,
            areaHereM2: null,
            batchPatternId: "pat1",
          },
        ],
      }),
    );
    // НЕ «снести всё и создать заново»
    expect(M.locationDeleteMany).not.toHaveBeenCalled();
    expect(M.locationCreate).not.toHaveBeenCalled();
    expect(M.locationUpdate).toHaveBeenCalledTimes(2);
    const loc1Call = M.locationUpdate.mock.calls.find(
      (c) => c[0].where.id === "loc1",
    );
    expect(loc1Call?.[0].data).toMatchObject({
      block: "A",
      landmark: "3",
      batchPatternId: "pat1",
    });
    expect(res.changes.some((c) => c.field === "locations")).toBe(true);
  });

  it("новая строка создаётся с выбранным узором («Что здесь»)", async () => {
    M.batchFindUnique.mockResolvedValue(
      batchRow({
        slabsTotal: null,
        areaTotalM2: null,
        locations: [],
      }),
    );
    await applyBatchEdit(
      baseInput({
        expected: {
          ...baseInput().expected,
          slabsTotal: null,
          areaTotalM2: null,
        },
        slabsTotal: null,
        areaTotalM2: 50,
        locations: [
          {
            id: null,
            block: "C",
            landmark: "",
            slabsHere: null,
            areaHereM2: 50,
            batchPatternId: "pat1",
          },
        ],
      }),
    );
    expect(M.locationCreate).toHaveBeenCalledTimes(1);
    expect(M.locationCreate.mock.calls[0][0].data).toMatchObject({
      batchId: "b1",
      block: "C",
      batchPatternId: "pat1",
    });
  });

  it("узор чужой партии в строке локации → INVALID_INPUT, без записи", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    await expect(
      applyBatchEdit(
        baseInput({
          locations: [
            {
              id: "loc1",
              block: "A",
              landmark: "1",
              slabsHere: 10,
              areaHereM2: null,
              batchPatternId: "pat-foreign",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
    expect(M.locationUpdate).not.toHaveBeenCalled();
  });
});

describe("applyBatchEdit — фотозапрос держит локацию (FK Restrict, без P2003)", () => {
  it("удаление локации с фотозапросом без замены → понятная ошибка, удаления нет", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    M.photoRequestFindMany.mockResolvedValue([{ batchLocationId: "loc1" }]);
    await expect(
      applyBatchEdit(
        baseInput({
          locations: [
            // loc1 (A·1) выброшена — а на неё смотрит фотозапрос
            {
              id: "loc2",
              block: "B",
              landmark: "2",
              slabsHere: 10,
              areaHereM2: null,
              batchPatternId: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringMatching(/Блок A · ориентир 1.*фотозапрос/),
    });
    // Транзакция откатывается целиком: удаление не выполнено, аудита нет.
    expect(M.locationDeleteMany).not.toHaveBeenCalled();
    expect(M.photoRequestUpdateMany).not.toHaveBeenCalled();
    expect(M.auditCreate).not.toHaveBeenCalled();
  });

  it("есть равнозначная выжившая строка (тот же блок+ориентир) → фотозапрос перевешивается", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    M.photoRequestFindMany.mockResolvedValue([{ batchLocationId: "loc1" }]);
    M.locationCreate.mockResolvedValue({ id: "loc-new-1" });
    await applyBatchEdit(
      baseInput({
        locations: [
          {
            id: "loc2",
            block: "B",
            landmark: "2",
            slabsHere: 4,
            areaHereM2: null,
            batchPatternId: null,
          },
          // loc1 удалена, но появилась НОВАЯ строка с тем же адресом A·1
          {
            id: null,
            block: "A",
            landmark: "1",
            slabsHere: 6,
            areaHereM2: null,
            batchPatternId: "pat1",
          },
        ],
        patterns: [{ ...inputPattern, slabsCount: 6, areaM2: 20 }],
      }),
    );
    expect(M.photoRequestUpdateMany).toHaveBeenCalledWith({
      where: { batchLocationId: "loc1" },
      data: { batchLocationId: "loc-new-1" },
    });
    expect(M.locationDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["loc1"] } },
    });
  });

  it("удаляемая локация без фотозапросов удаляется как раньше", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    M.photoRequestFindMany.mockResolvedValue([]);
    await applyBatchEdit(
      baseInput({
        locations: [
          {
            id: "loc2",
            block: "B",
            landmark: "2",
            slabsHere: 10,
            areaHereM2: null,
            batchPatternId: null,
          },
        ],
        // узор больше нигде не разложен — это законно (cap ≤, не ==)
      }),
    );
    expect(M.photoRequestUpdateMany).not.toHaveBeenCalled();
    expect(M.locationDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["loc1"] } },
    });
    expect(M.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("happy path без правки локаций: строки локаций не трогаются вовсе", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    const res = await applyBatchEdit(baseInput({ lengthMm: 120 }));
    expect(res.changes).toContainEqual({
      field: "lengthMm",
      old: 118,
      new: 120,
    });
    expect(M.locationUpdate).not.toHaveBeenCalled();
    expect(M.locationCreate).not.toHaveBeenCalled();
    expect(M.locationDeleteMany).not.toHaveBeenCalled();
    expect(M.photoRequestFindMany).not.toHaveBeenCalled();
  });
});

describe("applyBatchEdit — сверка раскладки на правке (ТЗ №18 §4)", () => {
  it("§4.2: по узору нельзя разложить больше, чем в узоре", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    await expect(
      applyBatchEdit(
        baseInput({
          locations: [
            {
              id: "loc1",
              block: "A",
              landmark: "1",
              slabsHere: 6, // в узоре только 5
              areaHereM2: null,
              batchPatternId: "pat1",
            },
            {
              id: "loc2",
              block: "B",
              landmark: "2",
              slabsHere: 4,
              areaHereM2: null,
              batchPatternId: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringMatching(/разложено 6 плит, а в узоре только 5/),
    });
    expect(M.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("§4.3: суммы по локациям должны сойтись с итогами партии", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    await expect(
      applyBatchEdit(
        baseInput({
          locations: [
            {
              id: "loc1",
              block: "A",
              landmark: "1",
              slabsHere: 3,
              areaHereM2: null,
              batchPatternId: "pat1",
            },
            {
              id: "loc2",
              block: "B",
              landmark: "2",
              slabsHere: 3,
              areaHereM2: null,
              batchPatternId: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringMatching(/Разложено 6 из 10 плит/),
    });
  });

  it("строка без «плит здесь» — строгой сверки нет (старые партии законны)", async () => {
    M.batchFindUnique.mockResolvedValue(batchRow());
    const res = await applyBatchEdit(
      baseInput({
        locations: [
          {
            id: "loc1",
            block: "A",
            landmark: "1",
            slabsHere: 3, // неполная раскладка, вторая строка пустая
            areaHereM2: null,
            batchPatternId: "pat1",
          },
          {
            id: "loc2",
            block: "B",
            landmark: "2",
            slabsHere: null,
            areaHereM2: null,
            batchPatternId: null,
          },
        ],
      }),
    );
    expect(res.changes.some((c) => c.field === "locations")).toBe(true);
    expect(M.locationUpdate).toHaveBeenCalledTimes(2);
  });
});
