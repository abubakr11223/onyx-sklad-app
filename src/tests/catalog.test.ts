// ТЗ №20 I — онлайн-каталог, похожие камни, подборки. Без БД — mock-клиенты.
//
// Проверяем правила, которые легко сломать тихо:
//   • видимость (без фото / флаг выключен — клиент не видит, сотрудник видит);
//   • сортировка «в наличии → по названию»;
//   • фильтр по размеру = логика «Поиска» (те же where и тот же отбор узоров);
//   • похожие: порядок ярусов, только в наличии, максимум 6;
//   • подборка: закрытая страница, «Нравится», скоуп менеджера, поля клиента.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/min-stock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/min-stock")>()),
  loadStockLevels: vi.fn(),
  loadStockLevelsByBatch: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/pattern-stock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pattern-stock")>()),
  loadPatternStock: vi.fn(async () => new Map()),
}));

import type { PrismaClient } from "@prisma/client";
import { loadStockLevels } from "@/lib/min-stock";
import { capabilitiesFor } from "@/lib/permissions";
import {
  buildCatalogItem,
  catalogTypesWhere,
  hiddenReasonOf,
  isCatalogVisible,
  loadCatalog,
  loadSimilarStones,
  parseCatalogFilters,
  pickSimilar,
  rankSimilar,
  similarTier,
  sortCatalog,
  SIMILAR_MAX,
  type CatalogFacts,
} from "@/lib/catalog";
import {
  batchesPlateWhere,
  plateFitStoneTypeIds,
  sizeSearchHits,
  slabsWhere,
  type SizeSearchBatch,
} from "@/lib/poisk-search";
import { loadPlateFitStoneTypeIds, parsePoiskDim, poiskNeed } from "@/lib/poisk-size-fit";
import {
  addCollectionItem,
  canEditCollection,
  collectionLeadContext,
  collectionListScope,
  generateCollectionCode,
  loadPublicCollection,
  loadStaffCollection,
  normalizeCollectionCode,
  setCollectionClosed,
  toggleCollectionLike,
} from "@/lib/collections";
import { describeHistoryEntry } from "@/lib/history-labels";

const OPTS = { canSeePurchasePrice: false };
const asDb = (x: unknown) => x as PrismaClient;

function facts(over: Partial<CatalogFacts> = {}): CatalogFacts {
  return {
    stoneTypeId: "st1",
    code: "ONX-AAAAA",
    name: "Оникс Мёд",
    rockType: "Оникс",
    color: "медовый",
    showInCatalog: true,
    photoId: "ph1",
    hasPhoto: true,
    formats: [{ lengthMm: 280, widthMm: 160, thicknessMm: 2, slabs: 4 }],
    free: { slabs: 4, areaM2: 17.92 },
    freePieces: 0,
    inShowroom: false,
    ...over,
  };
}

const OUT = { free: { slabs: 0, areaM2: 0 }, freePieces: 0, inShowroom: false };

// ───────────────────────── Видимость и поля ─────────────────────────

describe("каталог — видимость вида (§10.1)", () => {
  it("без фото клиент и партнёр не видят, сотрудник видит с пометкой", () => {
    const f = facts({ photoId: null, hasPhoto: false });
    expect(isCatalogVisible(f, "client")).toBe(false);
    expect(isCatalogVisible(f, "partner")).toBe(false);
    expect(isCatalogVisible(f, "staff")).toBe(true);
    expect(hiddenReasonOf(f)).toBe("noPhoto");
  });

  it("флаг «Показывать в каталоге» выключен — скрыт от клиента, даже с фото", () => {
    const f = facts({ showInCatalog: false });
    expect(isCatalogVisible(f, "client")).toBe(false);
    expect(isCatalogVisible(f, "partner")).toBe(false);
    expect(isCatalogVisible(f, "staff")).toBe(true);
    expect(hiddenReasonOf(f)).toBe("flagOff");
  });

  it("флаг и фото есть — видят все", () => {
    for (const v of ["client", "partner", "staff"] as const) {
      expect(isCatalogVisible(facts(), v)).toBe(true);
    }
  });

  it("where: клиенту/партнёру — только неархивные с флагом; сотруднику — без флага", () => {
    const client = JSON.stringify(catalogTypesWhere({ q: "", rock: "", color: "" }, "client", null));
    const staff = JSON.stringify(catalogTypesWhere({ q: "", rock: "", color: "" }, "staff", null));
    expect(client).toContain('"showInCatalog":true');
    expect(client).toContain('"isArchived":false');
    expect(staff).not.toContain("showInCatalog");
    expect(staff).toContain('"isArchived":false');
  });

  it("поиск по коду ONX-… работает в каталоге (тот же codeWhere, что «Поиск»)", () => {
    const w = JSON.stringify(catalogTypesWhere({ q: "onx 7k3qd", rock: "", color: "" }, "client", null));
    expect(w).toContain('"code":"ONX-7K3QD"');
  });
});

