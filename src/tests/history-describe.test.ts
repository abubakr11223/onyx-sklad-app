// ТЗ №19 E2 — «История без содержания». Записи вида «Отгрузка #cmvhvsy1»
// не говорят, что и сколько. describeHistoryEntry собирает строку из payload
// + пакетных справочников: объект, количество, узор, локация, «было → стало».
import { describe, expect, it } from "vitest";
import {
  collectHistoryRefs,
  describeHistoryEntry,
  formatHistoryQty,
  historyLineRu,
  patternCountRu,
  shortLocation,
  type HistoryLookups,
} from "@/lib/history-labels";

const lookups: HistoryLookups = {
  batches: new Map([["b1", { stoneName: "Травертин Классик" }]]),
  slabs: new Map([["s1", { stoneName: "Оникс Париж", label: "Плита №2" }]]),
  patterns: new Map([
    ["p1", "ТЕСТ светлый 2см"],
    ["p2", "тёмный"],
  ]),
  clients: new Map([["c1", "Тимур"]]),
  sales: new Map([["sale1", { customerName: "Тимур" }]]),
  shipments: new Map([
    [
      "sh1",
      {
        clientName: "Тимур",
        lines: [
          {
            id: "l1",
            stoneName: "Травертин Классик",
            patternLabel: "ТЕСТ светлый 2см",
            location: "Блок A1",
            unitLabel: null,
          },
        ],
      },
    ],
  ]),
};

describe("История — приёмка", () => {
  it("формат ТЗ: камень · плиты / площадь · узоры · блоки", () => {
    const line = historyLineRu(
      {
        action: "INTAKE",
        entityType: "Batch",
        entityId: "b1",
        payload: {
          stoneName: "Травертин Классик",
          slabsTotal: 6,
          areaTotalM2: 24.69,
          locations: [
            { block: "A1", landmark: "", slabsHere: 4 },
            { block: "A2", landmark: "", slabsHere: 2 },
            { block: "A1", landmark: "у ворот", slabsHere: 0 },
          ],
          patterns: [{ slabs: 4 }, { slabs: 2 }],
        },
      },
      lookups,
    );
    expect(line).toBe(
      "Приёмка · Травертин Классик · 6 пл. / 24,69 м² · 2 узора · A1, A2",
    );
  });

  it("новые ключи (patternCount, locationBlocks) и Decimal-строки", () => {
    const d = describeHistoryEntry({
      action: "INTAKE",
      entityType: "Batch",
      entityId: "b1",
      payload: {
        slabsTotal: "6",
        areaTotalM2: "24.690",
        patternCount: 1,
        locationBlocks: ["B3"],
      },
    }, lookups);
    expect(d.summary).toBe("Травертин Классик · 6 пл. / 24,69 м² · 1 узор · B3");
  });

  it("старая запись без количества: только камень (без падения)", () => {
    const d = describeHistoryEntry({
      action: "INTAKE",
      entityType: "Batch",
      entityId: "b-unknown",
      payload: { stoneName: "Мрамор" },
    });
    expect(d.summary).toBe("Мрамор");
  });
});

describe("История — продажа по узору", () => {
  it("строка с узором, количеством, локацией и клиентом", () => {
    const line = historyLineRu(
      {
        action: "SALE",
        entityType: "Batch",
        entityId: "b1",
        payload: {
          customerName: "Тимур",
          qtySlabs: 2,
          qtyAreaM2: null,
          lines: [
            {
              batchPatternId: "p1",
              patternLabel: "ТЕСТ светлый 2см",
              qtySlabs: 2,
              qtyAreaM2: null,
              location: "Блок A1",
            },
          ],
        },
      },
      lookups,
    );
    expect(line).toBe(
      "Продажа · Травертин Классик · ТЕСТ светлый 2см · 2 пл. · A1 → Тимур",
    );
  });

  it("узор без patternLabel берётся из справочника; несколько строк через +", () => {
    const d = describeHistoryEntry(
      {
        action: "SALE",
        entityType: "Batch",
        entityId: "b1",
        payload: {
          customerName: "Тимур",
          lines: [
            { batchPatternId: "p1", qtySlabs: 1, location: "Блок A1 · ориентир у ворот" },
            { batchPatternId: "p2", qtySlabs: 1, location: "Блок B2" },
          ],
        },
      },
      lookups,
    );
    expect(d.summary).toBe(
      "Травертин Классик · ТЕСТ светлый 2см · 1 пл. · A1 (у ворот) + тёмный · 1 пл. · B2 → Тимур",
    );
  });

  it("старая объёмная продажа без lines: узор по batchPatternId", () => {
    const d = describeHistoryEntry(
      {
        action: "SALE",
        entityType: "Batch",
        entityId: "b1",
        payload: { customerName: "Тимур", qtySlabs: 3, batchPatternId: "p2" },
      },
      lookups,
    );
    expect(d.summary).toBe("Травертин Классик · тёмный · 3 пл. → Тимур");
  });

  it("продажа плиты: камень и ярлык из справочника", () => {
    const d = describeHistoryEntry(
      {
        action: "SALE",
        entityType: "Slab",
        entityId: "s1",
        payload: { customerName: "Тимур" },
      },
      lookups,
    );
    expect(d.summary).toBe("Оникс Париж · Плита №2 → Тимур");
  });
});

