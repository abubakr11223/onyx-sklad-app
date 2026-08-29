// W3-T5 — keyset-страницы трёх растущих списков: /klienty, /otgruzki (архив),
// /zayavki. Раньше каждый из них молча обрывался на «последних N» без ссылки
// дальше: строка №101 (или №201) просто переставала существовать для склада.
//
// Контракт ровно тот же, что уже закреплён debts-cursor.test.ts:
//   1. составной курсор по ПОЛНОМУ порядку сортировки (сортировочный ключ + id);
//   2. обход всех страниц = полный набор строк, БЕЗ пропусков и дублей —
//      в том числе когда граница страницы падает внутрь кластера строк с
//      ОДИНАКОВЫМ createdAt (этот баг чинили дважды: курсор «только по id»
//      поверх двухколоночного порядка теряет и повторяет строки);
//   3. фильтры продолжают действовать вместе с курсором;
//   4. инвариант /poisk: nextCursor !== null ⟺ есть ещё строки, то есть
//      «Показать ещё» рисуется ровно тогда, когда следующая строка существует.
//
// БЕЗ БАЗЫ: in-memory фейковый Prisma в стиле debts-cursor.test.ts —
// интерпретатор `where` + сортировка модели + честный `take`.
import { describe, expect, it } from "vitest";
import {
  CLIENTS_DIRECTORY_PAGE_SIZE,
  encodeClientsCursor,
  listClientsDirectoryPage,
  parseClientsCursor,
} from "@/lib/clients-directory";
import {
  encodeShipmentsCursor,
  listShipmentsPage,
  parseShipmentsCursor,
  shipmentsKeysetWhere,
  SHIPMENTS_PAGE_SIZE,
} from "@/lib/shipments";
import {
  encodeLeadsCursor,
  leadStatusesAfter,
  leadsKeysetWhere,
  LEADS_PAGE_SIZE,
  listLeadsPage,
  parseLeadsCursor,
  type LeadStatus,
} from "@/lib/leads";

// ───────────────────────── generic where-interpreter ─────────────────────────
// Понимает ровно то подмножество Prisma-where, которое строят наши билдеры:
// AND / OR, скаляры, Date-равенство, lt/gt/gte/lte, in, not, contains+mode,
// и вложенные объекты связей (client.name, saleRecord.customerName, …).

type Row = Record<string, unknown>;

const OPS = new Set([
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "notIn",
  "not",
  "equals",
  "contains",
  "mode",
]);

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function matchField(rv: unknown, cond: unknown): boolean {
  if (cond === null) return rv === null || rv === undefined;
  if (cond instanceof Date) return eq(rv, cond);
  if (typeof cond !== "object") return rv === cond;

  const c = cond as Record<string, unknown>;
  const keys = Object.keys(c);
  const isOperator = keys.length > 0 && keys.every((k) => OPS.has(k));

  if (!isOperator) {
    // Вложенная связь: null-связь не может удовлетворить условие.
    if (rv === null || rv === undefined) return false;
    return matchWhere(rv as Row, cond);
  }

  for (const [op, val] of Object.entries(c)) {
    switch (op) {
      case "mode":
        break;
      case "equals":
        if (!eq(rv, val)) return false;
        break;
      case "lt":
        if (rv === null || rv === undefined || !(cmp(rv, val) < 0)) return false;
        break;
      case "lte":
        if (rv === null || rv === undefined || !(cmp(rv, val) <= 0)) return false;
        break;
      case "gt":
        if (rv === null || rv === undefined || !(cmp(rv, val) > 0)) return false;
        break;
      case "gte":
        if (rv === null || rv === undefined || !(cmp(rv, val) >= 0)) return false;
        break;
      case "in":
        if (!(val as unknown[]).some((x) => eq(rv, x))) return false;
        break;
      case "notIn":
        if ((val as unknown[]).some((x) => eq(rv, x))) return false;
        break;
      case "not":
        if (val === null) {
          if (rv === null || rv === undefined) return false;
        } else if (eq(rv, val)) {
          return false;
        }
        break;
      case "contains": {
        const hay = String(rv ?? "");
        const needle = String(val);
        const ci = c.mode === "insensitive";
        const ok = ci
          ? hay.toLowerCase().includes(needle.toLowerCase())
          : hay.includes(needle);
        if (!ok) return false;
        break;
      }
      default:
        throw new Error(`fake prisma: unsupported operator ${op}`);
    }
  }
  return true;
}

