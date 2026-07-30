// W3-B — /poisk page.tsx UI invarianti: «Ничего не найдено.» va «Показать ещё»
// BIRGA chiqishi mumkin emas. W2-A buni scratchpad harness da isbotlagan edi —
// isbot yo'qolgan; shu fayl avtomatlashtirilgan qo'riqchi.
//
// BAZASIZ: poisk-query.test.ts uslubidagi in-memory fake Prisma. Production
// page.tsx ni import qilmaymiz (Next server component + real db); uning
// predikatlarini page.tsx:173-190 va :443-584 dagi AYNAN shu ifodalardan
// ko'chiramiz va fetchPoiskTypesPage natijasiga qo'llaymiz.
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  fetchPoiskTypesPage,
  type PoiskStoneTypeRow,
  type PoiskTypesPage,
} from "@/lib/poisk-query";

// ───────────────────────────── page.tsx predikatlari ─────────────────────────────

/**
 * page.tsx:179-186 + :450-466 + :563 + :571 dagi shartlar — bayt-semantika.
 * «Ничего не найдено.» faqat `visibleTypes.length === 0 && !nextCursor`.
 * «Показать ещё» faqat `nextCursor` truthy (`{nextCursor && (…)}`).
 */
function pageUiFromModule(page: PoiskTypesPage) {
  const visibleTypes = page.types;
  const nextCursor = page.nextCursor;
  // page.tsx:186
  const typesIncomplete = page.truncated && nextCursor !== null;

  // page.tsx:450-466
  const showNothingFound =
    visibleTypes.length === 0 && nextCursor === null;
  const showContinueSearchAlert =
    visibleTypes.length === 0 && nextCursor !== null;

  // page.tsx:571 — «Показать ещё →»
  const showMoreLink = nextCursor !== null;

  // page.tsx:563 — faqat ro'yxat bo'sh bo'lmaganda
  const showTruncatedWarning =
    typesIncomplete && visibleTypes.length > 0;

  return {
    visibleCount: visibleTypes.length,
    nextCursor,
    typesIncomplete,
    showNothingFound,
    showContinueSearchAlert,
    showMoreLink,
    showTruncatedWarning,
  };
}

// ───────────────────────────── fake DB (poisk-query.test uslubi) ─────────────────────────────

interface FakeBatch {
  id: string;
  slabsTotal: number | null;
  areaTotalM2: string | null;
  slabsAdjusted: number;
  areaAdjustedM2: string;
  slabsSoldDirect: number;
  areaSoldDirectM2: string;
  patterns: number;
  separatedSlabs: number;
  directPieces: number;
}

interface FakeType {
  id: string;
  name: string;
  rockType: string;
  color: string | null;
  batches: FakeBatch[];
  countedSlabs: number;
  countedPieces: number;
}

type WhereShape = {
  isArchived?: boolean;
  name?: { gt?: string };
  OR?: Array<Record<string, { contains: string; mode: string }>>;
};

function matches(t: FakeType, where: WhereShape): boolean {
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
        const rows = sorted.filter((t) => matches(t, where)).slice(0, take);
        return rows.map(project);
      },
      findFirst: async ({ where }: { where: WhereShape }) => {
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

  return db as unknown as PrismaClient;
}

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

function depletedBatch(id: string): FakeBatch {
  return { ...stockedBatch(id), separatedSlabs: 4 };
}

function typeName(i: number): string {
  return "T" + String(i).padStart(3, "0");
}

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

/** Har qanday modul natijasida page UI juftligi yolg'on bo'lmasligi shart. */
function assertNoNothingFoundPlusMore(page: PoiskTypesPage) {
  const ui = pageUiFromModule(page);
  // Sintaktik istisno: showNothingFound ⇒ nextCursor===null ⇒ !showMoreLink
  expect(ui.showNothingFound && ui.showMoreLink).toBe(false);
  // Modul invarianti page.tsx:169-170: nextCursor ⟺ hasMore
  expect(page.nextCursor !== null).toBe(page.hasMore);
  return ui;
}

// ─────────────────────────── testlar ───────────────────────────

