// W8-B — sotuv tarixi: filtr + keyset (DB YO'Q, fake Prisma).
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  SALE_HISTORY_PAGE_SIZE,
  encodeSaleHistoryCursor,
  fetchSaleHistoryPage,
  filtersFromSearchParams,
  parseSaleHistoryCursor,
  parseTashkentDayEnd,
  parseTashkentDayStart,
  saleHistoryAccess,
  saleHistoryWhere,
  type SaleHistoryFilters,
  type SaleHistoryRow,
} from "@/lib/sale-history";

// ───────────────────────── access / parse ─────────────────────────

describe("saleHistoryAccess — rol (TZ §3 tor o'qish)", () => {
  it("!canSell → yo'q (WAREHOUSE/PARTNER)", () => {
    expect(
      saleHistoryAccess({
        canSell: false,
        canSeeHistory: false,
        actorId: "w1",
      }),
    ).toEqual({ allowed: false });
  });

  it("MANAGER (canSell, !canSeeHistory) → faqat o'z managerId", () => {
    expect(
      saleHistoryAccess({
        canSell: true,
        canSeeHistory: false,
        actorId: "mgr1",
      }),
    ).toEqual({ allowed: true, managerId: "mgr1" });
  });

  it("OWNER (canSeeHistory) → barcha sotuvlar (managerId null)", () => {
    expect(
      saleHistoryAccess({
        canSell: true,
        canSeeHistory: true,
        actorId: "owner1",
      }),
    ).toEqual({ allowed: true, managerId: null });
  });

  it("canSell lekin actor yo'q → yo'q", () => {
    expect(
      saleHistoryAccess({
        canSell: true,
        canSeeHistory: false,
        actorId: null,
      }),
    ).toEqual({ allowed: false });
  });
});

describe("cursor encode/parse", () => {
  it("round-trip", () => {
    const soldAt = new Date("2026-07-15T12:00:00.000Z");
    const enc = encodeSaleHistoryCursor({ soldAt, id: "sale_abc" });
    expect(parseSaleHistoryCursor(enc)).toEqual({ soldAt, id: "sale_abc" });
  });

  it("yaroqsiz → null", () => {
    expect(parseSaleHistoryCursor("")).toBeNull();
    expect(parseSaleHistoryCursor("nope")).toBeNull();
    expect(parseSaleHistoryCursor("not-a-date_id")).toBeNull();
  });
});

describe("parseTashkentDay*", () => {
  it("kun boshi/oxiri UTC+5", () => {
    const a = parseTashkentDayStart("2026-07-20");
    const b = parseTashkentDayEnd("2026-07-20");
    expect(a?.toISOString()).toBe("2026-07-19T19:00:00.000Z");
    expect(b?.toISOString()).toBe("2026-07-20T18:59:59.999Z");
  });

  it("yaroqsiz → null", () => {
    expect(parseTashkentDayStart("20-07-2026")).toBeNull();
    expect(parseTashkentDayEnd("abc")).toBeNull();
  });
});

describe("saleHistoryWhere", () => {
  const base: SaleHistoryFilters = {
    managerId: null,
    from: null,
    to: null,
    customerQ: "",
    returned: "all",
  };

  it("bo'sh filtr → {}", () => {
    expect(saleHistoryWhere(base, null)).toEqual({});
  });

  it("manager + customer + returned + cursor SQL AND", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const cursorSold = new Date("2026-07-10T00:00:00.000Z");
    const w = saleHistoryWhere(
      {
        managerId: "mgr1",
        from,
        to: null,
        customerQ: "Иван",
        returned: "no",
      },
      { soldAt: cursorSold, id: "s9" },
    );
    expect(w).toEqual({
      AND: [
        { managerId: "mgr1" },
        { soldAt: { gte: from } },
        { customerName: { contains: "Иван", mode: "insensitive" } },
        { returnedAt: null },
        {
          OR: [
            { soldAt: { lt: cursorSold } },
            { soldAt: cursorSold, id: { lt: "s9" } },
          ],
        },
      ],
    });
  });
});

// ───────────────────────── fake DB pagination ─────────────────────────

type Row = SaleHistoryRow & { managerId: string };

function makeRows(n: number): Row[] {
  // i=0 eng yangi (soldAt katta).
  return Array.from({ length: n }, (_, i) => {
    const seq = n - i; // n .. 1
    const id = "id" + String(seq).padStart(3, "0");
    // Har xil soldAt: 2026-07-01 + seq hours for strict DESC order
    const soldAt = new Date(
      Date.UTC(2026, 6, 1, 0, 0, 0) + seq * 3600_000,
    );
    return {
      id,
      managerId: seq % 2 === 0 ? "mgrA" : "mgrB",
      customerName: "Клиент " + id,
      customerContact: null,
      targetType: "SLAB",
      qtySlabs: null,
      qtyAreaM2: null,
      price: "100",
      soldAt,
      returnedAt: null,
      manager: { name: "Mgr" },
      slab: {
        id: "sl-" + id,
        label: "Плита",
        status: "SOLD",
        stoneType: { name: "Травертин" },
      },
      piece: null,
      batch: null,
    };
  });
}

