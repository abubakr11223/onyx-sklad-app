// W2-B — unit tests for the pure perf-seed generator (no DB).
// Normative sources: schema.prisma constraints, domain_model migration CHECKs,
// and the guarantees documented on buildPerfDataset in src/lib/seed-perf.ts.
import { describe, expect, it } from "vitest";
import {
  buildPerfDataset,
  chunk,
  DEFAULT_SCALE,
  MAX_SCALE,
  parsePerfArgs,
  PERF_ID_PREFIX,
  PERF_MANAGER_USER_ID,
  PERF_NAME_PREFIX,
  PERF_WAREHOUSE_USER_ID,
  validatePerfArgs,
  type PerfScale,
} from "@/lib/seed-perf";

/** Fixed clock so determinism tests are byte-stable. */
const FIXED_NOW_MS = Date.UTC(2026, 6, 30, 12, 0, 0);

/** Code-derived: isZeroAvailabilityType(i) === i % 3 === 0 (seed-perf.ts). */
function expectedZeroAvailabilityCount(types: number): number {
  if (types <= 0) return 0;
  return Math.floor((types - 1) / 3) + 1;
}

function scale(partial: Partial<PerfScale> = {}): PerfScale {
  return {
    types: partial.types ?? 30,
    slabs: partial.slabs ?? 200,
    pieces: partial.pieces ?? 80,
  };
}

const emptyEnv = (): NodeJS.ProcessEnv =>
  ({ NODE_ENV: "test" }) as NodeJS.ProcessEnv;

// ───────────────────────── buildPerfDataset ─────────────────────────

describe("buildPerfDataset — scale parameters", () => {
  it("yields exactly N stone types when asked for N types", () => {
    for (const n of [1, 7, 100, DEFAULT_SCALE.types]) {
      const data = buildPerfDataset(scale({ types: n, slabs: 0, pieces: 0 }), FIXED_NOW_MS);
      expect(data.stoneTypes).toHaveLength(n);
    }
  });

  it("yields exactly N slabs and N pieces when at least one batch exists", () => {
    // types=2 → one zero-availability + one with batches (index 0 is zero).
    const data = buildPerfDataset(
      scale({ types: 2, slabs: 123, pieces: 45 }),
      FIXED_NOW_MS,
    );
    expect(data.batches.length).toBeGreaterThan(0);
    expect(data.slabs).toHaveLength(123);
    expect(data.pieces).toHaveLength(45);
  });

  it("always creates the two perf users (warehouse + manager)", () => {
    const data = buildPerfDataset(scale({ types: 3 }), FIXED_NOW_MS);
    expect(data.users).toHaveLength(2);
    expect(data.users.map((u) => u.id).sort()).toEqual(
      [PERF_MANAGER_USER_ID, PERF_WAREHOUSE_USER_ID].sort(),
    );
  });
});

describe("buildPerfDataset — Slab label uniqueness (@@unique([batchId, label]))", () => {
  it("holds across the full DEFAULT_SCALE set (not a toy size)", () => {
    const data = buildPerfDataset(DEFAULT_SCALE, FIXED_NOW_MS);
    expect(data.slabs).toHaveLength(DEFAULT_SCALE.slabs);

    const seen = new Set<string>();
    for (const slab of data.slabs) {
      const key = `${slab.batchId}\0${slab.label}`;
      expect(seen.has(key), `duplicate (batchId,label)=(${slab.batchId},${slab.label})`).toBe(
        false,
      );
      seen.add(key);
    }
    expect(seen.size).toBe(data.slabs.length);
  });
});

