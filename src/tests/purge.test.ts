// W12-A — purge planner / arg gates (NO live DB). Fake client like seed-demo.test.ts.
import { describe, expect, it } from "vitest";
import {
  PURGE_ALLOW_ENV,
  PURGE_ALLOW_VALUE,
  executePurge,
  formatPlanReport,
  isDemoStoneType,
  parsePurgeArgs,
  planPurge,
  validatePurgeArgs,
  type PurgeDb,
} from "@/lib/purge";

describe("isDemoStoneType — seed-demo.ts markers only", () => {
  it("matches seed-demo names and qrSlugs", () => {
    expect(
      isDemoStoneType({
        name: "Травертин Classic (демо)",
        qrSlug: "demo-travertin",
      }),
    ).toBe(true);
    expect(
      isDemoStoneType({ name: "Оникс Медовый (демо)", qrSlug: "demo-onyx" }),
    ).toBe(true);
    expect(
      isDemoStoneType({ name: "Foo (demo)", qrSlug: "x" }),
    ).toBe(true);
    expect(
      isDemoStoneType({ name: "Real Marble", qrSlug: "demo-custom" }),
    ).toBe(true);
  });
  it("rejects real inventory names without markers", () => {
    expect(
      isDemoStoneType({ name: "Мрамор Сицилия", qrSlug: "mramor-sicilia" }),
    ).toBe(false);
    expect(
      isDemoStoneType({ name: "Оникс Париж", qrSlug: "onyx-paris" }),
    ).toBe(false);
  });
});

describe("parsePurgeArgs / validatePurgeArgs — safety gates", () => {
  it("env gate: missing ONYX_PURGE_ALLOW → error env", () => {
    const raw = parsePurgeArgs(["--scope=A"], {});
    expect(raw.envAllow).toBe(false);
    expect(validatePurgeArgs(raw)).toEqual({ ok: false, error: "env" });
  });

  it("env must be exact value", () => {
    const raw = parsePurgeArgs(["--scope=A"], {
      [PURGE_ALLOW_ENV]: "yes",
    });
    expect(validatePurgeArgs(raw)).toEqual({ ok: false, error: "env" });
  });

  it("scope required", () => {
    const raw = parsePurgeArgs([], {
      [PURGE_ALLOW_ENV]: PURGE_ALLOW_VALUE,
    });
    expect(validatePurgeArgs(raw)).toEqual({ ok: false, error: "scope" });
  });

  it("invalid scope rejected", () => {
    const raw = parsePurgeArgs(["--scope=Z"], {
      [PURGE_ALLOW_ENV]: PURGE_ALLOW_VALUE,
    });
    expect(validatePurgeArgs(raw)).toEqual({ ok: false, error: "scope" });
  });

  it("dry-run: scope + env, no execute → willWrite false", () => {
    const raw = parsePurgeArgs(["--scope=B"], {
      [PURGE_ALLOW_ENV]: PURGE_ALLOW_VALUE,
    });
    const v = validatePurgeArgs(raw);
    expect(v).toEqual({
      ok: true,
      scope: "B",
      execute: false,
      willWrite: false,
    });
  });

  it("execute without --yes → confirm error", () => {
    const raw = parsePurgeArgs(["--scope=C", "--execute"], {
      [PURGE_ALLOW_ENV]: PURGE_ALLOW_VALUE,
    });
    expect(validatePurgeArgs(raw)).toEqual({ ok: false, error: "confirm" });
  });

  it("execute + yes + env → willWrite true", () => {
    const raw = parsePurgeArgs(["--scope=A", "--execute", "--yes"], {
      [PURGE_ALLOW_ENV]: PURGE_ALLOW_VALUE,
    });
    expect(validatePurgeArgs(raw)).toEqual({
      ok: true,
      scope: "A",
      execute: true,
      willWrite: true,
    });
  });
});