function matchWhere(row: Row, where: unknown): boolean {
  if (where === null || where === undefined) return true;
  if (typeof where !== "object") return true;
  for (const [k, v] of Object.entries(where as Row)) {
    if (k === "AND") {
      if (!(v as unknown[]).every((c) => matchWhere(row, c))) return false;
      continue;
    }
    if (k === "OR") {
      if (!(v as unknown[]).some((c) => matchWhere(row, c))) return false;
      continue;
    }
    if (!matchField(row[k], v)) return false;
  }
  return true;
}

/** Фейковая модель Prisma: фильтрует, сортирует один раз, честно режет take. */
function fakeModel<T extends Row>(
  all: T[],
  sort: (a: T, b: T) => number,
): {
  findMany: (args: { where?: unknown; take: number; orderBy?: unknown }) => Promise<T[]>;
  calls: Array<{ where: unknown; take: number; orderBy: unknown }>;
  sorted: T[];
} {
  const sorted = [...all].sort(sort);
  const calls: Array<{ where: unknown; take: number; orderBy: unknown }> = [];
  return {
    sorted,
    calls,
    findMany: async (args) => {
      calls.push({ where: args.where, take: args.take, orderBy: args.orderBy });
      return sorted.filter((r) => matchWhere(r, args.where)).slice(0, args.take);
    },
  };
}

/**
 * Общий обход всех страниц. Возвращает id в порядке выдачи + счётчик страниц.
 * Курсор непрозрачен для теста — ровно как для браузера пользователя.
 */
