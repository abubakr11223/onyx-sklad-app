// ТЗ №14 §3 — pure floors: freeRemainderFromAggregate + holds (no invented math).
import { describe, expect, it } from "vitest";
import {
  assertQuantityAboveFloor,
  batchHasMovements,
  freeAfterVolumeHolds,
  minSlabsTotalFloor,
} from "@/lib/batch-edit";
import {
  EMPTY_AGGREGATE,
  EMPTY_HOLD,
  freeRemainderFromAggregate,
  type BatchRemainderAggregate,
} from "@/lib/batch-remainders";
import type { BatchTotalsInput } from "@/lib/inventory";

const baseBatch = (over: Partial<BatchTotalsInput> = {}): BatchTotalsInput => ({
  slabsTotal: 10,
  areaTotalM2: 50,
  slabsAdjusted: 0,
  areaAdjustedM2: 0,
  slabsSoldDirect: 0,
  areaSoldDirectM2: 0,
  ...over,
});

describe("minSlabsTotalFloor / assertQuantityAboveFloor", () => {
  it("no movements → floor 0, free edit of totals ok", () => {
    const b = baseBatch();
    const floor = minSlabsTotalFloor(b, EMPTY_AGGREGATE, EMPTY_HOLD);
    expect(floor).toBe(0);
    expect(
      assertQuantityAboveFloor(
        { ...b, slabsTotal: 1, areaTotalM2: 1 },
        EMPTY_AGGREGATE,
        EMPTY_HOLD,
      ).ok,
    ).toBe(true);
    expect(batchHasMovements(b, EMPTY_AGGREGATE, EMPTY_HOLD)).toBe(false);
  });

  it("cannot reduce below sold+reserved+separated+direct pieces", () => {
    // sold 3, reserved 2, 1 separated slab, 1 direct piece → floor 3+2+1+1=7
    const b = baseBatch({ slabsSoldDirect: 3, slabsTotal: 10 });
    const agg: BatchRemainderAggregate = {
      ...EMPTY_AGGREGATE,
      slabCount: 1,
      pieceCount: 1,
    };
    const hold = { reservedSlabs: 2, reservedAreaM2: 0 };
    expect(minSlabsTotalFloor(b, agg, hold)).toBe(7);

    const free10 = freeRemainderFromAggregate(b, agg);
    // free = 10+0-3-1-1 = 5; after hold 5-2=3 ≥ 0
    expect(freeAfterVolumeHolds(free10, hold).slabsFree).toBe(3);

    expect(
      assertQuantityAboveFloor(
        { ...b, slabsTotal: 6 },
        agg,
        hold,
      ).ok,
    ).toBe(false);

    expect(
      assertQuantityAboveFloor(
        { ...b, slabsTotal: 7 },
        agg,
        hold,
      ).ok,
    ).toBe(true);

    expect(batchHasMovements(b, agg, hold)).toBe(true);
  });

  it("area free after holds never negative", () => {
    const b = baseBatch({
      slabsTotal: null, // area-only party
      areaTotalM2: 20,
      areaSoldDirectM2: 8,
    });
    const hold = { reservedSlabs: 0, reservedAreaM2: 5 };
    // free area = 20-8 = 12; after hold 7 ≥ 0
    expect(
      assertQuantityAboveFloor(
        { ...b, areaTotalM2: 20 },
        EMPTY_AGGREGATE,
        hold,
      ).ok,
    ).toBe(true);
    // free would be 12-5=7 wait sold 8 → free 12, hold 5 → 7
    // set areaTotal to 10: free = 10-8=2; after hold 2-5=-3 → fail
    const bad = assertQuantityAboveFloor(
      { ...b, areaTotalM2: 10 },
      EMPTY_AGGREGATE,
      hold,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.field).toBe("areaTotalM2");
  });

  it("uses freeRemainderFromAggregate as single remainder source", () => {
    const b = baseBatch({ slabsTotal: 10, slabsSoldDirect: 2 });
    const agg: BatchRemainderAggregate = {
      ...EMPTY_AGGREGATE,
      slabCount: 2,
      pieceCount: 1,
    };
    const free = freeRemainderFromAggregate(b, agg);
    expect(free.slabsFree).toBe(10 - 2 - 2 - 1); // 5
    const after = freeAfterVolumeHolds(free, {
      reservedSlabs: 5,
      reservedAreaM2: 0,
    });
    expect(after.slabsFree).toBe(0);
    // one more reserved → negative
    expect(
      freeAfterVolumeHolds(free, { reservedSlabs: 6, reservedAreaM2: 0 })
        .slabsFree,
    ).toBe(-1);
  });
});