/** In-memory rows for plan selection tests. */
function makeFakePurgeDb(seed: {
  stones: Array<{ id: string; name: string; qrSlug: string }>;
  batches: Array<{ id: string; stoneTypeId: string }>;
  counts?: Partial<Record<string, number>>;
}) {
  const calls: Array<{ model: string; op: string; where?: unknown }> = [];
  const c = seed.counts ?? {};

  const countOf = (model: string, defaultN = 0) =>
    c[model] !== undefined ? c[model]! : defaultN;

  const db: PurgeDb = {
    stoneType: {
      findMany: async () => seed.stones,
      count: async ({ where } = {}) => {
        calls.push({ model: "stoneType", op: "count", where });
        if (!where) return seed.stones.length;
        // filter by id.in
        const w = where as { id?: { in: string[] } };
        if (w.id?.in) {
          return seed.stones.filter((s) => w.id!.in.includes(s.id)).length;
        }
        return seed.stones.length;
      },
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "stoneType", op: "deleteMany", where });
        return { count: countOf("stoneType", 0) };
      },
    },
    batch: {
      findMany: async ({ where } = {}) => {
        const w = where as { stoneTypeId?: { in: string[] } } | undefined;
        if (w?.stoneTypeId?.in) {
          return seed.batches
            .filter((b) => w.stoneTypeId!.in.includes(b.stoneTypeId))
            .map((b) => ({ id: b.id }));
        }
        return seed.batches.map((b) => ({ id: b.id }));
      },
      count: async () => countOf("batch", seed.batches.length),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "batch", op: "deleteMany", where });
        return { count: countOf("batch", 0) };
      },
    },
    batchLocation: {
      count: async () => countOf("batchLocation", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "batchLocation", op: "deleteMany", where });
        return { count: countOf("batchLocation", 0) };
      },
    },
    batchPattern: {
      count: async () => countOf("batchPattern", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "batchPattern", op: "deleteMany", where });
        return { count: countOf("batchPattern", 0) };
      },
    },
    slab: {
      count: async ({ where } = {}) => {
        calls.push({ model: "slab", op: "count", where });
        if (
          where &&
          typeof where === "object" &&
          "photoRequestId" in (where as object)
        ) {
          return countOf("slabsWithPhotoRequest", 0);
        }
        return countOf("slab", 0);
      },
      updateMany: async ({ where } = {}) => {
        calls.push({ model: "slab", op: "updateMany", where });
        return { count: countOf("slabsWithPhotoRequest", 0) };
      },
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "slab", op: "deleteMany", where });
        return { count: countOf("slab", 0) };
      },
    },
    piece: {
      count: async () => countOf("piece", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "piece", op: "deleteMany", where });
        return { count: countOf("piece", 0) };
      },
    },
    reservation: {
      count: async () => countOf("reservation", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "reservation", op: "deleteMany", where });
        return { count: countOf("reservation", 0) };
      },
    },
    saleRecord: {
      count: async () => countOf("saleRecord", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "saleRecord", op: "deleteMany", where });
        return { count: countOf("saleRecord", 0) };
      },
    },
    photo: {
      count: async () => countOf("photo", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "photo", op: "deleteMany", where });
        return { count: countOf("photo", 0) };
      },
    },
    photoRequest: {
      count: async ({ where } = {}) => {
        if (
          where &&
          typeof where === "object" &&
          "slabId" in (where as object)
        ) {
          return countOf("photoRequestsWithSlab", 0);
        }
        return countOf("photoRequest", 0);
      },
      updateMany: async ({ where } = {}) => {
        calls.push({ model: "photoRequest", op: "updateMany", where });
        return { count: countOf("photoRequestsWithSlab", 0) };
      },
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "photoRequest", op: "deleteMany", where });
        return { count: countOf("photoRequest", 0) };
      },
    },
    photoDispatch: {
      count: async () => countOf("photoDispatch", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "photoDispatch", op: "deleteMany", where });
        return { count: countOf("photoDispatch", 0) };
      },
    },
    lead: {
      count: async ({ where } = {}) => {
        calls.push({ model: "lead", op: "count", where });
        return countOf("lead", 0);
      },
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "lead", op: "deleteMany", where });
        return { count: countOf("lead", 0) };
      },
    },
    auditLog: {
      count: async () => countOf("auditLog", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "auditLog", op: "deleteMany", where });
        return { count: countOf("auditLog", 0) };
      },
      create: async () => {
        calls.push({ model: "auditLog", op: "create" });
        return {};
      },
    },
    mutationReceipt: {
      count: async () => countOf("mutationReceipt", 0),
      deleteMany: async ({ where } = {}) => {
        calls.push({ model: "mutationReceipt", op: "deleteMany", where });
        return { count: countOf("mutationReceipt", 0) };
      },
    },
    $transaction: async (fn) => fn(db),
  };

  return { db, calls };
}

const DEMO_STONES = [
  {
    id: "st-demo-1",
    name: "Травертин Classic (демо)",
    qrSlug: "demo-travertin",
  },
  {
    id: "st-demo-2",
    name: "Оникс Медовый (демо)",
    qrSlug: "demo-onyx",
  },
  {
    id: "st-real",
    name: "Мрамор Сицилия",
    qrSlug: "mramor-sicilia",
  },
];

const BATCHES = [
  { id: "b-demo", stoneTypeId: "st-demo-1" },
  { id: "b-real", stoneTypeId: "st-real" },
];