describe("каталог — поля по ролям (таблица 9.1)", () => {
  it("клиенту — без цифр остатка и служебных полей", () => {
    const item = buildCatalogItem(facts(), "client");
    expect(Object.keys(item).sort()).toEqual(
      ["availability", "code", "color", "name", "photoId", "rockType", "sizes", "thicknesses", "viewer"].sort(),
    );
    expect(item.availability).toBe("IN_STOCK");
    expect(item.sizes).toEqual(["280 × 160"]);
    expect(item.thicknesses).toEqual(["2"]);
  });

  it("партнёру — свободно плит и м²; сотруднику — ещё бой и пометка", () => {
    const p = buildCatalogItem(facts(), "partner");
    expect(p).toMatchObject({ viewer: "partner", freeSlabs: 4, freeAreaM2: 17.92 });
    expect(p).not.toHaveProperty("stoneTypeId");
    const s = buildCatalogItem(facts({ showInCatalog: false, freePieces: 2 }), "staff");
    expect(s).toMatchObject({ viewer: "staff", freePieces: 2, hiddenReason: "flagOff" });
  });

  it("нет в наличии — OUT_OF_STOCK («Нет в наличии, под заказ»)", () => {
    expect(buildCatalogItem(facts(OUT), "client").availability).toBe("OUT_OF_STOCK");
    expect(buildCatalogItem(facts({ ...OUT, inShowroom: true }), "client").availability).toBe(
      "IN_SHOWROOM",
    );
  });
});

describe("каталог — сортировка: в наличии, затем по названию", () => {
  it("в наличии сверху, шоу-рум, затем под заказ; внутри — по алфавиту", () => {
    const items = [
      { name: "Яшма", availability: "OUT_OF_STOCK" as const },
      { name: "Бежевый мрамор", availability: "IN_STOCK" as const },
      { name: "Агат", availability: "OUT_OF_STOCK" as const },
      { name: "Арабескато", availability: "IN_STOCK" as const },
      { name: "Белый оникс", availability: "IN_SHOWROOM" as const },
    ];
    expect(sortCatalog(items).map((i) => i.name)).toEqual([
      "Арабескато",
      "Бежевый мрамор",
      "Белый оникс",
      "Агат",
      "Яшма",
    ]);
  });
});

describe("каталог — разбор фильтров", () => {
  it("размер — семантика «Поиска» (parseInt, > 0), толщина с запятой", () => {
    const f = parseCatalogFilters({ l: "120.5", w: "abc", t: "1,8", rock: " Оникс " });
    expect(f.lengthCm).toBe(120);
    expect(f.widthCm).toBeNull();
    expect(f.thickness).toBe(1.8);
    expect(f.rock).toBe("Оникс");
    expect(parsePoiskDim("0")).toBeNull();
    expect(parsePoiskDim("60")).toBe(60);
  });
});

// ───────────────────────── Размер = «Поиск» ─────────────────────────