async function walkAll(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ items: Array<{ id: string }>; nextCursor: string | null }>,
): Promise<{ ids: string[]; pages: number; pageSizes: number[] }> {
  const ids: string[] = [];
  const pageSizes: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  while (pages < 50) {
    pages++;
    const res = await fetchPage(cursor);
    for (const it of res.items) ids.push(it.id);
    pageSizes.push(res.items.length);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return { ids, pages, pageSizes };
}

// ═════════════════════════════ /klienty ═════════════════════════════
// Порядок: name ASC, id ASC. «Тай» здесь — одинаковое ИМЯ (однофамильцы,
// «Иван» из разных объектов): курсор только по id ломался бы ровно на них.

type FakeClient = Row & {
  id: string;
  name: string;
  type: "B2C" | "B2B";
  phone: string;
  managerId: string;
  manager: { name: string };
  sales: Array<Row>;
  debts: Array<Row>;
};

function client(
  id: string,
  name: string,
  over: Partial<FakeClient> = {},
): FakeClient {
  return {
    id,
    name,
    type: "B2C",
    phone: "+998901112233",
    managerId: "mgr1",
    manager: { name: "Менеджер" },
    sales: [],
    debts: [],
    ...over,
  };
}

function makeClientDb(all: FakeClient[]) {
  const model = fakeModel(all, (a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    db: { client: model } as unknown as Parameters<
      typeof listClientsDirectoryPage
    >[0],
    ...model,
  };
}

describe("/klienty — курсор name+id", () => {
  it("round-trip encode/parse, мусор → null", () => {
    const enc = encodeClientsCursor({ name: "Иван Петров", id: "c1" });
    expect(parseClientsCursor(enc)).toEqual({ name: "Иван Петров", id: "c1" });
    // имя с подчёркиванием: разбор идёт по ПОСЛЕДНЕМУ «_», id — cuid без него
    const odd = encodeClientsCursor({ name: "ООО_Оникс", id: "c2" });
    expect(parseClientsCursor(odd)).toEqual({ name: "ООО_Оникс", id: "c2" });
    expect(parseClientsCursor("")).toBeNull();
    expect(parseClientsCursor(null)).toBeNull();
    // легаси «только id» — без имени: не должен читаться как продолжение
    expect(parseClientsCursor("clxxxxxxxxxxxxxxxxxxxx")).toBeNull();
    expect(parseClientsCursor("_noName")).toBeNull();
    expect(parseClientsCursor("Иван_")).toBeNull();
  });

  it("обход страниц: полный набор, без дублей и пропусков (граница внутри одинаковых имён)", async () => {
    // 5 клиентов с ОДНИМ именем + соседи по обе стороны → 9 строк, page 3.
    const tied = ["c04", "c03", "c02", "c01", "c00"].map((id) =>
      client(id, "Иван"),
    );
    const before = [client("b02", "Азиз"), client("b01", "Азиз")];
    const after = [client("z02", "Яна"), client("z01", "Яна")];
    const all = [...tied, ...before, ...after];
    const { db, sorted, calls } = makeClientDb(all);

    const walk = await walkAll((cursor) =>
      listClientsDirectoryPage(db, {
        canSeeAllClients: true,
        actorId: null,
        cursor,
        pageSize: 3,
      }),
    );

    expect(calls[0]!.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(walk.ids).toEqual(sorted.map((r) => r.id));
    expect(new Set(walk.ids).size).toBe(walk.ids.length); // без дублей
    expect(walk.ids).toHaveLength(all.length); // без пропусков
    expect(walk.pages).toBeGreaterThan(1);

    // Граница страницы действительно легла внутрь кластера одинаковых имён.
    const tieIdx = sorted
      .map((r, i) => (r.name === "Иван" ? i : -1))
      .filter((i) => i >= 0);
    expect(tieIdx).toHaveLength(5);
    expect(Math.floor(tieIdx[0]! / 3)).not.toBe(
      Math.floor(tieIdx[tieIdx.length - 1]! / 3),
    );
  });

  it("фильтры (тип, менеджер, поиск) продолжают действовать вместе с курсором", async () => {
    const all = [
      client("a1", "Иван", { type: "B2B", managerId: "mgrA" }),
      client("a2", "Иван", { type: "B2B", managerId: "mgrA" }),
      client("a3", "Иван", { type: "B2B", managerId: "mgrA" }),
      client("b1", "Иван", { type: "B2C", managerId: "mgrA" }), // не тот тип
      client("b2", "Иван", { type: "B2B", managerId: "mgrB" }), // не тот менеджер
      client("b3", "Пётр", { type: "B2B", managerId: "mgrA" }), // не тот поиск
    ];
    const { db } = makeClientDb(all);

    const walk = await walkAll((cursor) =>
      listClientsDirectoryPage(db, {
        canSeeAllClients: true,
        actorId: null,
        q: "Иван",
        type: "B2B",
        managerId: "mgrA",
        cursor,
        pageSize: 2,
      }),
    );

    expect(walk.ids).toEqual(["a1", "a2", "a3"]);
    expect(walk.pages).toBeGreaterThan(1); // граница страницы реально пройдена
  });

  it("область видимости менеджера не обходится курсором", async () => {
    const all = [
      client("m1", "Алиса", { managerId: "mgrA" }),
      client("m2", "Борис", { managerId: "mgrB" }),
      client("m3", "Виктор", { managerId: "mgrA" }),
    ];
    const { db } = makeClientDb(all);
    const walk = await walkAll((cursor) =>
      listClientsDirectoryPage(db, {
        canSeeAllClients: false,
        actorId: "mgrA",
        cursor,
        pageSize: 1,
      }),
    );
    expect(walk.ids).toEqual(["m1", "m3"]);
  });

  it("nextCursor ⟺ есть ещё строки; последняя страница ссылки не даёт", async () => {
    const all = [client("k1", "Аня"), client("k2", "Боря"), client("k3", "Вера")];
    const { db } = makeClientDb(all);

    const p1 = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
      pageSize: 2,
    });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
      pageSize: 2,
      cursor: p1.nextCursor,
    });
    expect(p2.items.map((i) => i.id)).toEqual(["k3"]);
    expect(p2.nextCursor).toBeNull(); // ровно столько строк — ссылки нет

    // Ровно кратный размер страницы: третья страница пуста и ссылки не даёт.
    const exact = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
      pageSize: 3,
    });
    expect(exact.items).toHaveLength(3);
    expect(exact.nextCursor).toBeNull();
  });

  it("пустой список и мусорный курсор: ссылки нет, страница пуста, база не опрашивается зря", async () => {
    const { db, calls } = makeClientDb([]);
    const empty = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
      pageSize: 10,
    });
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBeNull();

    const bad = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
      pageSize: 10,
      cursor: "clonlyidnoname",
    });
    expect(bad.items).toEqual([]);
    expect(bad.nextCursor).toBeNull();
    expect(calls).toHaveLength(1); // мусорный курсор не пошёл в базу
  });

  it("размер страницы ограничен и по умолчанию 50", async () => {
    expect(CLIENTS_DIRECTORY_PAGE_SIZE).toBe(50);
    const all = Array.from({ length: 130 }, (_, i) =>
      client(`c${String(i).padStart(3, "0")}`, `Клиент ${String(i).padStart(3, "0")}`),
    );
    const { db } = makeClientDb(all);
    const dflt = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
    });
    expect(dflt.items).toHaveLength(CLIENTS_DIRECTORY_PAGE_SIZE);
    // запрос свыше потолка не отдаёт весь справочник одной страницей
    const huge = await listClientsDirectoryPage(db, {
      canSeeAllClients: true,
      actorId: null,
      pageSize: 10_000,
    });
    expect(huge.items.length).toBeLessThanOrEqual(100);
    expect(huge.nextCursor).not.toBeNull();
  });
});