describe("planPurge — scope selection (fake client)", () => {
  it("scope A: only demo-marked stone types + their batches", async () => {
    const { db } = makeFakePurgeDb({
      stones: DEMO_STONES,
      batches: BATCHES,
      counts: {
        batch: 1,
        slab: 0,
        piece: 0,
        photo: 2,
        photoRequest: 1,
        photoDispatch: 1,
        saleRecord: 0,
        reservation: 0,
        lead: 0,
        batchLocation: 2,
        batchPattern: 0,
        auditLog: 99,
        mutationReceipt: 1,
      },
    });

    const plan = await planPurge(db, "A");
    expect(plan.stoneTypeIds.sort()).toEqual(["st-demo-1", "st-demo-2"]);
    expect(plan.batchIds).toEqual(["b-demo"]);
    expect(plan.counts.stoneTypes).toBe(2);
    // Scope A does not count AuditLog for deletion
    expect(plan.counts.auditLogs).toBe(0);
    expect(plan.preserved).toContain("User");
    expect(plan.preserved).toContain("WarehouseBlock");
    expect(formatPlanReport(plan)).toContain("scope=A");
  });

  it("scope B: all stone types", async () => {
    const { db } = makeFakePurgeDb({
      stones: DEMO_STONES,
      batches: BATCHES,
      counts: { batch: 2 },
    });
    const plan = await planPurge(db, "B");
    expect(plan.stoneTypeIds.sort()).toEqual([
      "st-demo-1",
      "st-demo-2",
      "st-real",
    ]);
    expect(plan.batchIds.sort()).toEqual(["b-demo", "b-real"]);
    expect(plan.counts.auditLogs).toBe(0);
  });

  it("scope C: plans AuditLog + all leads wipe", async () => {
    const { db, calls } = makeFakePurgeDb({
      stones: DEMO_STONES,
      batches: BATCHES,
      counts: { auditLog: 50, lead: 7 },
    });
    const plan = await planPurge(db, "C");
    expect(plan.counts.auditLogs).toBe(50);
    expect(plan.counts.leads).toBe(7);
    // lead.count called without stone filter for C
    const leadCount = calls.find(
      (c) => c.model === "lead" && c.op === "count",
    );
    expect(leadCount).toBeTruthy();
  });
});

describe("executePurge — order and audit marker (fake client)", () => {
  it("deletes Photo before Slab before Batch before StoneType; writes AuditLog", async () => {
    const { db, calls } = makeFakePurgeDb({
      stones: DEMO_STONES.filter((s) => s.id !== "st-real"),
      batches: [{ id: "b-demo", stoneTypeId: "st-demo-1" }],
      counts: {
        photoDispatch: 1,
        photo: 2,
        saleRecord: 1,
        reservation: 1,
        lead: 1,
        photoRequest: 1,
        piece: 1,
        slab: 1,
        batchLocation: 1,
        batchPattern: 0,
        batch: 1,
        stoneType: 2,
        mutationReceipt: 1,
        slabsWithPhotoRequest: 1,
        photoRequestsWithSlab: 0,
      },
    });

    const result = await executePurge(db, "A", () => {});
    expect(result.auditLogged).toBe(true);
    expect(result.deleted.stoneTypes).toBe(2);

    const deleteModels = calls
      .filter((c) => c.op === "deleteMany")
      .map((c) => c.model);

    // Restrict-safe order prefixes
    const idx = (m: string) => deleteModels.indexOf(m);
    expect(idx("photoDispatch")).toBeLessThan(idx("photo"));
    expect(idx("photo")).toBeLessThan(idx("photoRequest"));
    expect(idx("piece")).toBeLessThan(idx("slab"));
    expect(idx("slab")).toBeLessThan(idx("batch"));
    expect(idx("batch")).toBeLessThan(idx("stoneType"));

    // Slab cycle break before PhotoRequest delete
    const slabNull = calls.findIndex(
      (c) => c.model === "slab" && c.op === "updateMany",
    );
    const prDel = calls.findIndex(
      (c) => c.model === "photoRequest" && c.op === "deleteMany",
    );
    expect(slabNull).toBeGreaterThanOrEqual(0);
    expect(slabNull).toBeLessThan(prDel);

    expect(calls.some((c) => c.model === "auditLog" && c.op === "create")).toBe(
      true,
    );
  });

  it("scope C deletes auditLog before writing marker", async () => {
    const { db, calls } = makeFakePurgeDb({
      stones: [],
      batches: [],
      counts: { auditLog: 3, lead: 1 },
    });
    // C with no stones still wipes leads/audit
    const result = await executePurge(db, "C", () => {});
    expect(result.deleted.auditLogs).toBe(3);
    expect(result.deleted.leads).toBe(1);
    const auditDel = calls.findIndex(
      (c) => c.model === "auditLog" && c.op === "deleteMany",
    );
    const auditCreate = calls.findIndex(
      (c) => c.model === "auditLog" && c.op === "create",
    );
    expect(auditDel).toBeGreaterThanOrEqual(0);
    expect(auditCreate).toBeGreaterThan(auditDel);
  });

  it("scope A with no demo stones deletes nothing inventory", async () => {
    const { db, calls } = makeFakePurgeDb({
      stones: [
        { id: "r1", name: "Real", qrSlug: "real" },
      ],
      batches: [{ id: "b1", stoneTypeId: "r1" }],
      counts: { stoneType: 99, batch: 99 },
    });
    const result = await executePurge(db, "A", () => {});
    expect(result.deleted.stoneTypes).toBe(0);
    expect(result.deleted.batches).toBe(0);
    // No inventory deleteMany when no matching stones
    expect(
      calls.filter((c) => c.op === "deleteMany" && c.model === "stoneType"),
    ).toHaveLength(0);
  });
});

describe("validatePurgeArgs does not default a destructive scope", () => {
  it("empty argv never becomes willWrite", () => {
    const v = validatePurgeArgs(
      parsePurgeArgs([], { [PURGE_ALLOW_ENV]: PURGE_ALLOW_VALUE }),
    );
    expect(v.ok).toBe(false);
  });
});

