// Debts keyset pagination — compound (createdAt, id) like sale-history.ts.
// Property: walk all pages over same-timestamp rows → full set, no dups, no gaps.
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  debtsListWhere,
  encodeDebtsCursor,
  listDebts,
  parseDebtsCursor,
  type ListDebtsInput,
} from "@/lib/debts";

// ───────────────────────── encode / parse ─────────────────────────

describe("debts cursor encode/parse (sale-history shape)", () => {
  it("round-trip", () => {
    const createdAt = new Date("2026-08-07T10:00:00.000Z");
    const enc = encodeDebtsCursor({ createdAt, id: "debt_abc" });
    expect(enc).toBe("2026-08-07T10:00:00.000Z_debt_abc");
    expect(parseDebtsCursor(enc)).toEqual({ createdAt, id: "debt_abc" });
  });

  it("malformed / legacy id-only → null", () => {
    expect(parseDebtsCursor("")).toBeNull();
    expect(parseDebtsCursor(null)).toBeNull();
    expect(parseDebtsCursor("   ")).toBeNull();
    expect(parseDebtsCursor("nope")).toBeNull();
    expect(parseDebtsCursor("not-a-date_id")).toBeNull();
    // legacy: bare cuid / id only — no underscore date prefix
    expect(parseDebtsCursor("clxxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
    expect(parseDebtsCursor("_missingIso")).toBeNull();
    expect(parseDebtsCursor("2026-08-07T10:00:00.000Z_")).toBeNull();
  });
});

describe("debtsListWhere — filters + keyset", () => {
  const base = {
    now: new Date("2026-08-08T12:00:00.000Z"),
  };

  it("empty filters → {}", () => {
    expect(debtsListWhere(base, null)).toEqual({});
  });

  it("status + currency + manager + q + overdue + cursor AND", () => {
    const cursorAt = new Date("2026-08-07T10:00:00.000Z");
    const w = debtsListWhere(
      {
        ...base,
        status: "ACTIVE",
        currency: "USD",
        managerId: "mgr1",
        q: "Тимур",
        overdueOnly: true,
      },
      { createdAt: cursorAt, id: "d9" },
    );
    expect(w).toEqual({
      AND: [
        { status: "ACTIVE" },
        { currency: "USD" },
        {
          saleRecord: {
            managerId: "mgr1",
            OR: [
              { customerName: { contains: "Тимур", mode: "insensitive" } },
              { customerContact: { contains: "Тимур", mode: "insensitive" } },
            ],
          },
        },
        { status: "ACTIVE" },
        { dueDate: { lt: base.now } },
        {
          OR: [
            { createdAt: { lt: cursorAt } },
            { createdAt: cursorAt, id: { lt: "d9" } },
          ],
        },
      ],
    });
  });
});

// ───────────────────────── fake DB: property walk ─────────────────────────

type DebtRow = {
  id: string;
  saleRecordId: string;
  amount: Prisma.Decimal;
  currency: "UZS" | "USD";
  status: "ACTIVE" | "REPAID" | "CANCELLED";
  dueDate: Date | null;
  comment: string | null;
  repaidAt: Date | null;
  repaidAmount: Prisma.Decimal | null;
  createdAt: Date;
  saleRecord: {
    customerName: string;
    customerContact: string | null;
    soldAt: Date;
    price: Prisma.Decimal | null;
    targetType: string;
    qtySlabs: number | null;
    qtyAreaM2: null;
    managerId: string;
    manager: { name: string };
  };
};

/** Match Prisma where for debtsListWhere (subset needed for pagination tests). */
function matchWhere(row: DebtRow, where: unknown): boolean {
  if (!where || typeof where !== "object") return true;
  const o = where as Record<string, unknown>;

  if (Array.isArray(o.AND)) {
    return (o.AND as unknown[]).every((c) => matchWhere(row, c));
  }
  if (Array.isArray(o.OR)) {
    return (o.OR as unknown[]).some((c) => matchWhere(row, c));
  }

  if (typeof o.status === "string" && row.status !== o.status) return false;
  if (typeof o.currency === "string" && row.currency !== o.currency) return false;

  if (o.dueDate && typeof o.dueDate === "object" && o.dueDate !== null) {
    const d = o.dueDate as { lt?: Date };
    if (d.lt) {
      if (row.dueDate === null || !(row.dueDate < d.lt)) return false;
    }
  }

  if (o.saleRecord && typeof o.saleRecord === "object") {
    const s = o.saleRecord as {
      managerId?: string;
      OR?: Array<{
        customerName?: { contains: string; mode: string };
        customerContact?: { contains: string; mode: string };
      }>;
    };
    if (s.managerId && row.saleRecord.managerId !== s.managerId) return false;
    if (s.OR) {
      const ok = s.OR.some((branch) => {
        if (branch.customerName?.contains) {
          return row.saleRecord.customerName
            .toLowerCase()
            .includes(branch.customerName.contains.toLowerCase());
        }
        if (branch.customerContact?.contains) {
          const c = row.saleRecord.customerContact ?? "";
          return c
            .toLowerCase()
            .includes(branch.customerContact.contains.toLowerCase());
        }
        return false;
      });
      if (!ok) return false;
    }
  }

  // Keyset branch: { createdAt: { lt }, } or { createdAt: Date, id: { lt } }
  if (o.createdAt instanceof Date && o.id && typeof o.id === "object") {
    const idLt = (o.id as { lt: string }).lt;
    return (
      row.createdAt.getTime() === o.createdAt.getTime() && row.id < idLt
    );
  }
  if (o.createdAt && typeof o.createdAt === "object" && !(o.createdAt instanceof Date)) {
    const c = o.createdAt as { lt?: Date };
    if (c.lt && !(row.createdAt < c.lt)) return false;
  }

  return true;
}

function sortDebtsDesc(rows: DebtRow[]): DebtRow[] {
  return [...rows].sort((a, b) => {
    if (a.createdAt.getTime() !== b.createdAt.getTime()) {
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function makeFakeDb(all: DebtRow[]) {
  const sorted = sortDebtsDesc(all);
  const calls: { where: unknown; take: number; orderBy: unknown }[] = [];

  const db = {
    debt: {
      findMany: async (args: {
        where?: unknown;
        take: number;
        orderBy: unknown;
      }) => {
        calls.push({
          where: args.where,
          take: args.take,
          orderBy: args.orderBy,
        });
        const filtered = sorted.filter((r) => matchWhere(r, args.where));
        return filtered.slice(0, args.take);
      },
    },
  };

  return { db: db as unknown as Parameters<typeof listDebts>[0], calls, sorted };
}

function row(
  id: string,
  createdAt: Date,
  over: Partial<DebtRow> = {},
): DebtRow {
  return {
    id,
    saleRecordId: `s-${id}`,
    amount: new Prisma.Decimal(100),
    currency: "UZS",
    status: "ACTIVE",
    dueDate: new Date("2026-09-01T18:59:59.999Z"),
    comment: null,
    repaidAt: null,
    repaidAmount: null,
    createdAt,
    saleRecord: {
      customerName: "Клиент " + id,
      customerContact: "+998",
      soldAt: createdAt,
      price: new Prisma.Decimal(100),
      targetType: "SLAB",
      qtySlabs: null,
      qtyAreaM2: null,
      managerId: "mgr1",
      manager: { name: "Mgr" },
    },
    ...over,
  };
}

describe("listDebts pagination — property: same createdAt, multi-page", () => {
  const TIE = new Date("2026-08-07T12:00:00.000Z");
  const EARLIER = new Date("2026-08-06T12:00:00.000Z");
  const LATER = new Date("2026-08-08T12:00:00.000Z");
  const NOW = new Date("2026-08-09T00:00:00.000Z");

  /**
   * Dataset engineered so id-only keyset WOULD break:
   * - 5 rows at identical createdAt (tie) with ids d04..d00 (cuid-like order)
   * - 2 later, 2 earlier → 9 total
   * Page size 3 → at least one page boundary inside the tie cluster.
   */
  function buildDataset(): DebtRow[] {
    // ids: lexicographic order matters for DESC id within same timestamp
    const tied = ["d04", "d03", "d02", "d01", "d00"].map((id) =>
      row(id, TIE),
    );
    const later = [row("e02", LATER), row("e01", LATER)];
    const earlier = [row("a02", EARLIER), row("a01", EARLIER)];
    return [...tied, ...later, ...earlier];
  }

  it("walks all pages: union = full set, no dups, no gaps (same-timestamp boundary)", async () => {
    const all = buildDataset();
    const { db, calls, sorted } = makeFakeDb(all);
    const pageSize = 3;

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const maxPages = 20;

    while (pages < maxPages) {
      pages++;
      const res = await listDebts(db, {
        now: NOW,
        pageSize,
        cursor,
      });
      for (const it of res.items) {
        seen.push(it.id);
      }
      // orderBy stable
      expect(calls[calls.length - 1]!.orderBy).toEqual([
        { createdAt: "desc" },
        { id: "desc" },
      ]);
      // nextCursor is compound when more pages
      if (res.nextCursor) {
        const p = parseDebtsCursor(res.nextCursor);
        expect(p).not.toBeNull();
        expect(p!.id).toBe(res.items[res.items.length - 1]!.id);
        expect(p!.createdAt.getTime()).toBe(
          res.items[res.items.length - 1]!.createdAt.getTime(),
        );
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    // Full coverage property
    const expectedIds = sorted.map((r) => r.id);
    expect(seen).toEqual(expectedIds);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen).toHaveLength(all.length); // no gaps
    expect(pages).toBeGreaterThan(1);

    // Prove a page boundary crossed inside the same createdAt cluster:
    // at least one consecutive pair in `seen` shares TIE timestamp.
    const tieIds = sorted
      .filter((r) => r.createdAt.getTime() === TIE.getTime())
      .map((r) => r.id);
    expect(tieIds.length).toBe(5);
    // First page starts with LATER rows then TIE — eventually TIE rows span pages
    const firstTieIdx = seen.indexOf(tieIds[0]!);
    const lastTieIdx = seen.indexOf(tieIds[tieIds.length - 1]!);
    expect(lastTieIdx - firstTieIdx + 1).toBe(5);
    // With pageSize 3, 5 tied rows cannot fit on one page
    expect(Math.floor(firstTieIdx / pageSize)).not.toBe(
      Math.floor(lastTieIdx / pageSize),
    );
  });

  it("id-only keyset skips earlier rows with larger id (regression witness)", () => {
    // createdAt DESC, id DESC. After cursor at mid list, id-only drops
    // rows with createdAt < cursor.createdAt but id > cursor.id.
    const mid = new Date("2026-08-07T12:00:00.000Z");
    const older = new Date("2026-08-01T12:00:00.000Z");
    const all = sortDebtsDesc([
      row("m50", mid),
      row("m40", mid), // same timestamp, smaller id
      row("z99", older), // earlier day, but id > m50 lexicographically
    ]);
    // Order: m50, m40, z99
    const last = all[0]!; // m50
    expect(last.id).toBe("m50");
    const broken = all.filter((r) => r.id < last.id); // old listDebts
    const correct = all.filter(
      (r) =>
        r.createdAt < last.createdAt ||
        (r.createdAt.getTime() === last.createdAt.getTime() &&
          r.id < last.id),
    );
    expect(broken.map((r) => r.id)).toEqual(["m40"]); // z99 SKIPPED
    expect(correct.map((r) => r.id).sort()).toEqual(["m40", "z99"]);
  });

  it("filters (status, manager, currency) still apply with cursor", async () => {
    const all = [
      row("x1", TIE, {
        currency: "USD",
        saleRecord: {
          ...row("x1", TIE).saleRecord,
          managerId: "mgrA",
          customerName: "Alpha",
        },
      }),
      row("x2", TIE, {
        currency: "USD",
        saleRecord: {
          ...row("x2", TIE).saleRecord,
          managerId: "mgrA",
          customerName: "Beta",
        },
      }),
      row("x3", TIE, {
        currency: "UZS",
        saleRecord: {
          ...row("x3", TIE).saleRecord,
          managerId: "mgrA",
          customerName: "Gamma",
        },
      }),
      row("x4", EARLIER, {
        currency: "USD",
        saleRecord: {
          ...row("x4", EARLIER).saleRecord,
          managerId: "mgrB",
          customerName: "Delta",
        },
      }),
    ];
    const { db } = makeFakeDb(all);
    const res = await listDebts(db, {
      now: NOW,
      pageSize: 10,
      currency: "USD",
      managerId: "mgrA",
    });
    expect(res.items.map((i) => i.id).sort()).toEqual(["x1", "x2"]);
  });
});

describe("listDebts — malformed / empty cursor behaviour", () => {
  const NOW = new Date("2026-08-09T00:00:00.000Z");

  it("malformed cursor → empty page, no throw, not page-one restart", async () => {
    const all = [
      row("a", new Date("2026-08-08T00:00:00.000Z")),
      row("b", new Date("2026-08-07T00:00:00.000Z")),
    ];
    const { db, calls } = makeFakeDb(all);

    // no cursor → real first page
    const page1 = await listDebts(db, { now: NOW, pageSize: 10 });
    expect(page1.items).toHaveLength(2);

    // legacy id-only / garbage → empty (not silent page 1)
    const bad = await listDebts(db, {
      now: NOW,
      pageSize: 10,
      cursor: "clxxxxxxxxonlyid",
    });
    expect(bad.items).toEqual([]);
    expect(bad.nextCursor).toBeNull();
    // must not have issued findMany for the bad cursor (short-circuit)
    expect(calls).toHaveLength(1); // only page1

    const bad2 = await listDebts(db, {
      now: NOW,
      pageSize: 10,
      cursor: "not-iso_id",
    });
    expect(bad2.items).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("empty / null cursor → first page normally", async () => {
    const { db } = makeFakeDb([
      row("z", new Date("2026-08-08T00:00:00.000Z")),
    ]);
    const res = await listDebts(db, {
      now: NOW,
      pageSize: 10,
      cursor: null,
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.id).toBe("z");
  });
});
