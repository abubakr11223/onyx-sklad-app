// ТЗ №15 §3.2/§7.7 — «Поиск / фильтр: по клиенту, по типу, по дате, по менеджеру».
//
// До этого `listShipments` не принимала фильтров вообще: архив показывал
// «последние 100». Вопрос склада «когда мы отдали Ахмаду плиту?» решался
// прокруткой, а после сотни отгрузок — никак.
//
// Отдельно важен второй инвариант: фильтр по менеджеру НЕ должен становиться
// способом посмотреть чужие задачи. Менеджер видит только свои; параметр
// `manager` применяется лишь тем, кто и так видит все.
import { describe, expect, it } from "vitest";
import {
  shipmentFiltersActive,
  shipmentFiltersFromSearchParams,
  shipmentsListWhere,
} from "@/lib/shipments";

const OWNER = { canSeeAll: true, actorId: "owner-1" };
const MANAGER = { canSeeAll: false, actorId: "mgr-A" };

describe("shipmentsListWhere — область видимости важнее фильтров", () => {
  it("менеджер сужен до своих отгрузок", () => {
    const w = shipmentsListWhere({ ...MANAGER, tab: "open" });
    expect(w.managerId).toBe("mgr-A");
  });

  it("менеджер НЕ может фильтром посмотреть чужие задачи", () => {
    const w = shipmentsListWhere({
      ...MANAGER,
      tab: "archive",
      filters: { managerId: "mgr-B" },
    });
    // Область побеждает: остаётся собственный id, а не запрошенный.
    expect(w.managerId).toBe("mgr-A");
  });

  it("владелец может сузить до конкретного менеджера", () => {
    const w = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { managerId: "mgr-B" },
    });
    expect(w.managerId).toBe("mgr-B");
  });

  it("без актора и без права видеть всё — не показываем ничего", () => {
    const w = shipmentsListWhere({
      canSeeAll: false,
      actorId: null,
      tab: "open",
    });
    expect(w.managerId).toBe("__none__");
  });
});

describe("shipmentsListWhere — вкладки", () => {
  it("«К отгрузке» — не отменённые и не завершённые", () => {
    const w = shipmentsListWhere({ ...OWNER, tab: "open" });
    expect(w.cancelledAt).toBeNull();
    expect(w.completedAt).toBeNull();
  });

  it("«Архив» — завершённые или отменённые", () => {
    const w = shipmentsListWhere({ ...OWNER, tab: "archive" });
    expect(w.OR).toEqual([
      { completedAt: { not: null } },
      { cancelledAt: { not: null } },
    ]);
  });
});

describe("shipmentsListWhere — фильтры ТЗ §3.2", () => {
  it("тип сужает kind, а не расширяет", () => {
    const all = shipmentsListWhere({ ...OWNER, tab: "archive" });
    expect(all.kind).toEqual({ in: ["SALE", "SAMPLE", "SHOWROOM"] });

    const only = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { kind: "SAMPLE" },
    });
    expect(only.kind).toBe("SAMPLE");
  });

  it("дата — период по createdAt", () => {
    const from = new Date("2026-08-01T00:00:00.000+05:00");
    const to = new Date("2026-08-31T23:59:59.999+05:00");
    const w = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { from, to },
    });
    expect(w.createdAt).toEqual({ gte: from, lte: to });
  });

  it("только «с даты» — без верхней границы", () => {
    const from = new Date("2026-08-01T00:00:00.000+05:00");
    const w = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { from, to: null },
    });
    expect(w.createdAt).toEqual({ gte: from });
  });

  it("клиент ищется во ВСЕХ трёх местах, где живёт имя", () => {
    // Справочник, карточка образца и текстовое имя legacy-продажи. Если искать
    // только в справочнике, поиск «работает», но не находит часть отгрузок.
    const w = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { client: "Ахмад" },
    });
    const and = w.AND as Array<{ OR: unknown[] }>;
    expect(and).toHaveLength(1);
    expect(and[0].OR).toEqual([
      { client: { name: { contains: "Ахмад", mode: "insensitive" } } },
      { sample: { client: { name: { contains: "Ахмад", mode: "insensitive" } } } },
      { saleRecord: { customerName: { contains: "Ахмад", mode: "insensitive" } } },
    ]);
  });

  it("пустой запрос клиента не добавляет условий", () => {
    const w = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { client: "   " },
    });
    expect(w.AND).toBeUndefined();
  });

  it("фильтр клиента не затирает условие вкладки «Архив»", () => {
    const w = shipmentsListWhere({
      ...OWNER,
      tab: "archive",
      filters: { client: "Ахмад" },
    });
    // OR вкладки и OR поиска не должны конфликтовать: поиск уходит в AND.
    expect(w.OR).toEqual([
      { completedAt: { not: null } },
      { cancelledAt: { not: null } },
    ]);
    expect(Array.isArray(w.AND)).toBe(true);
  });
});

describe("shipmentFiltersFromSearchParams — разбор URL", () => {
  it("нормальные значения разбираются", () => {
    const f = shipmentFiltersFromSearchParams({
      client: "  Ахмад ",
      kind: "sample",
      from: "2026-08-01",
      to: "2026-08-31",
      manager: " mgr-B ",
    });
    expect(f.client).toBe("Ахмад");
    expect(f.kind).toBe("SAMPLE");
    expect(f.managerId).toBe("mgr-B");
    expect(f.from?.toISOString()).toBe("2026-07-31T19:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-08-31T18:59:59.999Z");
  });

  it("мусор игнорируется, страница не падает", () => {
    const f = shipmentFiltersFromSearchParams({
      kind: "DROP TABLE",
      from: "не дата",
      to: "31-08-2026",
    });
    expect(f.kind).toBe("");
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });

  it("пустые параметры → фильтр неактивен", () => {
    const f = shipmentFiltersFromSearchParams({});
    expect(shipmentFiltersActive(f)).toBe(false);
  });

  it("любой заполненный параметр включает «сбросить фильтр»", () => {
    expect(
      shipmentFiltersActive(shipmentFiltersFromSearchParams({ client: "А" })),
    ).toBe(true);
    expect(
      shipmentFiltersActive(shipmentFiltersFromSearchParams({ kind: "SALE" })),
    ).toBe(true);
    expect(
      shipmentFiltersActive(
        shipmentFiltersFromSearchParams({ from: "2026-08-01" }),
      ),
    ).toBe(true);
  });
});