/** Keyset + manager filtrini qo'llaydi (production where shakliga mos). */
function applyWhere(all: Row[], where: unknown): Row[] {
  type W = {
    managerId?: string;
    returnedAt?: null | { not: null };
    customerName?: { contains: string; mode: string };
    soldAt?: { gte?: Date; lte?: Date; lt?: Date };
    id?: { lt: string };
    AND?: W[];
    OR?: W[];
  };

  const matches = (row: Row, w: W | undefined): boolean => {
    if (!w) return true;
    if (w.AND) return w.AND.every((c) => matches(row, c));
    if (w.OR) return w.OR.some((c) => matches(row, c));
    if (w.managerId !== undefined && row.managerId !== w.managerId) return false;
    if (w.returnedAt === null && row.returnedAt !== null) return false;
    if (
      w.returnedAt &&
      typeof w.returnedAt === "object" &&
      "not" in w.returnedAt &&
      row.returnedAt === null
    ) {
      return false;
    }
    if (w.customerName?.contains) {
      const q = w.customerName.contains.toLowerCase();
      if (!row.customerName.toLowerCase().includes(q)) return false;
    }
    if (w.soldAt?.gte && row.soldAt < w.soldAt.gte) return false;
    if (w.soldAt?.lte && row.soldAt > w.soldAt.lte) return false;
    if (w.soldAt?.lt && !(row.soldAt < w.soldAt.lt)) return false;
    // equality soldAt + id.lt (keyset second branch)
    if (
      w.soldAt instanceof Date ||
      (w.soldAt &&
        typeof w.soldAt === "object" &&
        !("lt" in w.soldAt) &&
        !("gte" in w.soldAt) &&
        !("lte" in w.soldAt))
    ) {
      // Prisma: { soldAt: Date, id: { lt } } — soldAt as direct Date value
    }
    // When branch is { soldAt: cursorDate, id: { lt } } Prisma passes Date as value
    const soldAtEq =
      w.soldAt instanceof Date
        ? w.soldAt
        : w.soldAt &&
            typeof w.soldAt === "object" &&
            !("lt" in w.soldAt) &&
            !("gte" in w.soldAt) &&
            !("lte" in w.soldAt)
          ? (w.soldAt as unknown as Date)
          : null;
    // Actually Prisma shape for equality is just `soldAt: Date` as field value
    // in the object alongside id — our saleHistoryWhere uses:
    // { soldAt: cursor.soldAt, id: { lt: cursor.id } }
    // so w.soldAt is a Date instance when it's the equality form.
    if (w.id?.lt !== undefined) {
      // Must be paired with soldAt equality
      const eqTime =
        w.soldAt instanceof Date
          ? w.soldAt.getTime()
          : typeof w.soldAt === "object" &&
              w.soldAt !== null &&
              !("lt" in w.soldAt) &&
              !("gte" in w.soldAt) &&
              !("lte" in w.soldAt)
            ? new Date(w.soldAt as unknown as string).getTime()
            : null;
      // If only id.lt without proper soldAt Date — treat soldAt field as Date
      if (w.soldAt instanceof Date) {
        if (
          row.soldAt.getTime() !== w.soldAt.getTime() ||
          !(row.id < w.id.lt)
        ) {
          return false;
        }
      } else if (
        w.soldAt &&
        typeof w.soldAt === "object" &&
        !("lt" in w.soldAt) &&
        !("gte" in w.soldAt) &&
        !("lte" in w.soldAt)
      ) {
        // shouldn't happen
      } else if (!(w.soldAt as { lt?: Date })?.lt && w.id?.lt) {
        // soldAt is Date stored as value - in JS Prisma client it's Date
        // For our WHERE builder: { soldAt: cursor.soldAt, id: { lt } }
        // when this object is a top-level OR branch, soldAt IS a Date.
      }
      void soldAtEq;
    }
    // Handle Prisma equality form: soldAt is Date (not object with gte/lt)
    if (w.soldAt instanceof Date && w.id?.lt) {
      return (
        row.soldAt.getTime() === w.soldAt.getTime() && row.id < w.id.lt
      );
    }
    return true;
  };

  // Re-implement more carefully using JSON-like walk
  const matchRow = (row: Row, w: unknown): boolean => {
    if (!w || typeof w !== "object") return true;
    const o = w as Record<string, unknown>;
    if (Array.isArray(o.AND)) {
      return (o.AND as unknown[]).every((c) => matchRow(row, c));
    }
    if (Array.isArray(o.OR)) {
      return (o.OR as unknown[]).some((c) => matchRow(row, c));
    }
    if (typeof o.managerId === "string" && row.managerId !== o.managerId) {
      return false;
    }
    if (o.returnedAt === null && row.returnedAt !== null) return false;
    if (
      o.returnedAt &&
      typeof o.returnedAt === "object" &&
      o.returnedAt !== null &&
      "not" in o.returnedAt &&
      row.returnedAt === null
    ) {
      return false;
    }
    if (
      o.customerName &&
      typeof o.customerName === "object" &&
      o.customerName !== null &&
      "contains" in o.customerName
    ) {
      const q = String(
        (o.customerName as { contains: string }).contains,
      ).toLowerCase();
      if (!row.customerName.toLowerCase().includes(q)) return false;
    }
    if (o.soldAt instanceof Date && o.id && typeof o.id === "object") {
      const idLt = (o.id as { lt: string }).lt;
      return (
        row.soldAt.getTime() === o.soldAt.getTime() && row.id < idLt
      );
    }
    if (o.soldAt && typeof o.soldAt === "object" && !(o.soldAt instanceof Date)) {
      const s = o.soldAt as { gte?: Date; lte?: Date; lt?: Date };
      if (s.gte && row.soldAt < s.gte) return false;
      if (s.lte && row.soldAt > s.lte) return false;
      if (s.lt && !(row.soldAt < s.lt)) return false;
    }
    return true;
  };

  return all.filter((r) => matchRow(r, where));
}