describe("buildPerfDataset — FK integrity", () => {
  it("every Slab / Piece / Batch / Reservation FK points at a generated row", () => {
    const data = buildPerfDataset(
      scale({ types: 60, slabs: 500, pieces: 200 }),
      FIXED_NOW_MS,
    );

    const userIds = new Set(data.users.map((u) => u.id));
    const stoneTypeIds = new Set(data.stoneTypes.map((t) => t.id as string));
    const batchIds = new Set(data.batches.map((b) => b.id as string));
    const slabIds = new Set(data.slabs.map((s) => s.id as string));

    for (const batch of data.batches) {
      expect(stoneTypeIds.has(batch.stoneTypeId as string)).toBe(true);
    }

    for (const slab of data.slabs) {
      expect(batchIds.has(slab.batchId as string)).toBe(true);
      expect(stoneTypeIds.has(slab.stoneTypeId as string)).toBe(true);
      expect(userIds.has(slab.separatedById as string)).toBe(true);
      // Denormalized stoneTypeId must match the parent batch.
      const parent = data.batches.find((b) => b.id === slab.batchId);
      expect(parent?.stoneTypeId).toBe(slab.stoneTypeId);
    }

    for (const piece of data.pieces) {
      expect(stoneTypeIds.has(piece.stoneTypeId as string)).toBe(true);
      expect(userIds.has(piece.createdById as string)).toBe(true);
      if (piece.batchId != null) {
        expect(batchIds.has(piece.batchId as string)).toBe(true);
      }
      if (piece.originSlabId != null) {
        expect(slabIds.has(piece.originSlabId as string)).toBe(true);
        // origin slab must belong to the same batch (or piece has no batch).
        const origin = data.slabs.find((s) => s.id === piece.originSlabId);
        expect(origin).toBeDefined();
        if (piece.batchId != null) {
          expect(origin!.batchId).toBe(piece.batchId);
        }
      }
    }

    for (const r of data.reservations) {
      expect(r.batchId == null || batchIds.has(r.batchId as string)).toBe(true);
      expect(userIds.has(r.managerId as string)).toBe(true);
    }
  });

  it("every generated id is namespaced with PERF_ID_PREFIX", () => {
    const data = buildPerfDataset(scale({ types: 20, slabs: 50, pieces: 30 }), FIXED_NOW_MS);
    const allIds = [
      ...data.users.map((u) => u.id),
      ...data.stoneTypes.map((t) => t.id as string),
      ...data.batches.map((b) => b.id as string),
      ...data.slabs.map((s) => s.id as string),
      ...data.pieces.map((p) => p.id as string),
      ...data.reservations.map((r) => r.id as string),
    ];
    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(id.startsWith(PERF_ID_PREFIX)).toBe(true);
    }
  });
});

describe("buildPerfDataset — schema CHECK constraints", () => {
  it("Batch: at least one of slabsTotal / areaTotalM2 is NOT NULL (Batch_totals_check)", () => {
    const data = buildPerfDataset(
      scale({ types: 40, slabs: 300, pieces: 100 }),
      FIXED_NOW_MS,
    );
    expect(data.batches.length).toBeGreaterThan(0);
    for (const batch of data.batches) {
      const hasSlabs = batch.slabsTotal != null;
      const hasArea = batch.areaTotalM2 != null;
      expect(hasSlabs || hasArea).toBe(true);
      // Generator fills both so free remainder stays positive.
      expect(typeof batch.slabsTotal).toBe("number");
      expect(batch.slabsTotal as number).toBeGreaterThan(0);
      expect(batch.areaTotalM2).toBeTruthy();
    }
  });

  it("Reservation BATCH_VOLUME: batchId set, slab/piece null, qty filled (Reservation_target_check)", () => {
    // Larger type count → more batches → some ~5% reservations.
    const data = buildPerfDataset(
      scale({ types: 200, slabs: 400, pieces: 100 }),
      FIXED_NOW_MS,
    );
    expect(data.reservations.length).toBeGreaterThan(0);
    for (const r of data.reservations) {
      expect(r.targetType).toBe("BATCH_VOLUME");
      expect(r.batchId).toBeTruthy();
      expect(r.slabId ?? null).toBeNull();
      expect(r.pieceId ?? null).toBeNull();
      const hasQty =
        (r.qtySlabs != null && r.qtySlabs > 0) ||
        (r.qtyAreaM2 != null && String(r.qtyAreaM2).length > 0);
      expect(hasQty).toBe(true);
      expect(r.status).toBe("ACTIVE");
      expect(r.managerId).toBe(PERF_MANAGER_USER_ID);
    }
  });

  it("StoneType name and qrSlug are unique within the set", () => {
    const data = buildPerfDataset(DEFAULT_SCALE, FIXED_NOW_MS);
    const names = data.stoneTypes.map((t) => t.name as string);
    const slugs = data.stoneTypes.map((t) => t.qrSlug as string);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const name of names) {
      expect(name.startsWith(PERF_NAME_PREFIX)).toBe(true);
    }
  });
});

describe("buildPerfDataset — required Piece fields", () => {
  it("sidesMm, boundingLengthMm, boundingWidthMm are always present and positive", () => {
    const data = buildPerfDataset(
      scale({ types: 30, slabs: 100, pieces: 400 }),
      FIXED_NOW_MS,
    );
    expect(data.pieces.length).toBe(400);
    for (const piece of data.pieces) {
      expect(piece.sidesMm).toBeDefined();
      expect(Array.isArray(piece.sidesMm)).toBe(true);
      const sides = piece.sidesMm as number[];
      expect(sides.length).toBeGreaterThanOrEqual(3);
      for (const side of sides) {
        expect(Number.isFinite(side)).toBe(true);
        expect(side).toBeGreaterThan(0);
      }
      expect(piece.boundingLengthMm).toBeTypeOf("number");
      expect(piece.boundingWidthMm).toBeTypeOf("number");
      expect(piece.boundingLengthMm as number).toBeGreaterThan(0);
      expect(piece.boundingWidthMm as number).toBeGreaterThan(0);
    }
  });
});