describe("page.tsx UI — «Ничего не найдено.» ∩ «Показать ещё» = ∅", () => {
  it("bo'sh katalog: Ничего не найдено., Показать ещё yo'q", async () => {
    const db = makeFakeDb(makeCatalog(40, () => false));
    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
    });
    const ui = assertNoNothingFoundPlusMore(page);
    expect(page.types).toHaveLength(0);
    expect(ui.showNothingFound).toBe(true);
    expect(ui.showContinueSearchAlert).toBe(false);
    expect(ui.showMoreLink).toBe(false);
  });

  it("types:[] + hasMore:true (truncated skan) — Ничего не найдено. YO'Q, Показать ещё BOR", async () => {
    // W2-A harness: modul bo'sh types + kursor qaytarishi mumkin (skan
    // chegarasi, hammasi tugagan vid). page.tsx:450-451 da bo'sh + nextCursor
    // → «Поиск продолжается», EMAS «Ничего не найдено.»; :571 da link bor.
    const db = makeFakeDb(makeCatalog(300, () => false));
    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
      maxScanRows: 40,
    });

    expect(page.types).toHaveLength(0);
    expect(page.truncated).toBe(true);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();

    const ui = assertNoNothingFoundPlusMore(page);
    expect(ui.showNothingFound).toBe(false);
    expect(ui.showContinueSearchAlert).toBe(true);
    expect(ui.showMoreLink).toBe(true);
    // Ro'yxat bo'sh → truncated warning takrorlanmaydi (page.tsx:560-563)
    expect(ui.showTruncatedWarning).toBe(false);
  });

  it("to'liq sahifa + yana bor → Ничего не найдено. yo'q, Показать ещё bor", async () => {
    const db = makeFakeDb(makeCatalog(200, (i) => i % 5 === 0));
    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
    });
    const ui = assertNoNothingFoundPlusMore(page);
    expect(page.types.length).toBe(10);
    expect(ui.showNothingFound).toBe(false);
    expect(ui.showMoreLink).toBe(true);
  });

  it("oxirgi (to'liq) natija: truncated && nextCursor===null — to'liq, ogohlantirish YO'Q", async () => {
    // page.tsx:183-186: `truncated && nextCursor === null` → typesIncomplete false
    // (skan jadval oxiriga aynan chegarada yetgan). Bo'sh types → «Ничего не
    // найдено.»; «Показать ещё» yo'q.
    const db = makeFakeDb(makeCatalog(40, () => false));
    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
      maxScanRows: 40,
    });

    expect(page.truncated).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
    expect(page.types).toHaveLength(0);

    const ui = assertNoNothingFoundPlusMore(page);
    // typesIncomplete = truncated && nextCursor !== null → false
    expect(ui.typesIncomplete).toBe(false);
    expect(ui.showTruncatedWarning).toBe(false);
    expect(ui.showNothingFound).toBe(true);
    expect(ui.showMoreLink).toBe(false);
  });

  it("ko'p sahifa aylanishida juftlik hech qachon chiqmaydi", async () => {
    const db = makeFakeDb(makeCatalog(300, (i) => i >= 295));
    let after = "";
    for (let guard = 0; guard < 30; guard++) {
      const page = await fetchPoiskTypesPage(db, {
        q: "",
        hasDims: false,
        after,
        pageSize: 10,
        maxScanRows: 40,
      });
      assertNoNothingFoundPlusMore(page);
      if (!page.hasMore) break;
      after = page.nextCursor as string;
    }
  });
});

describe("page.tsx:186 typesIncomplete predikati", () => {
  it("truncated + nextCursor → typesIncomplete true (ro'yxatda ogohlantirish mumkin)", async () => {
    // Naliche faqat oxirida; birinchi skan truncated, lekin ba'zi qatorlar
    // to'planishi yoki bo'sh bo'lishi mumkin — flags to'g'ri.
    const db = makeFakeDb(makeCatalog(300, (i) => i >= 295));
    const page = await fetchPoiskTypesPage(db, {
      q: "",
      hasDims: false,
      after: "",
      pageSize: 10,
      maxScanRows: 40,
    });
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    const ui = pageUiFromModule(page);
    expect(ui.typesIncomplete).toBe(true);
    // Warning faqat visibleTypes.length > 0 da (page.tsx:563)
    expect(ui.showTruncatedWarning).toBe(page.types.length > 0);
  });
});
