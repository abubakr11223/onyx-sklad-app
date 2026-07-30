// W1-B — /poisk vidlar sahifasining testlari. BAZASIZ: minimal in-memory fake
// Prisma (seed-demo.test.ts uslubi) — repo'da hech bir test real Postgres'ga
// tegmaydi va bu shunday qolishi kerak.
//
// Tuzatilayotgan nuqson: HEAD'da SQL `take: PAGE_SIZE + 1` «наличие» JS filtridan
// OLDIN ishlaydi (page.tsx:95-129 + :256-258) → sahifa 30 ta o'rniga bir nechta
// yoki 0 ta qator ko'rsatishi, «Показать ещё» esa turishi mumkin. Bu yerdagi
// testlar sahifa ZICHLIGINI va kursorning yo'qotishsizligini bir vaqtda qamrab
// oladi (biri ikkinchisini buzmasligi shart).
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  POISK_MAX_SCAN_ROWS,
  buildTypeRows,
  fetchPoiskTypesPage,
  poiskTypesWhere,
  type PoiskStoneTypeRow,
} from "@/lib/poisk-query";
import { materialWhere } from "@/lib/poisk-search";
import { EMPTY_AGGREGATE, EMPTY_HOLD } from "@/lib/batch-remainders";

// ───────────────────────────── fake DB ─────────────────────────────

interface FakeBatch {
  id: string;
  slabsTotal: number | null;
  areaTotalM2: string | null;
  slabsAdjusted: number;
  areaAdjustedM2: string;
  slabsSoldDirect: number;
  areaSoldDirectM2: string;
  patterns: number;
  /** getBatchRemainders: partiyaning AJRATILGAN plitalari soni. */
  separatedSlabs: number;
  /** getBatchRemainders: partiyadan to'g'ridan-to'g'ri chiqqan boy soni. */
  directPieces: number;
}

interface FakeType {
  id: string;
  name: string;
  rockType: string;
  color: string | null;
  batches: FakeBatch[];
  /** AVAILABLE + needsCheck:false alohida plitalar (page.tsx:142-150). */
  countedSlabs: number;
  /** AVAILABLE + needsCheck:false boy va qoldiqlar (page.tsx:153-161). */
  countedPieces: number;
}

type WhereShape = {
  isArchived?: boolean;
  name?: { gt?: string };
  OR?: Array<Record<string, { contains: string; mode: string }>>;
};

function matches(t: FakeType, where: WhereShape): boolean {
  // Har bir so'rov arxivlanmagan vidlar bo'yicha bo'lishi SHART (page.tsx:97).
  if (where.isArchived !== false) {
    throw new Error("where.isArchived !== false — /poisk filtri buzilgan");
  }
  if (where.name?.gt !== undefined && !(t.name > where.name.gt)) return false;
  if (where.OR) {
    const needle = (where.OR[0].name?.contains ?? "").toLowerCase();
    const hay = [t.name, t.rockType, t.color ?? ""].map((s) => s.toLowerCase());
    if (!hay.some((h) => h.includes(needle))) return false;
  }
  return true;
}