describe("История — отгрузка", () => {
  it("вместо «Отгрузка #id» — камень, узор, сколько, откуда, кому", () => {
    const line = historyLineRu(
      {
        action: "SHIPMENT_CONFIRM",
        entityType: "Shipment",
        entityId: "sh1",
        payload: { lineId: "l1", addSlabs: 2, addArea: 0, fully: true },
      },
      lookups,
    );
    expect(line).toBe(
      "Отгрузка · Травертин Классик · ТЕСТ светлый 2см · 2 пл. · A1 · полностью → Тимур",
    );
  });

  it("неизвестная отгрузка — прежний откат на сущность+id", () => {
    const d = describeHistoryEntry({
      action: "SHIPMENT_CONFIRM",
      entityType: "Shipment",
      entityId: "cmvhvsy1xyz",
      payload: { lineId: "zz", addSlabs: 0, addArea: 0 },
    });
    expect(d.summary).toBe("Отгрузка #cmvhvsy1");
  });
});

describe("История — правки «было → стало»", () => {
  it("правка партии: поля и узоры", () => {
    const d = describeHistoryEntry(
      {
        action: "ADJUSTMENT",
        entityType: "Batch",
        entityId: "b1",
        payload: {
          kind: "BATCH_EDIT",
          stoneName: "Травертин Классик",
          changes: [
            { field: "slabsTotal", old: 6, new: 5 },
            { field: "areaTotalM2", old: 24.69, new: 20.5 },
            { field: "pattern.p1.slabsCount", old: 4, new: 3 },
            { field: "supplierNote", old: null, new: "Иран" },
            { field: "locations", old: "A1||4||;A2||2||", new: "A1||5||" },
          ],
        },
      },
      lookups,
    );
    expect(d.summary).toBe("Травертин Классик");
    expect(d.changes).toEqual([
      "Плиты: 6 → 5",
      "Площадь, м²: 24,69 → 20,5",
      "Узор «ТЕСТ светлый 2см»: плиты: 4 → 3",
      "Поставщик / заметка: — → Иран",
      "Локации: A1: 4 пл.; A2: 2 пл. → A1: 5 пл.",
    ]);
  });

  it("перемещение плиты: блок было → стало", () => {
    const d = describeHistoryEntry(
      {
        action: "MOVE",
        entityType: "Slab",
        entityId: "s1",
        payload: { from: { block: "A1" }, to: { block: "B2" } },
      },
      lookups,
    );
    expect(d.summary).toBe("Оникс Париж · Плита №2");
    expect(d.changes).toEqual(["Блок: A1 → B2"]);
  });

  it("переименование блока карты", () => {
    expect(
      historyLineRu({
        action: "ADJUSTMENT",
        entityType: "WarehouseBlock",
        entityId: "w1",
        payload: { kind: "KARTA_BLOCK_RENAME", from: "A", to: "Б" },
      }),
    ).toBe("Корректировка · Блок A → Б");
  });
});

describe("История — прочее", () => {
  it("возврат: клиент из SaleRecord", () => {
    const d = describeHistoryEntry(
      {
        action: "RETURN",
        entityType: "Batch",
        entityId: "b1",
        payload: { saleId: "sale1", qtySlabs: 2, qtyAreaM2: null },
      },
      lookups,
    );
    expect(d.summary).toBe("Травертин Классик · 2 пл. → Тимур");
  });

  it("мусорный payload не роняет страницу", () => {
    for (const payload of [null, 42, "x", [], { lines: "bad", changes: [1, null] }]) {
      const d = describeHistoryEntry({
        action: "SALE",
        entityType: "Batch",
        entityId: "abcdef123456",
        payload,
      });
      expect(d.summary).toBe("Партия #abcdef12");
    }
  });

  it("collectHistoryRefs собирает id для пакетной загрузки", () => {
    const r = collectHistoryRefs([
      { action: "SALE", entityType: "Batch", entityId: "b1", payload: { lines: [{ batchPatternId: "p9" }] } },
      { action: "RETURN", entityType: "Slab", entityId: "s1", payload: { saleId: "sale1" } },
      { action: "SHIPMENT_CONFIRM", entityType: "Shipment", entityId: "sh1", payload: {} },
      { action: "ADJUSTMENT", entityType: "Batch", entityId: "b2", payload: { changes: [{ field: "pattern.p7.areaM2" }] } },
    ]);
    expect([...r.batchIds]).toEqual(["b1", "b2"]);
    expect([...r.slabIds]).toEqual(["s1"]);
    expect([...r.patternIds].sort()).toEqual(["p7", "p9"]);
    expect([...r.saleIds]).toEqual(["sale1"]);
    expect([...r.shipmentIds]).toEqual(["sh1"]);
  });

  it("форматтеры", () => {
    expect(formatHistoryQty(6, 24.69)).toBe("6 пл. / 24,69 м²");
    expect(formatHistoryQty(0, null)).toBeNull();
    expect(patternCountRu(1)).toBe("1 узор");
    expect(patternCountRu(3)).toBe("3 узора");
    expect(patternCountRu(5)).toBe("5 узоров");
    expect(patternCountRu(11)).toBe("11 узоров");
    expect(patternCountRu(21)).toBe("21 узор");
    expect(shortLocation("Блок A1 · ориентир 2")).toBe("A1 (2)");
    expect(shortLocation("шоу-рум")).toBe("шоу-рум");
  });
});
