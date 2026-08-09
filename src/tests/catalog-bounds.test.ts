// Catalog caps + compound keyset (expiresAt, id) — no silent truncate, no skip/dup.
import { describe, expect, it } from "vitest";
import {
  ACTIVE_RESERVATIONS_PAGE_SIZE,
  CATALOG_SLABS_CAP,
  afterExpiresIdKeyset,
  catalogCapNoticeRu,
  encodeExpiresIdCursor,
  isCapNoticeVisible,
  parseExpiresIdCursor,
  stoneNameContainsFilter,
  takeCapPlusOne,
  takeForCap,
} from "@/lib/catalog-bounds";

describe("takeCapPlusOne", () => {
  it("under cap → no truncation", () => {
    const r = takeCapPlusOne([1, 2, 3], 10);
    expect(r).toEqual({ items: [1, 2, 3], truncated: false, shown: 3 });
  });

  it("exactly cap → no truncation", () => {
    const rows = Array.from({ length: CATALOG_SLABS_CAP }, (_, i) => i);
    const r = takeCapPlusOne(rows, CATALOG_SLABS_CAP);
    expect(r.truncated).toBe(false);
    expect(r.shown).toBe(CATALOG_SLABS_CAP);
  });

  it("over cap (take+1 pattern) → truncated, keep first cap", () => {
    const rows = Array.from({ length: CATALOG_SLABS_CAP + 1 }, (_, i) => `s${i}`);
    const r = takeCapPlusOne(rows, CATALOG_SLABS_CAP);
    expect(r.truncated).toBe(true);
    expect(r.shown).toBe(CATALOG_SLABS_CAP);
    expect(r.items).toHaveLength(CATALOG_SLABS_CAP);
    expect(r.items[0]).toBe("s0");
    expect(r.items[r.items.length - 1]).toBe(`s${CATALOG_SLABS_CAP - 1}`);
  });

  it("takeForCap is cap+1", () => {
    expect(takeForCap(40)).toBe(41);
  });
});

describe("catalogCapNoticeRu — visible when truncated", () => {
  it("message names shown and total", () => {
    const msg = catalogCapNoticeRu({
      what: "плит",
      shown: 400,
      total: 1200,
    });
    expect(msg).toContain("400");
    expect(msg).toContain("1200");
    expect(msg).toContain("плит");
    expect(isCapNoticeVisible(true, 1200, 400)).toBe(true);
    expect(isCapNoticeVisible(false, 10, 10)).toBe(false);
  });
});

describe("expiresAt+id cursor (ASC list keyset)", () => {
  it("round-trip encode/parse", () => {
    const expiresAt = new Date("2026-08-10T15:00:00.000Z");
    const enc = encodeExpiresIdCursor({ expiresAt, id: "res_1" });
    expect(parseExpiresIdCursor(enc)).toEqual({ expiresAt, id: "res_1" });
  });

  it("malformed → null", () => {
    expect(parseExpiresIdCursor("onlyid")).toBeNull();
    expect(parseExpiresIdCursor("bad_date_id")).toBeNull();
    expect(parseExpiresIdCursor("")).toBeNull();
  });

  it("afterExpiresIdKeyset shape for ASC", () => {
    const c = {
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
      id: "mid",
    };
    expect(afterExpiresIdKeyset(c)).toEqual({
      OR: [
        { expiresAt: { gt: c.expiresAt } },
        { expiresAt: c.expiresAt, id: { gt: "mid" } },
      ],
    });
  });
});

// ── Property: walk pages with shared expiresAt — no skip / no dup ──

type Res = { id: string; expiresAt: Date; status: string };

function matchResWhere(row: Res, where: unknown): boolean {
  if (!where || typeof where !== "object") return true;
  const o = where as Record<string, unknown>;
  if (Array.isArray(o.AND)) {
    return (o.AND as unknown[]).every((c) => matchResWhere(row, c));
  }
  if (Array.isArray(o.OR)) {
    return (o.OR as unknown[]).some((c) => matchResWhere(row, c));
  }
  if (typeof o.status === "string" && row.status !== o.status) return false;
  if (o.expiresAt instanceof Date && o.id && typeof o.id === "object") {
    const idGt = (o.id as { gt: string }).gt;
    return (
      row.expiresAt.getTime() === o.expiresAt.getTime() && row.id > idGt
    );
  }
  if (
    o.expiresAt &&
    typeof o.expiresAt === "object" &&
    !(o.expiresAt instanceof Date)
  ) {
    const e = o.expiresAt as { gt?: Date };
    if (e.gt && !(row.expiresAt > e.gt)) return false;
  }
  return true;
}