function makeFakeDb(types: FakeType[]) {
  const sorted = [...types].sort((a, b) => (a.name < b.name ? -1 : 1));
  const byBatchId = new Map<string, FakeBatch>();
  for (const t of sorted) for (const b of t.batches) byBatchId.set(b.id, b);

  const stats = { findManyCalls: 0, rowsServed: 0, findFirstCalls: 0 };

  const project = (t: FakeType): PoiskStoneTypeRow => ({
    id: t.id,
    name: t.name,
    rockType: t.rockType,
    color: t.color,
    batches: t.batches.map((b) => ({
      id: b.id,
      slabsTotal: b.slabsTotal,
      areaTotalM2: b.areaTotalM2,
      slabsAdjusted: b.slabsAdjusted,
      areaAdjustedM2: b.areaAdjustedM2,
      slabsSoldDirect: b.slabsSoldDirect,
      areaSoldDirectM2: b.areaSoldDirectM2,
      _count: { patterns: b.patterns },
    })),
  });

  const db = {
    stoneType: {
      findMany: async ({
        where,
        take,
      }: {
        where: WhereShape;
        take: number;
      }) => {
        stats.findManyCalls++;
        const rows = sorted.filter((t) => matches(t, where)).slice(0, take);
        stats.rowsServed += rows.length;
        return rows.map(project);
      },
      findFirst: async ({ where }: { where: WhereShape }) => {
        stats.findFirstCalls++;
        const row = sorted.find((t) => matches(t, where));
        return row ? { id: row.id } : null;
      },
    },
    slab: {
      groupBy: async (args: {
        by: string[];
        where: {
          batchId?: { in: string[] };
          stoneTypeId?: { in: string[] };
        };
      }) => {
        if (args.by[0] === "batchId") {
          return (args.where.batchId?.in ?? []).map((id) => {
            const b = byBatchId.get(id);
            const n = b?.separatedSlabs ?? 0;
            return {
              batchId: id,
              _count: { _all: n, areaM2: n },
              _sum: { areaM2: 0 },
            };
          });
        }
        const ids = new Set(args.where.stoneTypeId?.in ?? []);
        return sorted
          .filter((t) => ids.has(t.id) && t.countedSlabs > 0)
          .map((t) => ({ stoneTypeId: t.id, _count: { _all: t.countedSlabs } }));
      },
    },
    piece: {
      groupBy: async (args: {
        by: string[];
        where: {
          batchId?: { in: string[] };
          stoneTypeId?: { in: string[] };
        };
      }) => {
        if (args.by[0] === "batchId") {
          return (args.where.batchId?.in ?? []).map((id) => {
            const b = byBatchId.get(id);
            const n = b?.directPieces ?? 0;
            return {
              batchId: id,
              _count: { _all: n, areaM2: n },
              _sum: { areaM2: 0 },
            };
          });
        }
        const ids = new Set(args.where.stoneTypeId?.in ?? []);
        return sorted
          .filter((t) => ids.has(t.id) && t.countedPieces > 0)
          .map((t) => ({
            stoneTypeId: t.id,
            _count: { _all: t.countedPieces },
          }));
      },
    },
    reservation: { findMany: async () => [] },
  };

  return { db: db as unknown as PrismaClient, stats };
}

// ─────────────────────── test ma'lumotlari ───────────────────────

/** «Naliche bor» vid: partiyada 4 plita, hech biri ajratilmagan → slabsFree = 4. */
function stockedBatch(id: string): FakeBatch {
  return {
    id,
    slabsTotal: 4,
    areaTotalM2: null,
    slabsAdjusted: 0,
    areaAdjustedM2: "0",
    slabsSoldDirect: 0,
    areaSoldDirectM2: "0",
    patterns: 0,
    separatedSlabs: 0,
    directPieces: 0,
  };
}

/** «Tugagan» vid: 4 plita bor edi, 4 tasi ham ajratilgan → slabsFree = 0. */
function depletedBatch(id: string): FakeBatch {
  return { ...stockedBatch(id), separatedSlabs: 4 };
}

/** Nomlar leksikografik tartibi = raqamli tartib bo'lishi uchun 0-to'ldirilgan. */
function typeName(i: number): string {
  return "T" + String(i).padStart(3, "0");
}

/**
 * `available(i)` bo'yicha naliche bor/yo'q vidlar ro'yxati. Arxivlanmagan, lekin
 * tugagan vid — HEAD'da ham xuddi shunday `hasAvailability === false` beradi
 * (page.tsx:231-235), ya'ni bu «ko'rinmas» qatorlar aynan real holat.
 */
function makeCatalog(n: number, available: (i: number) => boolean): FakeType[] {
  return Array.from({ length: n }, (_, i) => ({
    id: "id-" + i,
    name: typeName(i),
    rockType: "мрамор",
    color: "белый",
    batches: [available(i) ? stockedBatch("b-" + i) : depletedBatch("b-" + i)],
    countedSlabs: 0,
    countedPieces: 0,
  }));
}

// ─────────────────────────── testlar ───────────────────────────

