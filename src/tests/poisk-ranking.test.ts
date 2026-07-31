// W6-A / W6-A2 — offcut ranking must use bounding L×W (display key), not areaM2.
// Pure unit tests (no DB).
//  • oldWrongRank = pre-W6-A (areaM2 SQL prefix) — must DROP best-fit
//  • sqlBoundedByBoundingArea = W6-A2 (ORDER BY L×W LIMIT max+1) + rankAndCap
//    — must KEEP best-fit first
import { describe, expect, it } from "vitest";
import {
  pieceBoundingAreaMm2,
  rankAndCapFittingPieces,
} from "@/lib/poisk-query";

type Row = {
  id: string;
  boundingLengthMm: number;
  boundingWidthMm: number;
  /** Nullable real area — used only to model the OLD wrong SQL order. */
  areaM2: number | null;
};

/** Old page algorithm (pre-W6-A): SQL areaM2 ASC take max, then JS L×W sort. */
function oldWrongRank(rows: readonly Row[], max: number): Row[] {
  const byArea = [...rows].sort((a, b) => {
    // Postgres ASC: NULLS LAST — treat null as +∞ for this model.
    const aa = a.areaM2 == null ? Number.POSITIVE_INFINITY : a.areaM2;
    const bb = b.areaM2 == null ? Number.POSITIVE_INFINITY : b.areaM2;
    return aa - bb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const prefix = byArea.slice(0, max);
  return [...prefix].sort(
    (a, b) =>
      pieceBoundingAreaMm2(a.boundingLengthMm, a.boundingWidthMm) -
        pieceBoundingAreaMm2(b.boundingLengthMm, b.boundingWidthMm) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * W6-A2 SQL shape: ORDER BY boundingAreaMm2 (=L×W) ASC, id ASC, take max+1,
 * then rankAndCapFittingPieces (same key + cap probe).
 */
function sqlBoundedByBoundingArea(rows: readonly Row[], max: number) {
  const byBound = [...rows].sort(
    (a, b) =>
      pieceBoundingAreaMm2(a.boundingLengthMm, a.boundingWidthMm) -
        pieceBoundingAreaMm2(b.boundingLengthMm, b.boundingWidthMm) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const prefix = byBound.slice(0, max + 1);
  return rankAndCapFittingPieces(prefix, max);
}

describe("pieceBoundingAreaMm2", () => {
  it("is L×W", () => {
    expect(pieceBoundingAreaMm2(1000, 500)).toBe(500_000);
  });
});

describe("rankAndCapFittingPieces — §6.5 display key", () => {
  it("orders by bounding area ASC with id tie-break", () => {
    const rows: Row[] = [
      { id: "c", boundingLengthMm: 2000, boundingWidthMm: 1000, areaM2: 0.1 },
      { id: "a", boundingLengthMm: 500, boundingWidthMm: 400, areaM2: 9 },
      { id: "b", boundingLengthMm: 500, boundingWidthMm: 400, areaM2: 1 },
    ];
    const { ranked, capped, total } = rankAndCapFittingPieces(rows, 10);
    expect(total).toBe(3);
    expect(capped).toBe(false);
    // Same L×W → id asc: a before b; both before large c.
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("caps AFTER correct ranking (best L×W always kept)", () => {
    const rows: Row[] = [
      { id: "best", boundingLengthMm: 300, boundingWidthMm: 200, areaM2: null },
      { id: "mid", boundingLengthMm: 800, boundingWidthMm: 600, areaM2: 0.01 },
      { id: "big", boundingLengthMm: 3000, boundingWidthMm: 2000, areaM2: 0.02 },
    ];
    const { ranked, capped, total } = rankAndCapFittingPieces(rows, 2);
    expect(total).toBe(3);
    expect(capped).toBe(true);
    expect(ranked.map((r) => r.id)).toEqual(["best", "mid"]);
    // NULL areaM2 must not affect ranking — best is first.
    expect(ranked[0]!.areaM2).toBeNull();
  });

  it("PROVES the old areaM2-prefix bug drops the best fit; L×W rank keeps it", () => {
    // 3 pieces with tiny areaM2 but HUGE bounding boxes fill a cap of 3.
    // 1 piece with NULL (or large) areaM2 but the SMALLEST bounding box —
    // the one a manager should see first under §6.5.
    const filler: Row[] = [1, 2, 3].map((i) => ({
      id: `thin-${i}`,
      boundingLengthMm: 5000,
      boundingWidthMm: 4000, // 20_000_000 mm² bounding
      areaM2: 0.001 * i, // tiny real area → wins SQL areaM2 ASC
    }));
    const best: Row = {
      id: "best-fit",
      boundingLengthMm: 400,
      boundingWidthMm: 300, // 120_000 mm² — smallest that fits
      areaM2: null, // NULLS LAST under areaM2 ASC → cut by prefix
    };
    const all = [...filler, best];
    const max = 3;

    const wrong = oldWrongRank(all, max);
    expect(wrong.map((r) => r.id)).not.toContain("best-fit");
    expect(wrong).toHaveLength(3);

    // Full-set rank (W6-A pure path) still correct.
    const rightFull = rankAndCapFittingPieces(all, max);
    expect(rightFull.capped).toBe(true);
    expect(rightFull.ranked[0]!.id).toBe("best-fit");
    expect(rightFull.ranked).toHaveLength(3);

    // W6-A2: SQL ordered by bounding area + take max+1 — best survives prefix.
    const rightBounded = sqlBoundedByBoundingArea(all, max);
    expect(rightBounded.capped).toBe(true);
    expect(rightBounded.ranked[0]!.id).toBe("best-fit");
    expect(rightBounded.ranked.map((r) => r.id)).toContain("best-fit");
    expect(rightBounded.ranked).toHaveLength(3);
  });

  it("handles empty input and max=0", () => {
    expect(rankAndCapFittingPieces([], 500)).toEqual({
      ranked: [],
      capped: false,
      total: 0,
    });
    const one: Row[] = [
      { id: "x", boundingLengthMm: 1, boundingWidthMm: 1, areaM2: 1 },
    ];
    const z = rankAndCapFittingPieces(one, 0);
    expect(z.capped).toBe(true);
    expect(z.ranked).toEqual([]);
    expect(z.total).toBe(1);
  });
});