describe("buildPerfDataset — zero-availability share", () => {
  it("is code-derived ~1/3 of types (i % 3 === 0), not 0% and not 100%", () => {
    const types = DEFAULT_SCALE.types;
    const data = buildPerfDataset(DEFAULT_SCALE, FIXED_NOW_MS);

    const typesWithBatch = new Set(data.batches.map((b) => b.stoneTypeId as string));
    const zeroAvail = data.stoneTypes.filter((t) => !typesWithBatch.has(t.id as string));
    const share = zeroAvail.length / data.stoneTypes.length;

    const expected = expectedZeroAvailabilityCount(types);
    expect(zeroAvail.length).toBe(expected);
    // 334/1000 = 0.334 — the wave-1 claim, derived from the code, not hardcoded.
    expect(share).toBeCloseTo(expected / types, 5);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
    // Both branches exist: types with availability and types without.
    expect(zeroAvail.length).toBeGreaterThan(0);
    expect(typesWithBatch.size).toBeGreaterThan(0);
  });
});

describe("buildPerfDataset — search realism", () => {
  it("name / rockType / color vary so a contains-filter matches some rows and not others", () => {
    const data = buildPerfDataset(
      scale({ types: 80, slabs: 0, pieces: 0 }),
      FIXED_NOW_MS,
    );

    const names = data.stoneTypes.map((t) => (t.name as string).toLowerCase());
    const rockTypes = data.stoneTypes.map((t) => (t.rockType as string).toLowerCase());
    const colors = data.stoneTypes
      .map((t) => t.color)
      .filter((c): c is string => c != null)
      .map((c) => c.toLowerCase());

    // Diversity: not every type is identical.
    expect(new Set(rockTypes).size).toBeGreaterThan(1);
    expect(new Set(colors).size).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);

    // A realistic ILIKE-style contains on a common rock word hits some, not all.
    const needle = "мрамор";
    const rockHits = rockTypes.filter((r) => r.includes(needle));
    expect(rockHits.length).toBeGreaterThan(0);
    expect(rockHits.length).toBeLessThan(rockTypes.length);

    // Color contains similarly partial.
    const colorNeedle = "белый";
    const colorHits = colors.filter((c) => c.includes(colorNeedle));
    expect(colorHits.length).toBeGreaterThan(0);
    expect(colorHits.length).toBeLessThan(colors.length);

    // Name contains: a specific suffix should not match every row.
    const nameNeedle = "classic";
    const nameHits = names.filter((n) => n.includes(nameNeedle));
    expect(nameHits.length).toBeGreaterThan(0);
    expect(nameHits.length).toBeLessThan(names.length);
  });
});

describe("buildPerfDataset — determinism", () => {
  it("same (scale, nowMs) → identical structural output (seeded PRNG)", () => {
    const s = scale({ types: 25, slabs: 120, pieces: 60 });
    const a = buildPerfDataset(s, FIXED_NOW_MS);
    const b = buildPerfDataset(s, FIXED_NOW_MS);

    expect(a.stoneTypes).toEqual(b.stoneTypes);
    expect(a.batches).toEqual(b.batches);
    expect(a.slabs).toEqual(b.slabs);
    expect(a.pieces).toEqual(b.pieces);
    expect(a.reservations).toEqual(b.reservations);
    expect(a.users).toEqual(b.users);
  });

  it("different nowMs only changes date fields, not ids/labels/counts", () => {
    const s = scale({ types: 15, slabs: 40, pieces: 20 });
    const a = buildPerfDataset(s, FIXED_NOW_MS);
    const b = buildPerfDataset(s, FIXED_NOW_MS + 86_400_000);

    expect(a.stoneTypes.map((t) => t.id)).toEqual(b.stoneTypes.map((t) => t.id));
    expect(a.slabs.map((sl) => ({ id: sl.id, label: sl.label, batchId: sl.batchId }))).toEqual(
      b.slabs.map((sl) => ({ id: sl.id, label: sl.label, batchId: sl.batchId })),
    );
    expect(a.batches.length).toBe(b.batches.length);
    // arrivedAt / expiresAt are anchored to nowMs — they must differ.
    const aArrived = a.batches.map((x) => (x.arrivedAt as Date).getTime());
    const bArrived = b.batches.map((x) => (x.arrivedAt as Date).getTime());
    expect(aArrived).not.toEqual(bArrived);
  });
});

// ───────────────────────── parse / validate (pure, no DB) ─────────────────────────