describe("poiskTypesWhere — page.tsx:96-102 bilan bir xil filtr", () => {
  it("bo'sh so'rov + kursorsiz → faqat isArchived:false", () => {
    expect(poiskTypesWhere("", "")).toEqual({ isArchived: false });
  });

  it("so'rov + kursor → material OR va name>after qo'shiladi (drift yo'q)", () => {
    expect(poiskTypesWhere("мрамор", "T010")).toEqual({
      isArchived: false,
      ...materialWhere("мрамор"),
      name: { gt: "T010" },
    });
  });
});

describe("fetchPoiskTypesPage — sahifa zichligi (asosiy nuqson)", () => {
  it("ko'rinmas vidlar orasida ham TO'LIQ sahifa qaytaradi", async () => {
    // Har 5-vidda naliche bor → 200 vidda 40 ta ko'rinadigan.
    const { db } = makeFakeDb(makeCatalog(200, (i) => i % 5 === 0));

    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
    });

    // HEAD algoritmi (take 11 → keyin filtr) shu ma'lumotda 3 ta qator berardi.
    expect(page.types).toHaveLength(10);
    expect(page.types.every((t) => t.hasAvailability)).toBe(true);
    expect(page.types.map((t) => t.st.name)).toEqual([
      "T000", "T005", "T010", "T015", "T020",
      "T025", "T030", "T035", "T040", "T045",
    ]);
    // Kursor — skan TO'XTAGAN xom qator (u ayni paytda oxirgi ko'rinadigan qator:
    // skan sahifa to'lgan joyda to'xtaydi, oradan hech narsa tushib qolmaydi).
    expect(page.nextCursor).toBe("T045");
    expect(page.hasMore).toBe(true);
    expect(page.truncated).toBe(false);
  });

  it("«qisqa sahifa + Показать ещё» juftligi hech qachon uchramaydi", async () => {
    const { db } = makeFakeDb(makeCatalog(200, (i) => i % 5 === 0));
    let after = "";
    for (let guard = 0; guard < 50; guard++) {
      const page = await fetchPoiskTypesPage(db, {
        q: "",
        hasDims: false,
        after,
        pageSize: 7,
      });
      if (page.hasMore) {
        // Invariant: hasMore → sahifa TO'LIQ (truncated bo'lmasa).
        expect(page.truncated).toBe(false);
        expect(page.types).toHaveLength(7);
        expect(page.nextCursor).not.toBeNull();
        after = page.nextCursor as string;
      } else {
        expect(page.nextCursor).toBeNull();
        break;
      }
    }
  });

  it("bo'sh natijada «Показать ещё» ham bo'lmaydi (yolg'on juftlik yo'q)", async () => {
    // Hech bir vidda naliche yo'q → ko'rsatiladigan hech narsa yo'q.
    const { db } = makeFakeDb(makeCatalog(40, () => false));

    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
    });

    expect(page.types).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.truncated).toBe(false);
  });
});

