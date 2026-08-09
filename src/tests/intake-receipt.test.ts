// W7-A2 — MutationReceipt intake idempotency (no DB).
// Proves: replay returns first batch without second create; concurrent race
// yields one winner; fresh mutationId creates a new batch.
import { describe, expect, it, vi } from "vitest";
import {
  createIntakeWithReceipt,
  IntakeConcurrentClaimError,
  parseMutationId,
  type IntakeReceiptTx,
} from "@/lib/intake-receipt";
import type { ValidIntake } from "@/lib/validators/intake";

const MUT_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MUT_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

function validData(overrides: Partial<ValidIntake> = {}): ValidIntake {
  return {
    stoneType: { kind: "existing", id: "st1" },
    slabsTotal: 10,
    areaTotalM2: 50,
    lengthMm: 280,
    widthMm: 160,
    thicknessMm: 2,
    supplierNote: null,
    arrivedAt: new Date("2026-07-31T00:00:00Z"),
    locations: [{ block: "А", landmark: "1", slabsHere: null, areaHereM2: null }],
    patterns: [],
    ...overrides,
  };
}

function makeTx() {
  const receipts = new Map<
    string,
    { entityId: string; resultJson: { stoneName: string; patternIds: string[] } }
  >();
  let batchSeq = 0;
  const batchCreate = vi.fn(async () => {
    batchSeq += 1;
    return { id: `batch-${batchSeq}` };
  });
  const receiptCreate = vi.fn(
    async (args: {
      data: {
        mutationId: string;
        entityId: string;
        resultJson: { stoneName: string; patternIds: string[] };
      };
    }) => {
      if (receipts.has(args.data.mutationId)) {
        const err = Object.assign(new Error("Unique constraint"), {
          code: "P2002",
        });
        throw err;
      }
      receipts.set(args.data.mutationId, {
        entityId: args.data.entityId,
        resultJson: args.data.resultJson,
      });
      return args.data;
    },
  );

  const tx = {
    mutationReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { mutationId: string } }) => {
        const r = receipts.get(where.mutationId);
        if (!r) return null;
        return { entityId: r.entityId, resultJson: r.resultJson };
      }),
      create: receiptCreate,
    },
    stoneType: {
      findUnique: vi.fn(async () => ({
        id: "st1",
        name: "Травертин Classic",
        isArchived: false,
      })),
      create: vi.fn(),
    },
    batch: { create: batchCreate },
    batchPattern: { create: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
  } as unknown as IntakeReceiptTx;

  return { tx, receipts, batchCreate, receiptCreate };
}

const baseArgs = {
  actorId: "user-wh",
  data: validData(),
  canSeePrices: false,
  slugify: (n: string) => n,
  randomSuffix: () => "x",
};

describe("parseMutationId", () => {
  it("accepts UUID v4 (normalizes lowercase)", () => {
    expect(parseMutationId("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE")).toBe(MUT_A);
  });
  it("rejects empty / garbage", () => {
    expect(parseMutationId("")).toBeNull();
    expect(parseMutationId("not-a-uuid")).toBeNull();
    expect(parseMutationId(null)).toBeNull();
  });
});

describe("createIntakeWithReceipt — idempotency", () => {
  it("fresh mutationId creates exactly one batch", async () => {
    const { tx, batchCreate } = makeTx();
    const r = await createIntakeWithReceipt(tx, {
      ...baseArgs,
      mutationId: MUT_A,
    });
    expect(r.replay).toBe(false);
    expect(r.batchId).toBe("batch-1");
    expect(r.stoneName).toBe("Травертин Classic");
    expect(batchCreate).toHaveBeenCalledTimes(1);
  });

  it("replayed mutationId creates NO second batch and returns the first", async () => {
    const { tx, batchCreate } = makeTx();
    const first = await createIntakeWithReceipt(tx, {
      ...baseArgs,
      mutationId: MUT_A,
    });
    const second = await createIntakeWithReceipt(tx, {
      ...baseArgs,
      mutationId: MUT_A,
    });
    expect(first.batchId).toBe("batch-1");
    expect(second.replay).toBe(true);
    expect(second.batchId).toBe(first.batchId);
    expect(second.stoneName).toBe(first.stoneName);
    expect(batchCreate).toHaveBeenCalledTimes(1);
  });

  it("two concurrent writers: loser hits P2002, one receipt, winner batch id", async () => {
    // Race model (Read Committed):
    // T1 commits fully. T2's opening findUnique is forced null (stale snapshot),
    // so T2 also creates a Batch, then receipt INSERT → P2002 →
    // IntakeConcurrentClaimError (outer $transaction rolls back T2's Batch).
    const { tx, receipts, batchCreate } = makeTx();

    const t1 = await createIntakeWithReceipt(tx, {
      ...baseArgs,
      mutationId: MUT_A,
    });
    expect(t1.batchId).toBe("batch-1");

    let findCalls = 0;
    type FindUnique = (args: {
      where: { mutationId: string };
    }) => Promise<{ entityId: string; resultJson: unknown } | null>;
    // makeTx casts fake to IntakeReceiptTx; rebind via unknown → narrow bag.
    const receiptBag = tx.mutationReceipt as unknown as {
      findUnique: FindUnique;
    };
    const mapFind = receiptBag.findUnique.bind(receiptBag);
    receiptBag.findUnique = async (args) => {
      findCalls += 1;
      if (findCalls === 1) return null; // T2 thinks empty
      return mapFind(args); // after P2002: load winner
    };

    let caught: IntakeConcurrentClaimError | null = null;
    try {
      await createIntakeWithReceipt(tx, { ...baseArgs, mutationId: MUT_A });
    } catch (e) {
      if (e instanceof IntakeConcurrentClaimError) caught = e;
      else throw e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.winner.batchId).toBe("batch-1");
    expect(caught!.winner.replay).toBe(true);

    // Exactly one receipt; batch.create ran for T1 + T2 attempt (T2 rolled back in real DB).
    expect(receipts.size).toBe(1);
    expect(receipts.get(MUT_A)?.entityId).toBe("batch-1");
    expect(batchCreate).toHaveBeenCalledTimes(2);
  });

  it("a genuinely new mutationId still creates a new batch", async () => {
    const { tx, batchCreate } = makeTx();
    const a = await createIntakeWithReceipt(tx, {
      ...baseArgs,
      mutationId: MUT_A,
    });
    const b = await createIntakeWithReceipt(tx, {
      ...baseArgs,
      mutationId: MUT_B,
    });
    expect(a.batchId).toBe("batch-1");
    expect(b.batchId).toBe("batch-2");
    expect(a.batchId).not.toBe(b.batchId);
    expect(batchCreate).toHaveBeenCalledTimes(2);
  });
});