describe("каталог — фильтр по размеру делегирует логике «Поиска»", () => {
  const batches: SizeSearchBatch[] = [
    // Узор 280×160 подходит под 150×270 (поворот + запас 2 см); узор 100×60 — нет.
    {
      id: "b1",
      lengthMm: null,
      widthMm: null,
      thicknessMm: 2,
      stoneType: { id: "stA", name: "A" },
      patterns: [
        { id: "p1", description: "светлый", lengthMm: 280, widthMm: 160, thicknessMm: 2 },
        { id: "p2", description: "мелкий", lengthMm: 100, widthMm: 60, thicknessMm: 2 },
      ],
      locations: [],
    },
    // Партия с узорами, но ни один узор не под размер → вид не попадает,
    // хотя габарит самой партии большой (ТЗ №19 C2).
    {
      id: "b2",
      lengthMm: 300,
      widthMm: 200,
      thicknessMm: 2,
      stoneType: { id: "stB", name: "B" },
      patterns: [{ id: "p3", description: "x", lengthMm: 120, widthMm: 80, thicknessMm: 2 }],
      locations: [],
    },
    // Однородная партия ровно на грани: 272×152 под 150×270 (+2 см) — подходит.
    {
      id: "b3",
      lengthMm: 272,
      widthMm: 152,
      thicknessMm: 3,
      stoneType: { id: "stC", name: "C" },
      patterns: [],
      locations: [],
    },
  ];
  const slabs = [{ id: "s1", stoneType: { id: "stD" } }];

  it("те же where-строители, тот же отбор узоров, тот же набор видов", async () => {
    const slabFind = vi.fn(async () => slabs);
    const batchFind = vi.fn(async () => batches);
    const ids = await loadPlateFitStoneTypeIds(
      { slab: { findMany: slabFind }, batch: { findMany: batchFind } } as never,
      { lengthCm: 150, widthCm: 270 },
    );
    const { needMax, needMin } = poiskNeed(150, 270);
    expect(needMax).toBe(272);
    expect(needMin).toBe(152);
    const slabArgs = (slabFind.mock.calls[0] as unknown[])[0] as { where: unknown };
    const batchArgs = (batchFind.mock.calls[0] as unknown[])[0] as { where: unknown };
    expect(slabArgs.where).toEqual(slabsWhere("", needMax, needMin));
    expect(batchArgs.where).toEqual(batchesPlateWhere("", needMax, needMin));
    // Тот же результат, что /poisk считает из тех же строк.
    const expected = plateFitStoneTypeIds(slabs, sizeSearchHits(batches, 150, 270, null, null));
    expect(ids).toEqual(expected);
    expect([...ids].sort()).toEqual(["stA", "stC", "stD"]);
  });

  it("loadCatalog с размером спрашивает только подошедшие виды; пусто — без запроса видов", async () => {
    const stoneFind = vi.fn(async () => []);
    const db = {
      slab: { findMany: vi.fn(async () => []) },
      batch: { findMany: vi.fn(async () => []) },
      stoneType: { findMany: stoneFind },
    };
    const r = await loadCatalog(asDb(db), {
      viewer: "client",
      filters: parseCatalogFilters({ l: "500", w: "500" }),
    });
    expect(r.items).toEqual([]);
    // Только запрос вариантов фильтра (порода/цвет), видов — нет.
    expect(stoneFind).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── loadCatalog (mock-БД) ─────────────────────────

type TypeRow = {
  id: string;
  code: string;
  name: string;
  rockType: string;
  color: string | null;
  showInCatalog: boolean;
};

function catalogDb(types: TypeRow[], opts: { photos: Record<string, string>; free: Record<string, number> }) {
  vi.mocked(loadStockLevels).mockImplementation(async (_db, ids) => {
    return new Map(
      [...ids].map((id) => [id, { slabs: opts.free[id] ?? 0, areaM2: (opts.free[id] ?? 0) * 4 }]),
    );
  });
  return {
    stoneType: {
      findMany: vi.fn(async (args: { select: Record<string, unknown> }) =>
        "id" in args.select ? types : types.map((t) => ({ rockType: t.rockType, color: t.color })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        types.find((t) => t.id === where.id) ?? null,
      ),
    },
    photo: {
      findMany: vi.fn(async () =>
        Object.entries(opts.photos).map(([typeId, id]) => ({
          id,
          kind: "SAMPLE",
          stoneTypeId: typeId,
          batchPattern: null,
          batch: null,
        })),
      ),
    },
    piece: { groupBy: vi.fn(async () => []) },
    slab: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    batch: { findMany: vi.fn(async () => []) },
  };
}

const T = (id: string, name: string, rockType: string, color: string | null, show = true): TypeRow => ({
  id,
  code: `ONX-${id.toUpperCase().padEnd(5, "Z").slice(0, 5)}`,
  name,
  rockType,
  color,
  showInCatalog: show,
});

describe("loadCatalog — видимость и порядок на mock-БД", () => {
  beforeEach(() => {
    vi.mocked(loadStockLevels).mockReset();
  });

  const types = [
    T("a", "Яшма", "Яшма", "красный"),
    T("b", "Бежевый мрамор", "Мрамор", "бежевый"),
    T("c", "Без фото", "Мрамор", "белый"),
    T("d", "Агат", "Агат", "серый"),
  ];
  const photos = { a: "pa", b: "pb", d: "pd" };
  const free = { a: 0, b: 3, c: 5, d: 0 };

  it("клиент: вид без фото не виден; в наличии сверху, затем по названию", async () => {
    const r = await loadCatalog(asDb(catalogDb(types, { photos, free })), {
      viewer: "client",
      filters: parseCatalogFilters({}),
    });
    expect(r.items.map((i) => i.name)).toEqual(["Бежевый мрамор", "Агат", "Яшма"]);
    expect(r.items.every((i) => i.viewer === "client")).toBe(true);
    expect(JSON.stringify(r.items)).not.toContain("freeSlabs");
  });

  it("сотрудник: видит и вид без фото (с пометкой)", async () => {
    const r = await loadCatalog(asDb(catalogDb(types, { photos, free })), {
      viewer: "staff",
      filters: parseCatalogFilters({}),
    });
    expect(r.items.map((i) => i.name)).toEqual(["Бежевый мрамор", "Без фото", "Агат", "Яшма"]);
    const noPhoto = r.items.find((i) => i.name === "Без фото");
    expect(noPhoto).toMatchObject({ viewer: "staff", hiddenReason: "noPhoto", freeSlabs: 5 });
  });
});

// ───────────────────────── Похожие (§10.2) ─────────────────────────

describe("похожие камни — порядок, наличие, максимум 6", () => {
  const base = { stoneTypeId: "base", rockType: "Оникс", color: "медовый" };

  it("ярусы: порода+цвет → порода → цвет; регистр и пробелы не важны", () => {
    expect(similarTier(base, { rockType: "оникс ", color: "Медовый" })).toBe(1);
    expect(similarTier(base, { rockType: "Оникс", color: "белый" })).toBe(2);
    expect(similarTier(base, { rockType: "Оникс", color: null })).toBe(2);
    expect(similarTier(base, { rockType: "Мрамор", color: "медовый" })).toBe(3);
    expect(similarTier(base, { rockType: "Мрамор", color: "белый" })).toBeNull();
    // Пустой цвет у базы «тем же цветом» не считается.
    expect(similarTier({ rockType: "Оникс", color: null }, { rockType: "Мрамор", color: null })).toBeNull();
  });

  it("rankSimilar: себя убирает, внутри яруса — по названию", () => {
    const c = (id: string, name: string, rockType: string, color: string) => ({
      stoneTypeId: id,
      name,
      rockType,
      color,
    });
    const ranked = rankSimilar(base, [
      c("x1", "Мрамор Мёд", "Мрамор", "медовый"),
      c("x2", "Оникс Белый", "Оникс", "белый"),
      c("base", "Сам камень", "Оникс", "медовый"),
      c("x3", "Оникс Янтарь", "Оникс", "медовый"),
      c("x4", "Гранит", "Гранит", "серый"),
      c("x5", "Оникс Амбер", "Оникс", "медовый"),
    ]);
    expect(ranked.map((r) => r.stoneTypeId)).toEqual(["x5", "x3", "x2", "x1"]);
  });

  it("pickSimilar: только в наличии, только видимые клиенту, не больше 6", () => {
    const many: CatalogFacts[] = [];
    for (let i = 0; i < 9; i++) {
      many.push(facts({ stoneTypeId: `s${i}`, code: `ONX-S${i}AAA`, name: `Оникс ${i}` }));
    }
    many.push(facts({ stoneTypeId: "out", name: "Оникс А-нет", ...OUT }));
    many.push(facts({ stoneTypeId: "hid", name: "Оникс 0 скрыт", showInCatalog: false }));
    const picked = pickSimilar(base, many, "client");
    expect(picked).toHaveLength(SIMILAR_MAX);
    expect(picked.map((p) => p.stoneTypeId)).not.toContain("out");
    expect(picked.map((p) => p.stoneTypeId)).not.toContain("hid");
    // Сотруднику скрытый флагом — можно (в наличии).
    expect(pickSimilar(base, many, "staff").map((p) => p.stoneTypeId)).toContain("hid");
  });

  it("loadSimilarStones: порядок ярусов, нет в наличии — пропуск, вид клиента", async () => {
    const all = [
      T("base", "Оникс Мёд", "Оникс", "медовый"),
      T("t1", "Оникс Янтарь", "Оникс", "медовый"),
      T("t2", "Оникс Белый", "Оникс", "белый"),
      T("t3", "Мрамор Мёд", "Мрамор", "медовый"),
      T("t4", "Оникс Амбер", "Оникс", "медовый"),
    ];
    const db = catalogDb(all, {
      photos: { t1: "p1", t2: "p2", t3: "p3", t4: "p4" },
      free: { t1: 2, t2: 1, t3: 5, t4: 0 },
    });
    // Кандидаты — все, кроме базы (SQL-фильтр породы/цвета mock не делает).
    db.stoneType.findMany = vi.fn(async () => all.filter((t) => t.id !== "base"));
    const items = await loadSimilarStones(asDb(db), "base", { viewer: "client" });
    expect(items.map((i) => i.name)).toEqual(["Оникс Янтарь", "Оникс Белый", "Мрамор Мёд"]);
    expect(items.every((i) => i.viewer === "client" && i.availability === "IN_STOCK")).toBe(true);
  });
});

// ───────────────────────── Подборки (§10.3) ─────────────────────────

describe("подборки — код и скоуп", () => {
  it("код: 10 символов алфавита ONX, нормализация регистра", () => {
    let i = 0;
    const code = generateCollectionCode(() => i++ % 32);
    expect(code).toBe("23456789AB");
    expect(normalizeCollectionCode(" 23456789ab ")).toBe("23456789AB");
    expect(normalizeCollectionCode("23456789A0")).toBeNull(); // 0 — не из алфавита
    expect(normalizeCollectionCode("SHORT")).toBeNull();
  });

  it("менеджер — свои, владелец — все, склад — ничего не меняет", () => {
    const owner = capabilitiesFor("OWNER", OPTS);
    const manager = capabilitiesFor("MANAGER", OPTS);
    const wh = capabilitiesFor("WAREHOUSE", OPTS);
    expect(collectionListScope({ canSeeAllCollections: owner.canSeeAllCollections, actorId: "o" })).toEqual({});
    expect(collectionListScope({ canSeeAllCollections: manager.canSeeAllCollections, actorId: "m1" })).toEqual({
      managerId: "m1",
    });
    expect(collectionListScope({ canSeeAllCollections: false, actorId: null })).toEqual({
      managerId: "__no_actor__",
    });
    expect(canEditCollection(manager, "m1", { managerId: "m1" })).toBe(true);
    expect(canEditCollection(manager, "m1", { managerId: "m2" })).toBe(false);
    expect(canEditCollection(owner, "o", { managerId: "m2" })).toBe(true);
    expect(canEditCollection(wh, "w", { managerId: "w" })).toBe(false);
  });

  it("loadStaffCollection: менеджеру where со своим managerId; склад — null без запроса", async () => {
    const findFirst = vi.fn(async () => null);
    const db = asDb({ collection: { findFirst } });
    await loadStaffCollection(db, { id: "c1", caps: capabilitiesFor("MANAGER", OPTS), actorId: "m1" });
    expect((findFirst.mock.calls[0] as unknown[])[0]).toMatchObject({ where: { id: "c1", managerId: "m1" } });
    findFirst.mockClear();
    expect(
      await loadStaffCollection(db, { id: "c1", caps: capabilitiesFor("WAREHOUSE", OPTS), actorId: "w" }),
    ).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("addCollectionItem: чужая подборка менеджеру — «не найдена», закрытая — «закрыта»", async () => {
    const manager = { id: "m1", caps: capabilitiesFor("MANAGER", OPTS) };
    const db = (c: object | null) =>
      asDb({ collection: { findUnique: vi.fn(async () => c) } });
    expect(
      await addCollectionItem(db({ id: "c1", code: "X", title: "t", managerId: "m2", closedAt: null }), {
        actor: manager,
        collectionId: "c1",
        stoneCode: "ONX-7K3QD",
      }),
    ).toEqual({ ok: false, error: "notfound" });
    expect(
      await addCollectionItem(db({ id: "c1", code: "X", title: "t", managerId: "m1", closedAt: new Date() }), {
        actor: manager,
        collectionId: "c1",
        stoneCode: "ONX-7K3QD",
      }),
    ).toEqual({ ok: false, error: "closed" });
    expect(
      await addCollectionItem(db(null), {
        actor: { id: "w", caps: capabilitiesFor("WAREHOUSE", OPTS) },
        collectionId: "c1",
        stoneCode: "ONX-7K3QD",
      }),
    ).toEqual({ ok: false, error: "denied" });
  });

  it("setCollectionClosed: повторное закрытие ничего не пишет в «Историю»", async () => {
    const audit = vi.fn();
    const tx = { collection: { updateMany: vi.fn(async () => ({ count: 0 })) }, auditLog: { create: audit } };
    const db = asDb({
      collection: {
        findUnique: vi.fn(async () => ({ id: "c1", code: "X", title: "t", managerId: "m1", closedAt: new Date() })),
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    });
    const r = await setCollectionClosed(db, {
      actor: { id: "m1", caps: capabilitiesFor("MANAGER", OPTS) },
      collectionId: "c1",
      closed: true,
    });
    expect(r).toEqual({ ok: true, changed: false });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("подборка — публичная страница", () => {
  beforeEach(() => {
    vi.mocked(loadStockLevels).mockReset();
  });

  it("закрытая подборка: только «закрыта», без камней", async () => {
    const db = asDb({
      collection: {
        findUnique: vi.fn(async () => ({ code: "23456789AB", title: "Кухня", closedAt: new Date(), items: [{}] })),
      },
    });
    const r = await loadPublicCollection(db, "23456789ab");
    expect(r).toEqual({ status: "closed", code: "23456789AB", title: "Кухня" });
  });

  it("неверный код — «не найдена» без запроса в БД", async () => {
    const findUnique = vi.fn();
    expect(await loadPublicCollection(asDb({ collection: { findUnique } }), "../../etc")).toEqual({
      status: "notfound",
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("открытая: камни с полями клиента — без цифр, менеджера, клиента", async () => {
    const st = T("a", "Оникс Мёд", "Оникс", "медовый", false);
    const base = catalogDb([st], { photos: { a: "pa" }, free: { a: 3 } });
    const db = asDb({
      ...base,
      collection: {
        findUnique: vi.fn(async () => ({
          code: "23456789AB",
          title: "Кухня",
          closedAt: null,
          items: [
            { id: "i1", stoneCode: "ONX-PATT1", comment: "На столешницу", likedAt: new Date(), stoneType: st },
          ],
        })),
      },
    });
    const r = await loadPublicCollection(db, "23456789AB");
    expect(r.status).toBe("open");
    if (r.status !== "open") return;
    expect(r.items).toHaveLength(1);
    const it0 = r.items[0];
    expect(it0).toMatchObject({ id: "i1", code: "ONX-PATT1", comment: "На столешницу", liked: true });
    // Камень показан, хотя скрыт из каталога — его выбрал менеджер.
    expect(it0.stone).toMatchObject({ viewer: "client", name: "Оникс Мёд", availability: "IN_STOCK" });
    const json = JSON.stringify(r);
    for (const leak of ["freeSlabs", "freeAreaM2", "managerId", "clientId", "stoneTypeId", "hiddenReason"]) {
      expect(json).not.toContain(leak);
    }
  });
});

describe("подборка — «Нравится»", () => {
  function likeDb(opts: { closed?: boolean; likedAt?: Date | null; item?: boolean }) {
    const update = vi.fn(async () => ({}));
    const audit = vi.fn(async () => ({}));
    const db = asDb({
      collection: {
        findUnique: vi.fn(async () => ({
          id: "c1",
          title: "Кухня",
          closedAt: opts.closed ? new Date() : null,
        })),
      },
      collectionItem: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; collectionId: string } }) =>
          opts.item === false || where.collectionId !== "c1"
            ? null
            : {
                id: where.id,
                likedAt: opts.likedAt ?? null,
                stoneCode: "ONX-7K3QD",
                stoneType: { name: "Оникс Мёд" },
              },
        ),
      },
      $transaction: async (fn: (t: unknown) => unknown) =>
        fn({ collectionItem: { update }, auditLog: { create: audit } }),
    });
    return { db, update, audit };
  }
  const now = new Date("2026-11-08T10:00:00Z");

  it("ставит отметку и пишет в «Историю» от имени клиента (userId null)", async () => {
    const { db, update, audit } = likeDb({});
    expect(await toggleCollectionLike(db, { code: "23456789AB", itemId: "i1", now })).toEqual({
      status: "ok",
      liked: true,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { likedAt: now } });
    const row = (audit.mock.calls[0] as unknown[])[0] as { data: { userId: null; payload: { kind: string } } };
    expect(row.data.userId).toBeNull();
    expect(row.data.payload.kind).toBe("collection.like");
  });

  it("повторное нажатие снимает отметку", async () => {
    const { db, update } = likeDb({ likedAt: new Date() });
    expect(await toggleCollectionLike(db, { code: "23456789AB", itemId: "i1", now })).toEqual({
      status: "ok",
      liked: false,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { likedAt: null } });
  });

  it("закрытая подборка и чужой камень — без записи", async () => {
    const closed = likeDb({ closed: true });
    expect(await toggleCollectionLike(closed.db, { code: "23456789AB", itemId: "i1" })).toEqual({
      status: "closed",
    });
    expect(closed.update).not.toHaveBeenCalled();
    const foreign = likeDb({ item: false });
    expect(await toggleCollectionLike(foreign.db, { code: "23456789AB", itemId: "zz" })).toEqual({
      status: "notfound",
    });
    expect(foreign.update).not.toHaveBeenCalled();
  });

  it("заявка с подборки: только открытая и только её камень", async () => {
    const db = (c: object | null) => ({ collection: { findUnique: vi.fn(async () => c) } }) as never;
    expect(
      await collectionLeadContext(db({ code: "23456789AB", title: "Кухня", closedAt: null, items: [{ id: "i" }] }), {
        collectionCode: "23456789AB",
        stoneCode: "ONX-7K3QD",
      }),
    ).toEqual({ collectionCode: "23456789AB", collectionTitle: "Кухня" });
    expect(
      await collectionLeadContext(db({ code: "23456789AB", title: "Кухня", closedAt: new Date(), items: [{ id: "i" }] }), {
        collectionCode: "23456789AB",
        stoneCode: "ONX-7K3QD",
      }),
    ).toBeNull();
    expect(
      await collectionLeadContext(db({ code: "23456789AB", title: "Кухня", closedAt: null, items: [] }), {
        collectionCode: "23456789AB",
        stoneCode: "ONX-7K3QD",
      }),
    ).toBeNull();
  });

  it("«История»: отметка клиента и закрытие подписаны по-русски", () => {
    const d = describeHistoryEntry({
      action: "STATUS_CHANGE",
      entityType: "Collection",
      entityId: "c1",
      payload: { kind: "collection.like", title: "Кухня", stoneName: "Оникс Мёд", stoneCode: "ONX-7K3QD" },
    } as never);
    expect(d.summary).toContain("Нравится");
    expect(d.summary).toContain("«Кухня»");
    const c = describeHistoryEntry({
      action: "STATUS_CHANGE",
      entityType: "Collection",
      entityId: "c1",
      payload: { kind: "collection.close", title: "Кухня" },
    } as never);
    expect(c.summary).toContain("Подборка закрыта");
  });
});

describe("фото партии (паллета) — только сотрудникам", () => {
  it("клиент/партнёр: BATCH не входит; сотрудник: входит", async () => {
    const { typePhotoWhere } = await import("@/lib/catalog");
    const pub = JSON.stringify(typePhotoWhere(["t1"]));
    const staff = JSON.stringify(typePhotoWhere(["t1"], { includeBatch: true }));
    expect(pub).not.toContain("BATCH");
    expect(staff).toContain("BATCH");
  });
});