describe("fetchPoiskTypesPage — kursor: dublikat ham, tushib qolish ham yo'q", () => {
  it("barcha sahifalar ketma-ket AYNAN barcha naliche vidlarini beradi", async () => {
    const catalog = makeCatalog(200, (i) => i % 5 === 0);
    const { db } = makeFakeDb(catalog);
    const expected = catalog
      .filter((_, i) => i % 5 === 0)
      .map((t) => t.name);

    const seen: string[] = [];
    let after = "";
    for (let guard = 0; guard < 50; guard++) {
      const page = await fetchPoiskTypesPage(db, {
        q: "",
        hasDims: false,
        after,
        pageSize: 7,
      });
      seen.push(...page.types.map((t) => t.st.name));
      if (!page.hasMore) break;
      after = page.nextCursor as string;
    }

    expect(seen).toEqual(expected); // tartib + to'liqlik + dublikatsizlik
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("oxirgi sahifada hasMore=false, nextCursor=null", async () => {
    // Aynan 10 ta naliche vid, pageSize 10 → bitta to'liq sahifa va tamom.
    const { db } = makeFakeDb(makeCatalog(10, () => true));

    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
    });

    expect(page.types).toHaveLength(10);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("nextCursor !== null ⟺ hasMore (o'lik «Показать ещё» havolasi bo'lmaydi)", async () => {
    // page.tsx:526 «Показать ещё»ni AYNAN nextCursor bo'yicha chizadi, shuning
    // uchun bu ikkisi hech qachon ajralib ketmasligi kerak.
    for (const n of [0, 1, 9, 10, 11, 25]) {
      const { db } = makeFakeDb(makeCatalog(n, () => true));
      let after = "";
      for (let guard = 0; guard < 20; guard++) {
        const p = await fetchPoiskTypesPage(db, {
          q: "",
          hasDims: false,
          after,
          pageSize: 10,
        });
        expect(p.nextCursor !== null).toBe(p.hasMore);
        if (!p.hasMore) break;
        after = p.nextCursor as string;
      }
    }
  });

  it("kursordan keyingi sahifa qat'iy keyingi nomlardan boshlanadi", async () => {
    const { db } = makeFakeDb(makeCatalog(200, (i) => i % 5 === 0));

    const p1 = await fetchPoiskTypesPage(db, {
      q: "", hasDims: false, after: "", pageSize: 7,
    });
    const p2 = await fetchPoiskTypesPage(db, {
      q: "", hasDims: false, after: p1.nextCursor as string, pageSize: 7,
    });

    expect(p2.types[0].st.name > (p1.nextCursor as string)).toBe(true);
    const p1Names = new Set(p1.types.map((t) => t.st.name));
    expect(p2.types.some((t) => p1Names.has(t.st.name))).toBe(false);
  });
});

describe("fetchPoiskTypesPage — q / gabarit bo'lganda filtr QO'LLANMAYDI", () => {
  it("q berilganda naliche yo'q vidlar ham chiqadi (HEAD xatti-harakati)", async () => {
    const { db } = makeFakeDb(makeCatalog(200, (i) => i % 5 === 0));

    const page = await fetchPoiskTypesPage(db, {
      q: "мрамор", // barcha fake vidlar rockType = «мрамор»
      hasDims: false,
      after: "",
      pageSize: 10,
    });

    // Filtrsiz → xom tartibdagi dastlabki 10 ta, ichida naliche yo'qlar ham bor.
    expect(page.types.map((t) => t.st.name)).toEqual([
      "T000", "T001", "T002", "T003", "T004",
      "T005", "T006", "T007", "T008", "T009",
    ]);
    expect(page.types.some((t) => !t.hasAvailability)).toBe(true);
    expect(page.nextCursor).toBe("T009");
    expect(page.hasMore).toBe(true);
  });

  it("gabarit berilganda (hasDims) ham filtr qo'llanmaydi", async () => {
    const { db } = makeFakeDb(makeCatalog(200, (i) => i % 5 === 0));

    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: true,
      after: "",
      pageSize: 10,
    });

    expect(page.types.map((t) => t.st.name)).toEqual([
      "T000", "T001", "T002", "T003", "T004",
      "T005", "T006", "T007", "T008", "T009",
    ]);
    expect(page.types.some((t) => !t.hasAvailability)).toBe(true);
  });

  it("filtrsiz yo'l HEAD algoritmi bilan AYNAN bir xil va BITTA so'rov qiladi", async () => {
    // HEAD (page.tsx:104,:127-129): take = PAGE_SIZE+1, hasMore = fetched > PAGE_SIZE,
    // nextCursor = hasMore ? PAGE_SIZE-chi qatorning nomi : null.
    for (const n of [0, 5, 10, 11, 40]) {
      const { db, stats } = makeFakeDb(makeCatalog(n, (i) => i % 3 === 0));
      const before = stats.findManyCalls;

      const page = await fetchPoiskTypesPage(db, {
        q: "мрамор",
        hasDims: false,
        after: "",
        pageSize: 10,
      });

      const headHasMore = n > 10;
      const headTypes = Array.from({ length: Math.min(n, 10) }, (_, i) =>
        typeName(i),
      );
      expect(page.types.map((t) => t.st.name)).toEqual(headTypes);
      expect(page.hasMore).toBe(headHasMore);
      expect(page.nextCursor).toBe(headHasMore ? typeName(9) : null);
      // Filtr yo'q → qo'shimcha aylanish ham, tekshiruv so'rovi ham kerak emas.
      expect(stats.findManyCalls - before).toBe(1);
      expect(stats.findFirstCalls).toBe(0);
    }
  });

  it("q mos kelmasa — bo'sh natija, «Показать ещё» yo'q", async () => {
    const { db } = makeFakeDb(makeCatalog(50, () => true));

    const page = await fetchPoiskTypesPage(db, {
      q: "гранит",
      hasDims: false,
      after: "",
      pageSize: 10,
    });

    expect(page.types).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe("fetchPoiskTypesPage — strategiya (B) chegarasi (bound)", () => {
  it("maxScanRows'dan ortiq xom qator O'QILMAYDI", async () => {
    // Faqat oxirgi 5 vidda naliche bor → chegarasiz skan 300 qatorni o'qirdi.
    const { db, stats } = makeFakeDb(makeCatalog(300, (i) => i >= 295));

    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
      maxScanRows: 40,
    });

    expect(stats.rowsServed).toBeLessThanOrEqual(40);
    expect(page.scannedRows).toBeLessThanOrEqual(40);
    expect(page.scannedRows).toBe(40);
    expect(page.truncated).toBe(true);
    // Chegara ishlagan — sahifa to'lmadi, lekin kursor o'qilgan OXIRGI xom
    // qatorda qoldi, ya'ni keyingi bosishda skan aynan shu joydan davom etadi.
    expect(page.types.length).toBeLessThan(10);
    expect(page.nextCursor).toBe(typeName(39));
    expect(page.hasMore).toBe(true);
  });

  it("chegara bosqichma-bosqich bo'lsa ham hech narsa tushib qolmaydi", async () => {
    // 300 vid, naliche faqat 295..299 da. maxScanRows=40 → bir necha «Показать ещё».
    const { db } = makeFakeDb(makeCatalog(300, (i) => i >= 295));

    const seen: string[] = [];
    let truncatedPages = 0;
    let after = "";
    for (let guard = 0; guard < 30; guard++) {
      const p = await fetchPoiskTypesPage(db, {
        q: "",
        hasDims: false,
        after,
        pageSize: 10,
        maxScanRows: 40,
      });
      if (p.truncated) truncatedPages++;
      seen.push(...p.types.map((t) => t.st.name));
      if (!p.hasMore) break;
      after = p.nextCursor as string;
    }

    // Kursor uzluksiz prefiks bo'ylab siljiydi → hamma naliche vid topiladi.
    expect(seen).toEqual([
      typeName(295), typeName(296), typeName(297),
      typeName(298), typeName(299),
    ]);
    // MA'LUM CHEKLOV: chegaraga urilgan sahifalar bo'sh, lekin hasMore=true —
    // bu YAGONA holat, unda «hech nima yo'q» + «Показать ещё» birga chiqishi
    // mumkin. Yashirish (hasMore=false) inventarni yo'qotgan bo'lardi, shuning
    // uchun `truncated` bayrog'i bilan ochiq belgilanadi (o3 shu bo'yicha
    // boshqa matn ko'rsatadi).
    expect(truncatedPages).toBeGreaterThan(0);
  });

  it("standart chegara hujjatlashtirilgan qiymatda", () => {
    expect(POISK_MAX_SCAN_ROWS).toBe(1000);
  });
});

describe("buildTypeRows — «наличие» semantikasi page.tsx:231-235 bilan bir xil", () => {
  const row = (batches: PoiskStoneTypeRow["batches"]): PoiskStoneTypeRow => ({
    id: "st-1",
    name: "Мрамор",
    rockType: "мрамор",
    color: "белый",
    batches,
  });

  const batch = (over: Partial<PoiskStoneTypeRow["batches"][number]> = {}) => ({
    id: "b-1",
    slabsTotal: 4 as number | null,
    areaTotalM2: null as { toString(): string } | null,
    slabsAdjusted: 0,
    areaAdjustedM2: "0",
    slabsSoldDirect: 0,
    areaSoldDirectM2: "0",
    _count: { patterns: 0 },
    ...over,
  });

  it("qoldig'i bor partiya → hasAvailability true", () => {
    const [t] = buildTypeRows(
      [row([batch()])],
      new Map([["b-1", { ...EMPTY_AGGREGATE }]]),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(t.slabsTotalSum).toBe(4);
    expect(t.hasAvailability).toBe(true);
  });

  it("to'liq tugagan partiya → hasAvailability false", () => {
    const [t] = buildTypeRows(
      [row([batch()])],
      new Map([["b-1", { ...EMPTY_AGGREGATE, slabCount: 4 }]]),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(t.slabsTotalSum).toBe(0);
    expect(t.hasAvailability).toBe(false);
  });

  it("partiyalar free {+2, −3} → Σ = −1, hasAvailability false (nol-clamp YO'Q)", () => {
    // freeRemainderFromAggregate (batch-remainders.ts:90-97) slabsFree ni 0 ga
    // KESMAYDI. buildTypeRows shu unclamped qiymatlarni yig'adi
    // (poisk-query.ts:259 slabsTotalSum += free.slabsFree) va
    // hasAvailability = slabsTotalSum > 0 (poisk-query.ts:284-288).
    //
    // Fixture: batch A free=+2, batch B free=−3 → Σ=−1.
    //   • joriy mantiq: hasAvailability === false
    //   • per-batch EXISTS(free > 0): A uchun true bo'lardi
    // Shu test «наличие»ni SQL EXISTS ga «optimallashtiruvchi» o'zgarishni ushlaydi.
    const [t] = buildTypeRows(
      [
        row([
          batch({ id: "b-plus", slabsTotal: 2 }),
          batch({ id: "b-minus", slabsTotal: 1 }),
        ]),
      ],
      new Map([
        // free = 2 − 0 = +2
        ["b-plus", { ...EMPTY_AGGREGATE }],
        // free = 1 − 4 = −3 (ajratilgan plitalar overshoot)
        ["b-minus", { ...EMPTY_AGGREGATE, slabCount: 4 }],
      ]),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(t.slabsTotalSum).toBe(-1);
    expect(t.hasAvailability).toBe(false);
    // Ekran raqami alohida clamp: Math.max(0, Σ − bron) (poisk-query.ts:271).
    // hasAvailability UNCLAMPED Σ ga bog'liq — shu juftlik sinishi kerak bo'lsa
    // test yiqiladi.
    expect(t.slabsFreeSum).toBe(0);
  });

  it("bron (hold) hasAvailability'ga TA'SIR QILMAYDI — faqat raqamlarga", () => {
    const [t] = buildTypeRows(
      [row([batch()])],
      new Map([["b-1", { ...EMPTY_AGGREGATE }]]),
      new Map([["b-1", { reservedSlabs: 4, reservedAreaM2: 0 }]]),
      new Map(),
      new Map(),
    );
    // Hammasi bronda: свободно = 0, lekin vid ro'yxatdan CHIQIB KETMAYDI —
    // HEAD'dagi xatti-harakat aynan shunday (page.tsx:228-235).
    expect(t.slabsFreeSum).toBe(0);
    expect(t.reservedSlabsSum).toBe(4);
    expect(t.hasAvailability).toBe(true);
  });

  it("partiyasiz vid, lekin alohida plita/boy bor → hasAvailability true", () => {
    const [t] = buildTypeRows(
      [row([])],
      new Map(),
      new Map(),
      new Map([["st-1", 3]]),
      new Map([["st-1", 0]]),
    );
    expect(t.countedSlabs).toBe(3);
    expect(t.hasAvailability).toBe(true);
  });

  it("slabsTotal null → slabsUnknown, hasAvailability boshqa manbalarga qarab", () => {
    const [t] = buildTypeRows(
      [row([batch({ slabsTotal: null })])],
      new Map([["b-1", { ...EMPTY_AGGREGATE }]]),
      new Map([["b-1", { ...EMPTY_HOLD }]]),
      new Map(),
      new Map(),
    );
    expect(t.slabsUnknown).toBe(true);
    expect(t.slabsKnown).toBe(false);
    expect(t.hasAvailability).toBe(false);
  });

  it("узор-подгруппы partiyalar bo'yicha yig'iladi", () => {
    const [t] = buildTypeRows(
      [
        row([
          batch({ id: "b-1", _count: { patterns: 2 } }),
          batch({ id: "b-2", _count: { patterns: 3 } }),
        ]),
      ],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(t.patternsCount).toBe(5);
  });
});