// ═════════════════════════════ /otgruzki ═════════════════════════════
// Порядок: isUrgent DESC, createdAt DESC, id DESC (ТЗ №15 §8.5 — срочные
// сверху). Курсор обязан нести ВСЕ три поля, иначе переход через границу
// «срочные → обычные» либо теряет строки, либо показывает их дважды.

type FakeShipment = Row & {
  id: string;
  kind: string;
  createdAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  managerId: string;
  isUrgent: boolean;
  note: string | null;
  manager: { name: string };
  client: { name: string } | null;
  site: { name: string } | null;
  saleRecord: Row | null;
  sample: Row | null;
  lines: Array<Row>;
};

function shipment(
  id: string,
  createdAt: Date,
  over: Partial<FakeShipment> = {},
): FakeShipment {
  return {
    id,
    kind: "SALE",
    createdAt,
    completedAt: null,
    cancelledAt: null,
    managerId: "mgr1",
    isUrgent: false,
    note: null,
    manager: { name: "Менеджер" },
    client: { name: "Клиент " + id },
    site: null,
    saleRecord: null,
    sample: null,
    lines: [
      {
        id: "l-" + id,
        targetType: "SLAB",
        qtyOrderedSlabs: null,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 0,
        qtyShippedAreaM2: 0,
        locationSnapshot: null,
        slab: null,
        piece: null,
      },
    ],
    ...over,
  };
}

/** Архивная строка: завершена (иначе вкладка «Архив» её не покажет). */
function archived(
  id: string,
  createdAt: Date,
  over: Partial<FakeShipment> = {},
): FakeShipment {
  return shipment(id, createdAt, { completedAt: createdAt, ...over });
}