function sortAsc(rows: Res[]): Res[] {
  return [...rows].sort((a, b) => {
    if (a.expiresAt.getTime() !== b.expiresAt.getTime()) {
      return a.expiresAt.getTime() - b.expiresAt.getTime();
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

describe("active reservations keyset walk — same expiresAt boundary", () => {
  const TIE = new Date("2026-08-15T12:00:00.000Z");
  const EARLY = new Date("2026-08-10T12:00:00.000Z");
  const LATE = new Date("2026-08-20T12:00:00.000Z");

  it("union of pages = full set, no dups/gaps when many share expiresAt", () => {
    // ASC: early → tie cluster → late
    const all = sortAsc([
      { id: "a1", expiresAt: EARLY, status: "ACTIVE" },
      { id: "a2", expiresAt: EARLY, status: "ACTIVE" },
      // 5 with identical expiresAt — page boundary must not skip
      { id: "t1", expiresAt: TIE, status: "ACTIVE" },
      { id: "t2", expiresAt: TIE, status: "ACTIVE" },
      { id: "t3", expiresAt: TIE, status: "ACTIVE" },
      { id: "t4", expiresAt: TIE, status: "ACTIVE" },
      { id: "t5", expiresAt: TIE, status: "ACTIVE" },
      { id: "z1", expiresAt: LATE, status: "ACTIVE" },
      { id: "z2", expiresAt: LATE, status: "ACTIVE" },
    ]);

    const pageSize = 3;
    const seen: string[] = [];
    let cursor: ReturnType<typeof parseExpiresIdCursor> = null;
    let pages = 0;

    while (pages < 20) {
      pages++;
      const where: Record<string, unknown> = { status: "ACTIVE" };
      const and: unknown[] = [where];
      if (cursor) and.push(afterExpiresIdKeyset(cursor));
      const filtered = all.filter((r) =>
        matchResWhere(r, { AND: and }),
      );
      const take = filtered.slice(0, pageSize + 1);
      const page = take.slice(0, pageSize);
      for (const r of page) seen.push(r.id);
      if (take.length <= pageSize) break;
      const last = page[page.length - 1]!;
      cursor = { expiresAt: last.expiresAt, id: last.id };
      // nextCursor must be compound-encodable
      expect(parseExpiresIdCursor(encodeExpiresIdCursor(cursor))).toEqual(
        cursor,
      );
    }

    expect(seen).toEqual(all.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBeGreaterThan(1);

    // Tie cluster spans more than one page
    const tIdx = seen.map((id, i) => (id.startsWith("t") ? i : -1)).filter(
      (i) => i >= 0,
    );
    expect(tIdx.length).toBe(5);
    expect(Math.floor(tIdx[0]! / pageSize)).not.toBe(
      Math.floor(tIdx[tIdx.length - 1]! / pageSize),
    );
  });

  it("timestamp-only cursor WOULD skip same-expiresAt peers (witness)", () => {
    // After cursor expiresAt=TIE only filtering expiresAt > TIE drops t2..t5.
    const all = sortAsc([
      { id: "t1", expiresAt: TIE, status: "ACTIVE" },
      { id: "t2", expiresAt: TIE, status: "ACTIVE" },
      { id: "t3", expiresAt: TIE, status: "ACTIVE" },
      { id: "z1", expiresAt: LATE, status: "ACTIVE" },
    ]);
    const last = all[0]!; // t1
    const broken = all.filter((r) => r.expiresAt > last.expiresAt);
    const correct = all.filter(
      (r) =>
        r.expiresAt > last.expiresAt ||
        (r.expiresAt.getTime() === last.expiresAt.getTime() &&
          r.id > last.id),
    );
    expect(broken.map((r) => r.id)).toEqual(["z1"]); // t2,t3 SKIPPED
    expect(correct.map((r) => r.id)).toEqual(["t2", "t3", "z1"]);
  });

  it("page size constant is positive and finite", () => {
    expect(ACTIVE_RESERVATIONS_PAGE_SIZE).toBeGreaterThan(0);
    expect(ACTIVE_RESERVATIONS_PAGE_SIZE).toBeLessThanOrEqual(200);
  });
});

describe("stoneNameContainsFilter", () => {
  it("empty → undefined", () => {
    expect(stoneNameContainsFilter("")).toBeUndefined();
    expect(stoneNameContainsFilter("  ")).toBeUndefined();
  });
  it("trim + contains", () => {
    expect(stoneNameContainsFilter("  Трав ")).toEqual({
      name: { contains: "Трав", mode: "insensitive" },
    });
  });
});