function makeFakeDb(all: Row[]) {
  // soldAt DESC, id DESC
  const sorted = [...all].sort((a, b) => {
    if (a.soldAt.getTime() !== b.soldAt.getTime()) {
      return b.soldAt.getTime() - a.soldAt.getTime();
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const calls: { take: number; where: unknown }[] = [];

  const db = {
    saleRecord: {
      findMany: async (args: {
        where?: unknown;
        take: number;
        orderBy: unknown;
      }) => {
        calls.push({ take: args.take, where: args.where });
        const filtered = applyWhere(sorted, args.where);
        // re-sort after filter
        filtered.sort((a, b) => {
          if (a.soldAt.getTime() !== b.soldAt.getTime()) {
            return b.soldAt.getTime() - a.soldAt.getTime();
          }
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });
        return filtered.slice(0, args.take);
      },
    },
  };

  return { db: db as unknown as PrismaClient, calls, sorted };
}

describe("fetchSaleHistoryPage — keyset: skip/dup yo'q", () => {
  const all = makeRows(45);

  it("ketma-ket sahifalar dublikatsiz va tushirmasdan barcha qatorlarni beradi", async () => {
    const { db } = makeFakeDb(all);
    const filters: SaleHistoryFilters = {
      managerId: null,
      from: null,
      to: null,
      customerQ: "",
      returned: "all",
    };

    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await fetchSaleHistoryPage(db, {
        filters,
        after,
        pageSize: 10,
      });
      seen.push(...page.rows.map((r) => r.id));
      expect(page.nextCursor !== null).toBe(page.hasMore);
      if (!page.hasMore) break;
      after = page.nextCursor;
    }

    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
    // Eng yangi birinchi
    expect(seen[0]).toBe(all[0].id);
    expect(seen[seen.length - 1]).toBe(all[all.length - 1].id);
  });

  it("managerId scope — faqat o'sha menejer; sahifalar to'liq", async () => {
    const { db } = makeFakeDb(all);
    const expected = all.filter((r) => r.managerId === "mgrA");
    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await fetchSaleHistoryPage(db, {
        filters: {
          managerId: "mgrA",
          from: null,
          to: null,
          customerQ: "",
          returned: "all",
        },
        after,
        pageSize: 7,
      });
      for (const r of page.rows) {
        expect((r as Row).managerId).toBe("mgrA");
      }
      seen.push(...page.rows.map((r) => r.id));
      if (!page.hasMore) break;
      after = page.nextCursor;
    }
    expect(seen).toHaveLength(expected.length);
    expect(new Set(seen).size).toBe(expected.length);
  });

  it("take = pageSize+1 — hasMore to'g'ri", async () => {
    const { db, calls } = makeFakeDb(all);
    const page = await fetchSaleHistoryPage(db, {
      filters: {
        managerId: null,
        from: null,
        to: null,
        customerQ: "",
        returned: "all",
      },
      pageSize: 10,
    });
    expect(calls[0].take).toBe(11);
    expect(page.rows).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it("pageSize default = SALE_HISTORY_PAGE_SIZE", () => {
    expect(SALE_HISTORY_PAGE_SIZE).toBe(20);
  });
});

describe("filtersFromSearchParams", () => {
  it("q/from/to/returned parse", () => {
    const f = filtersFromSearchParams(
      {
        q: "  Иван ",
        from: "2026-07-01",
        to: "2026-07-31",
        returned: "yes",
      },
      "mgr1",
    );
    expect(f.managerId).toBe("mgr1");
    expect(f.customerQ).toBe("Иван");
    expect(f.returned).toBe("yes");
    expect(f.from?.toISOString()).toBe(
      parseTashkentDayStart("2026-07-01")!.toISOString(),
    );
    expect(f.to?.toISOString()).toBe(
      parseTashkentDayEnd("2026-07-31")!.toISOString(),
    );
  });
});