describe("parsePerfArgs / validatePerfArgs", () => {
  it("requires --yes (or SEED_PERF_CONFIRM=yes) before anything is ok", () => {
    const raw = parsePerfArgs([], emptyEnv());
    expect(raw.confirm).toBe(false);
    expect(validatePerfArgs(raw)).toEqual({ ok: false, error: "confirm" });
  });

  it("argv --yes unlocks defaults; env SEED_PERF_CONFIRM=yes also works", () => {
    expect(validatePerfArgs(parsePerfArgs(["--yes"], emptyEnv()))).toEqual({
      ok: true,
      scale: DEFAULT_SCALE,
      purge: false,
    });
    const env = {
      NODE_ENV: "test",
      SEED_PERF_CONFIRM: "yes",
    } as NodeJS.ProcessEnv;
    expect(validatePerfArgs(parsePerfArgs([], env)).ok).toBe(true);
  });

  it("argv scale flags override env; rejects non-integers and out-of-range", () => {
    const env = {
      NODE_ENV: "test",
      SEED_PERF_TYPES: "10",
      SEED_PERF_SLABS: "20",
      SEED_PERF_PIECES: "30",
      SEED_PERF_CONFIRM: "yes",
    } as NodeJS.ProcessEnv;
    const raw = parsePerfArgs(["--types=5", "--slabs=6", "--pieces=7"], env);
    expect(validatePerfArgs(raw)).toEqual({
      ok: true,
      scale: { types: 5, slabs: 6, pieces: 7 },
      purge: false,
    });

    expect(
      validatePerfArgs(parsePerfArgs(["--yes", "--types=abc"], emptyEnv())),
    ).toEqual({ ok: false, error: "number" });
    expect(
      validatePerfArgs(
        parsePerfArgs([`--yes`, `--types=${MAX_SCALE.types + 1}`], emptyEnv()),
      ),
    ).toEqual({ ok: false, error: "range" });
    expect(
      validatePerfArgs(parsePerfArgs(["--yes", "--types=0"], emptyEnv())),
    ).toEqual({ ok: false, error: "range" });
  });

  // W3-A / W2-B Finding A regression:
  // isZeroAvailabilityType(0) === true → types=1 never creates batches.
  // Without this guard, validate ok:true and buildPerfDataset returns 0 slabs/pieces.
  it("rejects types=1 when slabs or pieces > 0 (impossible: no available batch)", () => {
    // Explicit impossible combo reported by W2-B.
    expect(
      validatePerfArgs({
        types: "1",
        slabs: "50000",
        pieces: "10000",
        confirm: true,
        purge: false,
      }),
    ).toEqual({ ok: false, error: "range" });

    // --yes --types=1 alone uses DEFAULT_SCALE slabs/pieces → also impossible.
    expect(
      validatePerfArgs(parsePerfArgs(["--yes", "--types=1"], emptyEnv())),
    ).toEqual({ ok: false, error: "range" });

    // Either dimension alone is enough to reject.
    expect(
      validatePerfArgs({
        types: "1",
        slabs: "10",
        pieces: "0",
        confirm: true,
        purge: false,
      }),
    ).toEqual({ ok: false, error: "range" });
    expect(
      validatePerfArgs({
        types: "1",
        slabs: "0",
        pieces: "10",
        confirm: true,
        purge: false,
      }),
    ).toEqual({ ok: false, error: "range" });

    // types-only seed (no units) remains valid — generator still yields 1 StoneType.
    expect(
      validatePerfArgs({
        types: "1",
        slabs: "0",
        pieces: "0",
        confirm: true,
        purge: false,
      }),
    ).toEqual({
      ok: true,
      scale: { types: 1, slabs: 0, pieces: 0 },
      purge: false,
    });

    // types=2 is the minimum that has a non-zero-availability index under i%3===0.
    expect(
      validatePerfArgs({
        types: "2",
        slabs: "10",
        pieces: "5",
        confirm: true,
        purge: false,
      }),
    ).toEqual({
      ok: true,
      scale: { types: 2, slabs: 10, pieces: 5 },
      purge: false,
    });

    // Purge ignores scale — types=1 + purge must still be allowed.
    expect(
      validatePerfArgs({
        types: "1",
        slabs: "50000",
        pieces: "10000",
        confirm: true,
        purge: true,
      }),
    ).toEqual({
      ok: true,
      scale: { types: 1, slabs: 50000, pieces: 10000 },
      purge: true,
    });
  });
});

describe("chunk", () => {
  it("splits into CHUNK_SIZE-aligned parts without dropping rows", () => {
    const rows = Array.from({ length: 2501 }, (_, i) => i);
    const parts = chunk(rows, 1000);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(1000);
    expect(parts[1]).toHaveLength(1000);
    expect(parts[2]).toHaveLength(501);
    expect(parts.flat()).toEqual(rows);
  });
});