function makeShipmentDb(all: FakeShipment[]) {
  const model = fakeModel(all, (a, b) => {
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1; // DESC: true сверху
    if (a.createdAt.getTime() !== b.createdAt.getTime()) {
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; // id DESC
  });
  return {
    db: { shipment: model } as unknown as Parameters<typeof listShipmentsPage>[0],
    ...model,
  };
}

const TIE = new Date("2026-08-07T12:00:00.000Z");
const EARLIER = new Date("2026-08-06T12:00:00.000Z");
const LATER = new Date("2026-08-08T12:00:00.000Z");

describe("/otgruzki — курсор isUrgent+createdAt+id", () => {
  it("round-trip encode/parse, мусор → null", () => {
    const c = { isUrgent: true, createdAt: TIE, id: "sh1" };
    expect(encodeShipmentsCursor(c)).toBe("1_2026-08-07T12:00:00.000Z_sh1");
    expect(parseShipmentsCursor(encodeShipmentsCursor(c))).toEqual(c);
    expect(
      parseShipmentsCursor(
        encodeShipmentsCursor({ isUrgent: false, createdAt: TIE, id: "sh2" }),
      ),
    ).toEqual({ isUrgent: false, createdAt: TIE, id: "sh2" });

    expect(parseShipmentsCursor("")).toBeNull();
    expect(parseShipmentsCursor(null)).toBeNull();
    // легаси «только id»
    expect(parseShipmentsCursor("clxxxxxxxxxxxxxxxxxx")).toBeNull();
    // формат курсора долгов — чужой, не должен приниматься за свой
    expect(parseShipmentsCursor("2026-08-07T12:00:00.000Z_sh1")).toBeNull();
    expect(parseShipmentsCursor("1_not-a-date_sh1")).toBeNull();
    expect(parseShipmentsCursor("1_2026-08-07T12:00:00.000Z_")).toBeNull();
    expect(parseShipmentsCursor("2_2026-08-07T12:00:00.000Z_sh1")).toBeNull();
  });

  it("keyset после срочной строки включает ВСЕ несрочные (boolean DESC)", () => {
    const w = shipmentsKeysetWhere({ isUrgent: true, createdAt: TIE, id: "s5" });
    expect(w).toEqual({
      OR: [
        {
          isUrgent: true,
          OR: [
            { createdAt: { lt: TIE } },
            { createdAt: TIE, id: { lt: "s5" } },
          ],
        },
        { isUrgent: false },
      ],
    });
    // После несрочной строки «ниже» уже ничего нет — ветки isUrgent быть не должно.
    expect(
      shipmentsKeysetWhere({ isUrgent: false, createdAt: TIE, id: "s5" }),
    ).toEqual({
      isUrgent: false,
      OR: [{ createdAt: { lt: TIE } }, { createdAt: TIE, id: { lt: "s5" } }],
    });
  });

  it("архив: обход страниц — полный набор, без дублей и пропусков на общем createdAt", async () => {
    const tied = ["a04", "a03", "a02", "a01", "a00"].map((id) =>
      archived(id, TIE),
    );
    const later = [archived("e02", LATER), archived("e01", LATER)];
    const earlier = [archived("b02", EARLIER), archived("b01", EARLIER)];
    // Открытые задачи не должны просочиться в архив.
    const open = [shipment("o1", LATER), shipment("o2", TIE)];
    const all = [...tied, ...later, ...earlier, ...open];
    const { db, sorted, calls } = makeShipmentDb(all);

    const walk = await walkAll((cursor) =>
      listShipmentsPage(db, {
        canSeeAll: true,
        actorId: null,
        tab: "archive",
        cursor,
        pageSize: 3,
      }),
    );

    expect(calls[0]!.orderBy).toEqual([
      { isUrgent: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    const expected = sorted
      .filter((r) => r.completedAt !== null || r.cancelledAt !== null)
      .map((r) => r.id);
    expect(walk.ids).toEqual(expected);
    expect(new Set(walk.ids).size).toBe(walk.ids.length);
    expect(walk.ids).toHaveLength(9);
    expect(walk.ids).not.toContain("o1");
    expect(walk.pages).toBeGreaterThan(1);

    // Кластер одинакового createdAt действительно разрезан границей страницы.
    const tieIdx = walk.ids
      .map((id, i) => (id.startsWith("a") ? i : -1))
      .filter((i) => i >= 0);
    expect(tieIdx).toHaveLength(5);
    expect(Math.floor(tieIdx[0]! / 3)).not.toBe(
      Math.floor(tieIdx[tieIdx.length - 1]! / 3),
    );
  });

  it("очередь: переход через границу «срочные → обычные» ничего не теряет", async () => {
    // 3 срочных и 3 обычных с ОДНИМ createdAt; страница 2 → граница ровно
    // на стыке. Курсор без isUrgent тут либо повторил бы срочные, либо
    // перескочил бы часть обычных.
    const urgent = ["u3", "u2", "u1"].map((id) =>
      shipment(id, TIE, { isUrgent: true }),
    );
    const normal = ["n3", "n2", "n1"].map((id) => shipment(id, TIE));
    const { db, sorted } = makeShipmentDb([...urgent, ...normal]);

    const walk = await walkAll((cursor) =>
      listShipmentsPage(db, {
        canSeeAll: true,
        actorId: null,
        tab: "open",
        cursor,
        pageSize: 2,
      }),
    );

    expect(walk.ids).toEqual(sorted.map((r) => r.id));
    expect(walk.ids.slice(0, 3).every((id) => id.startsWith("u"))).toBe(true);
    expect(new Set(walk.ids).size).toBe(6);
  });

  it("фильтры (клиент, тип, период, менеджер) продолжают действовать вместе с курсором", async () => {
    const all = [
      archived("f1", TIE, {
        client: { name: "Ахмад Каримов" },
        managerId: "mgrA",
      }),
      archived("f2", TIE, {
        client: { name: "Ахмад Юсупов" },
        managerId: "mgrA",
      }),
      archived("f3", EARLIER, {
        client: { name: "Ахмад Старый" },
        managerId: "mgrA",
      }),
      archived("f4", TIE, {
        client: { name: "Бобур" },
        managerId: "mgrA",
      }), // не тот клиент
      archived("f5", TIE, {
        client: { name: "Ахмад Чужой" },
        managerId: "mgrB",
      }), // не тот менеджер
      archived("f6", TIE, {
        kind: "SAMPLE",
        client: { name: "Ахмад Образец" },
        managerId: "mgrA",
      }), // не тот тип
    ];
    const { db } = makeShipmentDb(all);

    const walk = await walkAll((cursor) =>
      listShipmentsPage(db, {
        canSeeAll: true,
        actorId: null,
        tab: "archive",
        filters: {
          client: "ахмад",
          kind: "SALE",
          from: EARLIER,
          to: LATER,
          managerId: "mgrA",
        },
        cursor,
        pageSize: 1,
      }),
    );

    // f2 перед f1: одинаковый createdAt → тай-брейк id DESC.
    expect(walk.ids).toEqual(["f2", "f1", "f3"]);
    expect(walk.pages).toBeGreaterThan(2);
  });

  it("менеджер не видит чужие отгрузки ни на первой странице, ни на следующих", async () => {
    const all = [
      archived("s1", LATER, { managerId: "mgrA" }),
      archived("s2", TIE, { managerId: "mgrB" }),
      archived("s3", EARLIER, { managerId: "mgrA" }),
    ];
    const { db } = makeShipmentDb(all);
    const walk = await walkAll((cursor) =>
      listShipmentsPage(db, {
        canSeeAll: false,
        actorId: "mgrA",
        tab: "archive",
        cursor,
        pageSize: 1,
      }),
    );
    expect(walk.ids).toEqual(["s1", "s3"]);
  });

  it("nextCursor ⟺ есть ещё строки; мусорный курсор → пустая страница без запроса", async () => {
    const all = [
      archived("p1", LATER),
      archived("p2", TIE),
      archived("p3", EARLIER),
    ];
    const { db, calls } = makeShipmentDb(all);

    const exact = await listShipmentsPage(db, {
      canSeeAll: true,
      actorId: null,
      tab: "archive",
      pageSize: 3,
    });
    expect(exact.items).toHaveLength(3);
    expect(exact.nextCursor).toBeNull();

    const callsBefore = calls.length;
    const bad = await listShipmentsPage(db, {
      canSeeAll: true,
      actorId: null,
      tab: "archive",
      pageSize: 3,
      cursor: "garbage-id-only",
    });
    expect(bad.items).toEqual([]);
    expect(bad.nextCursor).toBeNull();
    expect(calls).toHaveLength(callsBefore);
  });

  it("размер страницы: по умолчанию 50, потолок 100", async () => {
    expect(SHIPMENTS_PAGE_SIZE).toBe(50);
    const all = Array.from({ length: 160 }, (_, i) =>
      archived(
        `x${String(i).padStart(3, "0")}`,
        new Date(TIE.getTime() - i * 60_000),
      ),
    );
    const { db } = makeShipmentDb(all);
    const dflt = await listShipmentsPage(db, {
      canSeeAll: true,
      actorId: null,
      tab: "archive",
    });
    expect(dflt.items).toHaveLength(SHIPMENTS_PAGE_SIZE);
    expect(dflt.nextCursor).not.toBeNull();

    const huge = await listShipmentsPage(db, {
      canSeeAll: true,
      actorId: null,
      tab: "archive",
      pageSize: 10_000,
    });
    expect(huge.items.length).toBeLessThanOrEqual(100);
  });
});

// ═════════════════════════════ /zayavki ═════════════════════════════
// Порядок: status ASC (NEW → CONTACTED → CLOSED), внутри статуса createdAt
// DESC, id DESC. Enum в Prisma не сравнивается через gt — «статусы ниже»
// перечисляются явным `in`.

const LEAD_ORDER: LeadStatus[] = ["NEW", "CONTACTED", "CLOSED"];

type FakeLead = Row & {
  id: string;
  status: LeadStatus;
  kind: "REQUEST" | "VIEW";
  createdAt: Date;
  updatedAt: Date;
};

function lead(
  id: string,
  status: LeadStatus,
  createdAt: Date,
  over: Partial<FakeLead> = {},
): FakeLead {
  return {
    id,
    status,
    kind: "REQUEST",
    requestedSlabs: null,
    requestedAreaM2: null,
    contact: null,
    note: null,
    createdAt,
    updatedAt: createdAt,
    createdBy: { name: "Партнёр" },
    stoneType: { id: "st1", name: "Оникс" },
    assignedManager: null,
    ...over,
  };
}

function makeLeadDb(all: FakeLead[]) {
  const model = fakeModel(all, (a, b) => {
    const sa = LEAD_ORDER.indexOf(a.status);
    const sb = LEAD_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb; // status ASC
    if (a.createdAt.getTime() !== b.createdAt.getTime()) {
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; // id DESC
  });
  return {
    db: { lead: model } as unknown as Parameters<typeof listLeadsPage>[0],
    ...model,
  };
}

describe("/zayavki — курсор status+createdAt+id", () => {
  it("round-trip encode/parse, мусор → null", () => {
    const c = { status: "CONTACTED" as LeadStatus, createdAt: TIE, id: "ld1" };
    expect(encodeLeadsCursor(c)).toBe("CONTACTED_2026-08-07T12:00:00.000Z_ld1");
    expect(parseLeadsCursor(encodeLeadsCursor(c))).toEqual(c);

    expect(parseLeadsCursor("")).toBeNull();
    expect(parseLeadsCursor(null)).toBeNull();
    expect(parseLeadsCursor("clxxxxxxxxxxxxxxxx")).toBeNull(); // легаси id-only
    expect(parseLeadsCursor("BOGUS_2026-08-07T12:00:00.000Z_ld1")).toBeNull();
    expect(parseLeadsCursor("NEW_not-a-date_ld1")).toBeNull();
    expect(parseLeadsCursor("NEW_2026-08-07T12:00:00.000Z_")).toBeNull();
  });

  it("keyset: «статусы ниже» перечислены явно, последний статус их не имеет", () => {
    expect(leadStatusesAfter("NEW")).toEqual(["CONTACTED", "CLOSED"]);
    expect(leadStatusesAfter("CONTACTED")).toEqual(["CLOSED"]);
    expect(leadStatusesAfter("CLOSED")).toEqual([]);

    expect(
      leadsKeysetWhere({ status: "CLOSED", createdAt: TIE, id: "l9" }),
    ).toEqual({
      AND: [
        { status: "CLOSED" },
        {
          OR: [
            { createdAt: { lt: TIE } },
            { createdAt: TIE, id: { lt: "l9" } },
          ],
        },
      ],
    });
    expect(leadsKeysetWhere({ status: "NEW", createdAt: TIE, id: "l9" })).toEqual(
      {
        OR: [
          {
            AND: [
              { status: "NEW" },
              {
                OR: [
                  { createdAt: { lt: TIE } },
                  { createdAt: TIE, id: { lt: "l9" } },
                ],
              },
            ],
          },
          { status: { in: ["CONTACTED", "CLOSED"] } },
        ],
      },
    );
  });

  it("обход страниц: полный набор, без дублей и пропусков на общем createdAt", async () => {
    const tiedNew = ["n04", "n03", "n02", "n01", "n00"].map((id) =>
      lead(id, "NEW", TIE),
    );
    const newer = [lead("n06", "NEW", LATER)];
    const contacted = [lead("c02", "CONTACTED", TIE), lead("c01", "CONTACTED", TIE)];
    const closed = [lead("z01", "CLOSED", LATER)];
    const all = [...tiedNew, ...newer, ...contacted, ...closed];
    const { db, sorted, calls } = makeLeadDb(all);

    const walk = await walkAll((cursor) =>
      listLeadsPage(db, { cursor, pageSize: 3 }),
    );

    expect(calls[0]!.orderBy).toEqual([
      { status: "asc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(walk.ids).toEqual(sorted.map((r) => r.id));
    expect(new Set(walk.ids).size).toBe(walk.ids.length);
    expect(walk.ids).toHaveLength(all.length);
    expect(walk.pages).toBeGreaterThan(2);

    // Новые заявки идут первыми — порядок не сломан пагинацией.
    expect(walk.ids[0]).toBe("n06");
    expect(walk.ids[walk.ids.length - 1]).toBe("z01");

    // Граница страницы легла внутрь кластера одинакового createdAt.
    const tieIdx = walk.ids
      .map((id, i) => (id.startsWith("n0") && id !== "n06" ? i : -1))
      .filter((i) => i >= 0);
    expect(tieIdx).toHaveLength(5);
    expect(Math.floor(tieIdx[0]! / 3)).not.toBe(
      Math.floor(tieIdx[tieIdx.length - 1]! / 3),
    );
  });

  it("граница между статусами не теряет и не дублирует заявки", async () => {
    // 2 NEW и 2 CONTACTED, страница 2 → граница ровно на смене статуса.
    const all = [
      lead("a2", "NEW", LATER),
      lead("a1", "NEW", TIE),
      lead("b2", "CONTACTED", LATER),
      lead("b1", "CONTACTED", TIE),
    ];
    const { db } = makeLeadDb(all);
    const walk = await walkAll((cursor) =>
      listLeadsPage(db, { cursor, pageSize: 2 }),
    );
    expect(walk.ids).toEqual(["a2", "a1", "b2", "b1"]);
    // Ровно две страницы: вторая забирает хвост и ссылки уже не даёт.
    expect(walk.pages).toBe(2);
    expect(walk.pageSizes).toEqual([2, 2]);
  });

  it("фильтр по статусу продолжает действовать вместе с курсором", async () => {
    const all = [
      lead("k1", "NEW", LATER),
      lead("k2", "NEW", TIE),
      lead("k3", "NEW", EARLIER),
      lead("x1", "CONTACTED", LATER),
      lead("x2", "CLOSED", LATER),
    ];
    const { db } = makeLeadDb(all);
    const walk = await walkAll((cursor) =>
      listLeadsPage(db, { status: "NEW", cursor, pageSize: 2 }),
    );
    expect(walk.ids).toEqual(["k1", "k2", "k3"]);
    expect(walk.ids).not.toContain("x1");
    expect(walk.pages).toBeGreaterThan(1);
  });

  it("nextCursor ⟺ есть ещё строки; мусорный курсор → пустая страница без запроса", async () => {
    const all = [
      lead("q1", "NEW", LATER),
      lead("q2", "NEW", TIE),
      lead("q3", "NEW", EARLIER),
    ];
    const { db, calls } = makeLeadDb(all);

    const exact = await listLeadsPage(db, { pageSize: 3 });
    expect(exact.items).toHaveLength(3);
    expect(exact.nextCursor).toBeNull();

    const before = calls.length;
    const bad = await listLeadsPage(db, { pageSize: 3, cursor: "onlyid" });
    expect(bad.items).toEqual([]);
    expect(bad.nextCursor).toBeNull();
    expect(calls).toHaveLength(before);

    const empty = await listLeadsPage(makeLeadDb([]).db, { pageSize: 10 });
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBeNull();
  });

  it("размер страницы: по умолчанию 50, потолок 200", async () => {
    expect(LEADS_PAGE_SIZE).toBe(50);
    const all = Array.from({ length: 260 }, (_, i) =>
      lead(
        `l${String(i).padStart(3, "0")}`,
        "NEW",
        new Date(TIE.getTime() - i * 60_000),
      ),
    );
    const { db } = makeLeadDb(all);
    const dflt = await listLeadsPage(db);
    expect(dflt.items).toHaveLength(LEADS_PAGE_SIZE);
    expect(dflt.nextCursor).not.toBeNull();

    const huge = await listLeadsPage(db, { pageSize: 10_000 });
    expect(huge.items.length).toBeLessThanOrEqual(200);
  });
});
